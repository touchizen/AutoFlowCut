// @vitest-environment node
//
// Transactional route-switch barrier: renderer quiesce receipt → session-job owner
// cancelAll/awaitIdle → detach → commit → attach → bounds, with rollback. Flow is the
// only registered session target, so the barrier is exercised through the flow ↔ api
// route change — the exact same code path a future second target would ride.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import { createModeController } from '../../../electron/ipc/mode.js'
import { guardFlowSideEffect } from '../../../electron/ipc/flowTargetGate.js'

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const flowRoute = () => ({ mode: 'flow', sessionTarget: 'flow' })
const apiRoute = () => ({ mode: 'api', sessionTarget: 'flow' })

const waitForCall = async (spy) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (spy.mock.calls.length > 0) return
    await Promise.resolve()
  }
  throw new Error('expected call was not observed')
}

const switchHarness = ({
  events = [],
  rendererAutomation = { requestQuiesce: vi.fn(async () => {}) },
  sessionJobs = { cancelAll: vi.fn(async () => {}), awaitIdle: vi.fn(async () => {}) },
  initialRoute = { mode: 'flow', sessionTarget: 'flow' },
  initialAttached = true,
  failAttach = null,
  failBounds = null,
} = {}) => {
  const flowView = { id: 'flow' }
  const parent = {
    children: initialAttached ? [flowView] : [],
    addChildView(view) {
      events.push(`attach:${view.id}`)
      if (failAttach === view.id) throw new Error('attach failed')
      if (!this.children.includes(view)) this.children.push(view)
    },
    removeChildView(view) {
      events.push(`detach:${view.id}`)
      this.children = this.children.filter((child) => child !== view)
    },
  }
  return {
    flowView,
    parent,
    getMainWindow: () => ({ contentView: parent }),
    createFlowView: () => flowView,
    options: {
      initialRoute,
      initialAttachedView: initialAttached ? flowView : null,
      createSessionView: () => flowView,
      rendererAutomation,
      sessionJobs,
      onRouteCommitted: (route) => events.push(`route:${route.mode}`),
      updateViewBounds: (_window, view) => {
        events.push(`bounds:${view.id}`)
        if (failBounds === view.id) throw new Error('bounds failed')
      },
    },
  }
}

const makeController = (deps) => createModeController(
  deps.getMainWindow,
  deps.createFlowView,
  deps.options,
)

describe('route:set target switch cancellation — barrier ordering', () => {
  it('injects the registry-drain session-job owner in the production main path', () => {
    const source = fs.readFileSync('electron/main.js', 'utf8')
    expect(source).toMatch(/const routeSessionJobs = Object\.freeze\(\{[\s\S]*?cancelAll: async \(\) => \{[\s\S]*?sessionTargetRegistry\.createAdapter\(name\)\?\.cancelAll\?\.\(\)[\s\S]*?awaitIdle: async \(\) => \{[\s\S]*?sessionTargetRegistry\.createAdapter\(name\)\?\.awaitIdle\?\.\(\)[\s\S]*?\}\)/)
    expect(source).toMatch(/createModeController\([\s\S]*?sessionJobs: routeSessionJobs,[\s\S]*?\}\)/)
  })

  it('cancels and idles automation before detaching Flow and committing the api route', async () => {
    const events = []
    const quiesceGate = deferred()
    const idleGate = deferred()
    const rendererAutomation = {
      requestQuiesce: vi.fn(async () => {
        events.push('renderer-flow:quiesce-start')
        await quiesceGate.promise
        events.push('renderer-flow:cancel+idle-receipt')
      }),
    }
    const sessionJobs = {
      cancelAll: vi.fn(async () => events.push('session-jobs:cancel')),
      awaitIdle: vi.fn(async () => {
        events.push('session-jobs:idle-start')
        await idleGate.promise
        events.push('session-jobs:idle')
      }),
    }
    const deps = switchHarness({ events, rendererAutomation, sessionJobs })
    const controller = makeController(deps)

    const pending = controller.setRoute(apiRoute())
    await waitForCall(rendererAutomation.requestQuiesce)
    expect(sessionJobs.cancelAll).not.toHaveBeenCalled()
    expect(events.filter((event) => event === 'detach:flow')).toHaveLength(0)

    quiesceGate.resolve()
    await waitForCall(sessionJobs.awaitIdle)
    expect(events).toEqual([
      'renderer-flow:quiesce-start', 'renderer-flow:cancel+idle-receipt',
      'session-jobs:cancel', 'session-jobs:idle-start',
    ])
    expect(events.filter((event) => event === 'detach:flow')).toHaveLength(0)

    idleGate.resolve()
    const result = await pending

    expect(result).toMatchObject({ ok: true, route: apiRoute() })
    expect(events).toEqual([
      'renderer-flow:quiesce-start', 'renderer-flow:cancel+idle-receipt',
      'session-jobs:cancel', 'session-jobs:idle-start', 'session-jobs:idle',
      'detach:flow', 'route:api',
    ])
    expect(controller.getCurrentRoute()).toEqual(apiRoute())
    expect(deps.parent.children).toEqual([])
  })

  it('runs the barrier before attaching on entry into the flow route', async () => {
    const events = []
    const sessionJobs = {
      cancelAll: vi.fn(async () => events.push('session-jobs:cancel')),
      awaitIdle: vi.fn(async () => events.push('session-jobs:idle')),
    }
    const deps = switchHarness({
      events, sessionJobs, initialRoute: apiRoute(), initialAttached: false,
    })
    const controller = makeController(deps)

    const result = await controller.setRoute(flowRoute())
    expect(result).toMatchObject({ ok: true, route: flowRoute() })
    expect(events).toEqual([
      'session-jobs:cancel', 'session-jobs:idle',
      'route:flow', 'attach:flow', 'bounds:flow',
    ])
    expect(deps.parent.children).toEqual([deps.flowView])
  })

  it('keeps the Flow route and view attached when quiesce fails', async () => {
    const deps = switchHarness({ rendererAutomation: { requestQuiesce: vi.fn().mockRejectedValue(new Error('busy')) } })
    const controller = makeController(deps)
    const result = await controller.setRoute(apiRoute())
    expect(result).toMatchObject({ ok: false, error: 'route-quiesce-failed' })
    expect(controller.getCurrentRoute()).toEqual(flowRoute())
    expect(deps.parent.children).toEqual([deps.flowView])
  })

  it('accepts an exact renderer receipt and fails closed when the production sender is unavailable', async () => {
    const positiveEvents = []
    const positive = switchHarness({ events: positiveEvents })
    delete positive.options.rendererAutomation
    positive.options.requireRendererQuiesce = true
    const listeners = {}
    const sender = {
      send: vi.fn((_channel, request) => {
        queueMicrotask(() => listeners['route:quiesce-receipt'](
          { sender },
          { requestId: request.requestId, fromRevision: request.fromRevision, ok: true },
        ))
      }),
    }
    positive.getMainWindow = () => ({ contentView: positive.parent, webContents: sender })
    const positiveController = makeController(positive)
    positiveController.register({
      on: (channel, listener) => { listeners[channel] = listener },
      handle: vi.fn(),
    })
    expect(await positiveController.setRoute(apiRoute()))
      .toMatchObject({ ok: true, route: apiRoute() })
    expect(positiveEvents).toContain('detach:flow')

    const negativeEvents = []
    const negative = switchHarness({ events: negativeEvents })
    delete negative.options.rendererAutomation
    negative.options.requireRendererQuiesce = true
    const negativeController = makeController(negative)
    expect(await negativeController.setRoute(apiRoute()))
      .toMatchObject({ ok: false, error: 'route-quiesce-failed', route: flowRoute() })
    expect(negativeEvents).not.toContain('detach:flow')
    expect(negativeController.getCurrentRoute()).toEqual(flowRoute())
    expect(negative.parent.children).toEqual([negative.flowView])
  })

  it('disarms the Flow main-side gate after leaving the flow route', async () => {
    const deps = switchHarness()
    const controller = makeController(deps)
    await controller.setRoute(apiRoute())
    const body = vi.fn()
    const result = await guardFlowSideEffect({
      getCurrentMode: () => controller.getCurrentRoute().mode,
      getSessionTarget: () => controller.getCurrentRoute().sessionTarget,
    }, body)(null)
    expect(result).toMatchObject({ success: false })
    expect(body).not.toHaveBeenCalled()
  })

  it('rolls main route/view back together when attach fails', async () => {
    const deps = switchHarness({
      initialRoute: apiRoute(), initialAttached: false, failAttach: 'flow',
    })
    const controller = makeController(deps)
    const result = await controller.setRoute(flowRoute())
    expect(result).toMatchObject({ ok: false, route: apiRoute() })
    expect(controller.getCurrentRoute()).toEqual(apiRoute())
    expect(deps.parent.children).toEqual([])
  })

  it('rolls main route/view back together when bounds fails', async () => {
    const deps = switchHarness({
      initialRoute: apiRoute(), initialAttached: false, failBounds: 'flow',
    })
    const controller = makeController(deps)
    const result = await controller.setRoute(flowRoute())
    expect(result).toMatchObject({ ok: false, route: apiRoute() })
    expect(controller.getCurrentRoute()).toEqual(apiRoute())
    expect(deps.parent.children).toEqual([])
  })

  it('refuses an unregistered session target through the session-view-unavailable path', async () => {
    const events = []
    const deps = switchHarness({
      events, initialRoute: apiRoute(), initialAttached: false,
    })
    deps.options.createSessionView = (target) => {
      if (target !== 'flow') throw new Error(`session-view-unavailable:${target}`)
      throw new Error('session-view-unavailable:flow')
    }
    const controller = makeController(deps)
    const result = await controller.setRoute(flowRoute())
    expect(result).toMatchObject({ ok: false, error: 'session-view-unavailable', route: apiRoute() })
    expect(events).not.toContain('attach:flow')
    expect(controller.getCurrentRoute()).toEqual(apiRoute())
  })
})

describe('barrier port validation — sessionJobs must be a real awaited owner', () => {
  const withSessionJobs = (sessionJobs) => {
    const deps = switchHarness()
    deps.options.sessionJobs = sessionJobs
    return deps
  }

  it('rejects construction when the sessionJobs key is supplied as undefined or null', () => {
    for (const missing of [undefined, null]) {
      expect(() => makeController(withSessionJobs(missing))).toThrow(TypeError)
      expect(() => makeController(withSessionJobs(missing)))
        .toThrow('sessionJobs.cancelAll/awaitIdle are required')
    }
  })

  it('rejects construction when sessionJobs.cancelAll is not a function', () => {
    const deps = withSessionJobs({ cancelAll: 'nope', awaitIdle: vi.fn(async () => {}) })
    expect(() => makeController(deps)).toThrow(TypeError)
    expect(() => makeController(deps)).toThrow('sessionJobs.cancelAll/awaitIdle are required')
  })

  it('rejects construction when sessionJobs.awaitIdle is not a function', () => {
    const deps = withSessionJobs({ cancelAll: vi.fn(async () => {}), awaitIdle: null })
    expect(() => makeController(deps)).toThrow(TypeError)
    expect(() => makeController(deps)).toThrow('sessionJobs.cancelAll/awaitIdle are required')
  })

  it('accepts a well-formed port and drives it during a route switch (positive control)', async () => {
    const sessionJobs = { cancelAll: vi.fn(async () => {}), awaitIdle: vi.fn(async () => {}) }
    const deps = switchHarness({ sessionJobs })
    const controller = makeController(deps)
    const result = await controller.setRoute(apiRoute())
    expect(result).toMatchObject({ ok: true, route: apiRoute() })
    expect(sessionJobs.cancelAll).toHaveBeenCalledTimes(1)
    expect(sessionJobs.awaitIdle).toHaveBeenCalledTimes(1)
  })

  it('refuses a direct route switch when the sessionJobs port is omitted', async () => {
    const events = []
    const deps = switchHarness({ events })
    delete deps.options.sessionJobs
    const controller = makeController(deps)
    const result = await controller.setRoute(apiRoute())
    expect(result).toMatchObject({
      ok: false,
      error: 'route-session-jobs-required',
      route: flowRoute(),
    })
    expect(deps.options.rendererAutomation.requestQuiesce).not.toHaveBeenCalled()
    expect(events).not.toContain('detach:flow')
    expect(controller.getCurrentRoute()).toEqual(flowRoute())
    expect(deps.parent.children).toEqual([deps.flowView])
  })

})
