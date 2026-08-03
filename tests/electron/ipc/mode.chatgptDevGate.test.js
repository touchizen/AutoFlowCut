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

  it('rejects explicit ChatGPT routes when any gate leg is absent, with a valid-gate positive control', async () => {
    const invalidGates = [
      makeGate({ chatgptP2Flag: undefined }),
      makeGate({ isPackaged: true, viteDevServerUrl: '' }),
      makeGate({ platform: 'linux' }),
    ]
    for (const gate of invalidGates) {
      const negative = gateHarness(gate)
      const result = await negative.controller.setRoute(chatgptRoute())
      expect(result).toMatchObject({ ok: false, error: 'session-target-disabled', route: flowRoute() })
      expect(negative.loadURL).not.toHaveBeenCalled()
      expect(negative.target.createView).not.toHaveBeenCalled()
      expect(negative.controller.getCurrentRoute()).toEqual(flowRoute())
    }

    const positive = gateHarness(makeGate({
      isPackaged: true,
      viteDevServerUrl: 'http://localhost:5173',
    }))
    await positive.controller.setRoute(chatgptRoute())
    expect(positive.loadURL).toHaveBeenCalledOnce()
    expect(positive.loadURL).toHaveBeenCalledWith('https://chatgpt.com/')
  })

  it('normalizes a disabled persisted ChatGPT boot route to Flow without creating a blank view', async () => {
    const setup = gateHarness(makeGate({ chatgptP2Flag: undefined }))

    const result = await setup.controller.setRoute({ to: chatgptRoute(), boot: true })

    expect(result).toMatchObject({ ok: true, route: flowRoute() })
    expect(setup.controller.getCurrentRoute()).toEqual(flowRoute())
    expect(setup.target.createView).not.toHaveBeenCalled()
    expect(setup.loadURL).not.toHaveBeenCalled()
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

  it('retries a preserved ChatGPT view after one transient initial load failure', async () => {
    const setup = gateHarness(makeGate())
    setup.loadURL
      .mockRejectedValueOnce(Object.assign(new Error('temporary network failure'), { code: 'ENETDOWN' }))
      .mockResolvedValueOnce(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await setup.controller.setRoute(chatgptRoute())
    await Promise.resolve()
    await setup.controller.setRoute({ mode: 'api', sessionTarget: 'chatgpt' })
    await setup.controller.setRoute(chatgptRoute())

    expect(setup.target.createView).toHaveBeenCalledOnce()
    expect(setup.loadURL).toHaveBeenCalledTimes(2)
    expect(setup.loadURL).toHaveBeenLastCalledWith('https://chatgpt.com/')
    warn.mockRestore()
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

function generationHarness({
  gate = makeGate(),
  route = chatgptRoute(),
  session = { target: 'chatgpt', status: 'ready', ready: true, revision: 4 },
} = {}) {
  const handlers = {}
  const sender = { send: vi.fn() }
  const adapter = {
    submit: vi.fn(async () => ({ success: true, generationId: 'chatgpt-job-positive' })),
    observe: vi.fn(async () => ({ success: true, completed: true })),
    collect: vi.fn(async () => ({ success: true, images: [{ filePath: '/saved/positive.png' }] })),
    clear: vi.fn(async () => ({ success: true })),
    cancelAll: vi.fn(async () => ({ success: true })),
    awaitIdle: vi.fn(async () => {}),
  }
  const ensureSession = vi.fn(async () => session)
  const target = {
    id: 'chatgpt',
    startUrl: 'https://chatgpt.com/',
    createView: vi.fn(() => ({ webContents: { loadURL: vi.fn() } })),
    createAdapter: vi.fn(() => adapter),
    ensureSession,
    getSessionStatus: vi.fn(() => session),
  }
  const registry = createTargetRegistry({ chatgpt: target })
  const mainWindow = {
    webContents: sender,
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  }
  const sessionJobs = { cancelAll: vi.fn(async () => {}), awaitIdle: vi.fn(async () => {}) }
  const controller = createModeController(() => mainWindow, vi.fn(), {
    initialRoute: route,
    targetRegistry: registry,
    createSessionView: (name) => registry.createView(name),
    chatgptDevGate: gate,
    sessionJobs,
    rendererAutomation: { requestQuiesce: vi.fn(async () => {}) },
  })
  controller.register({
    handle: (channel, handler) => { handlers[channel] = handler },
    on: vi.fn(),
  })
  return { handlers, sender, adapter, ensureSession, target, controller, sessionJobs }
}

describe('ChatGPT generation IPC route and session gate', () => {
  it('submits a text-only image request on the enabled flow+chatgpt route', async () => {
    const setup = generationHarness()
    expect(typeof setup.handlers['chatgpt:submit-generation']).toBe('function')
    if (typeof setup.handlers['chatgpt:submit-generation'] !== 'function') return

    const result = await setup.handlers['chatgpt:submit-generation'](
      { sender: setup.sender },
      { prompt: 'Generate a jade lighthouse image', referenceImages: [] },
    )

    expect(result).toEqual({ success: true, generationId: 'chatgpt-job-positive' })
    expect(setup.ensureSession).not.toHaveBeenCalled()
    expect(setup.adapter.submit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Generate a jade lighthouse image',
      referenceImages: [],
    }))
  })

  it('hands an accepted request to the cancellable adapter without awaiting an outer session probe', async () => {
    const ready = generationHarness()
    await expect(ready.handlers['chatgpt:submit-generation'](
      { sender: ready.sender },
      { prompt: 'adapter ownership positive control', referenceImages: [] },
    )).resolves.toMatchObject({ success: true })
    expect(ready.adapter.submit).toHaveBeenCalledOnce()

    const events = []
    let releaseProbe
    const probe = new Promise(resolve => { releaseProbe = resolve })
    const blocked = generationHarness({ session: probe })
    blocked.adapter.submit.mockImplementation(async () => {
      events.push('adapter-submit')
      return { success: true, generationId: 'outer-probe-bypassed' }
    })
    const pending = blocked.handlers['chatgpt:submit-generation'](
      { sender: blocked.sender },
      { prompt: 'outer probe must not own this request', referenceImages: [] },
    )
    await Promise.resolve()
    events.push(`adapter-calls:${blocked.adapter.submit.mock.calls.length}`)
    releaseProbe({ target: 'chatgpt', status: 'ready', ready: true, revision: 8 })

    await expect(pending).resolves.toMatchObject({ success: true, generationId: 'outer-probe-bypassed' })
    expect(blocked.ensureSession).not.toHaveBeenCalled()
    expect(events).toEqual(['adapter-submit', 'adapter-calls:1'])
  })

  it('refuses measured-route requests carrying references before adapter submission', async () => {
    const setup = generationHarness()
    expect(typeof setup.handlers['chatgpt:submit-generation']).toBe('function')
    if (typeof setup.handlers['chatgpt:submit-generation'] !== 'function') return

    await expect(setup.handlers['chatgpt:submit-generation'](
      { sender: setup.sender },
      { prompt: 'positive text-only control', referenceImages: [] },
    )).resolves.toMatchObject({ success: true })
    expect(setup.adapter.submit).toHaveBeenCalledOnce()
    setup.adapter.submit.mockClear()

    const refused = await setup.handlers['chatgpt:submit-generation'](
      { sender: setup.sender },
      { prompt: 'must not submit', referenceImages: [{ data: 'non-default-reference' }] },
    )

    expect(refused).toMatchObject({
      success: false,
      errorKind: 'chatgpt-reference-images-unmeasured',
    })
    expect(refused.error).toMatch(/reference/i)
    expect(setup.adapter.submit).not.toHaveBeenCalled()
  })

  it('fails closed on a malformed non-array reference envelope instead of coercing it away', async () => {
    const setup = generationHarness()
    await expect(setup.handlers['chatgpt:submit-generation'](
      { sender: setup.sender },
      { prompt: 'empty-array positive control', referenceImages: [] },
    )).resolves.toMatchObject({ success: true })
    expect(setup.adapter.submit).toHaveBeenCalledOnce()
    setup.adapter.submit.mockClear()

    const refused = await setup.handlers['chatgpt:submit-generation'](
      { sender: setup.sender },
      { prompt: 'malformed reference must not submit', referenceImages: { data: 'opaque-reference' } },
    )

    expect(refused).toMatchObject({
      success: false,
      errorKind: 'chatgpt-reference-images-unmeasured',
    })
    expect(setup.adapter.submit).not.toHaveBeenCalled()
  })

  it('binds admitted jobs to the exact ChatGPT route revision at observe and collect time', async () => {
    const setup = generationHarness()
    const submit = await setup.handlers['chatgpt:submit-generation'](
      { sender: setup.sender },
      { prompt: 'route-owned positive control', referenceImages: [] },
    )
    await expect(setup.handlers['chatgpt:observe-generation'](
      { sender: setup.sender },
      submit.generationId,
    )).resolves.toMatchObject({ success: true, completed: true })
    expect(setup.adapter.observe).toHaveBeenCalledOnce()

    await setup.controller.setRoute({ mode: 'api', sessionTarget: 'chatgpt' })
    await setup.controller.setRoute(chatgptRoute())
    setup.adapter.observe.mockClear()
    setup.adapter.collect.mockClear()

    const observed = await setup.handlers['chatgpt:observe-generation'](
      { sender: setup.sender },
      submit.generationId,
    )
    const collected = await setup.handlers['chatgpt:collect-generation'](
      { sender: setup.sender },
      submit.generationId,
    )

    expect(observed).toMatchObject({ success: false, errorKind: 'chatgpt-generation-route-changed' })
    expect(collected).toMatchObject({ success: false, errorKind: 'chatgpt-generation-route-changed' })
    expect(setup.adapter.observe).not.toHaveBeenCalled()
    expect(setup.adapter.collect).not.toHaveBeenCalled()
  })

  it('exposes an admitted cancellation IPC that reaches the active ChatGPT adapter', async () => {
    const setup = generationHarness()
    await expect(setup.handlers['chatgpt:clear-generations'](
      { sender: setup.sender },
    )).resolves.toMatchObject({ success: true })
    expect(setup.adapter.clear).toHaveBeenCalledOnce()

    expect(typeof setup.handlers['chatgpt:cancel-generations']).toBe('function')
    const cancelled = await setup.handlers['chatgpt:cancel-generations'](
      { sender: setup.sender },
    )

    expect(cancelled).toMatchObject({ success: true })
    expect(setup.adapter.cancelAll).toHaveBeenCalledOnce()
  })

  it('forwards a non-ready refusal from the adapter after a ready positive control', async () => {
    const ready = generationHarness()
    expect(typeof ready.handlers['chatgpt:submit-generation']).toBe('function')
    if (typeof ready.handlers['chatgpt:submit-generation'] !== 'function') return
    await expect(ready.handlers['chatgpt:submit-generation'](
      { sender: ready.sender },
      { prompt: 'ready control', referenceImages: [] },
    )).resolves.toMatchObject({ success: true })
    expect(ready.adapter.submit).toHaveBeenCalledOnce()

    const blocked = generationHarness({
      session: { target: 'chatgpt', status: 'login-required', ready: false, revision: 7 },
    })
    blocked.adapter.submit.mockResolvedValue({
      success: false,
      error: 'ChatGPT session is not ready (login-required)',
      errorKind: 'chatgpt-session-not-ready',
      sessionStatus: 'login-required',
    })
    const result = await blocked.handlers['chatgpt:submit-generation'](
      { sender: blocked.sender },
      { prompt: 'must not type', referenceImages: [] },
    )

    expect(result).toMatchObject({
      success: false,
      errorKind: 'chatgpt-session-not-ready',
      sessionStatus: 'login-required',
    })
    expect(result.error).toMatch(/session|login/i)
    expect(blocked.adapter.submit).toHaveBeenCalledOnce()
    expect(blocked.ensureSession).not.toHaveBeenCalled()
  })

  it('keeps generation unreachable without the dev flag, with an enabled-gate positive control', async () => {
    const enabled = generationHarness()
    expect(typeof enabled.handlers['chatgpt:submit-generation']).toBe('function')
    if (typeof enabled.handlers['chatgpt:submit-generation'] !== 'function') return
    await expect(enabled.handlers['chatgpt:submit-generation'](
      { sender: enabled.sender },
      { prompt: 'enabled control', referenceImages: [] },
    )).resolves.toMatchObject({ success: true })

    const disabled = generationHarness({ gate: makeGate({ chatgptP2Flag: undefined }) })
    const before = disabled.controller.getCurrentRoute()
    const result = await disabled.handlers['chatgpt:submit-generation'](
      { sender: disabled.sender },
      { prompt: 'disabled must not submit', referenceImages: [] },
    )

    expect(result).toMatchObject({ success: false, errorKind: 'chatgpt-target-disabled' })
    expect(disabled.adapter.submit).not.toHaveBeenCalled()
    expect(disabled.controller.getCurrentRoute()).toEqual(before)
  })
})
