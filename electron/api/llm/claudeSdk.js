/**
 * Claude Agent SDK 순수 헬퍼 — query 결과/스트림/취소 처리. (AutoMovie vision.mjs 이식 + 확장)
 * SDK 자체는 llmClaude가 동적 import — 여기는 SDK에 의존하지 않는 순수 함수만 둔다(테스트 용이).
 */
const CLAUDE_SDK_EFFORTS = new Set(['low', 'medium', 'high', 'max'])

// thinking 파라미터의 유효한 모양은 모델 세대마다 다르고, "생략"의 의미도 다르다:
//   Opus 4.8  — disabled 허용, 생략 시 thinking 없음
//   Sonnet 5  — disabled 허용, 생략 시 adaptive로 돈다(그래서 끄려면 명시해야 한다)
//   Fable 5   — thinking을 끌 수 없다. disabled는 거부되므로 생략한다(= 항상 켜짐)
//   Haiku 4.5 — 4.6 이전 세대. adaptive/effort 미지원이고 disabled는 4.6+ 형태다. 전부 생략한다
// 따라서 일괄 생략도, 일괄 disabled도 안 된다 — 못 끄는 모델만 골라 생략한다.
const THINKING_ALWAYS_ON = /^claude-(fable|mythos)-/
const THINKING_PRE_ADAPTIVE = /^claude-haiku-4-5/

function thinkingConfigFor(model, sdkEffort) {
  const id = String(model || '')
  if (THINKING_PRE_ADAPTIVE.test(id)) return {}
  if (sdkEffort) return { thinking: { type: 'adaptive' }, effort: sdkEffort }
  if (THINKING_ALWAYS_ON.test(id)) return {}
  return { thinking: { type: 'disabled' } }
}

export function buildClaudeSdkOptions(model, abortController, extra = {}) {
  const {
    reasoningEffort,
    thinking,
    effort,
    maxThinkingTokens,
    max_thinking_tokens,
    ...sdkExtra
  } = extra || {}
  const sdkEffort = CLAUDE_SDK_EFFORTS.has(reasoningEffort) ? reasoningEffort : null
  return {
    ...(model ? { model } : {}),
    ...(abortController ? { abortController } : {}),
    maxTurns: 2,
    ...thinkingConfigFor(model, sdkEffort),
    tools: [],
    settingSources: [],
    skills: [], // 빈 배열 = 활성 skill 없음(오염 차단). string[]|'all' 중 [] 유효.
    ...sdkExtra,
  }
}

function sdkResultErrorMessage(message) {
  const errors = Array.isArray(message?.errors) ? message.errors.filter(Boolean).join('; ') : ''
  const result = typeof message?.result === 'string' ? message.result.trim() : ''
  const text = errors || result
  if (text) return text
  return `Claude SDK result marked error (subtype: ${message?.subtype || 'error'})`
}

export function extractClaudeSdkResult(message) {
  if (message.subtype === 'success' && !message.is_error) return (message.result || '').trim()
  throw new Error(sdkResultErrorMessage(message))
}

export function bridgeAbortSignal(signal) {
  const abortController = new AbortController()
  if (!signal) return { abortController, cleanup: () => {} }
  if (signal.aborted) { abortController.abort(); return { abortController, cleanup: () => {} } }
  const onAbort = () => abortController.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  return { abortController, cleanup: () => signal.removeEventListener('abort', onAbort) }
}

export function extractTextDelta(message) {
  if (message?.type !== 'stream_event') return null
  const ev = message.event
  if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') return ev.delta.text
  return null
}

/** structured call result 메시지 분기. success 외 error subtype은 retry 신호 or throw. */
export function readStructuredResult(message) {
  if (message?.type !== 'result') return { kind: 'skip' }
  if (message.subtype === 'success' && !message.is_error) {
    if (message.structured_output != null) return { kind: 'structured', data: message.structured_output }
    return { kind: 'text', text: (message.result || '').trim() }
  }
  if (message.subtype === 'error_max_structured_output_retries') return { kind: 'retry' }
  throw new Error(sdkResultErrorMessage(message))
}
