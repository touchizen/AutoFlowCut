// @vitest-environment node
//
// #R30-1: a Flow compose mode-switch that fails after internal retries (configureFlowMode →
// {success:false}) must ABORT the submit, not proceed — otherwise an image submit goes out as a
// video request (or vice versa), spending the wrong quota and timing out the pending capture.
import { describe, it, expect, vi } from 'vitest'
import { registerVideoIPC } from '../../../electron/ipc/video.js'

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: (c, fn) => handlers.set(c, fn),
    invoke: (c, p) => handlers.get(c)({}, p),
  }
}

function makeDeps(configureResult) {
  return {
    getFlowView: () => ({ webContents: { getURL: () => 'https://labs.google/fx/project/x', executeJavaScript: vi.fn() }, getBounds: () => ({ width: 100, height: 100 }), setBounds: vi.fn() }),
    getMainWindow: () => ({ getContentBounds: () => ({ width: 800, height: 600 }) }),
    getCurrentMode: () => 'flow',
    ensureOnProjectComposer: vi.fn().mockResolvedValue({ ok: true }),
    ensureAgentOff: vi.fn().mockResolvedValue({ success: true }),
    configureFlowMode: vi.fn().mockResolvedValue(configureResult),
    setFlowPageInject: vi.fn().mockResolvedValue({ success: true }),
    clearFlowPageInject: vi.fn().mockResolvedValue(undefined),
    trustedClickOnFlowView: vi.fn(),
    getPendingVideoGeneration: () => null,
    setPendingVideoGeneration: vi.fn(),
  }
}

describe('#R30-1: configureFlowMode failure aborts video submit', () => {
  it('t2v aborts when configureFlowMode returns {success:false}', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps({ success: false, error: 'Mode VIDEO not set after 3 attempts' })
    registerVideoIPC(ipc, deps)
    const r = await ipc.invoke('flow:generate-video-t2v', { token: 't', prompt: 'p', projectId: 'pid', videoBatchCount: 1 })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/mode switch failed/i)
    // must NOT have proceeded to inject/submit
    expect(deps.setFlowPageInject).not.toHaveBeenCalled()
  })

  it('i2v aborts when configureFlowMode returns {success:false}', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps({ success: false, error: 'Mode VIDEO not set after 3 attempts' })
    registerVideoIPC(ipc, deps)
    const r = await ipc.invoke('flow:generate-video-i2v', { token: 't', prompt: 'p', startImageMediaId: 'm', projectId: 'pid', videoBatchCount: 1 })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/mode switch failed/i)
    expect(deps.setFlowPageInject).not.toHaveBeenCalled()
  })

  it('t2v proceeds past mode switch when configureFlowMode succeeds (reaches inject)', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps({ success: true })
    registerVideoIPC(ipc, deps)
    // will fail later (no real DOM) but must get PAST the mode-switch gate to inject
    await ipc.invoke('flow:generate-video-t2v', { token: 't', prompt: 'p', projectId: 'pid', videoBatchCount: 1 }).catch(() => {})
    expect(deps.setFlowPageInject).toHaveBeenCalled()
  })
})
