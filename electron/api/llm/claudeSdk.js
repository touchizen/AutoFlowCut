/**
 * Claude Agent SDK 순수 헬퍼 — query 결과/스트림/취소 처리. (AutoMovie vision.mjs 이식 + 확장)
 * SDK 자체는 llmClaude가 동적 import — 여기는 SDK에 의존하지 않는 순수 함수만 둔다(테스트 용이).
 */
const CLAUDE_SDK_EFFORTS = new Set(['low', 'medium', 'high', 'max'])

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
    thinking: sdkEffort ? { type: 'adaptive' } : { type: 'disabled' },
    ...(sdkEffort ? { effort: sdkEffort } : {}),
    tools: [],
    settingSources: [],
    skills: [], // 빈 배열 = 활성 skill 없음(오염 차단). string[]|'all' 중 [] 유효.
    ...sdkExtra,
  }
}

export function extractClaudeSdkResult(message) {
  if (message.subtype === 'success' && !message.is_error) return (message.result || '').trim()
  throw new Error(message.errors?.join('; ') || `result ${message.subtype || 'error'}`)
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
  throw new Error(message.errors?.join('; ') || `result ${message.subtype || 'error'}`)
}
