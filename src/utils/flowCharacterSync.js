// src/utils/flowCharacterSync.js
//
// #R34: 레퍼런스를 Flow 에 (재)동기화하는 공통 로직 — Ref 상세 모달 단건 동기화, ReferencePanel
//   일괄 동기화, 그리고 App 의 생성 전 sync 게이트가 공유한다. 캐릭터 entity 동기화는 생성 배치에서
//   분리됐다(공유 flowView DOM 동시 실행 충돌 + 중복 생성) — useAutomation 은 flow 모드에서 character
//   를 업로드 대상에서 제외한다.
//
//   - character:
//       · entityId + workflowId 가 있으면 → **재업로드하지 않고** 등록 PATCH 만 복구(#R37).
//         uploadImage 는 부를 때마다 새 entity 를 만들기 때문이다(중복의 근본 원인).
//       · id 가 없거나 entity 가 stale(404/NOT_FOUND)이면 → 업로드로 (재)생성
//   - 그 외(scene 등): 일반 ref 업로드 → mediaId/caption 갱신
//
//   ⚠️ 진입점은 반드시 **live ref** 로 resolveSyncTarget 을 거쳐야 한다 — 스냅샷을 넘기면 그 사이
//      끝난 다른 sync 의 entityId 를 못 보고 재업로드로 빠져 중복 entity 가 생긴다.
//
// 부수효과: onUpload(IPC) + fileSystemAPI(filePath 읽기)에 의존. 결과 patch 만 돌려주고,
//   상태 반영(setEditData/updateReferences)·refresh 는 호출측이 한다.

import { cleanBase64 } from './urls'
import { applyEntityRegistrationPatch } from './refEntityRegistration'
import { resolveMentions } from './mentionParser'
import { fileSystemAPI } from '../hooks/useFileSystem'
import {
  isFlowCharacterOperationActive,
  runFlowCharacterOperation,
} from './flowCharacterCoordinator'

/**
 * ref 가 Flow 에 동기화된 상태인지 판정.
 *   - character: entityId + flowNameSyncStatus==='synced'
 *   - 그 외: mediaId 보유(업로드됨)
 */
export function isRefSynced(ref) {
  if (!ref) return false
  if (ref.type === 'character') return !!(ref.entityId && ref.flowNameSyncStatus === 'synced')
  return !!ref.mediaId
}

/**
 * 레퍼런스 카드에 그릴 배지 상태.
 *
 * 카드는 mediaId 만 보고 녹색 ✅ 를 그렸다. 그런데 applyEntityRegistrationPatch 는 업로드만
 * 성공하면(등록/이름 PATCH 가 실패해 flowNameSyncStatus='failed' 여도) mediaId 를 채운다 —
 * 그래서 "동기화 실패한 캐릭터에 성공 체크"가 떴고, 같은 화면의 Sync(N) 배지는 여전히
 * 미동기화라고 말했다. 사용자는 다 됐다고 믿고 생성 → @멘션이 안 붙었다(실제 리포트).
 *
 * 그래서 이 함수는 Sync 버튼/생성 게이트와 같은 술어(isRefSynced)를 쓴다 — 카드와 배지가
 * 구조적으로 엇갈릴 수 없다. Flow 엔티티 동기화는 flow 모드의 character 에만 의미가 있으므로,
 * api 모드/비-character 는 종전대로 mediaId(=이미지 준비됨) 기준이다.
 *
 * @param {object|null} ref
 * @param {'api'|'flow'|string} mode
 * @returns {'ok'|'needs-sync'|'none'}
 */
export function refBadgeState(ref, mode) {
  if (!ref) return 'none'
  if (mode === 'flow' && ref.type === 'character') {
    if (isRefSynced(ref)) return 'ok'
    return ref.mediaId ? 'needs-sync' : 'none'
  }
  return ref.mediaId ? 'ok' : 'none'
}


/** 생성에 필요한 @mention sync 결과 — 하나라도 실패하면 unresolved ref 가 남으므로 fail closed. */
export function planSyncGateCompletion(ok = 0, fail = 0) {
  return fail > 0
    ? { proceed: false, outcome: 'incomplete' }
    : { proceed: true, outcome: 'complete' }
}

/**
 * 동기화 대상(미동기화 + 이미지 보유)인 character/scene ref 만 추린다.
 *
 * #R37: 이미 동기화가 진행 중인 ref(r.syncing)는 제외한다 — 모달 Sync 는 모달을 닫고 백그라운드로
 *   돌기 때문에, 그 사이 패널의 Sync(N) 를 누르면 같은 ref 를 두 번 업로드하고 Flow 는 그때마다
 *   새 entity 를 만든다(중복의 또 다른 출구). 진입점마다 로컬 busy 플래그만 있고 공유 락이 없다.
 */
export function selectUnsyncedRefs(references = []) {
  return (references || []).filter(r =>
    r && (r.type === 'character' || r.type === 'scene') &&
    !r.syncing &&
    (r.data || r.filePath || r.imagePath) &&
    (r.name && String(r.name).trim()) &&
    !isRefSynced(r)
  )
}

/**
 * 등록/동기화/이름변경 뒤 Flow SPA 를 새로고침해야 하는가.
 *
 * main 이 상세페이지 이름칸 타이핑으로 SPA 스토어를 갱신했으면(result.nameApplied) 프로젝트를
 * 나갔다 재진입하는 refreshFlowComposer(loadURL 2회 + 1s 대기)가 필요 없다. 실패했을 때만 폴백한다.
 * nameApplied 를 안 싣는 옛 응답은 refresh 필요로 본다 — 이름이 안 보이는 쪽이 헛수고보다 나쁘다.
 * 캐릭터가 아닌 ref(scene 등)는 entity 이름 자체가 없으므로 해당 없음.
 */
export function needsComposerRefresh(ref, result) {
  if (!result || result.success === false) return false
  if (ref?.type !== 'character') return false
  if (!result.entityId) return false
  return result.nameApplied !== true
}

/**
 * #R37: 동기화 직전, 이 ref 에 대해 무엇을 할지 결정한다 (순수).
 *
 * 모든 진입점(패널 Sync-all, 모달 Sync, 생성 게이트)은 **스냅샷**을 들고 루프를 돈다 —
 * 게이트 refs 는 모달을 열 때, 패널 targets 는 클릭할 때 캡처된다. 그런데 캐릭터 동기화는
 * 최대 ~120s DOM 자동화라, 그 사이 다른 진입점이 같은 ref 를 동기화해 끝낼 수 있다. 그때
 * 스냅샷에는 entityId 가 없고 live 에는 있다 → 스냅샷으로 planCharacterSync 를 부르면 'upload'
 * 를 골라 **Flow entity 를 하나 더 만든다**. 중복의 진짜 근본 원인이 이 stale 스냅샷이다.
 *
 * 그래서 진입점은 루프 매 회차에 live ref 로 이 함수를 물어야 한다.
 *
 * @param {object|undefined} live - 최신 상태의 ref (없으면 삭제된 것)
 * @returns {{action:'skip'|'sync', reason?:'gone'|'in-flight'|'already-synced', ref?:object}}
 */
export function resolveSyncTarget(live, opts = {}) {
  if (!live) return { action: 'skip', reason: 'gone' }
  if (live.syncing) return { action: 'skip', reason: 'in-flight' }   // 다른 진입점이 이미 처리 중
  // forceRepair: 엔진이 "그 칩은 못 쓴다"(미해결/stale)고 한 뒤의 복구 요청. 우리 기록이 synced 여도
  //   실제로 재등록을 태운다 — 여기서 건너뛰면 모달만 뜨고 아무것도 안 바뀐 채 같은 실패가 반복된다.
  //   planCharacterSync 가 entity+workflow 를 멱등 repair 로 보내므로 중복 entity 는 생기지 않는다.
  if (isRefSynced(live) && !opts.forceRepair) return { action: 'skip', reason: 'already-synced' }
  return { action: 'sync', ref: live }                               // ← 스냅샷이 아니라 live 를 넘긴다
}

/**
 * #R37: 이 ref 를 동기화하려면 무엇을 해야 하는가 (순수).
 *
 * uploadImage 는 호출할 때마다 Flow 에 **새 entity** 를 만든다(useAutomation #R34). 그래서
 * "업로드는 됐고 등록 PATCH 만 실패한" ref 를 재업로드로 재시도하면 같은 캐릭터가 Flow 라이브러리에
 * 계속 쌓인다(실측: 사용자 Flow 에 Zed 4개). 그 상태에서는 entityId/workflowId 를 이미 들고 있으니
 * 재업로드 없이 등록 PATCH 만 다시 치면 된다.
 *
 * workflowId 가 없으면 복구 불가 — register PATCH 는
 *   updateMask 'entityInfo.displayName,entityInfo.characterInfo.imageReferences' 로
 *   imageReferences[{workflowId}] 를 함께 쓰기 때문이다(flow-character-api.js buildEntityRegisterBody).
 * (rename PATCH 는 displayName 만 써서 복구에 쓸 수 없다 — 이미지 레퍼런스가 빈 채로 synced 가 된다.)
 *
 * @returns {'repair-registration'|'upload'}
 */
export function planCharacterSync(ref) {
  if (!ref) return 'upload'
  if (ref.type !== 'character') return 'upload'
  // 이미 synced 여도 재동기화는 repair 로 간다 — register PATCH 는 멱등이라 재업로드보다 안전하다.
  //   (모달 Sync 버튼은 stale entity 복구용으로 synced 여도 눌리게 열려 있다. 그 경로가 upload 로
  //    가면 멀쩡한 캐릭터를 다시 눌렀을 때 중복 entity 가 생긴다.) entity 가 진짜 없으면 PATCH 가
  //   404/NOT_FOUND 로 떨어지고(isStaleRegistrationResponse), 그때만 업로드로 self-heal 한다.
  //
  // ⚠️ 전제: 새 이미지가 들어오면 fresh entity 가 없는 한 옛 entityId 는 비워진다
  //   (entityPatchForNewImage). 안 그러면 여기서 "이미지는 새것인데 옛 entity 를 PATCH" 가 된다.
  if (ref.entityId && ref.workflowId) return 'repair-registration'
  return 'upload'
}

/**
 * ref 한 건을 Flow 에 동기화한다.
 *
 * ok 는 "요청한 동기화가 실제로 끝났는가" 다. 캐릭터는 업로드만 성공하고 등록이 실패하면
 * @멘션이 안 붙으므로 ok:false 다 — 예전엔 ok:true 라 ReferencePanel/DetailModal 이 "동기화 완료"
 * 토스트를 띄웠다. (App 의 생성 게이트는 원래부터 `res.ok && isRefSynced(...)` 를 봐서 영향 없음.)
 * 그래도 patch 는 항상 돌려준다: entityId/workflowId 를 보존해야 다음 시도가 재업로드 없이 복구한다.
 *
 * @param {object} ref
 * @param {Function} onUpload - (base64, meta) => Promise<uploadResult>
 * @param {{registerEntity?: Function}} deps - registerEntity({entityId, workflowId, displayName})
 * @returns {Promise<{ ok: boolean, patch?: object, result?: object, error?: string, status?: number }>}
 */
/**
 * #R37/#R38: project-scoped in-flight 레지스트리.
 *
 * 같은 ref 의 sync 는 진행 중인 promise 에 합류하고, 결과 shape 이 다른 업로드/생성은 공통
 * coordinator 가 busy 로 막는다. ref id 만 쓰지 않고 project/local scope + id-less fallback 을
 * 포함하므로 프로젝트별로 재사용되는 id 가 서로 결과를 받지 않는다.
 */

/** 이 ref 에 대한 업로드/동기화가 진행 중인가 (렌더 상태가 아니라 실제 flight 기준). */
export function isSyncInFlight(refOrId, opts = {}) {
  return isFlowCharacterOperationActive(refOrId, opts)
}

export async function syncRefToFlow(ref, onUpload, deps = {}) {
  try {
    return await runFlowCharacterOperation({
      ref,
      projectId: deps.projectId,
      scopeToken: deps.scopeToken,
      scope: deps.scope,
      refIndex: deps.refIndex,
      operation: 'sync',
      join: true,
      timeoutMs: deps.timeoutMs,
      task: () => syncRefToFlowUnlocked(ref, onUpload, deps),
      // React state setter 를 flight 밖에서 부르면 setter 전의 stale mirror 로 새 업로드가 시작될 수 있다.
      // joiner 별 publisher 를 모두 보호 구간에서 drain 한 뒤 promise/key 를 해제한다.
      publishResult: deps.publishResult,
    })
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

async function syncRefToFlowUnlocked(ref, onUpload, deps = {}) {
  if (!onUpload) return { ok: false, error: 'no uploader' }
  if (!ref?.name || !String(ref.name).trim()) return { ok: false, error: 'name required' }

  // 등록만 실패한 캐릭터 — 재업로드하면 중복 entity 가 생긴다. 등록 PATCH 만 재시도.
  if (planCharacterSync(ref) === 'repair-registration') {
    const registerEntity = deps.registerEntity || defaultRegisterEntity
    let res
    try {
      res = await registerEntity({
        entityId: ref.entityId,
        workflowId: ref.workflowId,
        displayName: ref.name,
        // bound projectId 를 반드시 넘긴다 — 안 넘기면 IPC 가 projectIdFromUrl() 로 폴백해
        //   Flow 탭이 다른 프로젝트로 드리프트했을 때 엉뚱한 프로젝트를 PATCH 한다(rename 경로가
        //   같은 이유로 이미 명시 전달 중).
        projectId: deps.projectId ?? null,
      })
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
    if (res?.success) {
      // result 에 entityId 를 실어 보낸다 — needsComposerRefresh 가 그걸로 판정한다.
      const result = { ...res, entityId: res.entityId ?? ref.entityId, workflowId: res.workflowId ?? ref.workflowId }
      const patch = applyEntityRegistrationPatch(ref, result, true)
      return { ok: patch.flowNameSyncStatus === 'synced', patch, result }
    }
    // entity 가 Flow 에서 삭제됐으면(stale) 복구는 영원히 실패한다 — 이때만 업로드로 self-heal 한다.
    //   (사용자가 중복 캐릭터를 정리하다 앱이 들고 있는 entity 를 지우는 게 실제 시나리오다.)
    if (!res?.stale) {
      // 토큰 만료/PATCH 거절은 재업로드로 안 풀리고 entity 만 늘린다 — 이유를 그대로 올린다.
      return {
        ok: false,
        errorKind: res?.errorKind,
        error: res?.error || 'registration failed',
        status: res?.status,
      }
    }
    console.warn('[flowCharacterSync] entity stale — falling back to upload:', ref?.name)
    // 아래 업로드 경로로 진행(죽은 id 는 uploadReference 응답의 새 id 로 덮인다).
  }

  let b64 = ref.data
  if (!b64 && (ref.filePath || ref.imagePath)) {
    try {
      const fr = await fileSystemAPI.readFileByPath(ref.filePath || ref.imagePath)
      if (fr?.success) b64 = fr.data
    } catch (e) {
      return { ok: false, error: e?.message || 'read failed' }
    }
  }
  if (!b64) return { ok: false, error: 'no image data' }
  let result
  try {
    result = await onUpload(cleanBase64(b64), { category: ref.category, type: ref.type, name: ref.name, refId: ref.id })
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
  if (!result?.success) {
    return { ok: false, errorKind: result?.errorKind, error: result?.error || 'upload failed' }
  }
  if (ref.type !== 'character') {
    return { ok: true, patch: { mediaId: result.mediaId ?? ref.mediaId, caption: result.caption ?? ref.caption }, result }
  }
  const patch = applyEntityRegistrationPatch(ref, result, true)
  const ok = patch.flowNameSyncStatus === 'synced'
  return {
    ok,
    patch,   // 실패해도 id 는 보존 — 다음 시도가 재업로드 없이 복구한다.
    result,
    ...(ok ? {} : {
      errorKind: result.errorKind,
      error: result.error || 'entity registration failed',
    }),
  }
}

/** 기본 registerEntity — 재업로드 없이 등록 PATCH 만 다시 친다. */
async function defaultRegisterEntity(payload) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.flowRegisterCharacterEntity) return { success: false, error: 'flowRegisterCharacterEntity unavailable' }
  return api.flowRegisterCharacterEntity(payload)
}
