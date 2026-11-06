// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createFlowSafety, flowSafetyConfig, isFlowDetectionText } from '../../electron/flow-safety.js'

describe('Flow detection classification', () => {
  it.each([
    '비정상적인 활동이 감지되었습니다. 페이지를 수정하는 브라우저 확장 프로그램으로 인해 문제가 발생할 수 있습니다.',
    'Unusual activity has been detected. Browser extensions that modify the page may cause issues.',
  ])('recognizes explicit warning: %s', text => expect(isFlowDetectionText(text)).toBe(true))
  it.each(['flow-rpc-error', 'RESOURCE_EXHAUSTED', 'rpc code 8', '429 quota exceeded', 'Try again'])('does not infer detection from %s', text => expect(isFlowDetectionText(text)).toBe(false))
  it('keeps safe defaults and bounds invalid configuration', () => {
    expect(flowSafetyConfig({})).toEqual({ minIntervalMs: 60000, jitterMs: 15000, rpcErrorLimit: 3 })
    expect(flowSafetyConfig({ AUTOFLOWCUT_FLOW_MIN_INTERVAL_MS: '-10', AUTOFLOWCUT_FLOW_JITTER_MS: 'NaN', AUTOFLOWCUT_FLOW_RPC_ERROR_LIMIT: '0' })).toEqual({ minIntervalMs: 1000, jitterMs: 15000, rpcErrorLimit: 1 })
  })
})

describe('Flow safety latch', () => {
  const config = { minIntervalMs: 1000, jitterMs: 0, rpcErrorLimit: 3 }
  it('blocks future attempts immediately on explicit detection', () => {
    const gate = createFlowSafety(config)
    const r = gate.observe({ success: false, error: 'Unusual activity has been detected' })
    expect(r).toMatchObject({ errorKind: 'flow-unusual-activity', safetyStop: true, retryBlocked: true })
    gate.observe({ success: true, images: [{}] })
    expect(gate.blocked()).toEqual(r)
  })
  it('latches three consecutive generation RPC failures and emits once', () => {
    const events = []
    const gate = createFlowSafety(config, { onStop: r => events.push(r) })
    const failure = { success: false, errorKind: 'flow-rpc-error', error: 'flow-rpc-error' }
    expect(gate.observe(failure)).toBe(null)
    expect(gate.observe(failure)).toBe(null)
    expect(gate.observe(failure)).toMatchObject({ errorKind: 'flow-repeated-rpc-errors' })
    gate.observe(failure)
    expect(events).toHaveLength(1)
  })
  it('does not reset failures on an async submission acknowledgement', () => {
    const gate = createFlowSafety({ ...config, rpcErrorLimit: 2 })
    gate.observe({ success: false, errorKind: 'flow-rpc-error' })
    gate.observe({ success: true, generationId: 'g', submitted: true })
    expect(gate.observe({ success: false, errorKind: 'flow-rpc-error' })).toMatchObject({ safetyStop: true })
  })
  it('resets consecutive count after completed generation success', () => {
    const gate = createFlowSafety({ ...config, rpcErrorLimit: 2 })
    gate.observe({ success: false, errorKind: 'flow-rpc-error' })
    gate.observe({ success: true, images: [{}] })
    expect(gate.observe({ success: false, errorKind: 'flow-rpc-error' })).toBe(null)
  })
  it('keeps quota as quota and ignores read failures', () => {
    const gate = createFlowSafety({ ...config, rpcErrorLimit: 1 })
    expect(gate.observe({ success: false, errorKind: 'flow-rpc-error', rpcCode: 8, error: 'RESOURCE_EXHAUSTED' })).toBe(null)
    expect(gate.observe({ success: false, errorKind: 'flow-rpc-error' }, { generation: false })).toBe(null)
    expect(gate.blocked()).toBe(null)
  })
  it('deduplicates terminal results by generation id', () => {
    const gate = createFlowSafety({ ...config, rpcErrorLimit: 2 })
    const error = { success: false, errorKind: 'flow-rpc-error' }
    gate.observe(error, { generationId: 'same' })
    expect(gate.observe(error, { generationId: 'same' })).toBe(null)
    expect(gate.observe(error, { generationId: 'next' })).toMatchObject({ safetyStop: true })
  })
})
