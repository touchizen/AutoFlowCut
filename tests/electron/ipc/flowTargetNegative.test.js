// tests/electron/ipc/flowTargetNegative.test.js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import { registerVideoIPC } from '../../../electron/ipc/video.js'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'
import { registerCharacterIPC } from '../../../electron/ipc/character.js'
import { registerDomIPC } from '../../../electron/ipc/dom.js'
import {
  FLOW_SIDE_EFFECT_CHANNELS, FLOW_READ_ONLY_CHANNELS,
  FLOW_INACTIVE_RESULT, guardFlowSideEffect,
} from '../../../electron/ipc/flowTargetGate.js'

const payload = {
  'flow:generate-video-t2v': { token: 't', prompt: 'p', projectId: 'p' },
  'flow:generate-video-i2v': { token: 't', prompt: 'p', startImageMediaId: 'm', projectId: 'p' },
  'flow:upscale-video': { token: 't', mediaId: 'm', projectId: 'p' },
  'flow:generate-image': { token: 't', prompt: 'p', projectId: 'p' },
  'flow:upload-reference': { token: 't', base64: 'b', projectId: 'p' },
  'flow:upscale-image': { token: 't', mediaId: 'm', projectId: 'p' },
  'flow:dom-download-video': { mediaId: 'm' },
  'flow:extract-token': {},
  'flow:get-recaptcha-token': {},
  'flow:apply-agent-defaults': {},
  'flow:clear-generations': {},
  'flow:generate-character': { prompt: 'p' },
  'flow:reroll-character': { prompt: 'p' },
  'flow:generate-scene': { prompt: 'p' },
  'flow:refresh-composer': {},
  'flow:register-character-entity': {},
  'flow:rename-character': {},
  'flow:upload-character-entity': {},
  'flow:dom-navigate': { url: 'https://labs.google/' },
  'flow:compose-navigate-wait': { url: 'https://labs.google/' },
  'flow:open-project': { flowProjectId: 'p' },
  'flow:new-project': {},
  'flow:dom-execute': { script: 'document.body.textContent="x"' },
  'flow:dom-click-enter-tool': { selectors: [] },
  'flow:dom-send-prompt': { prompt: 'p', selectors: [] },
  'flow:dom-show-flow': {},
}

function ipcHarness() {
  const handlers = new Map()
  return {
    ipc: { handle: (channel, fn) => handlers.set(channel, fn) },
    handlers,
  }
}

describe('P1 negative gate: flow + chatgpt', () => {
  it('refuses every classified Flow side effect before touching the Flow view', async () => {
    const { ipc, handlers } = ipcHarness()
    const getFlowView = vi.fn(() => ({ webContents: {} }))
    const deps = {
      getCurrentMode: () => 'flow',
      getSessionTarget: () => 'chatgpt',
      getFlowView,
      getMainWindow: () => null,
    }
    registerVideoIPC(ipc, deps)
    registerFlowAPIIPC(ipc, deps)
    registerCharacterIPC(ipc, deps)
    registerDomIPC(ipc, deps)

    const mainLocal = new Set(['flow:report-response', 'flow:set-agent-mode'])
    for (const channel of handlers.keys()) {
      expect(
        FLOW_SIDE_EFFECT_CHANNELS.has(channel) || FLOW_READ_ONLY_CHANNELS.has(channel),
        `unclassified Flow IPC: ${channel}`,
      ).toBe(true)
    }
    for (const channel of FLOW_SIDE_EFFECT_CHANNELS) {
      if (mainLocal.has(channel)) continue
      expect(handlers.has(channel), `side-effect channel not registered: ${channel}`).toBe(true)
      expect(await handlers.get(channel)({}, payload[channel] || {}), channel).toEqual(FLOW_INACTIVE_RESULT)
    }
    expect(getFlowView).not.toHaveBeenCalled()
  })

  it('refuses both main-local Flow state mutations and main wires the same guard', async () => {
    const mutation = vi.fn(() => ({ ok: true }))
    const guarded = guardFlowSideEffect({
      getCurrentMode: () => 'flow',
      getSessionTarget: () => 'chatgpt',
    }, mutation)
    expect(await guarded({}, {})).toEqual(FLOW_INACTIVE_RESULT)
    expect(mutation).not.toHaveBeenCalled()

    const main = fs.readFileSync('electron/main.js', 'utf8')
    expect(main).toMatch(/ipcMain\.handle\('flow:report-response',\s*guardFlowSideEffect\(/)
    expect(main).toMatch(/ipcMain\.handle\('flow:set-agent-mode',\s*guardFlowSideEffect\(/)
  })

  it('keeps missing getSessionTarget backward-compatible with Flow', async () => {
    const { ipc, handlers } = ipcHarness()
    registerVideoIPC(ipc, {
      getCurrentMode: () => 'flow', getFlowView: () => null, getMainWindow: () => null,
    })
    const result = await handlers.get('flow:generate-video-t2v')({}, payload['flow:generate-video-t2v'])
    expect(result).not.toEqual(FLOW_INACTIVE_RESULT)
  })
})
