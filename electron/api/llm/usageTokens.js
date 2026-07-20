/**
 * 엔진별 raw usage → { input, output } 정규화. 순수 함수.
 *
 * 정의(두 엔진 동일):
 *   in  = cache 포함 총 입력
 *   out = thinking/reasoning 포함 총 출력
 * thinking 은 두 엔진 다 분리 가능하지만 빼지 않는다 — 빼면 같은 "out" 이 엔진마다 다른 걸 센다.
 */

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Claude Agent SDK 의 result 메시지(usage: BetaUsage).
 * BetaUsage 의 input_tokens 는 cache 를 **제외**한다 — cache_creation/cache_read 가 별도 필드다.
 * agent SDK 는 캐시 리드가 입력의 대부분이라 input_tokens 만 세면 심하게 과소.
 * 실패 result(SDKResultError)도 usage 가 필수이며 실제 과금이므로 집계한다.
 */
export function claudeResultToUsage(message) {
  if (message?.type !== 'result') return null
  const u = message.usage
  if (!u) return null
  return {
    input: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens),
    output: n(u.output_tokens),
  }
}

/** thinking 중 system 진행 메시지의 현재 블록 누적 추정 토큰(이미 토큰 단위). 그 외 null. */
export function claudeThinkingTokens(message) {
  if (message?.type !== 'system' || message.subtype !== 'thinking_tokens') return null
  return message.estimated_tokens ?? null
}

/**
 * 스트리밍 실시간 표시용 추정 — message_delta.usage 는 응답 **끝에 한 번만** 오므로
 * (0.3s 짜리든 2분 짜리든 마지막에 딱 1개, 실측 확인됨) 텍스트/JSON 은 델타 길이로
 * 추정하고, thinking 은 system/thinking_tokens 누적 추정값을 쓴다. result 에서 정확치로
 * 확정(commit)된다.
 */

/** message_start 의 입력 토큰(캐시 포함, 즉시 정확). 그 외 null. */
export function claudeStreamInput(message) {
  if (message?.type !== 'stream_event') return null
  const ev = message.event
  if (ev?.type !== 'message_start') return null
  const u = ev.message?.usage
  if (!u) return null
  return n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens)
}

/** content_block_delta 로 흘러온 출력 문자수(text + thinking + structured JSON). 그 외 0.
 *  structured output(씬분리/프롬프트/검수)은 텍스트가 아니라 input_json_delta.partial_json
 *  으로 JSON 을 조각조각 흘린다 — 그것도 세야 그 스텝들도 실시간으로 오른다. */
export function claudeStreamOutChars(message) {
  if (message?.type !== 'stream_event') return 0
  const ev = message.event
  if (ev?.type !== 'content_block_delta') return 0
  const d = ev.delta
  if (d?.type === 'text_delta') return (d.text || '').length
  if (d?.type === 'thinking_delta') return (d.thinking || '').length
  if (d?.type === 'input_json_delta') return (d.partial_json || '').length
  return 0
}

// 문자→토큰 대략 추정. 한국어/마크다운 혼합 기준 ~3자/토큰(느슨). 진행 표시용일 뿐
// result 가 정확치로 덮으므로 정밀도는 중요치 않고, 단조 증가만 하면 된다.
const CHARS_PER_TOKEN = 3
export function estimateOutputTokens(chars) {
  return chars > 0 ? Math.round(chars / CHARS_PER_TOKEN) : 0
}

/**
 * codex app-server `thread/tokenUsage/updated` 의 params.
 *
 * 0.144.5 실측 스키마 — 추론이 아니라 바이너리가 자기 Rust 타입에서 생성한 것:
 *   codex app-server generate-ts --experimental -o <dir>   → <dir>/v2/*.ts
 *
 *   ThreadTokenUsageUpdatedNotification = { threadId, turnId, tokenUsage: ThreadTokenUsage }
 *   ThreadTokenUsage = { total: TokenUsageBreakdown, last: TokenUsageBreakdown, modelContextWindow }
 *   TokenUsageBreakdown = { totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }
 *
 * total 은 thread 누적, last 는 직전 응답 delta → 누적을 읽고 threadId 로 교체한다.
 * inputTokens 는 cached 를 이미 포함하므로 cachedInputTokens 를 더하면 중복이다.
 */
export function codexNotifToUsage(params) {
  const key = params?.threadId
  const total = params?.tokenUsage?.total
  if (!key || !total || typeof total !== 'object') return null
  return { key, input: n(total.inputTokens), output: n(total.outputTokens) }
}
