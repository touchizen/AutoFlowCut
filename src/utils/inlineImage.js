/**
 * 이미지 바이트(inline)인가 — data:image/<type>;base64,… 또는 접두 없는 긴 base64(60자 표본이 base64 문자뿐·100자 초과).
 *   CDN URL·Flow mediaId·빈 값은 아니다. 2026-10-30 I2V: 엔진(engineFlow)·훅(useVideoAutomation)·MCP set-frame-pairs(mcpFramePairs) 공용.
 */
export function isInlineImageData(v) {
  if (typeof v !== 'string') return false
  if (/^data:image\/[^;,]+;base64,/.test(v)) return true
  return v.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(v.slice(0, 60))
}
