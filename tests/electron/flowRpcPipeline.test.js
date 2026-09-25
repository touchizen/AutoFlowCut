// @vitest-environment node
//
// M1-5 — 파이프라인 통합 (a): 페이지 주입 → preload 채널(flowReportResponse) → 라우터 → pendingGenerations → collect.
//   실제 캡처 주입 문자열을 vm + FakeXHR 로 돌리고, flowReportResponse 를 routeReportResponse(payload, buildReportCtx(state))
//   로 배선한다(main.js 의 flow:report-response 와 같은 모양). registerFlowAPIIPC 하네스의 trustedClickOnFlowView 가
//   제출 클릭 자리에서 FakeXHR send → _finish(200, 실측 응답) 를 일으킨다 ⇒ 동기 결과 images[0].{mediaId,width,height}.
//   문서 전환은 새 vm 컨텍스트에 재주입 + failBoundUnfinished(main 의 did-navigate) 로 모사한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import vm from 'node:vm'
import { registerFlowAPIIPC } from '../../electron/ipc/flow-api.js'
import { createSharedHelpers } from '../../electron/ipc/shared.js'
import { routeReportResponse, buildReportCtx } from '../../electron/reportResponseRouter.js'
import { failBoundUnfinished } from '../../electron/flow-rpc-router.js'
import { FLOW_RPC_CAPTURE_INJECTION } from '../../electron/flow-rpc-capture.js'
import { sample, reencodeRequestBody, maskedUuid } from '../fixtures/flow-batchexecute-samples.js'
import { READ_COMPOSER_STATE_JS } from '../../electron/flow-composer-refs.js'   // M3: 레퍼런스 없는 제출 전의 잔여 칩 판독(D9 · §1-1)
// M3-14: 레퍼런스 파이프라인 — 가짜 컴포저 문서(jsdom)에 실제 캡처 주입(FakeXHR)을 설치한 핸들러 하네스
import { _resetDomStageForTests } from '../../electron/ipc/flow-angular.js'
import { refMediaCache } from '../../electron/flow-ref-media-cache.js'
import { refHandlerHarness, settle as settleRef, refInput, refSha, text, mention, session, FAKE_DOC, FAKE_PROJECT } from '../helpers/flowRefHandlerHarness.js'

const PROJECT = '134cf5b5-6a64-47b8-8709-6de4c6b0e44c'
const URL_OK = `https://flow.google.com/project/${PROJECT}`
const PROMPT = '궁정안에 있는 왕'
const BATCH = 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b&source-path=%2Fproject%2Fx&bl=B&f.sid=S&hl=ko&_reqid=1&rt=c'

class FakeXHR {
  constructor() { this._l = {}; this.responseType = ''; this.status = 0; this.responseText = ''; this.calls = [] }
  open(method, url) { this.calls.push(['open', method, url]) }
  setRequestHeader(k, v) { this.calls.push(['header', k, v]) }
  send(body) { this.calls.push(['send', body]) }
  addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn) }
  _finish(status, text) { this.status = status; this.responseText = text; for (const fn of this._l.loadend || []) fn.call(this) }
}

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
}

/** 하나의 "문서": 자기 XHR 클래스 + 자기 vm 컨텍스트. flowReportResponse 는 main 의 라우터로 간다. */
function makeDocument(state) {
  class PageXHR extends FakeXHR {}
  const ctx = buildReportCtx(state)
  const windowObject = {
    XMLHttpRequest: PageXHR, location: { href: URL_OK },
    electronAPI: { flowReportResponse: vi.fn(async (payload) => routeReportResponse(payload, ctx)) },
  }
  const context = vm.createContext({ window: windowObject, location: windowObject.location, console: { log() {}, warn() {}, error() {} }, Date, URL, URLSearchParams, JSON, String, Object })
  vm.runInContext(FLOW_RPC_CAPTURE_INJECTION, context)
  return {
    windowObject,
    /** 페이지가 제출 XHR 을 보내고 응답을 받는다. */
    submit: ({ body = reencodeRequestBody(sample('ogiZ0b').reqBody), respond = true, respBody = sample('ogiZ0b').respBody } = {}) => {
      const x = new windowObject.XMLHttpRequest()
      x.open('POST', BATCH); x.setRequestHeader('X-Same-Domain', '1'); x.send(body)
      if (respond) x._finish(200, respBody)
      return x
    },
  }
}

function harness({ onSubmit, summary } = {}) {
  const pendingGenerations = new Map()
  const state = { getPendingGeneration: () => null, setPendingGeneration: () => {}, pendingGenerations, getPendingVideoGeneration: () => null, setPendingVideoGeneration: () => {} }
  let doc = makeDocument(state)
  let injectedPrompt = null
  const executeJavaScript = vi.fn(async (script) => {
    const s = String(script)
    // M3: 컴포저 판독(빈 컴포저 — 잔여 칩 없음). 그 스크립트도 querySelectorAll('p') 를 품고 있어 아래 편집기 판독 마커보다 먼저 본다.
    if (s === READ_COMPOSER_STATE_JS) return { chips: [], segments: [], editorText: '', pickerOpen: false, searchDirty: false, activeInEditor: true }
    if (s.includes('__af_settings_driver__')) return { ok: true, closed: true, steps: { mode: 'already', model: 'verified', ratio: 'already(crop_16_9)', count: 'already' } }
    if (s.includes('__af_settings_panel_open__')) return false
    if (s.includes('__af_set_editor_text__')) { const m = s.match(/const text = (".*?");/); injectedPrompt = m ? JSON.parse(m[1]) : null; return { ok: true } }
    if (s.includes('WIZ_global_data.SNlM0e')) return true
    if (s.includes('elementFromPoint')) return { ok: true, why: 'ok' }
    if (s.includes('const scan =')) return { candidates: [], context: {} }
    if (s.includes('const find =')) return { found: true, on: false }
    // 캡처 플래그·주입은 **실제 문서**에서 실행한다 — 하네스가 흉내 내지 않는다.
    if (s.startsWith('!!window.__autoflowcut_rpc_capture__')) return vm.runInContext(s, vm.createContext({ window: doc.windowObject }))
    if (s.includes('batchexecute capture installed')) return undefined
    if (s.includes('settings-summary')) return summary || { text: '🍌 Nano Banana 2 x1', ligatures: ['crop_16_9'] }
    if (s.includes("querySelectorAll('p')")) return injectedPrompt
    if (s.includes('aria-disabled')) return true
    if (s.includes('interactiveCount')) return { hasComposer: true, interactiveCount: 80, url: URL_OK }
    return null
  })
  const flowView = {
    getBounds: () => ({ x: 0, y: 0, width: 957, height: 1022 }), setBounds: vi.fn(),
    webContents: { executeJavaScript, getURL: () => URL_OK, loadURL: vi.fn(async () => {}), focus: vi.fn(), sendInputEvent: vi.fn(), isDestroyed: () => false, session: null },
  }
  const helpers = createSharedHelpers({ getFlowView: () => flowView, getMainWindow: () => ({ getContentBounds: () => ({ width: 1280, height: 800 }), getBounds: () => ({ x: 0, y: 0 }) }), constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' }, onDomFailure: vi.fn(async () => {}) })
  const trustedClickOnFlowView = vi.fn(async (_sel, opts) => {
    if (opts?.step === 'compose-submit') await (onSubmit ? onSubmit(api) : doc.submit())
    return { success: true }
  })
  const sessionFetch = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: { get: () => 'image/png' } }))
  const ipcMain = makeIpcMain()
  registerFlowAPIIPC(ipcMain, {
    getFlowView: () => flowView, getMainWindow: () => ({ getContentBounds: () => ({ width: 1280, height: 800 }), getBounds: () => ({ x: 0, y: 0 }) }),
    getCurrentMode: () => 'flow', getFlowAgentOn: () => false,
    parseFlowResponse: () => null, getEnterToolClicked: () => true, setEnterToolClicked: vi.fn(),
    setCapturedProjectId: vi.fn(), getCapturedProjectId: () => null, pendingGenerations, collectedMediaIds: new Set(),
    getPendingGeneration: () => null, setPendingGeneration: vi.fn(), flowPageFetch: vi.fn(),
    extractMediaIds: () => [], extractFifeUrls: () => [], extractBase64Images: () => [], fetchMediaAsBase64: vi.fn(),
    listAgentModels: vi.fn(), selectFlowModeTab: vi.fn(), getApiBase: () => 'https://labs.google/fx/api/trpc', FLOW_URL: 'https://labs.google/fx/tools/flow',
    ...helpers,
    // R2#4: 옛 deps 스파이는 실제 헬퍼 뒤에(앞에 두면 실제 configureFlowMode 가 덮는다)
    configureFlowMode: vi.fn(), setFlowPageInject: vi.fn(), clearFlowPageInject: vi.fn(async () => {}), applyAgentDefaults: vi.fn(), getRecaptchaToken: vi.fn(),
    trustedClickOnFlowView, sessionFetch,
  })
  const api = {
    ipcMain, pendingGenerations, sessionFetch,
    get doc() { return doc },
    /** 문서 전환 모사: 새 컨텍스트에 재주입(새 doc nonce) + main 의 did-navigate 처리. */
    navigate: () => { doc = makeDocument(state); return failBoundUnfinished(pendingGenerations) },
    generate: (p = {}) => ipcMain.invoke('flow:generate-image', { prompt: PROMPT, aspectRatio: '16:9', model: 'Nano Banana 2', projectId: PROJECT, referenceImages: [], batchCount: 1, asyncMode: false, ...p }),
  }
  return api
}

async function settle(promise, maxMs = 5000) {
  let done = false
  const p = promise.then((v) => { done = true; return v })
  for (let t = 0; t < maxMs && !done; t += 100) await vi.advanceTimersByTimeAsync(100)
  return p
}

beforeEach(() => { vi.useFakeTimers({ now: 1790240102500 }); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('파이프라인 (a): 주입 → flowReportResponse → 라우터 → collect', () => {
  it('동기: 페이지 XHR(실제 주입) 의 send/loadend 가 라우터를 거쳐 images[0] {mediaId, width, height} 로 돌아온다', async () => {
    const h = harness()
    const r = await settle(h.generate())
    expect(r.success).toBe(true)
    expect(r.images[0]).toMatchObject({ mediaId: maskedUuid(5), width: 1376, height: 768, seed: 1687588041 })
    expect(h.doc.windowObject.electronAPI.flowReportResponse).toHaveBeenCalledTimes(2)
    const kinds = h.doc.windowObject.electronAPI.flowReportResponse.mock.calls.map((c) => c[0].kind)
    expect(kinds).toEqual(['batchexecute-send', 'batchexecute'])
    expect(h.pendingGenerations.size).toBe(0)
  })

  it('비동기: check(completed, DOM 프로브 없음) → collect', async () => {
    let page
    const h = harness({ onSubmit: (api) => { page = api.doc } })
    const r = await settle(h.generate({ asyncMode: true }))
    expect(r).toMatchObject({ success: true, submitted: true })
    expect(await h.ipcMain.invoke('flow:check-generation', { generationId: r.generationId })).toMatchObject({ completed: false, via: 'rpc' })
    page.submit()   // 페이지가 이제 보낸다(send → loadend)
    expect(await h.ipcMain.invoke('flow:check-generation', { generationId: r.generationId })).toMatchObject({ completed: true, via: 'rpc' })
    const c = await h.ipcMain.invoke('flow:collect-generation', { generationId: r.generationId })
    expect(c.images[0]).toMatchObject({ mediaId: maskedUuid(5), width: 1376, height: 768 })
  })

  it('문서 전환: 바인딩 중 새 컨텍스트에 재주입 + failBoundUnfinished → 첫 gen 은 flow-submit-lost, 새 문서의 send 는 새 gen 에만 바인딩', async () => {
    let lastXhr = null
    const h = harness({ onSubmit: (api) => { lastXhr = api.doc.submit({ respond: false }) } })   // send 만, 응답은 나중에
    const r1 = await settle(h.generate({ asyncMode: true }))
    const g1 = h.pendingGenerations.get(r1.generationId)
    expect(g1.doc).toMatch(/^[0-9a-f]{32}$/)
    const doc1 = g1.doc
    expect(h.navigate()).toBe(1)
    expect(g1).toMatchObject({ completed: true, error: 'flow-submit-lost' })
    // 새 문서에서 두 번째 생성 — send 는 새 gen 에만 바인딩된다(첫 gen 은 완료 상태라 후보가 아니다)
    const r2 = await settle(h.generate({ asyncMode: true }))
    const g2 = h.pendingGenerations.get(r2.generationId)
    expect(g2.doc).toMatch(/^[0-9a-f]{32}$/)
    expect(g2.doc).not.toBe(doc1)
    expect(g1.doc).toBe(doc1)
    // 새 문서의 seq 1 응답(옛 문서의 seq 1 과 같은 seq) 은 새 gen 만 완료한다
    lastXhr._finish(200, sample('ogiZ0b').respBody)
    expect(await h.ipcMain.invoke('flow:collect-generation', { generationId: r1.generationId })).toMatchObject({ success: false, errorKind: 'flow-submit-lost' })
    const c2 = await h.ipcMain.invoke('flow:collect-generation', { generationId: r2.generationId })
    expect(c2.success).toBe(true)
  })

  it('wantRatio 는 gen 에서 온다: 9:16 요청에 1376x768 응답 → flow-aspect-mismatch', async () => {
    const h = harness({ summary: { text: '🍌 Nano Banana 2 x1', ligatures: ['crop_9_16'] } })
    const r = await settle(h.generate({ aspectRatio: '9:16' }))
    expect(r).toMatchObject({ success: false, errorKind: 'flow-aspect-mismatch' })
    expect(h.sessionFetch).not.toHaveBeenCalled()
  })
})

// M3-14(계획서 docs/plans/2026-09-25-flow-M3-references-plan.md §4 M3-14 · D5·D6·D10·D12) — 레퍼런스 경로를 **실제 캡처 주입**까지 잇는다.
//   가짜 컴포저 문서(jsdom — 컴포즈 스크립트가 실제로 돈다)에 FLOW_RPC_CAPTURE_INJECTION 을 FakeXHR 위에 설치한다(main 이 문서 로드 때 하듯). 붙여넣기 업로드는
//   그 문서의 XHR 이 maseQ(S3#4 요청)를 보내고, 제출 클릭은 S3#9 요청을 보낸다 — 주입이 send/loadend 를 flowReportResponse 로 보고하고 라우터가 {doc, seq} 로
//   바인딩한다. 핸들러 하네스(tests/helpers/flowRefHandlerHarness.js realCapture)가 나머지(세션·설정·신뢰 클릭)를 맡는다.
describe('M3-14 파이프라인 — 레퍼런스: 실제 캡처 주입 → flowReportResponse → 라우터(sentRefs·sentMentions) → 검증 → collect', () => {
  const U = maskedUuid
  /** S3#9: @king(U2) 인라인 멘션 + queen ＋ 첨부 — 요청 refs [U2,U3] · mentions [U2] · 응답 U24(768×1376, 되돌림 [U2,U3]). */
  const PLAN9 = { segments: [mention(0), text(' and a queen in a garden')], attach: [1] }
  const REFS9 = () => [refInput('king'), refInput('queen')]
  const logged = () => [...console.log.mock.calls, ...console.warn.mock.calls].map((c) => c.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')).join('\n')
  /** 제출 클릭 때 맵의 ogiZ0b gen 을 잡아 두고 **페이지 XHR** 이 S3#9 요청을 보내고 응답한다(주입이 보고). */
  const submitS3_9 = (box) => (sp, map) => { box.gen = [...map.values()].find((g) => g.rpc === 'ogiZ0b') || null; sp.xhr(9) }
  /** 드라이버가 맵에 넣는 업로드(maseQ) gen 을 붙잡는다 — 성공하면 드라이버가 맵에서 지우므로. */
  const catchUploadGens = (h) => {
    const gens = []
    const set = h.pendingGenerations.set.bind(h.pendingGenerations)
    h.pendingGenerations.set = (k, g) => { if (g && g.rpc === 'maseQ') gens.push(g); return set(k, g) }
    return gens
  }
  beforeEach(() => { _resetDomStageForTests(); refMediaCache.clear() })
  afterEach(() => { refMediaCache.clear() })

  it('동기: king 은 이 문서 세션 재사용 · queen 은 붙여넣기 업로드 — 페이지의 maseQ(S3#4)가 주입 nonce 로 바인딩돼 업로드 gen 이 U3 로 완료 → S3#9 send 가 sentRefs [U2,U3]·sentMentions [U2] 로 바인딩 → loadend → images', async () => {
    const box = {}
    const h = refHandlerHarness({ realCapture: true, page: { assets: session(U(2)), upload: { ids: [U(3)] } }, onSubmit: submitS3_9(box) })
    const uploads = catchUploadGens(h)
    expect(h.docNonce).toMatch(/^[0-9a-f]{32}$/)
    expect(h.docNonce).not.toBe(FAKE_DOC)   // 주입이 만든 nonce(가짜 페이지가 심어 둔 값이 아니다)
    refMediaCache.set(h.docNonce, FAKE_PROJECT, refSha('king'), U(2))
    const r = await settleRef(h.generate({ refs: REFS9(), plan: PLAN9 }), 120000)
    expect(r.success).toBe(true)
    expect(r.images).toHaveLength(1)
    expect(r.images[0]).toMatchObject({ mediaId: U(24), width: 768, height: 1376 })
    // 페이지가 보낸 것은 주입의 보고 넷뿐 — 전부 같은 문서
    expect(h.reports.map((p) => [p.kind, p.rpcid])).toEqual([['batchexecute-send', 'maseQ'], ['batchexecute', 'maseQ'], ['batchexecute-send', 'ogiZ0b'], ['batchexecute', 'ogiZ0b']])
    expect([...new Set(h.reports.map((p) => p.doc))]).toEqual([h.docNonce])
    expect(h.reports[0]).toEqual({ kind: 'batchexecute-send', doc: h.docNonce, rpcid: 'maseQ', rpcids: ['maseQ'], seq: 1, prompts: [], sentAt: expect.any(Number) })   // 업로드 본문은 풀지 않는다
    // 업로드 gen — 주입 nonce 로 바인딩, S3#4 의 mediaId 로 완료 → 세션 캐시도 그 문서 키로
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({ rpc: 'maseQ', boundRpc: 'maseQ', doc: h.docNonce, seq: 1, mediaId: U(3), completed: true, error: null })
    expect(refMediaCache.get(h.docNonce, FAKE_PROJECT, refSha('queen'))).toBe(U(3))
    // 제출 gen — 캡처가 요청에서 뽑은 refs·mentions 로 바인딩
    expect(box.gen).toMatchObject({
      rpc: 'ogiZ0b', boundRpc: 'ogiZ0b', doc: h.docNonce, seq: 2, completed: true,
      sentRefs: [U(2), U(3)], sentMentions: [U(2)], expectedRefs: [U(2), U(3)], expectedMentions: [U(2)],
    })
    expect(h.page.counts.paste).toBe(1)
    expect(h.sessionFetch).toHaveBeenCalledTimes(1)
    expect(h.pendingGenerations.size).toBe(0)
    expect(logged()).toMatch(/\[Flow API\] \[Angular\] refs verified request=2 echo=2 mentions=1\/1/)
  })

  it('비동기: 둘 다 세션 재사용(업로드 0) → {generationId, submitted} → check(completed, via rpc) → collect 가 검증 뒤 images', async () => {
    const box = {}
    const h = refHandlerHarness({ realCapture: true, page: { assets: session(U(2), U(3)) }, onSubmit: submitS3_9(box) })
    refMediaCache.set(h.docNonce, FAKE_PROJECT, refSha('king'), U(2))
    refMediaCache.set(h.docNonce, FAKE_PROJECT, refSha('queen'), U(3))
    const r = await settleRef(h.generate({ refs: REFS9(), plan: PLAN9, asyncMode: true }), 120000)
    expect(r).toMatchObject({ success: true, submitted: true })
    expect(h.reports.map((p) => p.rpcid)).toEqual(['ogiZ0b', 'ogiZ0b'])
    expect(box.gen).toMatchObject({ doc: h.docNonce, sentRefs: [U(2), U(3)], sentMentions: [U(2)] })
    expect(await h.ipcMain.invoke('flow:check-generation', { generationId: r.generationId })).toMatchObject({ completed: true, via: 'rpc' })
    const c = await h.ipcMain.invoke('flow:collect-generation', { generationId: r.generationId })
    expect(c.success).toBe(true)
    expect(c.images[0]).toMatchObject({ mediaId: U(24), width: 768, height: 1376 })
    expect(h.pendingGenerations.size).toBe(0)
  })

  it('기대를 [U2,U9] 로 바꾸면(queen 이 세션의 U9) — 같은 S3#9 요청(refs [U2,U3])·되돌림이 기대와 달라 flow-references-mismatch + postClick, 다운로드 없음', async () => {
    const box = {}
    const h = refHandlerHarness({ realCapture: true, page: { assets: session(U(2), U(9)) }, onSubmit: submitS3_9(box) })
    refMediaCache.set(h.docNonce, FAKE_PROJECT, refSha('king'), U(2))
    refMediaCache.set(h.docNonce, FAKE_PROJECT, refSha('queen'), U(9))
    const r = await settleRef(h.generate({ refs: REFS9(), plan: PLAN9 }), 120000)
    expect(r).toEqual({ success: false, errorKind: 'flow-references-mismatch', error: 'flow-references-mismatch', postClick: true })
    expect(box.gen).toMatchObject({ expectedRefs: [U(2), U(9)], sentRefs: [U(2), U(3)], sentMentions: [U(2)] })
    expect(h.page.counts.paste).toBe(0)
    expect(h.sessionFetch).not.toHaveBeenCalled()
    expect(logged()).toMatch(/refs mismatch request=2\/2 echo=2\/2 mentions=1\/1 → flow-references-mismatch/)
  })
})
