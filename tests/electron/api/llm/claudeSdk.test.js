import { describe, it, expect } from 'vitest'
import {
  buildClaudeSdkOptions, extractClaudeSdkResult, bridgeAbortSignal,
  extractTextDelta, readStructuredResult,
} from '../../../../electron/api/llm/claudeSdk.js'

describe('buildClaudeSdkOptions', () => {
  it('격리 옵션을 고정하고 model/extra를 병합한다', () => {
    const o = buildClaudeSdkOptions('claude-opus-4-8', undefined, { includePartialMessages: true })
    expect(o).toMatchObject({
      model: 'claude-opus-4-8', tools: [], settingSources: [], skills: [],
      thinking: { type: 'disabled' }, maxTurns: 2, includePartialMessages: true,
    })
  })
  it('model 없으면 model 키를 넣지 않는다', () => {
    expect('model' in buildClaudeSdkOptions()).toBe(false)
  })
  it('reasoningEffort=off는 기존처럼 thinking disabled만 사용한다', () => {
    const o = buildClaudeSdkOptions('claude-opus-4-8', undefined, { reasoningEffort: 'off' })
    expect(o).toMatchObject({
      model: 'claude-opus-4-8',
      thinking: { type: 'disabled' },
    })
    expect(o).not.toHaveProperty('effort')
    expect(o).not.toHaveProperty('reasoningEffort')
  })
  it('Claude reasoning effort는 adaptive thinking과 SDK effort로 변환한다', () => {
    const o = buildClaudeSdkOptions('claude-opus-4-8', undefined, { reasoningEffort: 'high' })
    expect(o).toMatchObject({
      model: 'claude-opus-4-8',
      thinking: { type: 'adaptive' },
      effort: 'high',
    })
    expect(o).not.toHaveProperty('reasoningEffort')
  })
  // thinking 파라미터의 유효한 모양은 모델 세대마다 다르다. "생략"의 의미도 모델마다 달라서
  // (Sonnet 5는 생략하면 adaptive로 돈다) 일괄 생략은 안 되고, 못 끄는 모델만 생략해야 한다.
  describe('모델별 thinking 형태', () => {
    it('Fable 5는 thinking을 끌 수 없다 — disabled 대신 생략한다', () => {
      const o = buildClaudeSdkOptions('claude-fable-5', undefined, { reasoningEffort: 'off' })
      expect(o).not.toHaveProperty('thinking')
      expect(o).not.toHaveProperty('effort')
    })

    it('Fable 5도 effort를 주면 adaptive + effort를 싣는다', () => {
      const o = buildClaudeSdkOptions('claude-fable-5', undefined, { reasoningEffort: 'high' })
      expect(o).toMatchObject({ thinking: { type: 'adaptive' }, effort: 'high' })
    })

    it('Haiku 4.5는 adaptive/effort/disabled 어느 것도 싣지 않는다 (4.6 이전 세대)', () => {
      for (const effort of ['off', 'high', undefined]) {
        const o = buildClaudeSdkOptions('claude-haiku-4-5', undefined, { reasoningEffort: effort })
        expect(o).not.toHaveProperty('thinking')
        expect(o).not.toHaveProperty('effort')
      }
    })

    it('Sonnet 5는 off일 때 disabled를 명시한다 (생략하면 adaptive로 돈다)', () => {
      const o = buildClaudeSdkOptions('claude-sonnet-5', undefined, { reasoningEffort: 'off' })
      expect(o).toMatchObject({ thinking: { type: 'disabled' } })
    })

    it('Opus 4.8은 기존 동작 그대로', () => {
      const o = buildClaudeSdkOptions('claude-opus-4-8', undefined, { reasoningEffort: 'off' })
      expect(o).toMatchObject({ thinking: { type: 'disabled' } })
    })
  })

  // 'xhigh'는 실제로 지원되는 값이다(supportedModels() 가 opus/sonnet/fable 에 대해 보고한다).
  // 예전엔 이 테스트가 xhigh를 "알 수 없는 값" 예시로 써서 버그를 고정하고 있었다.
  it('알 수 없는 Claude reasoning effort는 off처럼 처리한다', () => {
    const o = buildClaudeSdkOptions('claude-opus-4-8', undefined, { reasoningEffort: 'turbo' })
    expect(o.thinking).toEqual({ type: 'disabled' })
    expect(o).not.toHaveProperty('effort')
  })
  it('sdkExtra로 tools/maxTurns를 오버라이드할 수 있다 (D11 — 팩트체크 WebSearch 경로)', () => {
    const o = buildClaudeSdkOptions('claude-opus-4-8', undefined, { tools: ['WebSearch'], maxTurns: 8 })
    expect(o.tools).toEqual(['WebSearch'])
    expect(o.maxTurns).toBe(8)
    // 격리 옵션은 유지(오염 차단)
    expect(o.settingSources).toEqual([])
    expect(o.skills).toEqual([])
  })
})

describe('extractClaudeSdkResult', () => {
  it('success면 result를 trim해 반환', () => {
    expect(extractClaudeSdkResult({ subtype: 'success', is_error: false, result: '  hi ' })).toBe('hi')
  })
  it('에러 result면 throw', () => {
    expect(() => extractClaudeSdkResult({ subtype: 'error_during_execution', errors: ['boom'] })).toThrow('boom')
  })
  it('success subtype이어도 is_error=true면 result 본문을 에러로 보여준다', () => {
    expect(() => extractClaudeSdkResult({ subtype: 'success', is_error: true, result: 'schema validation failed' })).toThrow('schema validation failed')
    expect(() => extractClaudeSdkResult({ subtype: 'success', is_error: true, result: 'schema validation failed' })).not.toThrow('result success')
  })
})

describe('bridgeAbortSignal', () => {
  it('signal abort 시 controller가 abort된다', () => {
    const ac = new AbortController()
    const { abortController, cleanup } = bridgeAbortSignal(ac.signal)
    ac.abort()
    expect(abortController.signal.aborted).toBe(true)
    cleanup()
  })
})

describe('extractTextDelta', () => {
  it('text_delta면 텍스트, 아니면 null', () => {
    expect(extractTextDelta({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ab' } } })).toBe('ab')
    expect(extractTextDelta({ type: 'stream_event', event: { type: 'content_block_start' } })).toBeNull()
    expect(extractTextDelta({ type: 'result' })).toBeNull()
  })
})

describe('readStructuredResult', () => {
  it('success + structured_output', () => {
    expect(readStructuredResult({ type: 'result', subtype: 'success', structured_output: { a: 1 } })).toEqual({ kind: 'structured', data: { a: 1 } })
  })
  it('success + structured_output 없음 → text', () => {
    expect(readStructuredResult({ type: 'result', subtype: 'success', result: '{"a":1}' })).toEqual({ kind: 'text', text: '{"a":1}' })
  })
  it('retries 에러 → retry', () => {
    expect(readStructuredResult({ type: 'result', subtype: 'error_max_structured_output_retries', errors: [] })).toEqual({ kind: 'retry' })
  })
  it('그 외 에러 → throw', () => {
    expect(() => readStructuredResult({ type: 'result', subtype: 'error_during_execution', errors: ['x'] })).toThrow('x')
  })
  it('success subtype + is_error=true면 result success 대신 result 본문을 던진다', () => {
    expect(() => readStructuredResult({ type: 'result', subtype: 'success', is_error: true, result: 'structured output failed' })).toThrow('structured output failed')
    expect(() => readStructuredResult({ type: 'result', subtype: 'success', is_error: true, result: 'structured output failed' })).not.toThrow('result success')
  })
})

// 카탈로그가 동적이 되면 model 은 정규 id 가 아니라 SDK 별칭('haiku', 'opus[1m]')으로 온다.
// 정규식이 별칭을 못 잡으면 haiku 에 4.6+ 전용 thinking:disabled 를 보내 400 이 난다.
describe('buildClaudeSdkOptions — 동적 카탈로그 별칭', () => {
  it('xhigh effort 를 버리지 않는다', () => {
    const o = buildClaudeSdkOptions('opus[1m]', null, { reasoningEffort: 'xhigh' })
    expect(o.effort).toBe('xhigh')
    expect(o.thinking).toEqual({ type: 'adaptive' })
  })

  it("별칭 'haiku' 에는 thinking 을 아예 안 붙인다 (4.6 이전 세대)", () => {
    const o = buildClaudeSdkOptions('haiku', null, { resolvedModel: 'claude-haiku-4-5-20251001' })
    expect(o.thinking).toBeUndefined()
    expect(o.effort).toBeUndefined()
  })

  it("별칭 'claude-fable-5[1m]' 은 thinking 을 못 끄므로 disabled 를 안 붙인다", () => {
    const o = buildClaudeSdkOptions('claude-fable-5[1m]', null, { resolvedModel: 'claude-fable-5' })
    expect(o.thinking).toBeUndefined()
  })

  it("별칭 'opus[1m]' 은 effort 없으면 disabled 를 붙인다", () => {
    const o = buildClaudeSdkOptions('opus[1m]', null, { resolvedModel: 'claude-opus-4-8[1m]' })
    expect(o.thinking).toEqual({ type: 'disabled' })
  })

  it('resolvedModel 은 SDK 옵션으로 새지 않는다 (SDK 가 모르는 키)', () => {
    const o = buildClaudeSdkOptions('sonnet', null, { resolvedModel: 'claude-sonnet-5' })
    expect(o).not.toHaveProperty('resolvedModel')
  })
})
