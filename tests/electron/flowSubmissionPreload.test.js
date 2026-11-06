// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const { expose, ipc } = vi.hoisted(() => ({ expose: vi.fn(), ipc: { on: vi.fn(), removeListener: vi.fn(), send: vi.fn() } }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: expose }, ipcRenderer: ipc, webUtils: {} }))
await import('../../electron/preload.js')
const api = expose.mock.calls.find(([name]) => name === 'electronAPI')[1]
beforeEach(() => { ipc.on.mockClear(); ipc.removeListener.mockClear(); ipc.send.mockClear() })

it('forwards the click record without exposing the Electron event and unsubscribes', () => {
  const cb = vi.fn(), record = { submissionRequestId: 'call', flowSubmission: { id: 'paid' } }
  const unsubscribe = api.onFlowImageSubmission(cb)
  const [channel, handler] = ipc.on.mock.calls[0]
  handler({ sender: 'private' }, record)
  expect(cb).toHaveBeenCalledWith(record)
  unsubscribe()
  expect(ipc.removeListener).toHaveBeenCalledWith(channel, handler)
})

it('replies only for the owning check and cleans up its subscription', async () => {
  const unsubscribe = api.onFlowImageSubmitCheck(data => data.submissionRequestId === 'ours' ? false : undefined)
  const [channel, handler] = ipc.on.mock.calls[0]
  await handler({}, { checkId: 'wrong', submissionRequestId: 'other' })
  expect(ipc.send).not.toHaveBeenCalled()
  await handler({}, { checkId: 'check', submissionRequestId: 'ours' })
  expect(ipc.send).toHaveBeenCalledExactlyOnceWith('flow:image-submit-check-result', { checkId: 'check', allowed: false })
  unsubscribe()
  expect(ipc.removeListener).toHaveBeenCalledWith(channel, handler)
})
