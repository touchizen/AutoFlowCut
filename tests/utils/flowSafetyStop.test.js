import { beforeEach, describe, expect, it } from 'vitest'
import { __resetFlowSafetyForTests, getFlowSafetyStop, receiveFlowSafetyStop, subscribeFlowSafetyStop } from '../../src/utils/flowSafetyStop'

beforeEach(__resetFlowSafetyForTests)
describe('renderer Flow safety latch', () => {
  it('retains the first stop, notifies once, and does not accept ordinary failures', () => {
    const events = []
    const unsub = subscribeFlowSafetyStop(r => events.push(r))
    expect(receiveFlowSafetyStop({ success: false, errorKind: 'flow-rpc-error' })).toBe(false)
    const stop = { success: false, errorKind: 'flow-unusual-activity', retryBlocked: true, safetyStop: true }
    expect(receiveFlowSafetyStop(stop)).toBe(true)
    expect(receiveFlowSafetyStop(stop)).toBe(false)
    expect(getFlowSafetyStop()).toMatchObject(stop)
    expect(events).toHaveLength(1)
    unsub()
  })
})
