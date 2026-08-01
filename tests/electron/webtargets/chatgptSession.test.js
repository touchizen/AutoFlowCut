// @vitest-environment node
import { beforeAll, describe, it, expect, vi } from 'vitest'
import { createModeController } from '../../../electron/ipc/mode.js'
import { createTargetRegistry } from '../../../electron/webtargets/index.js'
import { createChatgptTarget } from '../../../electron/webtargets/chatgpt/index.js'

const preloadMocks = vi.hoisted(() => {
  const exposed = {}
  const listeners = new Map()
  return {
    exposed,
    listeners,
    exposeInMainWorld: vi.fn((_name, api) => Object.assign(exposed, api)),
    invoke: vi.fn(),
    on: vi.fn((channel, listener) => listeners.set(channel, listener)),
    removeListener: vi.fn((channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel)
    }),
  }
})

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: preloadMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: preloadMocks.invoke,
    on: preloadMocks.on,
    removeListener: preloadMocks.removeListener,
  },
  webUtils: { getPathForFile: vi.fn() },
}))

beforeAll(async () => {
  await import('../../../electron/preload.js')
})

const createViewDeps = (listeners = new Map()) => {
  const view = {
    webContents: {
      session: {},
      on: vi.fn((name, listener) => listeners.set(name, listener)),
    },
  }
  return {
    view,
    WebContentsView: class { constructor() { return view } },
    reservedSessionWebPreferences: () => ({ partition: 'persist:chatgpt' }),
    installReservedSessionSecurity: vi.fn(),
  }
}

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

describe('ChatGPT fail-closed session port', () => {
  it('leaves the unmeasured DOM predicate as a blocked injection point', async () => {
    const deps = createViewDeps()
    const target = createChatgptTarget(deps)
    target.createView()

    await expect(target.ensureSession()).resolves.toEqual({
      target: 'chatgpt', status: 'session-blocked', ready: false, revision: 0,
    })
    expect(deps.view.webContents).not.toHaveProperty('executeJavaScript')
  })

  it('maps every unknown probe result to session-blocked after a ready positive control', async () => {
    const probes = ['ready', 'logged-in-but-unapproved']
    const changed = vi.fn()
    const target = createChatgptTarget({
      ...createViewDeps(),
      probeSession: vi.fn(async () => probes.shift()),
    })
    target.onSessionStatusChanged(changed)

    await expect(target.ensureSession()).resolves.toEqual({
      target: 'chatgpt', status: 'ready', ready: true, revision: 1,
    })
    await expect(target.ensureSession()).resolves.toEqual({
      target: 'chatgpt', status: 'session-blocked', ready: false, revision: 2,
    })
    expect(changed.mock.calls.map(([status]) => status)).toEqual([
      { target: 'chatgpt', status: 'ready', ready: true, revision: 1 },
      { target: 'chatgpt', status: 'session-blocked', ready: false, revision: 2 },
    ])
  })

  it('runs ensureSession from the Electron did-finish-load producer', async () => {
    const listeners = new Map()
    const probeSession = vi.fn(async () => 'ready')
    const target = createChatgptTarget({
      ...createViewDeps(listeners),
      probeSession,
    })
    target.createView()

    await listeners.get('did-finish-load')()

    expect(probeSession).toHaveBeenCalledOnce()
    expect(target.getSessionStatus()).toEqual({
      target: 'chatgpt', status: 'ready', ready: true, revision: 1,
    })
  })

  it.each([
    ['ready', 'login-required'],
    ['session-blocked', 'ready'],
  ])('publishes only the newest overlapping probe: stale %s, newest %s', async (staleStatus, newestStatus) => {
    const first = deferred()
    const second = deferred()
    const target = createChatgptTarget({
      ...createViewDeps(),
      probeSession: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    })
    const changed = vi.fn()
    target.onSessionStatusChanged(changed)

    const staleProbe = target.ensureSession()
    const newestProbe = target.ensureSession()
    second.resolve(newestStatus)
    await newestProbe
    first.resolve(staleStatus)
    await staleProbe

    expect(target.getSessionStatus()).toEqual({
      target: 'chatgpt',
      status: newestStatus,
      ready: newestStatus === 'ready',
      revision: 1,
    })
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ status: newestStatus }))
  })
})

describe('session target initial query and status event', () => {
  function setupController() {
    const probeResults = ['ready', 'not-an-approved-state']
    const probeSession = vi.fn(async () => probeResults.shift())
    const target = createChatgptTarget({
      ...createViewDeps(),
      probeSession,
    })
    const registry = createTargetRegistry({ chatgpt: target })
    const handlers = {}
    const sender = { send: vi.fn() }
    const mainWindow = { webContents: sender, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } }
    const controller = createModeController(() => mainWindow, vi.fn(), {
      initialRoute: { mode: 'api', sessionTarget: 'chatgpt' },
      targetRegistry: registry,
      createSessionView: (name) => registry.createView(name),
      sessionJobs: { cancelAll: vi.fn(async () => {}), awaitIdle: vi.fn(async () => {}) },
      rendererAutomation: { requestQuiesce: vi.fn(async () => {}) },
    })
    controller.register({
      handle: (channel, handler) => { handlers[channel] = handler },
      on: vi.fn(),
    })
    return { controller, handlers, registry, probeSession, sender, target }
  }

  it('returns the initial target-tagged status and relays monotonic changes', async () => {
    const setup = setupController()
    expect(await setup.handlers['session-target:get-status'](
      { sender: setup.sender },
      'chatgpt',
    )).toEqual({
      target: 'chatgpt', status: 'session-blocked', ready: false, revision: 0,
    })

    expect(await setup.handlers['session-target:reconnect'](
      { sender: setup.sender },
      'chatgpt',
    )).toEqual({
      target: 'chatgpt', status: 'ready', ready: true, revision: 1,
    })
    expect(setup.sender.send).toHaveBeenLastCalledWith(
      'session-target:status-changed',
      { target: 'chatgpt', status: 'ready', ready: true, revision: 1 },
    )

    expect(await setup.handlers['session-target:reconnect'](
      { sender: setup.sender },
      'chatgpt',
    )).toEqual({
      target: 'chatgpt', status: 'session-blocked', ready: false, revision: 2,
    })
    expect(setup.sender.send).toHaveBeenLastCalledWith(
      'session-target:status-changed',
      { target: 'chatgpt', status: 'session-blocked', ready: false, revision: 2 },
    )
  })

  it('preserves a non-default status for prototype targets and foreign senders', async () => {
    const setup = setupController()
    await setup.handlers['session-target:reconnect']({ sender: setup.sender }, 'chatgpt')
    const before = setup.target.getSessionStatus()
    const beforeCalls = setup.sender.send.mock.calls.length

    expect(await setup.handlers['session-target:reconnect'](
      { sender: setup.sender },
      '__proto__',
    )).toBeNull()
    expect(await setup.handlers['session-target:reconnect'](
      { sender: { id: 'foreign' } },
      'chatgpt',
    )).toBeNull()
    expect(setup.target.getSessionStatus()).toEqual(before)
    expect(setup.sender.send).toHaveBeenCalledTimes(beforeCalls)
  })

  it('rejects missing targets and sender-less IPC without using controller defaults', async () => {
    const setup = setupController()
    await setup.handlers['session-target:reconnect']({ sender: setup.sender }, 'chatgpt')
    const before = setup.target.getSessionStatus()
    expect(before.ready).toBe(true) // positive control with non-default state
    expect(setup.probeSession).toHaveBeenCalledOnce()

    expect(await setup.handlers['session-target:get-status'](
      { sender: setup.sender },
      undefined,
    )).toBeNull()
    expect(await setup.handlers['session-target:reconnect'](
      { sender: setup.sender },
      undefined,
    )).toBeNull()
    expect(await setup.handlers['session-target:get-status']({}, 'chatgpt')).toBeNull()
    expect(await setup.handlers['session-target:reconnect']({}, 'chatgpt')).toBeNull()
    expect(setup.probeSession).toHaveBeenCalledOnce()
    expect(setup.target.getSessionStatus()).toEqual(before)
  })
})

describe('preload session status relay', () => {
  it('exposes initial query, reconnect, and an unsubscribeable target-tagged event', async () => {
    preloadMocks.invoke.mockResolvedValue({
      target: 'chatgpt', status: 'session-blocked', ready: false, revision: 0,
    })

    await preloadMocks.exposed.getSessionTargetStatus('chatgpt')
    await preloadMocks.exposed.reconnectSession('chatgpt')
    expect(preloadMocks.invoke).toHaveBeenCalledWith('session-target:get-status', 'chatgpt')
    expect(preloadMocks.invoke).toHaveBeenCalledWith('session-target:reconnect', 'chatgpt')

    const callback = vi.fn()
    const unsubscribe = preloadMocks.exposed.onSessionTargetStatus(callback)
    const status = { target: 'chatgpt', status: 'ready', ready: true, revision: 1 }
    preloadMocks.listeners.get('session-target:status-changed')({}, status)
    expect(callback).toHaveBeenCalledWith(status)
    unsubscribe()
    expect(preloadMocks.removeListener).toHaveBeenCalledWith(
      'session-target:status-changed',
      expect.any(Function),
    )
  })
})
