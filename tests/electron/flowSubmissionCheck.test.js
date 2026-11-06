// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { requestFlowSubmissionCheck } from '../../electron/flow-submission-check.js'
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('accepts only the originating renderer and check ID, then removes its listener', async () => {
  const ipc = new EventEmitter(), sender = { send: vi.fn() }
  const pending = requestFlowSubmissionCheck(ipc, sender, 'call-1')
  const [channel, check] = sender.send.mock.calls[0]
  expect(channel).toBe('flow:image-submit-check')
  expect(check.submissionRequestId).toBe('call-1')
  ipc.emit('flow:image-submit-check-result', { sender: {} }, { ...check, allowed: true })
  ipc.emit('flow:image-submit-check-result', { sender }, { checkId: 'wrong', allowed: true })
  expect(ipc.listenerCount('flow:image-submit-check-result')).toBe(1)
  ipc.emit('flow:image-submit-check-result', { sender }, { ...check, allowed: true })
  expect(await pending).toBe(true)
  expect(ipc.eventNames()).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['timeout', 'cancel', 'refuse', 'send-error'])('refuses %s without leaking a timer or listener', async kind => {
  const ipc = new EventEmitter(), signal = new AbortController()
  const sender = { send: vi.fn(() => { if (kind === 'send-error') throw new Error('renderer gone') }) }
  const pending = requestFlowSubmissionCheck(ipc, sender, 'call-1', signal.signal)
  if (kind === 'cancel') signal.abort()
  if (kind === 'refuse') ipc.emit('flow:image-submit-check-result', { sender }, { ...sender.send.mock.calls[0][1], allowed: false })
  await vi.runAllTimersAsync()
  expect(await pending).toBe(false)
  expect(ipc.eventNames()).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})
