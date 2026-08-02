// @vitest-environment node
import { beforeAll, describe, it, expect, vi } from 'vitest'
import { JSDOM } from 'jsdom'
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

const afterMicrotasks = async (value, turns = 50) => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve()
  return value
}

const runProbeInHtml = (source, html) => {
  const dom = new JSDOM(`<body>${html}</body>`)
  try {
    return new Function('document', `return (${source})`)(dom.window.document) // eslint-disable-line no-new-func
  } finally {
    dom.window.close()
  }
}

const createDefaultProbeDeps = (executeJavaScript, listeners = new Map()) => {
  const deps = createViewDeps(listeners)
  Object.assign(deps.view.webContents, {
    isLoading: vi.fn(() => false),
    executeJavaScript,
  })
  return deps
}

describe('ChatGPT fail-closed session port', () => {
  it('maps the measured logged-in DOM to ready and publishes the chip-facing status event', async () => {
    const eventLog = []
    const executeJavaScript = vi.fn(async (source) => {
      eventLog.push('eval:logged-in-fixture')
      return runProbeInHtml(source, '<div id="prompt-textarea" contenteditable="true"></div>')
    })
    const deps = createDefaultProbeDeps(executeJavaScript)
    const target = createChatgptTarget(deps)
    target.onSessionStatusChanged((status) => {
      eventLog.push(`chip:${status.status}:${status.ready}:${status.revision}`)
    })
    target.createView()

    await expect(target.ensureSession()).resolves.toEqual({
      target: 'chatgpt', status: 'ready', ready: true, revision: 1,
    })
    expect(eventLog).toEqual([
      'eval:logged-in-fixture',
      'chip:ready:true:1',
    ])
  })

  it('re-probes the hydrating first-open DOM before publishing a logged-in user status', async () => {
    vi.useFakeTimers()
    try {
      const fixtures = [
        '<main data-fixture="first-open-react-shell"></main>',
        '<div id="prompt-textarea" data-fixture="hydrated-logged-in-user"></div>',
      ]
      const eventLog = []
      const executeJavaScript = vi.fn(async (source) => {
        const fixture = fixtures.shift()
        eventLog.push(`eval:${fixture}`)
        return runProbeInHtml(source, fixture)
      })
      const target = createChatgptTarget(createDefaultProbeDeps(executeJavaScript))
      target.onSessionStatusChanged((status) => eventLog.push(`status:${status.status}`))
      target.createView()

      const firstOpenProbe = target.ensureSession()
      await vi.advanceTimersByTimeAsync(0)
      expect(target.getSessionStatus()).toEqual({
        target: 'chatgpt', status: 'session-blocked', ready: false, revision: 0,
      })
      expect(eventLog).toEqual([
        'eval:<main data-fixture="first-open-react-shell"></main>',
      ])

      await vi.advanceTimersByTimeAsync(499)
      expect(executeJavaScript).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      await expect(firstOpenProbe).resolves.toEqual({
        target: 'chatgpt', status: 'ready', ready: true, revision: 1,
      })
      expect(eventLog).toEqual([
        'eval:<main data-fixture="first-open-react-shell"></main>',
        'eval:<div id="prompt-textarea" data-fixture="hydrated-logged-in-user"></div>',
        'status:ready',
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed after five well-formed unmeasured DOM results and a ready positive control', async () => {
    vi.useFakeTimers()
    try {
      let evaluation = 0
      const eventLog = []
      const executeJavaScript = vi.fn(async (source) => {
        evaluation += 1
        const fixture = evaluation === 1
          ? '<div id="prompt-textarea" data-fixture="exhaustion-ready-control"></div>'
          : `<main data-fixture="ambiguous-attempt-${evaluation - 1}"></main>`
        eventLog.push(`eval:${evaluation}:${fixture}`)
        return runProbeInHtml(source, fixture)
      })
      const target = createChatgptTarget(createDefaultProbeDeps(executeJavaScript))
      target.onSessionStatusChanged((status) => eventLog.push(`status:${status.status}`))
      target.createView()

      await expect(target.ensureSession()).resolves.toMatchObject({ status: 'ready', ready: true })
      const exhaustedProbe = target.ensureSession()
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(exhaustedProbe).resolves.toMatchObject({
        status: 'session-blocked', ready: false,
      })
      expect(executeJavaScript).toHaveBeenCalledTimes(6)
      expect(eventLog.filter((entry) => entry.startsWith('status:'))).toEqual([
        'status:ready',
        'status:session-blocked',
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves a measured login CTA immediately after a ready positive control', async () => {
    vi.useFakeTimers()
    let loginProbe
    try {
      const fixtures = [
        '<div id="prompt-textarea" data-fixture="login-immediate-ready-control"></div>',
        '<div id="prompt-textarea" data-fixture="login-immediate-composer"></div><button data-testid="login-button" data-fixture="login-immediate-cta">Log in</button>',
      ]
      const eventLog = []
      const executeJavaScript = vi.fn(async (source) => {
        const fixture = fixtures.shift()
        eventLog.push(`eval:${fixture}`)
        return runProbeInHtml(source, fixture)
      })
      const target = createChatgptTarget(createDefaultProbeDeps(executeJavaScript))
      target.onSessionStatusChanged((status) => eventLog.push(`status:${status.status}`))
      target.createView()

      await expect(target.ensureSession()).resolves.toMatchObject({ status: 'ready', ready: true })
      loginProbe = target.ensureSession()
      const settledStatus = await Promise.race([
        loginProbe,
        afterMicrotasks({ status: 'not-settled-before-retry-timer', ready: false }),
      ])

      expect(settledStatus).toMatchObject({ status: 'login-required', ready: false })
      expect(executeJavaScript).toHaveBeenCalledTimes(2)
      expect(eventLog.filter((entry) => entry.startsWith('status:'))).toEqual([
        'status:ready',
        'status:login-required',
      ])
      await loginProbe
    } finally {
      await vi.runAllTimersAsync()
      await loginProbe
      vi.useRealTimers()
    }
  })

  it('maps a login CTA to login-required even if a composer is also present', async () => {
    const fixtures = [
      '<div id="prompt-textarea"></div>',
      '<div id="prompt-textarea"></div><button data-testid="login-button">Log in</button>',
      '<a href="/auth/login?fixture=measured-logged-out">Log in</a>',
    ]
    const eventLog = []
    const executeJavaScript = vi.fn(async (source) => {
      const fixture = fixtures.shift()
      eventLog.push(`eval:${fixture}`)
      return runProbeInHtml(source, fixture)
    })
    const target = createChatgptTarget(createDefaultProbeDeps(executeJavaScript))
    target.onSessionStatusChanged((status) => eventLog.push(`status:${status.status}`))
    target.createView()

    await expect(target.ensureSession()).resolves.toMatchObject({ status: 'ready', ready: true })
    await expect(target.ensureSession()).resolves.toMatchObject({ status: 'login-required', ready: false })
    await expect(target.ensureSession()).resolves.toMatchObject({ status: 'login-required', ready: false })
    expect(eventLog.filter((entry) => entry.startsWith('status:'))).toEqual([
      'status:ready',
      'status:login-required',
    ])
  })

  it('fails closed for an unrecognised evaluation result after a measured ready positive control', async () => {
    const executeJavaScript = vi.fn()
      .mockImplementationOnce(async (source) => runProbeInHtml(
        source,
        '<div id="prompt-textarea" data-fixture="positive-control"></div>',
      ))
      .mockResolvedValueOnce({
        composer: 'rendered-but-not-boolean',
        loginCta: false,
        fixture: 'non-default-unrecognised-shape',
      })
    const target = createChatgptTarget(createDefaultProbeDeps(executeJavaScript))
    target.createView()

    await expect(target.ensureSession()).resolves.toMatchObject({ status: 'ready', ready: true })
    await expect(target.ensureSession()).resolves.toMatchObject({
      status: 'session-blocked', ready: false,
    })
  })

  it('fails closed when evaluation throws after a measured ready positive control', async () => {
    const executeJavaScript = vi.fn()
      .mockImplementationOnce(async (source) => runProbeInHtml(
        source,
        '<div id="prompt-textarea" data-fixture="throw-positive-control"></div>',
      ))
      .mockRejectedValueOnce(new Error('fixture-context-destroyed'))
    const target = createChatgptTarget(createDefaultProbeDeps(executeJavaScript))
    target.createView()

    await expect(target.ensureSession()).resolves.toMatchObject({ status: 'ready', ready: true })
    await expect(target.ensureSession()).resolves.toMatchObject({
      status: 'session-blocked', ready: false,
    })
  })

  it('bounds a hung evaluation and fails closed after a measured ready positive control', async () => {
    vi.useFakeTimers()
    try {
      const executeJavaScript = vi.fn()
        .mockImplementationOnce(async (source) => runProbeInHtml(
          source,
          '<div id="prompt-textarea" data-fixture="timeout-positive-control"></div>',
        ))
        .mockImplementationOnce(() => new Promise(() => {}))
      const target = createChatgptTarget(createDefaultProbeDeps(executeJavaScript))
      target.createView()

      await expect(target.ensureSession()).resolves.toMatchObject({ status: 'ready', ready: true })
      const timedProbe = target.ensureSession()
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(timedProbe).resolves.toMatchObject({
        status: 'session-blocked', ready: false,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed without a view and has a measured ready positive control once the view exists', async () => {
    const executeJavaScript = vi.fn(async (source) => runProbeInHtml(
      source,
      '<div id="prompt-textarea" data-fixture="post-missing-view-control"></div>',
    ))
    const deps = createDefaultProbeDeps(executeJavaScript)
    const target = createChatgptTarget(deps)

    await expect(target.ensureSession()).resolves.toEqual({
      target: 'chatgpt', status: 'session-blocked', ready: false, revision: 0,
    })
    target.createView()
    await expect(target.ensureSession()).resolves.toEqual({
      target: 'chatgpt', status: 'ready', ready: true, revision: 1,
    })
  })

  it('waits out an in-flight load instead of publishing a false login-required result', async () => {
    const eventLog = []
    const handlers = new Map()
    let loading = true
    const webContents = {
      session: { fixture: 'reserved-chatgpt-session' },
      isLoading: vi.fn(() => {
        eventLog.push(`loading:${loading}`)
        return loading
      }),
      executeJavaScript: vi.fn(async (source) => {
        eventLog.push(`eval:${loading ? 'mid-load' : 'loaded'}`)
        return runProbeInHtml(source, loading
          ? '<a href="/auth/login?fixture=mid-load-false-negative">Log in</a>'
          : '<div id="prompt-textarea" data-fixture="loaded-session"></div>')
      }),
      on: vi.fn((name, listener) => {
        eventLog.push(`listen:${name}`)
        if (!handlers.has(name)) handlers.set(name, new Set())
        handlers.get(name).add(listener)
      }),
      removeListener: vi.fn((name, listener) => handlers.get(name)?.delete(listener)),
    }
    const view = { webContents }
    const target = createChatgptTarget({
      WebContentsView: class { constructor() { return view } },
      reservedSessionWebPreferences: () => ({ partition: 'persist:chatgpt' }),
      installReservedSessionSecurity: vi.fn(),
    })
    target.onSessionStatusChanged((status) => eventLog.push(`status:${status.status}`))
    target.createView()

    const probeIssuedMidLoad = target.ensureSession()
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    expect(eventLog.filter((entry) => entry.startsWith('eval:'))).toEqual([])
    expect(eventLog.filter((entry) => entry.startsWith('status:'))).toEqual([])

    loading = false
    const loadCallbacks = [...(handlers.get('did-finish-load') || [])]
    await Promise.all(loadCallbacks.map((listener) => listener()))
    await probeIssuedMidLoad

    expect(eventLog.filter((entry) => entry.startsWith('eval:'))).toEqual([
      'eval:loaded',
      'eval:loaded',
    ])
    expect(eventLog.filter((entry) => entry.startsWith('status:'))).toEqual([
      'status:ready',
    ])
    expect(target.getSessionStatus()).toMatchObject({ status: 'ready', ready: true })
  })

  it('closes the load-listener registration race when loading flips on the recheck', async () => {
    vi.useFakeTimers()
    let raceProbe
    try {
      const eventLog = []
      const loadingStates = [true, false]
      const webContents = {
        session: { fixture: 'registration-race-session' },
        isLoading: vi.fn(() => {
          const loading = loadingStates.shift()
          eventLog.push(`loading:${loading}`)
          return loading
        }),
        executeJavaScript: vi.fn(async (source) => {
          eventLog.push('eval:registration-race-ready-control')
          return runProbeInHtml(
            source,
            '<div id="prompt-textarea" data-fixture="registration-race-ready-control"></div>',
          )
        }),
        on: vi.fn((name) => eventLog.push(`listen:${name}`)),
        removeListener: vi.fn((name) => eventLog.push(`remove:${name}`)),
      }
      const view = { webContents }
      const target = createChatgptTarget({
        WebContentsView: class { constructor() { return view } },
        reservedSessionWebPreferences: () => ({ partition: 'persist:chatgpt' }),
        installReservedSessionSecurity: vi.fn(),
      })
      target.createView()

      raceProbe = target.ensureSession()
      const settledStatus = await Promise.race([
        raceProbe,
        afterMicrotasks({ status: 'not-settled-without-load-event-or-timer' }),
      ])

      expect(settledStatus).toEqual({
        target: 'chatgpt', status: 'ready', ready: true, revision: 1,
      })
      expect(eventLog).toEqual([
        'listen:did-finish-load',
        'loading:true',
        'listen:did-finish-load',
        'listen:did-fail-load',
        'loading:false',
        'remove:did-finish-load',
        'remove:did-fail-load',
        'eval:registration-race-ready-control',
      ])
      await raceProbe
    } finally {
      await vi.runAllTimersAsync()
      await raceProbe
      vi.useRealTimers()
    }
  })

  it('fails closed when the load wait times out after a ready positive control', async () => {
    vi.useFakeTimers()
    try {
      let loading = false
      const eventLog = []
      const handlers = new Map()
      const webContents = {
        session: { fixture: 'load-timeout-session' },
        isLoading: vi.fn(() => {
          eventLog.push(`loading:${loading}`)
          return loading
        }),
        executeJavaScript: vi.fn(async (source) => {
          eventLog.push('eval:load-timeout-ready-control')
          return runProbeInHtml(
            source,
            '<div id="prompt-textarea" data-fixture="load-timeout-ready-control"></div>',
          )
        }),
        on: vi.fn((name, listener) => {
          eventLog.push(`listen:${name}`)
          if (!handlers.has(name)) handlers.set(name, new Set())
          handlers.get(name).add(listener)
        }),
        removeListener: vi.fn((name, listener) => handlers.get(name)?.delete(listener)),
      }
      const view = { webContents }
      const target = createChatgptTarget({
        WebContentsView: class { constructor() { return view } },
        reservedSessionWebPreferences: () => ({ partition: 'persist:chatgpt' }),
        installReservedSessionSecurity: vi.fn(),
      })
      target.createView()

      await expect(target.ensureSession()).resolves.toMatchObject({ status: 'ready', ready: true })
      loading = true
      const timedProbe = target.ensureSession()
      await vi.advanceTimersByTimeAsync(14_999)
      expect(target.getSessionStatus()).toMatchObject({ status: 'ready', ready: true })
      expect(webContents.executeJavaScript).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      await expect(timedProbe).resolves.toMatchObject({
        status: 'session-blocked', ready: false,
      })
      expect(eventLog.filter((entry) => entry.startsWith('eval:'))).toEqual([
        'eval:load-timeout-ready-control',
      ])
    } finally {
      vi.useRealTimers()
    }
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
