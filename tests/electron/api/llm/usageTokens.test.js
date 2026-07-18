import { describe, it, expect } from 'vitest'
import { claudeResultToUsage, codexNotifToUsage, claudeStreamInput, claudeStreamOutChars, estimateOutputTokens } from '../../../../electron/api/llm/usageTokens.js'

describe('claudeResultToUsage', () => {
  // BetaUsage 의 input_tokens 는 cache 를 제외한다(cache_*_input_tokens 가 별도 필드).
  // agent SDK 는 캐시 리드가 입력의 대부분이라 input_tokens 만 세면 심하게 과소.
  it('in 은 cache 를 포함해 합산한다 — input_tokens 만 세면 심하게 과소', () => {
    const m = {
      type: 'result',
      usage: {
        input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 300, output_tokens: 50,
      },
    }
    expect(claudeResultToUsage(m)).toEqual({ input: 420, output: 50 })
  })

  it('out 은 thinking 을 포함한다 — 분리 가능해도 빼지 않는다(엔진 간 정의 일치)', () => {
    const m = {
      type: 'result',
      usage: { input_tokens: 10, output_tokens: 90, output_tokens_details: { thinking_tokens: 70 } },
    }
    expect(claudeResultToUsage(m).output).toBe(90) // 90-70=20 이 아니다
  })

  it('cache 필드가 없어도 죽지 않는다', () => {
    expect(claudeResultToUsage({ type: 'result', usage: { input_tokens: 5, output_tokens: 7 } }))
      .toEqual({ input: 5, output: 7 })
  })

  it('실패 result 의 usage 도 집계한다 — 실제 과금이다', () => {
    const m = {
      type: 'result', subtype: 'error_during_execution', is_error: true,
      usage: { input_tokens: 8, output_tokens: 3 },
    }
    expect(claudeResultToUsage(m)).toEqual({ input: 8, output: 3 })
  })

  it('result 가 아니거나 usage 가 없으면 null', () => {
    expect(claudeResultToUsage({ type: 'stream_event' })).toBeNull()
    expect(claudeResultToUsage({ type: 'result' })).toBeNull()
    expect(claudeResultToUsage(null)).toBeNull()
  })
})

describe('claude stream helpers (실시간 추정)', () => {
  const se = (event) => ({ type: 'stream_event', event })

  it('claudeStreamInput: message_start 입력은 cache 포함 합산, 그 외 null', () => {
    expect(claudeStreamInput(se({ type: 'message_start', message: { usage: { input_tokens: 2, cache_creation_input_tokens: 2689, cache_read_input_tokens: 0 } } }))).toBe(2691)
    expect(claudeStreamInput(se({ type: 'message_delta', usage: { output_tokens: 5 } }))).toBeNull()
    expect(claudeStreamInput({ type: 'result' })).toBeNull()
  })

  it('claudeStreamOutChars: text/thinking/input_json_delta 를 센다', () => {
    expect(claudeStreamOutChars(se({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } }))).toBe(5)
    expect(claudeStreamOutChars(se({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'abc' } }))).toBe(3)
    // structured output(씬분리/프롬프트)은 JSON 을 input_json_delta 로 흘린다 — 이걸 세야 실시간으로 오른다.
    expect(claudeStreamOutChars(se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"n":1}' } }))).toBe(7)
    // 세지 않는 것들
    expect(claudeStreamOutChars(se({ type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'xxxx' } }))).toBe(0)
    expect(claudeStreamOutChars(se({ type: 'message_start', message: {} }))).toBe(0)
    expect(claudeStreamOutChars({ type: 'result' })).toBe(0)
  })

  it('estimateOutputTokens: chars/3 반올림, 0 은 0', () => {
    expect(estimateOutputTokens(0)).toBe(0)
    expect(estimateOutputTokens(90)).toBe(30)
    expect(estimateOutputTokens(10)).toBe(3) // round(3.33)
  })
})

describe('codexNotifToUsage', () => {
  // 0.144.5 실측 스키마(`codex app-server generate-ts --experimental` → v2/):
  //   ThreadTokenUsageUpdatedNotification = { threadId, turnId, tokenUsage: ThreadTokenUsage }
  //   ThreadTokenUsage = { total: TokenUsageBreakdown, last: TokenUsageBreakdown, modelContextWindow }
  const breakdown = (o) => ({
    totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, ...o,
  })

  it('total 을 읽는다 — last 를 읽으면 축소된다', () => {
    const params = {
      threadId: 't1',
      turnId: 'u1',
      tokenUsage: {
        total: breakdown({ inputTokens: 900, outputTokens: 300 }),
        last: breakdown({ inputTokens: 100, outputTokens: 40 }),
        modelContextWindow: 272000,
      },
    }
    expect(codexNotifToUsage(params)).toEqual({ key: 't1', input: 900, output: 300 })
  })

  it('inputTokens 는 cached 를 이미 포함한다 — cachedInputTokens 를 더하면 중복', () => {
    const params = {
      threadId: 't1',
      tokenUsage: {
        total: breakdown({ inputTokens: 500, cachedInputTokens: 400, outputTokens: 10 }),
        last: breakdown({}),
        modelContextWindow: null,
      },
    }
    expect(codexNotifToUsage(params).input).toBe(500) // 900 이 아니다
  })

  it('out 은 reasoning 을 포함한다 — reasoningOutputTokens 는 outputTokens 의 세부항목', () => {
    const params = {
      threadId: 't1',
      tokenUsage: {
        total: breakdown({ outputTokens: 200, reasoningOutputTokens: 150 }),
        last: breakdown({}),
        modelContextWindow: null,
      },
    }
    expect(codexNotifToUsage(params).output).toBe(200) // 350 도 50 도 아니다
  })

  it('평면 payload 는 거부한다 — 0.144.5 는 중첩이다', () => {
    expect(codexNotifToUsage({ threadId: 't1', tokenUsage: { inputTokens: 5, outputTokens: 5 } })).toBeNull()
  })

  it('threadId 없으면 null — key 없이는 교체를 할 수 없다', () => {
    const params = {
      tokenUsage: { total: breakdown({ inputTokens: 1 }), last: breakdown({}), modelContextWindow: null },
    }
    expect(codexNotifToUsage(params)).toBeNull()
  })
})
