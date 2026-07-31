// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  createModeController,
  isChatgptP2DevGateEnabled,
} from '../../../electron/ipc/mode.js'
import { createTargetRegistry } from '../../../electron/webtargets/index.js'
import { createChatgptTarget } from '../../../electron/webtargets/chatgpt/index.js'

const flowRoute = () => ({ mode: 'flow', sessionTarget: 'flow' })
const chatgptRoute = () => ({ mode: 'flow', sessionTarget: 'chatgpt' })

function makeGate(overrides = {}) {
  return {
    platform: 'darwin',
    isPackaged: false,
    viteDevServerUrl: '',
    chatgptP2Flag: '1',
    ...overrides,
  }
}

function gateHarness(gate, { events = [], targetDefinition } = {}) {
  const loadURL = vi.fn(async (url) => { events.push(`load:${url}`) })
  const view = targetDefinition ? null : { id: 'chatgpt', webContents: { loadURL } }
  const target = targetDefinition || {
    id: 'chatgpt',
    startUrl: 'https://chatgpt.com/',
    createView: vi.fn(() => {
      events.push('view:create')
      return view
    }),
    createAdapter: vi.fn(),
  }
  const registry = createTargetRegistry({ chatgpt: target })
  const flow = { id: 'flow' }
  const children = [flow]
  const contentView = {
    addChildView: vi.fn((nextView) => {
      events.push(`attach:${nextView.id || 'chatgpt'}`)
      children.splice(0, children.length, nextView)
    }),
    removeChildView: vi.fn((oldView) => {
      events.push(`detach:${oldView.id}`)
      const index = children.indexOf(oldView)
      if (index >= 0) children.splice(index, 1)
    }),
  }
  const controller = createModeController(
    () => ({ contentView }),
    vi.fn(() => flow),
    {
      initialRoute: flowRoute(),
      initialAttachedView: flow,
      targetRegistry: registry,
      createSessionView: (name) => name === 'flow' ? flow : registry.createView(name),
      chatgptDevGate: gate,
      rendererAutomation: { requestQuiesce: vi.fn(async () => {}) },
      sessionJobs: { cancelAll: vi.fn(async () => {}), awaitIdle: vi.fn(async () => {}) },
      onRouteCommitted: (route) => events.push(`route:${route.sessionTarget}`),
      updateViewBounds: (_window, nextView) => events.push(`bounds:${nextView.id || 'chatgpt'}`),
    },
  )
  return { controller, events, loadURL, target, registry, contentView, children }
}

describe('P2 ChatGPT view load gate', () => {
  it.each([
    [makeGate({ chatgptP2Flag: '0' }), false],
    [makeGate({ isPackaged: true }), false],
    [makeGate({ isPackaged: true, viteDevServerUrl: 'http://localhost:5173' }), true],
    [makeGate({ platform: 'linux' }), false],
    [makeGate(), true],
  ])('evaluates the exact real development gate %j → %s', (gate, expected) => {
    expect(isChatgptP2DevGateEnabled(gate)).toBe(expected)
  })

  it('never loads when any gate leg is absent, with a valid-gate positive control', async () => {
    const invalidGates = [
      makeGate({ chatgptP2Flag: undefined }),
      makeGate({ isPackaged: true, viteDevServerUrl: '' }),
      makeGate({ platform: 'linux' }),
    ]
    for (const gate of invalidGates) {
      const negative = gateHarness(gate)
      await negative.controller.setRoute(chatgptRoute())
      expect(negative.loadURL).not.toHaveBeenCalled()
      expect(negative.controller.getCurrentRoute()).toEqual(chatgptRoute())
    }

    const positive = gateHarness(makeGate({
      isPackaged: true,
      viteDevServerUrl: 'http://localhost:5173',
    }))
    await positive.controller.setRoute(chatgptRoute())
    expect(positive.loadURL).toHaveBeenCalledOnce()
    expect(positive.loadURL).toHaveBeenCalledWith('https://chatgpt.com/')
  })

  it('does not create or load a view until route:set actually selects ChatGPT', async () => {
    const setup = gateHarness(makeGate())

    expect(setup.target.createView).not.toHaveBeenCalled()
    expect(setup.loadURL).not.toHaveBeenCalled()

    await setup.controller.setRoute(chatgptRoute())
    expect(setup.target.createView).toHaveBeenCalledOnce()
    expect(setup.loadURL).toHaveBeenCalledOnce()
  })

  it('preserves one ChatGPT view and performs only one initial load across route transitions', async () => {
    const setup = gateHarness(makeGate())

    await setup.controller.setRoute(chatgptRoute())
    const firstView = setup.controller.getActiveSessionView('chatgpt')
    await setup.controller.setRoute({ mode: 'api', sessionTarget: 'chatgpt' })
    await setup.controller.setRoute(chatgptRoute())

    expect(setup.controller.getActiveSessionView('chatgpt')).toBe(firstView)
    expect(setup.target.createView).toHaveBeenCalledOnce()
    expect(setup.loadURL).toHaveBeenCalledOnce()
  })

  it('installs the real two-argument security policy before the first URL load', async () => {
    const events = []
    const listeners = new Map()
    const electronSession = {}
    const view = {
      id: 'chatgpt',
      webContents: {
        session: electronSession,
        on: vi.fn((name, listener) => {
          events.push(`listener:${name}`)
          listeners.set(name, listener)
        }),
        loadURL: vi.fn(async (url) => events.push(`load:${url}`)),
      },
    }
    class FakeWebContentsView {
      constructor() {
        events.push('view:create')
        return view
      }
    }
    const target = createChatgptTarget({
      WebContentsView: FakeWebContentsView,
      reservedSessionWebPreferences: () => {
        events.push('security:preferences')
        return { partition: 'persist:chatgpt' }
      },
      installReservedSessionSecurity: (receivedView, receivedSession) => {
        expect(receivedView).toBe(view)
        expect(receivedSession).toBe(electronSession)
        events.push('security:install')
      },
    })
    const setup = gateHarness(makeGate(), { events, targetDefinition: target })

    await setup.controller.setRoute(chatgptRoute())

    expect(events).toEqual([
      'security:preferences',
      'view:create',
      'security:install',
      'listener:did-finish-load',
      'detach:flow',
      'route:chatgpt',
      'attach:chatgpt',
      'bounds:chatgpt',
      'load:https://chatgpt.com/',
    ])
  })
})
