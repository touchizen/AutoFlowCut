// @vitest-environment node
//
// M1-12 — 옛 핸들러 단락: 새 Flow(flow.google.com)에서 아직 미지원인 9개 핸들러는 Flow 모드에서 URL 과 무관하게
//   {success:false, errorKind:'flow-feature-unsupported', error:'flow-feature-unsupported:<name>'} 로 닫힌다 —
//   DOM·클릭·fetch 없이(getFlowView 미호출). API 모드는 기존 flowActive 게이트가 먼저(flowModeGate.test.js).
import { describe, it, expect, vi } from 'vitest'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'
import { registerVideoIPC } from '../../../electron/ipc/video.js'
import { registerCharacterIPC } from '../../../electron/ipc/character.js'

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p), has: (c) => handlers.has(c) }
}
function makeDeps(url = 'https://flow.google.com/project/x') {
  const getFlowView = vi.fn(() => ({ webContents: { getURL: () => url, executeJavaScript: vi.fn() } }))
  return {
    getFlowView, getCurrentMode: () => 'flow', getMainWindow: () => null, getFlowAgentOn: () => false,
    sessionFetch: vi.fn(), trustedClickOnFlowView: vi.fn(), pendingGenerations: new Map(),
    getCapturedProjectId: () => 'x',
  }
}

const CASES = {
  'flow-api': [registerFlowAPIIPC, [
    ['flow:upscale-image', 'upscale-image', { token: null, mediaId: 'm', projectId: 'p', resolution: '2k' }],
    ['flow:upload-reference', 'upload-reference', { token: null, base64: 'b', projectId: 'p' }],
    ['flow:fetch-gallery', 'fetch-gallery', { token: null, projectId: 'p' }],
  ]],
  video: [registerVideoIPC, [
    ['flow:upscale-video', 'upscale-video', { token: null, mediaId: 'm', projectId: 'p' }],
    ['flow:generate-video-i2v', 'generate-video-i2v', { token: null, prompt: 'p', startImageMediaId: 'm', projectId: 'p' }],
  ]],
  character: [registerCharacterIPC, [
    ['flow:generate-character', 'generate-character', { prompt: 'p', displayName: 'd', projectId: 'p' }],
    ['flow:reroll-character', 'reroll-character', { entityId: 'e', prompt: 'p', projectId: 'p' }],
    ['flow:generate-scene', 'generate-scene', { prompt: 'p', projectId: 'p' }],
    ['flow:upload-character-entity', 'upload-character-entity', { base64: 'b', displayName: 'd', projectId: 'p' }],
  ]],
}

describe.each(Object.entries(CASES))('%s — Flow 모드에서 미지원 단락', (_mod, [register, list]) => {
  it.each(list)('%s → flow-feature-unsupported:%s, 뷰 미접근', async (channel, name, payload) => {
    for (const url of ['https://flow.google.com/project/x', 'https://labs.google/fx/tools/flow/project/x', 'https://accounts.google.com/signin']) {
      const ipc = makeIpcMain()
      const deps = makeDeps(url)
      register(ipc, deps)
      const r = await ipc.invoke(channel, payload)
      expect(r).toEqual({ success: false, errorKind: 'flow-feature-unsupported', error: `flow-feature-unsupported:${name}` })
      expect(deps.getFlowView).not.toHaveBeenCalled()
      expect(deps.trustedClickOnFlowView).not.toHaveBeenCalled()
      expect(deps.sessionFetch).not.toHaveBeenCalled()
    }
  })
})
