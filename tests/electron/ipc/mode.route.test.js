// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createModeController } from '../../../electron/ipc/mode.js'

function setup() {
  const handlers = {}
  const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn } }
  const flow = { id: 'flow' }
  const contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
  const bounds = vi.fn()
  const ctl = createModeController(
    () => ({ contentView }),
    vi.fn(() => flow),
    { createSessionView: vi.fn(() => flow), updateViewBounds: bounds },
  )
  ctl.register(ipcMain)
  return { handlers, ctl, flow, contentView, bounds }
}

describe('route:set atomic session view lifecycle', () => {
  it('accepts a complete route and returns the adopted route', async () => {
    const { handlers, ctl, flow, contentView, bounds } = setup()
    const result = await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'flow' })
    expect(result).toEqual({ ok: true, route: { mode: 'flow', sessionTarget: 'flow' } })
    expect(ctl.getCurrentRoute()).toEqual(result.route)
    expect(ctl.getActiveSessionView()).toBe(flow)
    expect(contentView.addChildView).toHaveBeenCalledWith(flow)
    expect(bounds).toHaveBeenCalledWith(expect.anything(), flow)
    expect(contentView.addChildView.mock.invocationCallOrder[0])
      .toBeLessThan(bounds.mock.invocationCallOrder[0])
  })

  it('API mode detaches but preserves the partition instance', async () => {
    const { handlers, ctl, flow, contentView } = setup()
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'flow' })
    await handlers['route:set']({}, { mode: 'api', sessionTarget: 'flow' })
    expect(contentView.removeChildView).toHaveBeenCalledWith(flow)
    expect(ctl.getFlowView()).toBe(flow)
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'flow' })
    expect(ctl.getActiveSessionView()).toBe(flow)
  })

  it('invalid or unregistered-target routes have no route or view side effect', async () => {
    const { handlers, ctl, contentView, bounds } = setup()
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'flow' })
    const before = ctl.getCurrentRoute()
    contentView.addChildView.mockClear()
    contentView.removeChildView.mockClear()
    bounds.mockClear()
    for (const target of ['wat', 'chatgpt']) {
      expect(await handlers['route:set']({}, { mode: 'flow', sessionTarget: target }))
        .toEqual({ ok: false, error: 'invalid-route' })
    }
    expect(ctl.getCurrentRoute()).toEqual(before)
    expect(contentView.addChildView).not.toHaveBeenCalled()
    expect(contentView.removeChildView).not.toHaveBeenCalled()
    expect(bounds).not.toHaveBeenCalled()
  })

  it('a session view that cannot be created fails through session-view-unavailable', async () => {
    const handlers = {}
    const contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
    const ctl = createModeController(() => ({ contentView }), vi.fn(), {
      createSessionView: vi.fn(() => { throw new Error('session-view-unavailable:flow') }),
      updateViewBounds: vi.fn(),
    })
    ctl.register({ handle: (channel, fn) => { handlers[channel] = fn } })
    expect(await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'flow' }))
      .toEqual({ ok: false, error: 'session-view-unavailable' })
    expect(ctl.getCurrentRoute()).toEqual({ mode: 'api', sessionTarget: 'flow' })
    expect(contentView.addChildView).not.toHaveBeenCalled()
  })

  it('attach failure rolls the route back and leaves nothing attached', async () => {
    const { handlers, ctl, flow, contentView } = setup()
    contentView.addChildView.mockImplementationOnce(() => { throw new Error('attach failed') })
    expect(await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'flow' }))
      .toEqual({ ok: false, error: 'session-view-transition-failed' })
    expect(ctl.getCurrentRoute()).toEqual({ mode: 'api', sessionTarget: 'flow' })
    expect(ctl.getActiveSessionView()).toBe(flow) // instance preserved for retry
  })

  it('legacy mode:set preserves target and its response shape', async () => {
    const { handlers, ctl } = setup()
    await handlers['route:set']({}, { mode: 'api', sessionTarget: 'flow' })
    expect(await handlers['mode:set']({}, { mode: 'flow' })).toEqual({ ok: true, mode: 'flow' })
    expect(ctl.getSessionTarget()).toBe('flow')
    expect(await handlers['mode:set']({}, {})).toEqual({ ok: false, error: 'invalid-route' })
    expect(ctl.getCurrentRoute()).toEqual({ mode: 'flow', sessionTarget: 'flow' })
  })
})
