// src/utils/flowCharacterSync.js
//
// #R34: 레퍼런스를 Flow 에 (재)동기화하는 공통 로직 — Ref 상세 모달 단건 동기화와
//   ReferencePanel 일괄 동기화가 공유한다. 캐릭터 entity 동기화는 생성 배치에서 분리됐고
//   (공유 flowView DOM 동시 실행 충돌 + 중복 생성), 오직 Ref 탭의 '동기화' 버튼으로만 수행한다.
//
//   - character: 현재 이미지를 재업로드해 entityId/이름을 (재)등록 → applyEntityRegistrationPatch
//   - 그 외(scene 등): 일반 ref 업로드 → mediaId/caption 갱신
//
// 부수효과: onUpload(IPC) + fileSystemAPI(filePath 읽기)에 의존. 결과 patch 만 돌려주고,
//   상태 반영(setEditData/updateReferences)·refresh 는 호출측이 한다.

import { cleanBase64 } from './urls'
import { applyEntityRegistrationPatch } from './refEntityRegistration'
import { resolveMentions } from './mentionParser'
import { fileSystemAPI } from '../hooks/useFileSystem'

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
 * #R34: 생성 대상 씬들의 @멘션 캐릭터 중 "미동기화" 인 것만 추린다.
 *   생성 전 가드 모달에 쓴다 — 이 캐릭터들이 동기화 안 된 채 생성하면 멘션 실패/이미지 폴백이 된다.
 * @param {Array<{prompt?:string}>} scenes - 생성 대상 씬
 * @param {Array} references - 전체 ref
 * @returns {Array} 미동기화 character ref (멘션된 것만)
 */
export function selectUnsyncedMentionedRefs(scenes = [], references = []) {
  const ids = new Set()
  for (const s of scenes || []) {
    const { matched } = resolveMentions(s?.prompt || '', references)
    for (const r of matched) {
      if (r?.type === 'character' && r.id != null) ids.add(r.id)
    }
  }
  return (references || []).filter(r => r && ids.has(r.id) && !isRefSynced(r))
}

/** 동기화 대상(미동기화 + 이미지 보유)인 character/scene ref 만 추린다. */
export function selectUnsyncedRefs(references = []) {
  return (references || []).filter(r =>
    r && (r.type === 'character' || r.type === 'scene') &&
    (r.data || r.filePath || r.imagePath) &&
    (r.name && String(r.name).trim()) &&
    !isRefSynced(r)
  )
}

/**
 * ref 한 건을 Flow 에 동기화한다.
 * @returns {Promise<{ ok: boolean, patch?: object, result?: object, error?: string }>}
 */
export async function syncRefToFlow(ref, onUpload) {
  if (!onUpload) return { ok: false, error: 'no uploader' }
  if (!ref?.name || !String(ref.name).trim()) return { ok: false, error: 'name required' }
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
  if (!result?.success) return { ok: false, error: result?.error || 'upload failed' }
  const patch = ref.type === 'character'
    ? applyEntityRegistrationPatch(ref, result, true)
    : { mediaId: result.mediaId ?? ref.mediaId, caption: result.caption ?? ref.caption }
  return { ok: true, patch, result }
}
