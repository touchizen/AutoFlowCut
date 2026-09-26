// @vitest-environment node
//
// M1-12 — 디스패치: Flow 모드의 generate-image · generate-video-t2v · check-video-status 는 URL 과 무관하게 angular
//   핸들러로 간다. 영상 둘의 angular 본문은 M2-4·M2-5 — 세션 게이트(WIZ 없음 → flow-session-missing)가 먼저라
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

describe('video.js — t2v / check-video-status 는 Flow 모드에서 angular(M2-4 · M2-5 본문)', () => {
  // M2-4: 스텁이 본문으로 바뀌었다 — WIZ 전역이 없는 문서(executeJavaScript → null)면 세션 게이트에서 닫힌다(옛 'No token' 아님).
  it.each(['https://flow.google.com/project/x', 'https://labs.google/fx/tools/flow/project/x'])('%s: generate-video-t2v → angular 세션 게이트(flow-session-missing + authFailed), 옛 deps 미호출', async (url) => {
    const { deps, legacy } = makeDeps(url)
    const ipc = makeIpcMain(); registerVideoIPC(ipc, deps)
    const r = await ipc.invoke('flow:generate-video-t2v', { token: null, prompt: 'p', projectId: 'p', model: 'veo', aspectRatio: '16:9', duration: 6 })
    expect(r).toEqual({ success: false, errorKind: 'flow-session-missing', error: 'wiz-missing', authFailed: true })
    for (const fn of Object.values(legacy)) expect(fn).not.toHaveBeenCalled()
    expect(deps.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  // M2-R1 F11(c)(B2): video.js 가 resolution 을 angular.generateVideoT2V 에 넘긴다(M2-3 배관) — 핸들러의 첫 로그(세션 게이트 전)가 그 값을 찍는다.
  it('generate-video-t2v: video.js 가 resolution 을 angular 로 넘긴다(핸들러 진입 로그에 resolution 값)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const { deps } = makeDeps('https://flow.google.com/project/x')
      const ipc = makeIpcMain(); registerVideoIPC(ipc, deps)
      await ipc.invoke('flow:generate-video-t2v', { token: null, prompt: 'p', projectId: 'p', model: 'Omni Flash', aspectRatio: '16:9', duration: 6, resolution: '1080p' })
      const entry = logSpy.mock.calls.find((c) => String(c[0]).includes('[Flow Video T2V] [Angular] generate-video-t2v:'))
      expect(entry).toBeTruthy()
      expect(entry[1]).toMatchObject({ resolution: '1080p', model: 'Omni Flash', duration: 6 })
    } finally { logSpy.mockRestore() }
  })

  // M3(D1): video.js 가 refs·plan 을 angular.generateVideoT2V 에 넘긴다 — 구조분해에서 빠지면 레퍼런스 영상이 조용히 t2v 로 제출된다. 진입 로그(세션 게이트 전)의 개수로 본다.
  it('generate-video-t2v: video.js 가 refs·plan 을 angular 로 넘긴다(핸들러 진입 로그에 refs·mentions 개수)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const { deps } = makeDeps('https://flow.google.com/project/x')
      const ipc = makeIpcMain(); registerVideoIPC(ipc, deps)
      await ipc.invoke('flow:generate-video-t2v', {
        token: null, prompt: '@king walks', projectId: 'p', model: 'Omni Flash', aspectRatio: '9:16', duration: 4, resolution: '720p',
        refs: [{ base64: 'iVBORw0KGgo=', mime: 'image/png' }], plan: { segments: [{ t: 'mention', ref: 0 }, { t: 'text', text: ' walks' }], attach: [] },
      })
      const entry = logSpy.mock.calls.find((c) => String(c[0]).includes('[Flow Video T2V] [Angular] generate-video-t2v:'))
      expect(entry).toBeTruthy()
      expect(entry[1]).toMatchObject({ refs: 1, mentions: 1 })
    } finally { logSpy.mockRestore() }
  })

  it('check-video-status → angular 세션 게이트(옛 "No token" 아님), API 모드는 옛 게이트', async () => {
    const { deps } = makeDeps('https://flow.google.com/project/x')
    const ipc = makeIpcMain(); registerVideoIPC(ipc, deps)
    const r = await ipc.invoke('flow:check-video-status', { token: null, generationIds: ['g1'], projectId: 'p' })
    // M2-5: 스텁이 본문으로 — WIZ 전역이 없는 문서면 세션 게이트에서 닫힌다. M2-R1 F3: 최상위 authFailed 가 아니라 항목별 pollError.
    expect(r).toEqual({ success: true, statuses: [{ status: 'pending', pollError: 'flow-session-missing' }] })
    expect(JSON.stringify(r)).not.toMatch(/token/i)
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
