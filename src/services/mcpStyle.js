/**
 * MCP styleId 헬퍼 — useMcpServer.js batch path의 UI sync 정책을 한 곳에 모은다.
 *
 * 이전엔 __mcpStartBatch / __mcpStartRefBatch에 같은 sentinel 체크 + normalize + sync 로직이
 * 중복되어 있어 회귀 위험. 이 helper로 정책 단일 출처화.
 */

/**
 * MCP가 명시 styleId를 줬을 때 UI의 selectedStyleRefId를 정규화된 형태로 갱신.
 * sentinel ('auto'/'none')과 omit(null/undefined/'')는 UI를 건드리지 않는다.
 *
 * @param {string|undefined|null} styleId
 * @param {object} deps
 * @param {Function} deps.normalizeStyleId
 * @param {Function} [deps.setSelectedStyleRefId]
 */
export function syncExplicitStyleId(styleId, { normalizeStyleId, setSelectedStyleRefId }) {
  if (styleId === 'auto' || styleId === 'none' || styleId == null || styleId === '') return
  const normalized = normalizeStyleId(styleId)
  if (normalized) setSelectedStyleRefId?.(normalized)
}
