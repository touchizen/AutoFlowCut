// @vitest-environment node
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
const chatgptRoute = () => ({ mode: 'flow', sessionTarget: 'chatgpt' })

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
  failAttach = null,
  failBounds = null,
} = {}) => {
  const flowView = { id: 'flow' }
  const chatgptView = { id: 'chatgpt' }
  const parent = {
    children: [flowView],
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
    chatgptView,
    parent,
    getMainWindow: () => ({ contentView: parent }),
    createFlowView: () => flowView,
    options: {
      initialRoute,
      initialAttachedView: flowView,
      createSessionView: (target) => target === 'flow' ? flowView : chatgptView,
      rendererAutomation,
      sessionJobs,
      onRouteCommitted: (route) => events.push(`route:${route.sessionTarget}`),
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

describe('route:set target switch cancellation — P1 landmine', () => {
  it('injects an explicit awaited no-op session owner in the production main path', () => {
    const source = fs.readFileSync('electron/main.js', 'utf8')
    expect(source).toMatch(/const routeSessionJobs = Object\.freeze\(\{[\s\S]*?cancelAll: async \(\) => \{\},[\s\S]*?awaitIdle: async \(\) => \{\},[\s\S]*?\}\)/)
    expect(source).toMatch(/createModeController\([\s\S]*?sessionJobs: routeSessionJobs,[\s\S]*?\}\)/)
  })

  it('cancels and idles automation before detaching Flow and committing ChatGPT route', async () => {
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
    const deps = switchHarness({ events, rendererAutomation, sessionJobs, initialRoute: { mode: 'flow', sessionTarget: 'flow' } })
    const controller = makeController(deps)

    const pending = controller.setRoute({ mode: 'flow', sessionTarget: 'chatgpt' })
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

    expect(result).toMatchObject({ ok: true, route: { mode: 'flow', sessionTarget: 'chatgpt' } })
    expect(events).toEqual([
      'renderer-flow:quiesce-start', 'renderer-flow:cancel+idle-receipt',
      'session-jobs:cancel', 'session-jobs:idle-start', 'session-jobs:idle',
      'detach:flow', 'route:chatgpt', 'attach:chatgpt', 'bounds:chatgpt',
    ])
    expect(controller.getCurrentRoute()).toEqual({ mode: 'flow', sessionTarget: 'chatgpt' })
    expect(deps.parent.children).toEqual([deps.chatgptView])
  })

  it('keeps the Flow route and view attached when quiesce fails', async () => {
    const deps = switchHarness({ rendererAutomation: { requestQuiesce: vi.fn().mockRejectedValue(new Error('busy')) } })
    const controller = makeController(deps)
    const result = await controller.setRoute({ mode: 'flow', sessionTarget: 'chatgpt' })
    expect(result).toMatchObject({ ok: false, error: 'route-quiesce-failed' })
    expect(controller.getCurrentRoute()).toEqual({ mode: 'flow', sessionTarget: 'flow' })
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
    expect(await positiveController.setRoute(chatgptRoute()))
      .toMatchObject({ ok: true, route: chatgptRoute() })
    expect(positiveEvents).toContain('detach:flow')

    const negativeEvents = []
    const negative = switchHarness({ events: negativeEvents })
    delete negative.options.rendererAutomation
    negative.options.requireRendererQuiesce = true
    const negativeController = makeController(negative)
    expect(await negativeController.setRoute(chatgptRoute()))
      .toMatchObject({ ok: false, error: 'route-quiesce-failed', route: flowRoute() })
    expect(negativeEvents).not.toContain('detach:flow')
    expect(negativeController.getCurrentRoute()).toEqual(flowRoute())
    expect(negative.parent.children).toEqual([negative.flowView])
  })

  it('disarms the Flow main-side gate after switching targets', async () => {
    const deps = switchHarness()
    const controller = makeController(deps)
    await controller.setRoute({ mode: 'flow', sessionTarget: 'chatgpt' })
    const body = vi.fn()
    const result = await guardFlowSideEffect({
      getCurrentMode: () => controller.getCurrentRoute().mode,
      getSessionTarget: () => controller.getCurrentRoute().sessionTarget,
    }, body)(null)
    expect(result).toMatchObject({ success: false })
    expect(body).not.toHaveBeenCalled()
  })

  it('rolls main route/view back together when attach or bounds fails', async () => {
    const deps = switchHarness({ failAttach: 'chatgpt' })
    const controller = makeController(deps)
    const result = await controller.setRoute({ mode: 'flow', sessionTarget: 'chatgpt' })
    expect(result).toMatchObject({ ok: false, route: { mode: 'flow', sessionTarget: 'flow' } })
    expect(controller.getCurrentRoute()).toEqual({ mode: 'flow', sessionTarget: 'flow' })
    expect(deps.parent.children).toEqual([deps.flowView])
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

  it('accepts a well-formed port and drives it during a target switch (positive control)', async () => {
    const sessionJobs = { cancelAll: vi.fn(async () => {}), awaitIdle: vi.fn(async () => {}) }
    const deps = switchHarness({ sessionJobs })
    const controller = makeController(deps)
    const result = await controller.setRoute({ mode: 'flow', sessionTarget: 'chatgpt' })
    expect(result).toMatchObject({ ok: true, route: { mode: 'flow', sessionTarget: 'chatgpt' } })
    expect(sessionJobs.cancelAll).toHaveBeenCalledTimes(1)
    expect(sessionJobs.awaitIdle).toHaveBeenCalledTimes(1)
  })

  it('refuses a direct target switch when the sessionJobs port is omitted', async () => {
    const events = []
    const deps = switchHarness({ events })
    delete deps.options.sessionJobs
    const controller = makeController(deps)
    const result = await controller.setRoute(chatgptRoute())
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
