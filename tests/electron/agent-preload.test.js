// @vitest-environment node
// D14 renderer bridge. key 존재만 보지 않고 노출된 함수를 실제 호출해 invoke/on/send 효과를 확인한다.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const electronDouble = vi.hoisted(() => ({
  exposed: null,
  contextBridge: {
    exposeInMainWorld: vi.fn((_name, api) => { electronDouble.exposed = api }),
  },
  // preload가 호출할 수 있는 ipcRenderer surface를 빠짐없이 둔다.
  ipcRenderer: {
    invoke: vi.fn(async (channel, payload) => ({ channel, payload })),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
  webUtils: { getPathForFile: vi.fn((file) => file?.path) },
}))

vi.mock('electron', () => ({
  contextBridge: electronDouble.contextBridge,
  ipcRenderer: electronDouble.ipcRenderer,
  webUtils: electronDouble.webUtils,
}))

beforeAll(async () => {
  await import('../../electron/preload.js?agent-surface-test')
})

beforeEach(() => {
  electronDouble.ipcRenderer.invoke.mockClear()
  electronDouble.ipcRenderer.on.mockClear()
  electronDouble.ipcRenderer.removeListener.mockClear()
  electronDouble.ipcRenderer.send.mockClear()
})

describe('preload agent surface — D14 효과', () => {
  it('5개 session command가 각각 전용 agent IPC를 invoke한다', async () => {
    const api = electronDouble.exposed

    await api.agentSessionOpen()
    await api.agentSend({ text: '계속' })
    await api.agentSteer({ text: '영상은 빼' })
    await api.agentAbort()
    await api.agentSessionClose()

    expect(electronDouble.ipcRenderer.invoke.mock.calls).toEqual([
      ['agent:session-open', undefined],
      ['agent:send', { text: '계속' }],
      ['agent:steer', { text: '영상은 빼' }],
      ['agent:abort', undefined],
      ['agent:session-close', undefined],
    ])
  })

  it('agent event allowlist가 payload를 renderer에 전달하고 cleanup에서 같은 listener를 제거한다', () => {
    const api = electronDouble.exposed
    const callback = vi.fn()
    const off = api.onAgentEvent('agent:error', callback)
    const [, listener] = electronDouble.ipcRenderer.on.mock.calls[0]

    listener({}, { error: 'agent-limit', limit: 64, used: 64 })
    off()

    expect(callback).toHaveBeenCalledWith({ error: 'agent-limit', limit: 64, used: 64 })
    expect(electronDouble.ipcRenderer.removeListener)
      .toHaveBeenCalledWith('agent:error', listener)
  })

  it('agent:message completion을 allowlist가 renderer에 전달한다', () => {
    const api = electronDouble.exposed
    const callback = vi.fn()
    const off = api.onAgentEvent('agent:message', callback)
    const [channel, listener] = electronDouble.ipcRenderer.on.mock.calls[0]
    const payload = {
      turnId: 'turn-1',
      item: { id: 'message-1', type: 'agentMessage', text: '확정 답변' },
    }

    listener({}, payload)
    off()

    expect(channel).toBe('agent:message')
    expect(callback).toHaveBeenCalledWith(payload)
    expect(electronDouble.ipcRenderer.removeListener).toHaveBeenCalledWith('agent:message', listener)
  })

  it('permission request는 기존 app-scoped 전용 listener만 받고 session event allowlist에 섞이지 않는다', () => {
    const api = electronDouble.exposed
    const before = electronDouble.ipcRenderer.on.mock.calls.length
    const off = api.onAgentEvent('agent:permission-request', vi.fn())

    off()
    expect(electronDouble.ipcRenderer.on.mock.calls).toHaveLength(before)

    const callback = vi.fn()
    api.onAgentPermissionRequest(callback)
    const [channel, listener] = electronDouble.ipcRenderer.on.mock.calls.at(-1)
    listener({}, { requestId: 'approval-1' })
    expect(channel).toBe('agent:permission-request')
    expect(callback).toHaveBeenCalledWith({ requestId: 'approval-1' })
  })

  it('permission cancel은 app-scoped listener로 전달하고 같은 listener를 cleanup한다', () => {
    const api = electronDouble.exposed
    const callback = vi.fn()
    const off = api.onAgentPermissionCancel(callback)
    const [channel, listener] = electronDouble.ipcRenderer.on.mock.calls.at(-1)

    listener({}, { requestId: 'approval-1', reason: 'timeout' })
    off()

    expect(channel).toBe('agent:permission-cancel')
    expect(callback).toHaveBeenCalledWith({ requestId: 'approval-1', reason: 'timeout' })
    expect(electronDouble.ipcRenderer.removeListener).toHaveBeenCalledWith(channel, listener)
  })
})
