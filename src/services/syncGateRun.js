import { resolveSyncTarget, isRefSynced, planSyncGateCompletion } from '../utils/flowCharacterSync'

/**
 * 동기화 게이트의 "동기화 후 생성" 실행부.
 *
 * App 안에 인라인으로 있을 땐 프로젝트 스코프 판정과 forceRepair 전달을 통째로 되돌려도 전체
 * 스위트가 초록불이었다(뮤테이션 실측) — 이 수정이 주장하는 보장 두 가지가 무방비였다.
 *
 * 규칙:
 *  - 대상은 모달을 열 때의 스냅샷이지만, 실행은 **매 회차 live ref** 로 다시 판단한다. 스냅샷을
 *    넘기면 그 사이 끝난 sync 의 entityId 를 못 보고 재업로드로 빠져 중복 entity 가 생긴다.
 *  - 프로젝트가 바뀌면 어느 지점에서든 멈추고 실패로 닫는다(fail-closed). 계속하면 B 의 ref 를
 *    A 의 Flow 프로젝트로 동기화하거나 A 의 결과를 B 의 ref 에 덮어쓴다.
 *  - 어떤 출구로 나가든 대기자는 정확히 한 번 정산된다 — 안 그러면 그 promise 를 기다리던 생성
 *    큐가 영영 멈춘다.
 *
 * @param {{gate: {refs: Array, forceRepair?: boolean, scope?: string|null}}} params
 * @param {{
 *   getReferences: () => Array,
 *   getProjectName: () => string,
 *   isProjectLoading: () => boolean,
 *   getFlowProjectId: () => string|null,
 *   getScopeToken: () => string,
 *   syncRef: (ref: object, opts: object) => Promise<{ok: boolean, patch?: object, error?: string}>,
 *   publishRefs: (updater: (prev: Array) => Array) => void,
 *   refreshComposer?: () => Promise<any>,
 *   onIncomplete: (counts: {ok: number, fail: number}) => void,
 *   onSuccess: (counts: {ok: number}) => void,
 *   finish: (patchedRefs: Array) => void,
 *   abort: (reason: string) => void,
 * }} deps
 */
export async function runSyncGate({ gate }, deps) {
  // 게이트가 **열린 시점**의 프로젝트. 실행 시점에 읽으면 그 사이 바뀐 프로젝트를 정상으로
  // 간주해, A 에서 열린 목록을 B 의 refs 와 대조하게 된다.
  const gateProject = gate.scope ?? deps.getProjectName()
  const scopeChanged = () => deps.isProjectLoading() || deps.getProjectName() !== gateProject

  let ok = 0, fail = 0
  // #R34-fix: 패치를 로컬 배열에 누적해 생성에 넘긴다(React state 는 같은 tick 에 stale).
  let patchedRefs = deps.getReferences()
  const flowProjectId = deps.getFlowProjectId()
  const scopeToken = deps.getScopeToken()

  const patchAt = (list, ref, refIndex, patch) => list.map((r, i) => (
    ref.id != null ? r.id === ref.id : i === refIndex
  ) ? { ...r, ...patch } : r)

  const targets = (gate.refs || []).map((ref) => {
    const refIndex = ref.id != null
      ? patchedRefs.findIndex(r => r.id === ref.id)
      : patchedRefs.findIndex(r => r === ref || (
        r?.id == null && r?.type === ref.type && r?.name === ref.name
        && (r?.filePath || r?.imagePath || '') === (ref.filePath || ref.imagePath || '')
      ))
    return { ref, refIndex }
  })

  if (scopeChanged()) { deps.abort('project-changed'); return }

  for (const { ref, refIndex } of targets) {
    const live = ref.id != null
      ? deps.getReferences().find(r => r.id === ref.id)
      : deps.getReferences()[refIndex]
    // forceRepair: 엔진이 거절한 뒤의 복구 요청이면 기록이 synced 여도 재등록을 태운다.
    const decision = resolveSyncTarget(live, { forceRepair: !!gate.forceRepair })
    if (decision.action === 'skip') {
      if (decision.reason === 'already-synced') {
        ok++
        // ⚠️ live 를 patchedRefs 에 병합해야 한다 — 이 배열이 생성에 넘어가는 authoritative refs 다.
        //   안 하면 "동기화 성공"이라 보고해놓고 생성에는 entity 없는 stale ref 가 넘어간다.
        patchedRefs = patchAt(patchedRefs, ref, refIndex, live)
      } else {
        fail++
        console.warn('[SyncGate] skip:', ref?.name, decision.reason)
      }
      continue
    }
    const res = await deps.syncRef(decision.ref, {
      projectId: flowProjectId,
      scopeToken,
      refIndex,
      // patch publish 를 flight 안에서 실행 — React setter 전에 같은 stale ref 가 재진입하는 창 제거.
      publishResult: async (syncResult) => {
        if (!syncResult.patch) return
        // 프로젝트가 바뀌었으면 지금의 refs 는 다른 프로젝트 것이다 — 패치하지 않는다.
        if (scopeChanged()) return
        patchedRefs = patchAt(patchedRefs, ref, refIndex, syncResult.patch)
        deps.publishRefs(prev => patchAt(prev, ref, refIndex, syncResult.patch))
      },
    })
    if (scopeChanged()) {
      // 원격 동기화는 성공했을 수 있지만 이 결과를 지금 프로젝트의 성공으로 셀 수는 없다.
      console.warn('[SyncGate] aborted — project changed mid-sync')
      deps.abort('project-changed')
      return
    }
    const synced = res.ok && isRefSynced(res.patch ? { ...ref, ...res.patch } : ref)
    if (synced) ok++
    else { fail++; console.warn('[SyncGate] sync incomplete for', ref?.name, res.error || res.patch?.flowNameSyncStatus) }
  }

  try { await deps.refreshComposer?.() } catch (_e) { /* best-effort */ }

  if (scopeChanged()) { deps.abort('project-changed'); return }

  // required mention sync 는 all-or-nothing. 하나라도 실패하면 혼합 resolved/unresolved 는 하드
  // 에러, all-unresolved+mediaId 는 plain-image 로 조용히 degrade 하므로 생성을 시작하지 않는다.
  if (!planSyncGateCompletion(ok, fail).proceed) {
    deps.onIncomplete({ ok, fail })
    deps.abort('sync-incomplete')
    return
  }
  deps.onSuccess({ ok })
  deps.finish(patchedRefs)
}
