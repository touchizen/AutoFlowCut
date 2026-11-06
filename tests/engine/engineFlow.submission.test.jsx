import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useFlowEngine } from '../../src/engine/engineFlow'
import { __resetFlowSafetyForTests } from '../../src/utils/flowSafetyStop'
beforeEach(__resetFlowSafetyForTests)

it('correlates the click to its call and retains it when the IPC rejects', async () => {
  let listener, check, reject, payload
  const off = vi.fn(), offCheck = vi.fn(), record = { id: 'flow-submit-1', postClick: true, retryBlocked: true, reason: 'awaiting-result' }
  window.electronAPI = {
    onFlowImageSubmission: cb => { listener = cb; return off },
    onFlowImageSubmitCheck: cb => { check = cb; return offCheck },
    flowGenerateImage: vi.fn(data => { payload = data; return new Promise((_, fail) => { reject = fail }) }),
  }
  const onSubmission = vi.fn(), beforeSubmit = vi.fn(() => null)
  const h = renderHook(() => useFlowEngine())
  let pending
  await act(async () => { pending = h.result.current.generateImage('p', [], { onSubmission, beforeSubmit }) })
  listener({ submissionRequestId: 'foreign', flowSubmission: record })
  expect(onSubmission).not.toHaveBeenCalled()
  expect(check({ submissionRequestId: 'foreign' })).toBeUndefined()
  expect(check({ submissionRequestId: payload.submissionRequestId })).toBe(true)
  listener({ submissionRequestId: payload.submissionRequestId, flowSubmission: record })
  expect(onSubmission).toHaveBeenCalledExactlyOnceWith(record)
  let result
  await act(async () => { reject(new Error('transport-lost')); result = await pending })
  expect(result).toMatchObject({ success: false, postClick: true, retryBlocked: true, safetyStop: true,
    flowSubmission: { ...record, reason: 'transport-lost' } })
  expect(off).toHaveBeenCalledOnce()
  expect(offCheck).toHaveBeenCalledOnce()
})
