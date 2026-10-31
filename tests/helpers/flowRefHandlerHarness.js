// M3-9 · M3-10 공용 — 레퍼런스 경로의 **핸들러** 하네스(계획서 2026-09-25 M3 §4 "가짜 페이지").
//
//   flow:generate-image(registerFlowAPIIPC) / flow:generate-video-t2v(registerVideoIPC) 를 실제 createSharedHelpers 와 함께 등록하고,
//   컴포저 스크립트(READ_COMPOSER_STATE_JS·APPEND_EDITOR_TEXT_JS·애셋 창 파인더·붙여넣기 관찰·READ_EDITOR_TEXT_JS …)는 가짜 페이지
//   (fakeFlowComposer.js)의 jsdom 문서에서 **실제로** 돌린다. 나머지(WIZ·캡처 프로브·설정 드라이버·에이전트·크레딧·제출 가능·요약)는 기존 하네스
//   (flowGenerateImageAngular.test.js)처럼 마커로 라우팅한다. 신뢰 클릭 가짜는 제출 클릭(compose-submit)만 가로채 beforeDispatch → 페이지의
//   send/loadend(S3 샘플 — 요청의 refs·mentions·prompts 는 실제 추출기로)를 라우터에 흘리고, 나머지 클릭은 가짜 페이지에 mousemove·click 을 보낸다.
//   붙여넣기(deps.pasteIntoFlowView)는 가짜 페이지의 paste() — 편집기 붙여넣기 업로드가 maseQ send/loadend 를 예약한다.
//   이 헬퍼는 파일 로더(fs)를 쓰므로 `@vitest-environment node` 에서만.
import { vi } from 'vitest'
import { createHash } from 'node:crypto'
import { registerFlowAPIIPC } from '../../electron/ipc/flow-api.js'
import { registerVideoIPC } from '../../electron/ipc/video.js'
import { createSharedHelpers } from '../../electron/ipc/shared.js'
import { routeReportResponse, buildReportCtx } from '../../electron/reportResponseRouter.js'
import { decodeFReqInner, extractSubmitRefs, extractSubmitPrompts } from '../../electron/flow-rpc-protocol.js'
import { SUBMIT_ENABLED_PROBE } from '../../electron/flow-submit-gate.js'
import { READ_EDITOR_TEXT_JS } from '../../electron/flow-composer-dom.js'
import { composerStateJs } from '../../electron/flow-composer-refs.js'
import { FLOW_RPC_CAPTURE_INJECTION } from '../../electron/flow-rpc-capture.js'
import { createMediaTokenRegistry } from '../../electron/flow-media-tokens.js'
import { createFakeFlowComposer, makeFakeClipboard, fakeNativeImage, maseQBody, pngBytes, FAKE_DOC, FAKE_PROJECT } from './fakeFlowComposer.js'
import { s3, s3RequestBody } from '../fixtures/flow-m3-samples.js'
import { EMPTY_EDITOR, asbToken } from '../fixtures/flow-live-dom-m3.js'
import { respBodyWithPayload, maskedUuid } from '../fixtures/flow-batchexecute-samples.js'

/** 페이지의 XMLHttpRequest 흉내(realCapture) — 캡처 주입이 prototype 의 open/send 를 감싼다. _finish 가 loadend 를 쏜다. */
class FakeXHR {
  constructor() { this._l = {}; this.responseType = ''; this.status = 0; this.responseText = ''; this.calls = [] }
  open(method, url) { this.calls.push(['open', method, url]) }
  setRequestHeader(k, v) { this.calls.push(['header', k, v]) }
  send(body) { this.calls.push(['send', body]) }
  addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn) }
  _finish(status, text) { this.status = status; this.responseText = text; for (const fn of this._l.loadend || []) fn.call(this) }
}

export { FAKE_DOC, FAKE_PROJECT }
const COMPOSER_STATE_PREFIX = composerStateJs().slice(0, composerStateJs().lastIndexOf('{}'))
/** 2026-10-31 실측 모양의 as29s 이미지 기록(마스킹) — [5][10]·[6][1][3] 에 https://lh3.googleusercontent.com/asb/<토큰>. */
export function as29sImageRecord(id, tokenOf = id) {
  const url = `https://lh3.googleusercontent.com/asb/${asbToken(tokenOf)}`
  return [id, FAKE_PROJECT, maskedUuid(98), null, null, [[1793426994, 0], null, null, null, null, null, [null, null, null, null, 1], null, null, 1, url, null, null, 276168],
    [null, [null, null, null, url, 0, null, 'image/jpeg'], [768, 1376], null, null, [url]]]
}
export const FLOW_URL_OK = `https://flow.google.com/project/${FAKE_PROJECT}`
export const SUBMIT_SEQ = 100

/** IPC 로 넘기는 레퍼런스 한 장({base64, mime}) · 그 sha256(main 이 계산하는 캐시 키) — 꼬리가 다르면 다른 이미지. */
export const refInput = (tail) => ({ base64: pngBytes(tail).toString('base64'), mime: 'image/png' })
export const refSha = (tail) => createHash('sha256').update(pngBytes(tail)).digest('hex')
export const text = (t) => ({ t: 'text', text: t })
export const mention = (i) => ({ t: 'mention', ref: i })
export const session = (...ids) => ids.map((id) => ({ id, session: true, name: 'image.png' }))

/** S3#n 요청에서 캡처 주입이 싣는 것(rpcid · prompts · refs · mentions) — 실제 추출기로. */
export function sampleSendFields(n) {
  const d = decodeFReqInner(s3RequestBody(n))
  const r = extractSubmitRefs(d.rpcid, d.inner)
  return { rpcid: d.rpcid, prompts: extractSubmitPrompts(d.rpcid, d.inner), refs: r ? r.refs : null, mentions: r ? r.mentions : null }
}

/**
 * @param {object} o
 *   kind 'image'|'video' · url · page(createFakeFlowComposer 옵션) · clipboard(가짜 클립보드 초기값) · upload {sendMs, loadendMs, noSend}
 *   · sample(제출 샘플 번호 S3#n — 기본 onSubmit 이 send/loadend) · send(send 이벤트 덮어쓰기) · loadend(loadend 덮어쓰기) · onSubmit(api)
 *   · settings(드라이버 결과 | Promise) · summary · credits(nzlxg 순서) · hidden · bounds · beforeDispatchHook(page) · deadSteps(신뢰 클릭이 헛도는 step 들)
 *   · quarantineDuringGuard(registry)(2026-10-31) → 제출 클릭 dispatch 가드의 컴포저 판독 중에 호출(토큰 격리 모사)
 *   · as29sTokens(2026-10-31) true → as29s 를 그 id 의 이미지 기록(asb 토큰)으로 답한다(page.asb 와 함께)
 *   · realCapture(M3-14) true → 가짜 페이지 문서에 **실제** 캡처 주입(FLOW_RPC_CAPTURE_INJECTION)을 FakeXHR 위에 설치한다(main 이 문서 로드 때 하듯).
 *     그 문서의 flowReportResponse 가 라우터로 간다(main.js 의 flow:report-response 와 같은 모양). 문서 nonce 는 주입이 만든다(가짜 페이지의 FAKE_DOC 은 지운다 —
 *     드라이버의 READ_RPC_DOC_JS 도 같은 문서에서 그 값을 읽는다) · 핸들러의 캡처 프로브·주입도 그 문서에서 돈다 · 붙여넣기 업로드는 페이지 XHR 이 maseQ(S3#4 요청)를
 *     보내고 응답한다(U3 이면 S3#4 응답 그대로) · 제출은 submitPage.xhr(n) — 페이지 XHR 이 S3#n 요청을 보내고 응답한다. 이때 결과의 docNonce · reports(보고 페이로드).
 */
export function refHandlerHarness(o = {}) {
  const kind = o.kind || 'image'
  const url = o.url ?? FLOW_URL_OK
  const trace = []
  const as29sCalls = {}
  let bounds = o.bounds ? { ...o.bounds } : o.hidden ? { x: 0, y: 0, width: 0, height: 0 } : { x: 0, y: 0, width: 957, height: 1022 }
  const credits = Array.isArray(o.credits) ? [...o.credits] : [900]
  const clipboard = makeFakeClipboard(o.clipboard || { formats: ['text/plain', 'text/html', 'application/x-lexical-editor'], text: 'user text', html: '<p>user text</p>' }, (tag) => trace.push(tag))
  const pendingGenerations = new Map()
  const onDomFailure = vi.fn(async () => {})
  let flowView = null
  const mainWindow = { getContentBounds: () => ({ width: 1280, height: 800 }), getBounds: () => ({ x: 0, y: 0 }), webContents: { focus: vi.fn(() => { trace.push('main-focus') }) } }
  const helpers = createSharedHelpers({
    getFlowView: () => flowView,
    getMainWindow: () => mainWindow,
    constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' },
    onDomFailure,
  })
  const ctx = buildReportCtx({
    getPendingGeneration: () => null, setPendingGeneration: () => {}, pendingGenerations,
    getPendingVideoGeneration: () => null, setPendingVideoGeneration: () => {},
    reportDomFailure: helpers.reportDomFailure,
  })
  const up = { sendMs: 300, loadendMs: 7500, ...(o.upload || {}) }
  /** realCapture: 페이지(가짜 문서)의 XHR 로 S3#n 요청을 보낸다 — 캡처 주입이 send 를 보고한다. XHR 을 돌려준다(_finish 가 loadend). */
  const pageXhrSend = (n) => {
    const x = new page.window.XMLHttpRequest()
    x.open('POST', s3(n).url)
    x.setRequestHeader('X-Same-Domain', '1')
    x.send(s3RequestBody(n))
    return x
  }
  const page = createFakeFlowComposer({
    ...(o.page || {}),
    clipboard,
    onEvent: (tag) => trace.push('page:' + tag),
    upload: {
      ...((o.page && o.page.upload) || {}),
      onUpload: ({ id, n }) => {
        if (up.noSend) return
        if (o.realCapture) {
          let x = null
          setTimeout(() => { x = pageXhrSend(4) }, up.sendMs)
          setTimeout(() => { if (x) x._finish(200, id === maskedUuid(3) ? s3(4).respBody : maseQBody(id)) }, up.loadendMs)
          return
        }
        setTimeout(() => routeReportResponse({ kind: 'batchexecute-send', doc: FAKE_DOC, rpcid: 'maseQ', rpcids: ['maseQ'], seq: n, prompts: [], sentAt: Date.now() / 1000 }, ctx), up.sendMs)
        setTimeout(() => routeReportResponse({ kind: 'batchexecute', doc: FAKE_DOC, rpcid: 'maseQ', seq: n, status: 200, responseText: maseQBody(id), endedAt: Date.now() / 1000 }, ctx), up.loadendMs)
      },
    },
  })
  let docNonce = FAKE_DOC
  let reports = null
  if (o.realCapture) {
    const w = page.window
    w.XMLHttpRequest = class PageXHR extends FakeXHR {}
    w.Date = Date   // 가짜 시계 — 주입의 sentAt·endedAt(초)이 gen.setAt 과 같은 시계
    delete w.__autoflowcut_rpc_doc__
    reports = []
    w.electronAPI = { flowReportResponse: vi.fn(async (payload) => { reports.push(payload); return routeReportResponse(payload, ctx) }) }
    w.eval(FLOW_RPC_CAPTURE_INJECTION)
    docNonce = w.__autoflowcut_rpc_doc__
  }
  const submitPage = {
    /** S3#n 의 send(요청 필드는 실제 추출기) — over 로 refs/mentions/rpcid 등을 덮는다. */
    send: (n, over = {}) => {
      const f = sampleSendFields(n)
      return routeReportResponse({ kind: 'batchexecute-send', doc: FAKE_DOC, rpcid: f.rpcid, rpcids: [over.rpcid || f.rpcid], seq: SUBMIT_SEQ, prompts: f.prompts, refs: f.refs, mentions: f.mentions, sentAt: Date.now() / 1000, ...over }, ctx)
    },
    loadend: (n, over = {}) => {
      const smp = s3(n)
      return routeReportResponse({ kind: 'batchexecute', doc: FAKE_DOC, rpcid: smp.rpcid, seq: SUBMIT_SEQ, status: 200, responseText: smp.respBody, endedAt: Date.now() / 1000, ...over }, ctx)
    },
    /** realCapture: 페이지 XHR 이 S3#n 요청을 보내고(주입이 send 보고) 응답한다(주입이 loadend 보고) — respBody 로 응답을 바꾼다. */
    xhr: (n, { respBody } = {}) => {
      const x = pageXhrSend(n)
      x._finish(200, respBody ?? s3(n).respBody)
      return x
    },
  }
  const onSubmit = o.onSubmit !== undefined ? o.onSubmit
    : (o.sample ? (() => { submitPage.send(o.sample, o.send || {}); submitPage.loadend(o.sample, o.loadend || {}) }) : null)
  const summary = o.summary ?? (kind === 'video' ? { text: '동영상 · 720p · 4초 x1', ligatures: ['crop_9_16'] } : { text: '🍌 Nano Banana 2 x1', ligatures: ['crop_9_16'] })

  // 2026-10-31: 토큰 지도(flow-angular 가 deps 로 받는다) — 시험이 격리를 일으킬 수 있게 하네스가 만든다
  // o.sharedTokens: true → 주입하지 않는다(프로덕션 기본 = 모듈 공유 지도 — 이미지·영상 핸들러가 같이 쓴다)
  const mediaTokenRegistry = o.sharedTokens ? null : createMediaTokenRegistry()
  let submitClicked = false
  const executeJavaScript = vi.fn(async (script) => {
    const s = String(script)
    if (s.includes('__af_settings_driver__')) {
      // I2V: 목표의 입력방식을 가짜 페이지에 반영한다(드라이버가 패널을 눌렀다고 보고) — input 키가 없으면 소재(T2V·R2V 기본).
      const frames = s.includes('"input":"frames"')
      trace.push(frames ? 'settings-driver:frames' : 'settings-driver')
      const res = typeof o.settings === 'function' ? o.settings(s) : o.settings
      if (kind === 'video' && (!res || res.ok !== false)) page.setInputMode(frames ? 'frames' : 'material')
      if (typeof o.afterSettings === 'function') o.afterSettings(s, page)
      return res ?? { ok: true, closed: true, steps: { mode: 'already', model: 'verified', ratio: 'already', count: 'already', ...(frames ? { input: 'clicked(frames)' } : {}) } }
    }
    if (s.includes('__af_settings_panel_open__')) return false
    if (s.includes('__af_set_editor_text__')) {
      // M2 의 SET_EDITOR_TEXT_JS(전체 선택·삭제 → insertText) 흉내 — 편집기를 비우고 가짜 페이지의 insertText 로 넣는다.
      trace.push(bounds.width > 0 && bounds.height > 0 ? 'set-text:visible' : 'set-text:hidden')
      const m = s.match(/const text = (".*?");/)
      const ed = page.document.querySelector('div.ProseMirror[contenteditable="true"]')
      ed.innerHTML = EMPTY_EDITOR
      page.document.execCommand('insertText', false, m ? JSON.parse(m[1]) : '')
      return { ok: true }
    }
    if (s.includes('WIZ_global_data.SNlM0e')) { trace.push('wiz'); return true }
    if (s.includes('"nzlxg"')) {
      trace.push('credits')
      const next = credits.length > 1 ? credits.shift() : credits[0]
      return { status: 200, text: respBodyWithPayload('nzlxg', [next, 1, 2, 2, null, next]) }
    }
    // 2026-10-31: as29sTokens → 그 id 의 이미지 기록(asb 토큰 주소 [5][10]·[6][1][3])으로 답한다 — 드라이버가 칩·애셋을 토큰으로 읽는다.
    if (o.as29sTokens && s.includes('"as29s"')) {
      const m = s.match(/payload: \["([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"\]/)
      trace.push('as29s')
      if (!m) return null
      as29sCalls[m[1]] = (as29sCalls[m[1]] || 0) + 1
      // 함수면 (id, n번째) → 토큰을 만들 id(다른 id 면 그 미디어의 토큰을 준다 — 충돌·낡은 토큰 시험)
      const tokenOf = typeof o.as29sTokens === 'function' ? o.as29sTokens(m[1], as29sCalls[m[1]]) : m[1]
      if (tokenOf === null) return { status: 200, text: respBodyWithPayload('as29s', [m[1], FAKE_PROJECT]) }   // 토큰 없는 기록
      return { status: 200, text: respBodyWithPayload('as29s', as29sImageRecord(m[1], tokenOf)) }
    }
    if (s.includes('"jwpduf"')) { trace.push('poll'); return null }
    if (s.includes('"as29s"')) { trace.push('as29s'); return null }   // 2026-10-31: 컴포즈 중 토큰 배우기도 as29s — 폴(jwpduf)과 따로 센다
    if (s.includes('elementFromPoint')) return { ok: true, why: 'ok' }
    if (s.includes('const scan =')) return { candidates: [], context: { lang: 'ko' } }
    if (s.includes('const find =')) { trace.push('agent-probe'); return { found: true, on: false } }
    if (s.includes('batchexecute capture installed')) { trace.push('capture-inject'); return o.realCapture ? page.exec(s) : undefined }
    if (s.startsWith('!!window.__autoflowcut_rpc_capture__')) { trace.push('capture-probe'); return o.realCapture ? page.exec(s) : true }
    if (s.includes('settings-summary')) return summary
    if (s === SUBMIT_ENABLED_PROBE) { trace.push('submit-enabled'); return true }
    if (s.includes('interactiveCount')) return { hasComposer: true, interactiveCount: 80, url }
    if (s === READ_EDITOR_TEXT_JS) trace.push('read-text')
    else if (s.startsWith(COMPOSER_STATE_PREFIX)) {
      trace.push('composer-state')   // 2026-10-31: 토큰 지도가 실려도 같은 판독
      // Codex 2차#2: 제출 클릭(dispatch 가드) 중의 판독이 도는 사이 늦은 as29s 답이 토큰을 격리한다 — 결과는 옛 지도로 계산된 그대로
      if (submitClicked && typeof o.quarantineDuringGuard === 'function') {
        const r = await page.exec(s)
        o.quarantineDuringGuard(mediaTokenRegistry)
        return r
      }
    }
    // I2V 워치독 시험: 특정 스크립트(execDelay(s) → ms)의 결과를 늦춘다 — 늦은 판독이 워치독 뒤에 돌아오는 경우
    const delayMs = typeof o.execDelay === 'function' ? o.execDelay(s) : 0
    if (delayMs > 0) { trace.push('exec-delayed'); await new Promise((r) => setTimeout(r, delayMs)) }
    return page.exec(s)   // 컴포저 스크립트는 가짜 페이지 문서에서 실제로
  })
  flowView = {
    getBounds: () => ({ ...bounds }),
    setBounds: vi.fn((b) => { bounds = { ...b }; trace.push(`bounds:${b.width}x${b.height}`) }),
    webContents: { executeJavaScript, getURL: () => url, loadURL: vi.fn(async () => {}), focus: vi.fn(() => { trace.push('focus') }), sendInputEvent: vi.fn(), isDestroyed: () => false, session: null, isFocused: () => false },
  }
  const clickCounts = {}
  const trustedClickOnFlowView = vi.fn(async (js, opts = {}) => {
    trace.push('click:' + (opts.step || '?'))
    if (opts.step === 'compose-submit') {
      submitClicked = true
      if (o.beforeDispatchHook) o.beforeDispatchHook(page)
      if (typeof opts.beforeDispatch === 'function') {
        let go = false
        try { go = !!(await opts.beforeDispatch()) } catch (_e) { go = false }
        if (!go) { trace.push('dispatch-refused'); return { success: false, error: 'Refused before dispatch' } }
      }
      trace.push('armed:' + pendingGenerations.size)
      if (onSubmit) await onSubmit(submitPage, pendingGenerations)
      return { success: true }
    }
    if (Array.isArray(o.deadSteps) && o.deadSteps.includes(opts.step)) return { success: false, error: 'dead' }
    // I2V 워치독 시험: 클릭 도우미 안에서 걸리는 시간(뮤텍스 대기 등) — clickDelay(step, n번째) → ms. 그 뒤 beforeDispatch(있으면)가 false 면 누르지 않는다.
    const nth = (clickCounts[opts.step] = (clickCounts[opts.step] || 0) + 1)
    const wait = typeof o.clickDelay === 'function' ? o.clickDelay(opts.step, nth) : 0
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    if (typeof opts.beforeDispatch === 'function' && !(await opts.beforeDispatch())) { trace.push('dispatch-refused:' + opts.step); return { success: false, error: 'Refused before dispatch' } }
    trace.push('dispatched:' + opts.step)
    return page.trustedClick(js, opts)
  })
  const sessionFetch = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: { get: () => 'image/png' } }))
  const createInputShield = vi.fn(() => { trace.push('shield:on'); return { remove: vi.fn(() => { trace.push('shield:off') }), focus: () => {} } })
  const setAutomationKeyLock = vi.fn((on) => { trace.push(on ? 'keylock:on' : 'keylock:off') })
  const setShieldFocusTarget = vi.fn()
  const pasteIntoFlowView = vi.fn(() => { trace.push('paste'); page.paste() })
  const legacy = {
    configureFlowMode: vi.fn(async () => ({ success: true })), setFlowPageInject: vi.fn(async () => ({ success: true })), clearFlowPageInject: vi.fn(async () => {}),
    applyAgentDefaults: vi.fn(async () => ({ success: true })), getRecaptchaToken: vi.fn(async () => null), switchFlowToVideoMode: vi.fn(async () => ({ success: true })),
  }
  const handlers = new Map()
  const ipcMain = { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
  const deps = {
    getFlowView: () => flowView, getMainWindow: () => mainWindow, getCurrentMode: () => 'flow', getFlowAgentOn: () => false,
    parseFlowResponse: () => null, getEnterToolClicked: () => true, setEnterToolClicked: vi.fn(),
    setCapturedProjectId: vi.fn(), getCapturedProjectId: () => null,
    pendingGenerations, collectedMediaIds: new Set(),
    getPendingGeneration: () => null, setPendingGeneration: vi.fn(), getPendingVideoGeneration: () => null, setPendingVideoGeneration: vi.fn(),
    flowPageFetch: vi.fn(), extractMediaIds: () => [], extractFifeUrls: () => [], extractBase64Images: () => [],
    fetchMediaAsBase64: vi.fn(), listAgentModels: vi.fn(), selectFlowModeTab: vi.fn(),
    getApiBase: () => 'https://labs.google/fx/api/trpc', FLOW_URL: 'https://labs.google/fx/tools/flow',
    ...helpers,
    ...legacy,
    trustedClickOnFlowView, sessionFetch, createInputShield, setAutomationKeyLock, setShieldFocusTarget,
    clipboard, nativeImage: fakeNativeImage, pasteIntoFlowView, ...(mediaTokenRegistry ? { mediaTokenRegistry } : {}),
  }
  if (kind === 'video') registerVideoIPC(ipcMain, deps)
  else registerFlowAPIIPC(ipcMain, deps)
  /** I2V: flow:generate-video-i2v(Flow 모드 본문) — startImage 는 base64(main 이 sha·붙여넣기 업로드). */
  const generateI2V = (p = {}) => ipcMain.invoke('flow:generate-video-i2v', { token: null, prompt: 'The hand pulls the scissors up', projectId: FAKE_PROJECT, model: 'Omni Flash', aspectRatio: '9:16', duration: 4, resolution: '720p', videoBatchCount: 1, seed: null, startImage: refInput('frame').base64, ...p })
  const generate = (p = {}) => (kind === 'video'
    ? ipcMain.invoke('flow:generate-video-t2v', { token: null, prompt: '@king walks', projectId: FAKE_PROJECT, model: 'Omni Flash', aspectRatio: '9:16', duration: 4, resolution: '720p', videoBatchCount: 1, seed: null, segments: null, ...p })
    : ipcMain.invoke('flow:generate-image', { prompt: '@king and a queen', aspectRatio: '9:16', model: 'Nano Banana 2', projectId: FAKE_PROJECT, referenceImages: [], batchCount: 1, asyncMode: false, ...p }))
  return {
    ipcMain, generate, generateI2V, trace, page, submitPage, clipboard, executeJavaScript, trustedClickOnFlowView, sessionFetch, onDomFailure, pendingGenerations,
    flowView, mainWindow, pasteIntoFlowView, createInputShield, setAutomationKeyLock, legacy, docNonce, reports, mediaTokenRegistry,
  }
}

/** 가짜 시계에서 핸들러 promise 를 굴린다. */
export async function settle(promise, maxMs = 60000, stepMs = 100) {
  let done = false
  const p = promise.then((v) => { done = true; return v })
  for (let t = 0; t < maxMs && !done; t += stepMs) await vi.advanceTimersByTimeAsync(stepMs)
  return p
}
