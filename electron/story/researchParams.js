/** IPC와 Agent가 공유하는 YouTube 검색 결과 개수 경계. */
export function clampResearchMaxResults(maxResults) {
  return Math.min(Math.max(1, Math.floor(maxResults)), 50)
}

/** Agent 승인창과 실행 adapter가 공유하는 채택 인덱스 계약. */
export function normalizeResearchAdoptedIndices(adoptedIndices) {
  if (!Array.isArray(adoptedIndices)) return adoptedIndices
  return adoptedIndices.filter((index) => Number.isInteger(index) && index >= 0)
}
