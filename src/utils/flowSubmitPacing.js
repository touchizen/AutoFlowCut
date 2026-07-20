// Flow 반봇 페이싱 — 씬 사이 랜덤 대기(ms). 기본 7~15초.
// 단일 웹 패널 DOM 자동화라 빠른 연속 제출이 봇 감지/레이트리밋을 유발하므로 제출 사이에 대기를 둔다.
// min/max 는 설정(SceneTab)에서 조정할 수 있고, start() options 로 여기까지 주입된다.
export const FLOW_SUBMIT_PACING_MIN_MS = 7000
export const FLOW_SUBMIT_PACING_MAX_MS = 15000

// 페이싱 하한 — 0/음수/과소값이 봇 감지를 유발하지 않도록 최소 1초는 보장한다.
export const FLOW_SUBMIT_PACING_FLOOR_MS = 1000
// 페이싱 천장 — 오타(예: 999999초)로 자동화가 멈춘 듯 보이는 것 방지. 60초 상한.
// useAutomation 의 ITEM_TIMEOUT(120초)보다 넉넉히 낮춰야 한다 — 페이싱 대기 동안 직전 제출
// 아이템이 폴링되지 않으므로, 대기가 타임아웃에 근접하면 완료 전에 timed-out 처리된다(리뷰 R2).
export const FLOW_SUBMIT_PACING_CEIL_MS = 60000

function coerce(value, fallback) {
  // null/undefined/'' 는 "미지정" → 기본값 (Number(null)===0, Number('')===0 오검출 방지)
  if (value == null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(FLOW_SUBMIT_PACING_CEIL_MS, Math.max(FLOW_SUBMIT_PACING_FLOOR_MS, Math.floor(n)))
}

/**
 * @param {number} [minMs] 최소 대기(ms). 미지정/잘못된 값이면 기본 7000.
 * @param {number} [maxMs] 최대 대기(ms). 미지정/잘못된 값이면 기본 15000.
 * @param {() => number} [random] 0~1 난수 생성기(테스트 주입용).
 * @returns {number} [min, max] 범위의 랜덤 대기(ms).
 */
export function getFlowSubmitPacingDelayMs(minMs, maxMs, random = Math.random) {
  let lo = coerce(minMs, FLOW_SUBMIT_PACING_MIN_MS)
  let hi = coerce(maxMs, FLOW_SUBMIT_PACING_MAX_MS)
  if (lo > hi) [lo, hi] = [hi, lo] // 역전 입력은 스왑
  return lo + Math.floor(random() * (hi - lo + 1))
}
