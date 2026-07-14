// src/utils/refEntityRegistration.js
/**
 * on-demand ref entityId 등록 — 순수 결정 헬퍼.
 *
 * API 모드에서 만든 character ref 는 entityId 가 없어 Flow 멘션 후보(sceneMentions.js B1)가
 * 못 된다. Flow 모드로 전환 후 자동화/생성 시작 시 on-demand 로 uploadReference 를 호출해
 * entityId 를 얻고 ref 를 패치한다(§3.5.3).
 *
 * 이 두 함수는 순수(side-effect 없음)이므로 hook 밖에서도 테스트 가능.
 *
 * sceneMentions.js 멘션 후보 precondition(F9):
 *   type==='character' + entityId + name.trim() + flowNameSyncStatus==='synced'
 */

/**
 * 이 ref 가 on-demand entity 등록이 필요한지 결정한다.
 *
 * @param {{ type?: string, entityId?: string|null }} ref - 레퍼런스 객체
 * @param {'api'|'flow'|string} mode - 현재 엔진 모드
 * @returns {boolean}
 */
export function needsEntityRegistration(ref, mode) {
  if (mode !== 'flow') return false
  if (ref?.type !== 'character') return false
  // #R6-16: "fully registered" = entityId 가 있고 display-name sync 도 성공('synced')한 상태.
  // entityId 만 보고 skip 하면, sync 실패(flowNameSyncStatus!=='synced', registered:false)한 ref 가
  // 영구히 재등록되지 않아 mention 후보(F9: synced 필요)에서 빠진 채 고착된다.
  // sync 안 된 ref 는 재시도 대상으로 둔다(ids 는 applyEntityRegistrationPatch 가 보존).
  if (ref?.entityId && ref?.flowNameSyncStatus === 'synced') return false
  return true
}

/**
 * uploadReference 결과를 ref 에 병합하는 패치 객체를 반환한다(순수).
 *
 * success=true + result.registered !== false + entityId 있음 → synced, registered=true 패치.
 * success=true + result.registered === false (display-name PATCH 실패) → ids 보존, flowNameSyncStatus='failed', registered=false.
 * success=true + entityId 없음 → flowNameSyncStatus='failed', registered=false (재시도 가능).
 * success=false → flowNameSyncStatus='failed' 패치 (멘션 후보에서 제외 유지).
 *
 * @param {object} ref - 원본 ref 객체
 * @param {object} result - uploadReference 반환값 (registered, entityId, workflowId, mediaId)
 * @param {boolean} success - 등록 성공 여부
 * @returns {object} ref 에 spread 가능한 패치 객체
 */
export function applyEntityRegistrationPatch(ref, result, success) {
  if (success) {
    // #R12-9: 부분 등록 결과가 id 를 생략하면(null/undefined) 기존 ref 의 id 를 보존한다 —
    //   안 그러면 재시도(R6-16) 시 기존 entityId/workflowId/mediaId 를 null 로 덮어쓴다.
    const entityId = result.entityId ?? ref?.entityId ?? null
    const workflowId = result.workflowId ?? ref?.workflowId ?? null
    const mediaId = result.mediaId ?? ref?.mediaId ?? null
    // Only mark synced when the display-name PATCH also succeeded and we have an entity id
    const fullyRegistered = result.registered !== false && !!entityId
    return {
      entityId,
      workflowId,
      mediaId,
      flowNameSyncStatus: fullyRegistered ? 'synced' : 'failed',
      registered: fullyRegistered,
    }
  }
  return {
    flowNameSyncStatus: 'failed',
  }
}

/**
 * 이번 run 에서 업로드/등록할 레퍼런스만 고른다(순수).
 *
 * 배치 생성/retry 가 시작될 때 "등록 안 된 모든 character"를 무조건 올리면, 어떤 씬도
 * @멘션·태그로 쓰지 않는 character 까지 매번 Flow 에 업로드된다(멘션도 없는데 등록되는 버그).
 * 그래서 타깃 씬들이 실제 쓰는 ref(usedRefIds = getMatchingReferences 합집합)만 후보로 두고,
 * 그중 소스가 있고 아직 미등록(!mediaId || needsEntityRegistration)인 것만 올린다.
 *
 * @param {Array<object>} references - 전체 레퍼런스
 * @param {Set} usedRefIds - 타깃 씬들이 쓰는 ref id 집합
 * @param {'api'|'flow'|string} mode
 * @returns {Array<object>} 업로드 대상 레퍼런스
 */
export function selectRefsToRegister(references, usedRefIds, mode) {
  return (references || []).filter((r) => {
    const hasSource = !!(r && (r.data || r.filePath || r.imagePath))
    if (!hasSource) return false
    if (!usedRefIds || !usedRefIds.has(r.id)) return false // 타깃 씬이 안 쓰면 스킵
    return !r.mediaId || needsEntityRegistration(r, mode)
  })
}

/**
 * #R37: 새 이미지가 ref 에 들어올 때의 entity 필드 패치(순수).
 *
 * fresh entity 가 없으면(API 모드 생성/업로드 등 entity 를 안 만드는 경로) character 의 옛
 * entityId/workflowId 를 **반드시 비운다**. 안 그러면 이미지만 새것이고 id 는 옛 캐릭터를 가리키는
 * 상태가 되고, 그 ref 를 Sync 하면 planCharacterSync 가 'repair-registration' 으로 가서 옛 entity 만
 * 다시 PATCH 한다 — 새 이미지는 영영 업로드되지 않고 @멘션은 옛 얼굴로 생성된다.
 *
 * ReferenceCard(#R31-3)/ReferenceDetailModal(#R16-3)이 인라인으로 지키던 정책을 한 곳으로 모은 것.
 *
 * @param {object} ref - 새 이미지가 들어갈 ref
 * @param {object|null} result - 업로드/생성 결과 (entityId 가 있으면 fresh 등록)
 * @returns {object} ref 에 spread 할 패치. fresh entity 가 없으면 entity 필드를 전부 null 로 비운다.
 */
export function entityPatchForNewImage(ref, result) {
  if (result?.entityId) return applyEntityRegistrationPatch(ref, result, true)
  // 타입과 무관하게 비운다. character 일 때만 비우면 character→scene→재생성→character 로 되돌렸을 때
  //   옛 entityId 가 부활한다(타입 변경 UI 는 entity 필드를 보존한다) → 새 이미지가 옛 얼굴로 @멘션된다.
  //   비-character 는 entity 개념이 없어 null 로 채워도 무해하므로, "새 이미지엔 옛 entity 가 없다" 를
  //   타입과 상관없는 불변식으로 둔다.
  return { entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null }
}

/**
 * #R37: ref 에서 이미지를 제거할 때 함께 비워야 하는 필드(순수).
 *
 * Flow entity 필드까지 비우지 않으면, 이미지가 없는 ref 가 여전히 옛 entityId 를 들고 있어
 * planCharacterSync 가 'repair-registration' 으로 가서 옛 entity 를 다시 등록한다 —
 * 사용자는 이미지를 지웠는데 @멘션은 옛 얼굴로 계속 생성된다.
 * ReferenceCard 의 '이미지 제거' 는 이 정책을 지키고 있었으나 MCP 경로가 빠져 있었다.
 */
export function clearedImageFields() {
  return {
    data: null, filePath: null, mediaId: null, caption: null, dataStorage: null,
    entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null,
  }
}
