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

it.each(['t2v', 'i2v'])('correlates a %s Flow click journal and returns it if IPC transport is lost', async mode => {
  let listener, payload, reject
  const off = vi.fn()
  const record = { id: `video-${mode}-submit`, submittedAt: 456, postClick: true, retryBlocked: true, reason: 'awaiting-result' }
  const invoke = vi.fn(input => { payload = input; return new Promise((_resolve, fail) => { reject = fail }) })
  const onSubmission = vi.fn()
  window.electronAPI = {
    onFlowVideoSubmission: cb => { listener = cb; return off },
    flowGenerateVideoT2V: invoke,
    flowGenerateVideoI2V: invoke,
  }
  const h = renderHook(() => useFlowEngine())
  let pending
  await act(async () => {
    pending = mode === 't2v'
      ? h.result.current.generateVideoT2V('p', 'Omni Flash', '16:9', 6, null, '720p', [], { onSubmission })
      : h.result.current.generateVideoI2V('p', 'data:image/png;base64,QUJD', null, 'Omni Flash', '9:16', 4, null, '720p', { onSubmission })
  })
  expect(payload.submissionRequestId).toMatch(/^[0-9a-f-]{36}$/i)
  listener({ submissionRequestId: 'foreign-call', flowSubmission: record })
  expect(onSubmission).not.toHaveBeenCalled()
  listener({ submissionRequestId: payload.submissionRequestId, flowSubmission: record })
  expect(onSubmission).toHaveBeenCalledExactlyOnceWith(record)
  let result
  await act(async () => { reject(new Error('transport-lost')); result = await pending })
  expect(result).toMatchObject({ success: false, errorKind: 'flow-submit-lost', postClick: true, retryBlocked: true,
    flowSubmission: record })
  expect(off).toHaveBeenCalledOnce()
})
