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
  it('알 수 없는 Claude reasoning effort는 off처럼 처리한다', () => {
    const o = buildClaudeSdkOptions('claude-opus-4-8', undefined, { reasoningEffort: 'xhigh' })
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
