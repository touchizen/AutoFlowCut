// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createModeController } from '../../../electron/ipc/mode.js'

function setup() {
  const handlers = {}
  const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn } }
  const flow = { id: 'flow' }
  const chatgpt = { id: 'chatgpt' }
  const contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
  const bounds = vi.fn()
  const ctl = createModeController(
    () => ({ contentView }),
    vi.fn(() => flow),
    { createSessionView: vi.fn((target) => target === 'flow' ? flow : chatgpt), updateViewBounds: bounds },
  )
  ctl.register(ipcMain)
  return { handlers, ctl, flow, chatgpt, contentView, bounds }
}

describe('route:set atomic session view lifecycle', () => {
  it('accepts a complete route and returns the adopted route', async () => {
    const { handlers, ctl, chatgpt, contentView, bounds } = setup()
    const result = await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'chatgpt' })
    expect(result).toEqual({ ok: true, route: { mode: 'flow', sessionTarget: 'chatgpt' } })
    expect(ctl.getCurrentRoute()).toEqual(result.route)
    expect(ctl.getActiveSessionView()).toBe(chatgpt)
    expect(contentView.addChildView).toHaveBeenCalledWith(chatgpt)
    expect(bounds).toHaveBeenCalledWith(expect.anything(), chatgpt)
  })

  it('switches targets detach → attach → bounds and never keeps two attached', async () => {
    const { handlers, flow, chatgpt, contentView, bounds } = setup()
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'flow' })
    contentView.removeChildView.mockClear()
    contentView.addChildView.mockClear()
    bounds.mockClear()
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'chatgpt' })
    expect(contentView.removeChildView).toHaveBeenCalledWith(flow)
    expect(contentView.addChildView).toHaveBeenCalledWith(chatgpt)
    expect(contentView.removeChildView.mock.invocationCallOrder[0])
      .toBeLessThan(contentView.addChildView.mock.invocationCallOrder[0])
    expect(contentView.addChildView.mock.invocationCallOrder[0])
      .toBeLessThan(bounds.mock.invocationCallOrder[0])
  })

  it('API mode detaches but preserves both partition instances', async () => {
    const { handlers, ctl, flow, chatgpt } = setup()
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'flow' })
    await handlers['route:set']({}, { mode: 'api', sessionTarget: 'chatgpt' })
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'chatgpt' })
    expect(ctl.getFlowView()).toBe(flow)
    expect(ctl.getActiveSessionView('chatgpt')).toBe(chatgpt)
  })

  it('invalid route has no route or view side effect', async () => {
    const { handlers, ctl, contentView, bounds } = setup()
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'chatgpt' })
    const before = ctl.getCurrentRoute()
    contentView.addChildView.mockClear()
    contentView.removeChildView.mockClear()
    bounds.mockClear()
    expect(await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'wat' }))
      .toEqual({ ok: false, error: 'invalid-route' })
    expect(ctl.getCurrentRoute()).toEqual(before)
    expect(contentView.addChildView).not.toHaveBeenCalled()
    expect(contentView.removeChildView).not.toHaveBeenCalled()
    expect(bounds).not.toHaveBeenCalled()
  })

  it('attach failure rolls the old attachment back and keeps the old route', async () => {
    const { handlers, ctl, flow, chatgpt, contentView } = setup()
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'flow' })
    contentView.addChildView.mockImplementationOnce((view) => {
      if (view === chatgpt) throw new Error('attach failed')
    })
    expect(await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'chatgpt' }))
      .toEqual({ ok: false, error: 'session-view-transition-failed' })
    expect(ctl.getCurrentRoute()).toEqual({ mode: 'flow', sessionTarget: 'flow' })
    expect(contentView.removeChildView).toHaveBeenCalledWith(flow)
    expect(contentView.addChildView).toHaveBeenLastCalledWith(flow)
    expect(ctl.getActiveSessionView()).toBe(flow)
  })

  it('legacy mode:set preserves target and its response shape', async () => {
    const { handlers, ctl } = setup()
    await handlers['route:set']({}, { mode: 'api', sessionTarget: 'chatgpt' })
    expect(await handlers['mode:set']({}, { mode: 'flow' })).toEqual({ ok: true, mode: 'flow' })
    expect(ctl.getSessionTarget()).toBe('chatgpt')
    expect(await handlers['mode:set']({}, {})).toEqual({ ok: false, error: 'invalid-route' })
    expect(ctl.getCurrentRoute()).toEqual({ mode: 'flow', sessionTarget: 'chatgpt' })
  })

  it('flow+chatgpt never creates or attaches the Flow view', async () => {
    const handlers = {}
    const flowFactory = vi.fn(() => ({ id: 'flow' }))
    const chatgpt = { id: 'reserved-chatgpt' }
    const contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
    const ctl = createModeController(() => ({ contentView }), flowFactory, {
      createSessionView: (target) => target === 'flow' ? flowFactory() : chatgpt,
      updateViewBounds: vi.fn(),
    })
    ctl.register({ handle: (channel, fn) => { handlers[channel] = fn } })
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'chatgpt' })
    expect(flowFactory).not.toHaveBeenCalled()
    expect(contentView.addChildView).toHaveBeenCalledWith(chatgpt)
    expect(ctl.getFlowView()).toBeNull()
  })
})
