// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createModeController } from '../../../electron/ipc/mode.js'

function setup() {
  const handlers = {}
  const ipcMain = { handle: vi.fn((ch, fn) => { handlers[ch] = fn }) }
  const flowView = { __id: 'flow-view', webContents: { loadURL: vi.fn() } }
  const contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
  const mainWindow = { contentView }
  const createFlowView = vi.fn(() => flowView)
  const ctl = createModeController(() => mainWindow, createFlowView)
  ctl.register(ipcMain)
  return { handlers, ipcMain, flowView, contentView, createFlowView, ctl }
}

describe('createModeController — mode:set lifecycle', () => {
  it('starts in api mode with no flow view', () => {
    const { ctl, createFlowView } = setup()
    expect(ctl.getCurrentMode()).toBe('api')
    expect(ctl.getFlowView()).toBe(null)
    expect(createFlowView).not.toHaveBeenCalled()
  })

  it('mode:set(flow) lazily creates and attaches the flow view', async () => {
    const { handlers, ctl, flowView, contentView, createFlowView } = setup()
    const res = await handlers['mode:set']({}, { mode: 'flow' })
    expect(createFlowView).toHaveBeenCalledTimes(1)
    expect(contentView.addChildView).toHaveBeenCalledWith(flowView)
    expect(ctl.getCurrentMode()).toBe('flow')
    expect(ctl.getFlowView()).toBe(flowView)
    expect(res).toEqual({ ok: true, mode: 'flow' })
  })

  it('mode:set(flow) twice does not recreate the view (session preserved)', async () => {
    const { handlers, createFlowView } = setup()
    await handlers['mode:set']({}, { mode: 'flow' })
    await handlers['mode:set']({}, { mode: 'api' })
    await handlers['mode:set']({}, { mode: 'flow' })
    expect(createFlowView).toHaveBeenCalledTimes(1)
  })

  it('mode:set(api) detaches the view but keeps the instance alive', async () => {
    const { handlers, ctl, flowView, contentView } = setup()
    await handlers['mode:set']({}, { mode: 'flow' })
    const res = await handlers['mode:set']({}, { mode: 'api' })
    expect(contentView.removeChildView).toHaveBeenCalledWith(flowView)
    expect(ctl.getCurrentMode()).toBe('api')
    expect(ctl.getFlowView()).toBe(flowView) // instance preserved for re-attach
    expect(res).toEqual({ ok: true, mode: 'api' })
  })
})

describe('createModeController — startup hint / decision', () => {
  it('undefined hint (not declared) → wait', () => {
    const { ctl } = setup()
    expect(ctl.getStartupDecision()).toEqual({ action: 'wait' })
  })
  it('flow:set-startup-project with id → open-saved', async () => {
    const { handlers, ctl } = setup()
    await handlers['flow:set-startup-project']({}, { flowProjectId: 'saved-1' })
    expect(ctl.getStartupDecision()).toEqual({ action: 'open-saved', flowProjectId: 'saved-1' })
  })
  it('flow:set-startup-project with no id → create-new', async () => {
    const { handlers, ctl } = setup()
    await handlers['flow:set-startup-project']({}, {})
    expect(ctl.getStartupDecision()).toEqual({ action: 'create-new' })
  })
})
