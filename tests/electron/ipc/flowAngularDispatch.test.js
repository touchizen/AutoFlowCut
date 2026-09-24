// @vitest-environment node
//
// M1-12 — 디스패치: Flow 모드의 generate-image · generate-video-t2v · check-video-status 는 URL 과 무관하게 angular
//   핸들러로 간다. 영상 둘의 angular 본문은 M2 — M1 에서는 fail-closed 스텁(flow-feature-unsupported:<name>)이라
//   옛 'No token' 같은 무의미 실패로 20분 폴링이 도는 일이 없다. accounts.google.com/blank 의 generate-image 는
//   flow-session-missing(+authFailed). 옛 핸들러 코드는 남지만 도달 불가(옛 deps 미호출로 증명).
import { describe, it, expect, vi } from 'vitest'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'
import { registerVideoIPC } from '../../../electron/ipc/video.js'
import { unsupportedOnAngular } from '../../../electron/ipc/flow-angular.js'

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
}
function makeDeps(url, mode = 'flow') {
  const legacy = {
    configureFlowMode: vi.fn(async () => ({ success: true })), setFlowPageInject: vi.fn(async () => ({ success: true })),
    clearFlowPageInject: vi.fn(async () => {}), applyAgentDefaults: vi.fn(async () => ({ success: true })), getRecaptchaToken: vi.fn(async () => null),
    ensureAgentOff: vi.fn(async () => ({ success: true })), ensureAgentOn: vi.fn(async () => ({ success: true })),
    ensureOnProjectComposer: vi.fn(async () => ({ ok: true })), switchFlowToVideoMode: vi.fn(async () => ({ success: true })),
  }
  const flowView = { webContents: { getURL: () => url, executeJavaScript: vi.fn(async () => null), loadURL: vi.fn(async () => {}) } }
  const deps = {
    getFlowView: vi.fn(() => flowView), getCurrentMode: () => mode, getMainWindow: () => null, getFlowAgentOn: () => false,
    sessionFetch: vi.fn(), flowPageFetch: vi.fn(), trustedClickOnFlowView: vi.fn(async () => ({ success: true })),
    pendingGenerations: new Map(), getCapturedProjectId: () => 'x', setCapturedProjectId: vi.fn(),
    getPendingVideoGeneration: () => null, setPendingVideoGeneration: vi.fn(),
    getPendingGeneration: () => null, setPendingGeneration: vi.fn(), collectedMediaIds: new Set(),
    parseFlowResponse: () => null, getEnterToolClicked: () => true, setEnterToolClicked: vi.fn(),
    extractMediaIds: () => [], extractFifeUrls: () => [], extractBase64Images: () => [], fetchMediaAsBase64: vi.fn(),
    listAgentModels: vi.fn(), selectFlowModeTab: vi.fn(), getApiBase: () => 'https://labs.google/fx/api/trpc',
    FLOW_URL: 'https://labs.google/fx/tools/flow', ...legacy,
  }
  return { deps, legacy, flowView }
}

describe('unsupportedOnAngular (순수)', () => {
  it('unsupportedOnAngular(name) 계약', () => {
    expect(unsupportedOnAngular('upscale-image')).toEqual({ success: false, errorKind: 'flow-feature-unsupported', error: 'flow-feature-unsupported:upscale-image' })
  })
})

describe('video.js — t2v / check-video-status 는 Flow 모드에서 angular(M1 스텁)', () => {
  it.each(['https://flow.google.com/project/x', 'https://labs.google/fx/tools/flow/project/x'])('%s: generate-video-t2v → flow-feature-unsupported:generate-video-t2v, 옛 deps 미호출', async (url) => {
    const { deps, legacy } = makeDeps(url)
    const ipc = makeIpcMain(); registerVideoIPC(ipc, deps)
    const r = await ipc.invoke('flow:generate-video-t2v', { token: null, prompt: 'p', projectId: 'p', model: 'veo', aspectRatio: '16:9', duration: 6 })
    expect(r).toEqual({ success: false, errorKind: 'flow-feature-unsupported', error: 'flow-feature-unsupported:generate-video-t2v' })
    for (const fn of Object.values(legacy)) expect(fn).not.toHaveBeenCalled()
    expect(deps.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('check-video-status → 스텁(옛 "No token" 아님), API 모드는 옛 게이트', async () => {
    const { deps } = makeDeps('https://flow.google.com/project/x')
    const ipc = makeIpcMain(); registerVideoIPC(ipc, deps)
    const r = await ipc.invoke('flow:check-video-status', { token: null, generationIds: ['g1'], projectId: 'p' })
    expect(r).toEqual({ success: false, errorKind: 'flow-feature-unsupported', error: 'flow-feature-unsupported:check-video-status' })
    expect(r.error).not.toMatch(/token/i)
    const api = makeDeps('https://flow.google.com/project/x', 'api')
    const ipc2 = makeIpcMain(); registerVideoIPC(ipc2, api.deps)
    const r2 = await ipc2.invoke('flow:generate-video-t2v', { token: 't', prompt: 'p', projectId: 'p' })
    expect(r2).toEqual({ success: false, error: 'Flow inactive (API mode)' })
  })
})

describe('flow-api.js — generate-image 디스패치', () => {
  it.each(['https://accounts.google.com/signin', 'about:blank', ''])('%s → flow-session-missing + authFailed (옛 "No token"/네비게이트 아님)', async (url) => {
    const { deps, legacy, flowView } = makeDeps(url)
    const ipc = makeIpcMain(); registerFlowAPIIPC(ipc, deps)
    const r = await ipc.invoke('flow:generate-image', { prompt: 'p', projectId: 'p' })
    expect(r).toEqual({ success: false, errorKind: 'flow-session-missing', error: 'not-on-flow', authFailed: true })
    // R1#13/R2#10: makeDeps 가 만든 그 flowView 의 loadURL 을 본다(deps.flowView 는 없다 — 예전 단언은 새 vi.fn() 을 봤다)
    expect(flowView.webContents.loadURL).not.toHaveBeenCalled()
    expect(flowView.webContents.executeJavaScript).not.toHaveBeenCalled()
    for (const fn of Object.values(legacy)) expect(fn).not.toHaveBeenCalled()
  })
})
