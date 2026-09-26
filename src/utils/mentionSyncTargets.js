/**
 * 개별 씬 생성·배치 프리플라이트가 "동기화가 필요한 @멘션 캐릭터"를 물을 때의 대상 선정 — M3 에서 퇴역(항상 빈 배열).
 *
 * 새 Flow(flow.google.com)엔 캐릭터 entity 동기화가 없고, 엔진은 @멘션을 로컬 이미지 인라인 멘션으로 붙인다(planFlowReferenceComposition —
 * parseSceneMentions 를 쓰지 않는다). 옛 셀렉터(미동기화 캐릭터 멘션)를 남기면 "파서가 둘이면 어긋난다" — 엔진이 쓰지도 않는 동기화 모달이 뜨고,
 * MCP 의 비대화 게이트는 멘션 배치를 취소한다. 대상이 없으니 호출부(emptyRefGate·App·mentionSyncRequest)는 모달 없이 통과한다.
 * 옛 동기화 UI·코드 정리는 범위 밖(계획서 docs/plans/2026-09-25-flow-M3-references-plan.md D15·§7).
 *
 * @param {{scene?: object, names?: string[], references?: Array}} [_req]
 * @returns {Array} 항상 빈 배열 — 호출부는 모달 없이 진행한다
 */
export function selectMentionSyncTargets(_req = {}) {
  return []
}
