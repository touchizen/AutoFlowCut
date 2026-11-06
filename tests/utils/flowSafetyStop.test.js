import { beforeEach, describe, expect, it } from 'vitest'
import { __resetFlowSafetyForTests, getFlowSafetyStop, receiveFlowSafetyStop, subscribeFlowSafetyStop, getPreservedFlowSubmissionStop } from '../../src/utils/flowSafetyStop'

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
it('shares the persisted image submission guard without a process-memory latch', () => {
  const scene = { generationId: 'paid', retryBlocked: true, errorKind: 'flow-unusual-activity', errorParams: { reason: 'detected' } }
  expect(getFlowSafetyStop()).toBeNull()
  expect(getPreservedFlowSubmissionStop(scene, 'flow')).toMatchObject({ success: false, generationId: 'paid', retryBlocked: true, errorKind: 'flow-unusual-activity', reason: 'detected' })
  expect(getPreservedFlowSubmissionStop({ ...scene, retryBlocked: false }, 'flow')).toBeNull()
  expect(getPreservedFlowSubmissionStop({ retryBlocked: true }, 'flow')).toBeNull()
})

it('blocks a clicked local submission without generationId or a process latch', () => {
  const flowSubmission = { id: 'flow-submit-local', submittedAt: 123, promptHash: 'hash',
    postClick: true, retryBlocked: true, reason: 'download-timeout' }
  expect(getPreservedFlowSubmissionStop({ flowSubmission }, 'flow')).toMatchObject({
    success: false, retryBlocked: true, postClick: true, reason: 'download-timeout', flowSubmission,
  })
  expect(getPreservedFlowSubmissionStop({ flowSubmission }, 'api')).toBeNull()
  expect(getPreservedFlowSubmissionStop({ flowSubmission: { ...flowSubmission, retryBlocked: false } }, 'flow')).toBeNull()
})
