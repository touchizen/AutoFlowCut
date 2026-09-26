// @vitest-environment node
//
// M1-6 — flow:download-video-url 은 flow.google.com 에서 서명 URL(flow-content.google/…?Signature=…)을 받는다.
//   로그는 host=<hostname> media=<id 앞 8자> bytes=<n> 만(URL·서명 없음), 실패는 중립 {error:'flow-download-error',
//   httpStatus} — 'HTTP 403' 같은 문구는 isFlowAuthError 가 인증 실패로 오판한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'
import { isFlowAuthError, markFlowAuthFailure } from '../../../src/engine/engineFlow.js'

const SIGNED = 'https://flow-content.google/video/2f1c9a7e-1111-2222-3333-444455556666?Expires=1790261742&KeyName=labs-flow-prod-cdn-key&Signature=SIGSECRET'

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
}

function harness(sessionFetch) {
  const ipcMain = makeIpcMain()
  registerFlowAPIIPC(ipcMain, {
    getFlowView: () => null,
    getMainWindow: () => null,
    trustedClickOnFlowView: vi.fn(),
    getCurrentMode: () => 'flow',
    getFlowAgentOn: () => false,
    ensureAgentOff: vi.fn(), ensureAgentOn: vi.fn(), ensureOnProjectComposer: vi.fn(),
    applyAgentDefaults: vi.fn(), configureFlowMode: vi.fn(), setFlowPageInject: vi.fn(), clearFlowPageInject: vi.fn(),
    parseFlowResponse: () => null,
    getEnterToolClicked: () => true, setEnterToolClicked: vi.fn(),
    setCapturedProjectId: vi.fn(), getCapturedProjectId: () => null,
    pendingGenerations: new Map(), collectedMediaIds: new Set(),
    getPendingGeneration: () => null, setPendingGeneration: vi.fn(),
    getRecaptchaToken: vi.fn(async () => null),
    sessionFetch,
    flowPageFetch: vi.fn(),
    extractMediaIds: () => [], extractFifeUrls: () => [], extractBase64Images: () => [],
    fetchMediaAsBase64: vi.fn(), listAgentModels: vi.fn(), selectFlowModeTab: vi.fn(),
    getApiBase: () => 'https://labs.google/fx/api/trpc',
    FLOW_URL: 'https://labs.google/fx/tools/flow',
  })
  return ipcMain
}

let log, warn, error
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { log.mockRestore(); warn.mockRestore(); error.mockRestore() })
const logged = () => [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].map((c) => c.map(String).join(' ')).join('\n')

describe('flow:download-video-url — 서명 URL 다운로드 (M1-6)', () => {
  it('성공: base64 반환, sessionFetch 는 Authorization 없이, 로그는 host=flow-content.google media=<8자> bytes=<n>', async () => {
    const sessionFetch = vi.fn(async () => ({
      ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: { get: () => 'video/mp4' },
    }))
    const r = await harness(sessionFetch).invoke('flow:download-video-url', { url: SIGNED, token: null })
    expect(r).toEqual({ success: true, base64: 'data:video/mp4;base64,AQID' })
    expect(sessionFetch).toHaveBeenCalledWith(SIGNED, { headers: {} })
    expect(logged()).toMatch(/host=flow-content\.google media=2f1c9a7e bytes=3/)
    expect(logged()).not.toContain('SIGSECRET')
    expect(logged()).not.toContain('Expires')
    expect(logged()).not.toContain('flow-content.google/video')
  })

  it('HTTP 403 → {error:"flow-download-error", errorKind, httpStatus:403} — 로그는 status=403 만, auth 아님', async () => {
    const sessionFetch = vi.fn(async () => ({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }))
    const r = await harness(sessionFetch).invoke('flow:download-video-url', { url: SIGNED })
    expect(r).toEqual({ success: false, error: 'flow-download-error', errorKind: 'flow-download-error', httpStatus: 403 })
    expect(logged()).toMatch(/host=flow-content\.google media=2f1c9a7e status=403/)
    expect(logged()).not.toContain('SIGSECRET')
    expect(isFlowAuthError(r)).toBe(false)
    expect(markFlowAuthFailure(r)).not.toHaveProperty('authFailed')
  })

  it('fetch throw → 중립 결과(httpStatus 0), 예외 메시지(URL 포함 가능)는 결과·로그에 싣지 않는다', async () => {
    const sessionFetch = vi.fn(async () => { throw new TypeError('Invalid URL ' + SIGNED) })
    const r = await harness(sessionFetch).invoke('flow:download-video-url', { url: SIGNED })
    expect(r).toEqual({ success: false, error: 'flow-download-error', errorKind: 'flow-download-error', httpStatus: 0 })
    expect(logged()).not.toContain('SIGSECRET')
    expect(logged()).toMatch(/reason=TypeError/)
  })

  it('url 없음 → No URL (기존 계약 유지)', async () => {
    const r = await harness(vi.fn()).invoke('flow:download-video-url', { url: '' })
    expect(r).toEqual({ success: false, error: 'No URL' })
  })
})
