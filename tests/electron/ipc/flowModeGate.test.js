// @vitest-environment node
//
// #R25-4: quota-spending Flow IPC handlers must refuse when current mode is 'api'.
// After mode:set('api') the flowView instance is preserved (session kept), so a stale
// renderer call could otherwise reach Flow and spend quota. The handlers gate on
// getCurrentMode()==='flow'.
import { describe, it, expect, vi } from 'vitest'
import { registerVideoIPC } from '../../../electron/ipc/video.js'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'
import { registerCharacterIPC } from '../../../electron/ipc/character.js'
import { registerDomIPC } from '../../../electron/ipc/dom.js'

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, payload) => handlers.get(channel)(/* event */ {}, payload),
    has: (channel) => handlers.has(channel),
  }
}

// getFlowView spy lets us prove the gate returns BEFORE touching the Flow view.
function makeDeps(mode) {
  const getFlowView = vi.fn(() => ({ webContents: { getURL: () => 'https://labs.google/fx/project/x' } }))
  return {
    getFlowView,
    getCurrentMode: () => mode,
    getMainWindow: () => null,
    // remaining deps are unused on the early-return path
  }
}

const QUOTA_VIDEO = [
  ['flow:generate-video-t2v', { token: 't', prompt: 'p', projectId: 'pid' }],
  ['flow:generate-video-i2v', { token: 't', prompt: 'p', startImageMediaId: 'm', projectId: 'pid' }],
  ['flow:upscale-video', { token: 't', mediaId: 'm', projectId: 'pid' }],
]
const QUOTA_FLOW = [
  ['flow:generate-image', { token: 't', prompt: 'p', projectId: 'pid' }],
  ['flow:upload-reference', { token: 't', base64: 'b', projectId: 'pid' }],
  ['flow:upscale-image', { token: 't', mediaId: 'm', projectId: 'pid' }],
  ['flow:dom-download-video', { mediaId: 'm', resolution: '1080p' }],  // #R27-5: can trigger upscale (quota)
  ['flow:extract-token', {}],  // #R28-1: token readable in API mode (fail-open)
]
const STATE_DOM = [
  ['flow:open-project', { flowProjectId: 'p1' }],   // #R28-2: navigates preserved Flow view
  ['flow:new-project', {}],                          // #R28-2: creates a Flow project
]
const QUOTA_CHARACTER = [
  ['flow:generate-character', { prompt: 'p', displayName: 'd', projectId: 'pid' }],
  ['flow:reroll-character', { entityId: 'e', prompt: 'p', projectId: 'pid' }],
  ['flow:generate-scene', { prompt: 'p', projectId: 'pid' }],
  ['flow:rename-character', { entityId: 'e', displayName: 'd', projectId: 'pid' }],
  ['flow:upload-character-entity', { base64: 'b', displayName: 'd', projectId: 'pid' }],
]

describe('#R25-4: Flow quota handlers gated by mode', () => {
  it('video handlers refuse in API mode without touching the Flow view', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps('api')
    registerVideoIPC(ipc, deps)
    for (const [channel, payload] of QUOTA_VIDEO) {
      const r = await ipc.invoke(channel, payload)
      expect(r).toEqual({ success: false, error: 'Flow inactive (API mode)' })
    }
    expect(deps.getFlowView).not.toHaveBeenCalled()
  })

  it('flow-api handlers refuse in API mode without touching the Flow view', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps('api')
    registerFlowAPIIPC(ipc, deps)
    for (const [channel, payload] of QUOTA_FLOW) {
      const r = await ipc.invoke(channel, payload)
      expect(r).toEqual({ success: false, error: 'Flow inactive (API mode)' })
    }
    expect(deps.getFlowView).not.toHaveBeenCalled()
  })

  it('character handlers refuse in API mode without touching the Flow view (#R26-1)', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps('api')
    registerCharacterIPC(ipc, deps)
    for (const [channel, payload] of QUOTA_CHARACTER) {
      const r = await ipc.invoke(channel, payload)
      expect(r).toEqual({ success: false, error: 'Flow inactive (API mode)' })
    }
    expect(deps.getFlowView).not.toHaveBeenCalled()
  })

  it('dom.js project handlers refuse in API mode without touching the Flow view (#R28-2)', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps('api')
    registerDomIPC(ipc, deps)
    for (const [channel, payload] of STATE_DOM) {
      const r = await ipc.invoke(channel, payload)
      expect(r).toEqual({ success: false, error: 'Flow inactive (API mode)' })
    }
    expect(deps.getFlowView).not.toHaveBeenCalled()
  })

  it('in flow mode the gate passes (reaches the Flow-view readiness path, not the API-mode refusal)', async () => {
    const ipc = makeIpcMain()
    // flowView absent → handler proceeds past the mode gate and fails later with a DIFFERENT error
    const deps = { getFlowView: () => null, getCurrentMode: () => 'flow', getMainWindow: () => null }
    registerVideoIPC(ipc, deps)
    const r = await ipc.invoke('flow:generate-video-t2v', { token: 't', prompt: 'p', projectId: 'pid' })
    expect(r.error).not.toBe('Flow inactive (API mode)')
  })
})
