// @vitest-environment node
//
// M1-9 — flow:session-status. flow.google.com 에는 세션 API 도 Bearer 도 없다(2026-09-23 실측). 준비 판정은
//   Flow 페이지 URL(isFlowPageUrl) → WIZ_global_data.SNlM0e 존재 → nzlxg(크레딧) 읽기 RPC 성공 — 순서대로.
//   결과 {ready:true, credits} | {ready:false, reason}. reason 은 상태어(wiz-missing | not-on-flow | flow-inactive
//   | rpc:http:<status> | rpc:er:<code> | timeout) — 렌더러가 이유별 토스트를 고른다. ready 는 10초 캐시.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'
import { sample, respBodyFailure } from '../../fixtures/flow-batchexecute-samples.js'

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
}

/**
 * @param {object} o
 * @param {string} o.url 현재 뷰 URL
 * @param {boolean} o.wiz WIZ 프로브 결과
 * @param {object|Error} o.rpc nzlxg 페이지 XHR 결과({status,text}|{status:0,error}) 또는 throw
 */
function harness({ url = 'https://flow.google.com/project/abc', wiz = true, rpc = { status: 200, text: sample('nzlxg').respBody }, mode = 'flow' } = {}) {
  const executeJavaScript = vi.fn(async (script) => {
    const s = String(script)
    if (s.includes('WIZ_global_data.SNlM0e')) return wiz
    if (s.includes('"nzlxg"')) { if (rpc instanceof Error) throw rpc; return rpc }
    return null
  })
  const getURL = vi.fn(() => url)
  const flowView = { webContents: { executeJavaScript, getURL, isDestroyed: () => false } }
  const ipcMain = makeIpcMain()
  registerFlowAPIIPC(ipcMain, {
    getFlowView: () => flowView,
    getMainWindow: () => null,
    getCurrentMode: () => mode,
    trustedClickOnFlowView: vi.fn(), getFlowAgentOn: () => false,
    ensureAgentOff: vi.fn(), ensureAgentOn: vi.fn(), ensureOnProjectComposer: vi.fn(),
    applyAgentDefaults: vi.fn(), configureFlowMode: vi.fn(), setFlowPageInject: vi.fn(), clearFlowPageInject: vi.fn(),
    parseFlowResponse: () => null, getEnterToolClicked: () => true, setEnterToolClicked: vi.fn(),
    setCapturedProjectId: vi.fn(), getCapturedProjectId: () => null,
    pendingGenerations: new Map(), collectedMediaIds: new Set(),
    getPendingGeneration: () => null, setPendingGeneration: vi.fn(),
    getRecaptchaToken: vi.fn(async () => null), sessionFetch: vi.fn(), flowPageFetch: vi.fn(),
    extractMediaIds: () => [], extractFifeUrls: () => [], extractBase64Images: () => [],
    fetchMediaAsBase64: vi.fn(), listAgentModels: vi.fn(), selectFlowModeTab: vi.fn(),
    getApiBase: () => 'https://labs.google/fx/api/trpc', FLOW_URL: 'https://labs.google/fx/tools/flow',
  })
  return { ipcMain, executeJavaScript, getURL, status: () => ipcMain.invoke('flow:session-status', {}) }
}

let log, warn
beforeEach(() => { log = vi.spyOn(console, 'log').mockImplementation(() => {}); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { log.mockRestore(); warn.mockRestore(); vi.useRealTimers() })

describe('flow:session-status', () => {
  it('ready: Flow URL + WIZ + nzlxg → {ready:true, credits:1050} + 로그 [Flow Session] ready credits=1050', async () => {
    const h = harness()
    await expect(h.status()).resolves.toEqual({ ready: true, credits: 1050 })
    const scripts = h.executeJavaScript.mock.calls.map((c) => String(c[0]))
    expect(scripts[0]).toContain('WIZ_global_data.SNlM0e')
    expect(scripts[1]).toContain('"nzlxg"')
    expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('[Flow Session] ready credits=1050')
  })

  it('WIZ 없음 → wiz-missing (nzlxg 호출 없음)', async () => {
    const h = harness({ wiz: false })
    await expect(h.status()).resolves.toEqual({ ready: false, reason: 'wiz-missing' })
    expect(h.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it('accounts.google.com / about:blank → not-on-flow (페이지 스크립트 미실행)', async () => {
    for (const url of ['https://accounts.google.com/v3/signin/identifier?continue=x', 'about:blank']) {
      const h = harness({ url })
      await expect(h.status()).resolves.toEqual({ ready: false, reason: 'not-on-flow' })
      expect(h.executeJavaScript).not.toHaveBeenCalled()
    }
  })

  it('API 모드 → flow-inactive (뷰 미접근)', async () => {
    const h = harness({ mode: 'api' })
    await expect(h.status()).resolves.toEqual({ ready: false, reason: 'flow-inactive' })
    expect(h.getURL).not.toHaveBeenCalled()
    expect(h.executeJavaScript).not.toHaveBeenCalled()
  })

  it.each([
    ['HTTP 401', { status: 401, text: '' }, 'rpc:http:401'],
    ['HTTP 500', { status: 500, text: 'oops' }, 'rpc:http:500'],
    ['실패 프레임 code 3', { status: 200, text: respBodyFailure('nzlxg', 3) }, 'rpc:er:3'],
    ['실패 프레임 code 16', { status: 200, text: respBodyFailure('nzlxg', 16) }, 'rpc:er:16'],
    ['timeout', { status: 0, error: 'timeout' }, 'timeout'],
    ['xhr-error', { status: 0, error: 'xhr-error' }, 'rpc:network:xhr-error'],
    ['executeJavaScript reject', new Error('Script failed'), 'rpc:network:execute-failed'],
  ])('%s → {ready:false, reason:%s}', async (_l, rpc, reason) => {
    const h = harness({ rpc })
    await expect(h.status()).resolves.toEqual({ ready: false, reason })
    expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('reason=' + reason)
  })

  it('ready 는 10초 캐시 — 그 안의 두 번째 호출은 페이지를 다시 묻지 않고, 지나면 다시 묻는다', async () => {
    vi.useFakeTimers({ now: 1790240102500 })
    const h = harness()
    await expect(h.status()).resolves.toEqual({ ready: true, credits: 1050 })
    expect(h.executeJavaScript).toHaveBeenCalledTimes(2)
    await expect(h.status()).resolves.toEqual({ ready: true, credits: 1050, cached: true })
    expect(h.executeJavaScript).toHaveBeenCalledTimes(2)
    vi.setSystemTime(1790240102500 + 10001)
    await expect(h.status()).resolves.toEqual({ ready: true, credits: 1050 })
    expect(h.executeJavaScript).toHaveBeenCalledTimes(4)
  })

  it('not-ready 는 캐시하지 않는다', async () => {
    const h = harness({ wiz: false })
    await h.status(); await h.status()
    expect(h.executeJavaScript).toHaveBeenCalledTimes(2)
  })
})
