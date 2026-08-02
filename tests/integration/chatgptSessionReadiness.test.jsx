import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createModeController } from '../../electron/ipc/mode.js'
import { createTargetRegistry } from '../../electron/webtargets/index.js'
import { createChatgptTarget } from '../../electron/webtargets/chatgpt/index.js'
import TargetCombo from '../../src/components/TargetCombo.jsx'
import { ModeProvider } from '../../src/contexts/ModeContext.jsx'
import { I18nProvider } from '../../src/hooks/useI18n.jsx'
import { useTargetAuthReady } from '../../src/hooks/useTargetAuthReady.js'
import {
  MODE_STORAGE_KEY,
  SESSION_TARGET_STORAGE_KEY,
} from '../../src/config/appRoute.js'

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
  let probeCount = 0
  const view = {
    webContents: {
      session: {},
      isLoading: vi.fn(() => false),
      executeJavaScript: vi.fn(async (source) => {
        probeCount += 1
        if (probeCount > 1) throw new Error('fixture-evaluation-failed')
        const pageDocument = document.implementation.createHTMLDocument('chatgpt-fixture')
        pageDocument.body.innerHTML = '<div id="prompt-textarea" data-fixture="logged-in"></div>'
        return new Function('document', `return (${source})`)(pageDocument) // eslint-disable-line no-new-func
      }),
      on: vi.fn((name, listener) => viewListeners.set(name, listener)),
    },
  }
  const target = createChatgptTarget({
    WebContentsView: class { constructor() { return view } },
    reservedSessionWebPreferences: () => ({ partition: 'persist:chatgpt' }),
    installReservedSessionSecurity: vi.fn(),
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
  const { authReady, authReadyByTarget } = useTargetAuthReady('chatgpt', electronAPI)
  return (
    <>
      <TargetCombo enabled authReadyByTarget={authReadyByTarget} />
      <button type="button" data-testid="image-start" disabled={!authReady}>start</button>
    </>
  )
}

describe('ChatGPT session readiness integration', () => {
  it('drives did-finish-load and reconnect through main status, preload contract, and image admission', async () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'flow')
    localStorage.setItem(SESSION_TARGET_STORAGE_KEY, 'chatgpt')
    localStorage.setItem('autoflowcut_lang', 'ko')
    const runtime = chatgptSessionRuntimeHarness()
    render(
      <I18nProvider>
        <ModeProvider>
          <ImageAdmission electronAPI={runtime.preloadAPI} />
        </ModeProvider>
      </I18nProvider>,
    )

    expect(screen.getByTestId('image-start')).toBeDisabled()
    expect(screen.getByTestId('target-auth-chip-current')).toHaveTextContent('로그인 필요')

    await act(async () => { await runtime.emitDidFinishLoad() })
    await waitFor(() => expect(screen.getByTestId('image-start')).toBeEnabled())
    expect(screen.getByTestId('target-auth-chip-current')).toHaveTextContent('로그인됨')
    expect(preloadBridge.invoke).toHaveBeenCalledWith('session-target:get-status', 'chatgpt')

    await act(async () => { await runtime.preloadAPI.reconnectSession('chatgpt') })
    expect(screen.getByTestId('image-start')).toBeDisabled()
    expect(screen.getByTestId('target-auth-chip-current')).toHaveTextContent('로그인 필요')
    expect(preloadBridge.invoke).toHaveBeenCalledWith('session-target:reconnect', 'chatgpt')
    expect(runtime.observedStatuses()).toEqual([
      { target: 'chatgpt', status: 'ready', ready: true, revision: 1 },
      { target: 'chatgpt', status: 'session-blocked', ready: false, revision: 2 },
    ])
  })
})
