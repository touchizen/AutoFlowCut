import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createModeController } from '../../electron/ipc/mode.js'
import { createTargetRegistry } from '../../electron/webtargets/index.js'
import { createChatgptTarget } from '../../electron/webtargets/chatgpt/index.js'
import { useTargetAuthReady } from '../../src/hooks/useTargetAuthReady.js'

const preloadBridge = vi.hoisted(() => {
  const exposed = {}
  const listeners = new Map()
  return {
    exposed,
    listeners,
    exposeInMainWorld: vi.fn((_name, api) => Object.assign(exposed, api)),
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn((channel, listener) => listeners.set(channel, listener)),
    removeListener: vi.fn((channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel)
    }),
  }
})

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: preloadBridge.exposeInMainWorld },
  ipcRenderer: {
    invoke: preloadBridge.invoke,
    send: preloadBridge.send,
    on: preloadBridge.on,
    removeListener: preloadBridge.removeListener,
  },
  webUtils: { getPathForFile: vi.fn() },
}))

beforeAll(async () => {
  await import('../../electron/preload.js')
})

function chatgptSessionRuntimeHarness() {
  const viewListeners = new Map()
  const observedStatuses = []
  const probeResults = ['ready', 'unapproved-r1-signal']
  const probeSession = vi.fn(async () => probeResults.shift())
  const view = {
    webContents: {
      session: {},
      on: vi.fn((name, listener) => viewListeners.set(name, listener)),
    },
  }
  const target = createChatgptTarget({
    WebContentsView: class { constructor() { return view } },
    reservedSessionWebPreferences: () => ({ partition: 'persist:chatgpt' }),
    installReservedSessionSecurity: vi.fn(),
    probeSession,
  })
  target.createView()

  const registry = createTargetRegistry({ chatgpt: target })
  const handlers = {}
  const sender = {
    send: vi.fn((channel, status) => {
      if (channel !== 'session-target:status-changed') return
      observedStatuses.push(status)
      preloadBridge.listeners.get(channel)?.({}, status)
    }),
  }
  const mainWindow = {
    webContents: sender,
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  }
  const controller = createModeController(() => mainWindow, vi.fn(), {
    initialRoute: { mode: 'flow', sessionTarget: 'chatgpt' },
    targetRegistry: registry,
    createSessionView: (targetName) => registry.createView(targetName),
    sessionJobs: { cancelAll: vi.fn(async () => {}), awaitIdle: vi.fn(async () => {}) },
    rendererAutomation: { requestQuiesce: vi.fn(async () => {}) },
  })
  controller.register({
    handle: (channel, handler) => { handlers[channel] = handler },
    on: vi.fn(),
  })
  preloadBridge.invoke.mockImplementation((channel, ...args) => (
    handlers[channel]?.({ sender }, ...args)
  ))

  return {
    target,
    preloadAPI: preloadBridge.exposed,
    emitDidFinishLoad: () => viewListeners.get('did-finish-load')(),
    observedStatuses: () => observedStatuses,
  }
}

function ImageAdmission({ electronAPI }) {
  const { authReady } = useTargetAuthReady('chatgpt', electronAPI)
  return <button type="button" data-testid="image-start" disabled={!authReady}>start</button>
}

describe('ChatGPT session readiness integration', () => {
  it('drives did-finish-load and reconnect through main status, preload contract, and image admission', async () => {
    const runtime = chatgptSessionRuntimeHarness()
    render(<ImageAdmission electronAPI={runtime.preloadAPI} />)

    expect(screen.getByTestId('image-start')).toBeDisabled()

    await act(async () => { await runtime.emitDidFinishLoad() })
    await waitFor(() => expect(screen.getByTestId('image-start')).toBeEnabled())
    expect(preloadBridge.invoke).toHaveBeenCalledWith('session-target:get-status', 'chatgpt')

    await act(async () => { await runtime.preloadAPI.reconnectSession('chatgpt') })
    expect(screen.getByTestId('image-start')).toBeDisabled()
    expect(preloadBridge.invoke).toHaveBeenCalledWith('session-target:reconnect', 'chatgpt')
    expect(runtime.observedStatuses()).toEqual([
      { target: 'chatgpt', status: 'ready', ready: true, revision: 1 },
      { target: 'chatgpt', status: 'session-blocked', ready: false, revision: 2 },
    ])
  })
})
