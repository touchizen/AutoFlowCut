/**
 * 정수 clamp + 안전 fallback.
 *
 * value 를 반올림한 정수로 보고 [min, max] 로 제한한다. 단:
 *   - 유한수가 아니거나(value=NaN/'x'/null/undefined) min 미만(0/음수)이면 → fallback
 *     (예: 동시성 0/음수는 무한대기를 유발하므로 기본값으로 회피)
 *   - max 초과는 max 로 clamp
 *   - 숫자 문자열('5')은 파싱
 *
 * @param {*} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback - value 가 유효하지 않을 때 반환
 * @returns {number}
 */
export function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < min) return fallback
  return Math.min(max, n)
}
