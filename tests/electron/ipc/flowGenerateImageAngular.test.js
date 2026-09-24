// @vitest-environment node
//
// M1-11 — flow.google.com(Angular) 이미지 핸들러. 하네스는 **실제 createSharedHelpers(ctx)**(onDomFailure 스파이) 를
// deps 에 스프레드한다(main.js 와 동일) — reportDomFailure 는 그 객체에서 온다. trustedClickOnFlowView 만 가짜로
// 바꿔 제출 클릭이 "페이지의 send/loadend" 를 라우터로 흘리게 한다(실제 주입 문자열은 M1-5 파이프라인이 돈다).
//   순서: 세션(URL·WIZ) → 에이전트 모드/레퍼런스 거부 → 프로젝트 → ensureAgentOff → 캡처 플래그 → 설정 → 편집기 → 제출 가능 → arm → 클릭
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'
import { createSharedHelpers } from '../../../electron/ipc/shared.js'
import { routeReportResponse, buildReportCtx } from '../../../electron/reportResponseRouter.js'
import { failBoundUnfinished } from '../../../electron/flow-rpc-router.js'
import { isFlowAuthError, markFlowAuthFailure } from '../../../src/engine/engineFlow.js'
import { setModalVisible } from '../../../electron/ipc/layout.js'
import { sample, samplePayload, respBodyWithPayload, respBodyFailure, maskedUuid } from '../../fixtures/flow-batchexecute-samples.js'

const PROJECT = '134cf5b5-6a64-47b8-8709-6de4c6b0e44c'
const FLOW_URL_OK = `https://flow.google.com/project/${PROJECT}`
const PROMPT = '궁정안에 있는 왕'
const DOC = 'f'.repeat(32)
const NOW_S = 1790240102.5

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
}

/**
 * @param {object} o
 *   url · wiz · agent(프로브 결과 | 순서 배열 | 'throw') · captureFlag(프로브 결과 순서) · settings(드라이버 결과)
 *   · summary · editorText(읽기 결과, 기본 = 주입한 프롬프트) · submitEnabled · flowAgentOn · mode · fetch(sessionFetch 응답)
 */
function harness(o = {}) {
  const url = o.url ?? FLOW_URL_OK
  const trace = []
  // R2#1: 뷰 bounds 는 가변 — hidden 변형은 0×0 에서 시작하고 setBounds 가 갱신한다(실제 WebContentsView 처럼).
  let bounds = o.bounds ? { ...o.bounds } : o.hidden ? { x: 0, y: 0, width: 0, height: 0 } : { x: 0, y: 0, width: 957, height: 1022 }
  const captureFlags = Array.isArray(o.captureFlag) ? [...o.captureFlag] : [true]
  const agentSeq = Array.isArray(o.agent) ? [...o.agent] : null
  let injectedPrompt = null
  const executeJavaScript = vi.fn(async (script) => {
    const s = String(script)
    // 마커 있는 스크립트 먼저 — 설정 드라이버도 `const scan =` 을 품고 있어 진단 프로브 검사와 겹친다.
    if (s.includes('__af_settings_driver__')) { trace.push('settings-driver'); return o.settings ?? { ok: true, closed: true, steps: { mode: 'already', model: 'verified', ratio: 'already(crop_16_9)', count: 'already' } } }
    if (s.includes('__af_settings_panel_open__')) return false
    if (s.includes('__af_set_editor_text__')) {
      trace.push(bounds.width > 0 && bounds.height > 0 ? 'set-text:visible' : 'set-text:hidden')
      const m = s.match(/const text = (".*?");/)
      injectedPrompt = m ? JSON.parse(m[1]) : null
      if (o.onSetText) o.onSetText()   // R2-2#7: 주입 도중 레이아웃 상태를 바꾸는 훅(모달 닫힘 등)
      return { ok: true }
    }
    if (s.includes('WIZ_global_data.SNlM0e')) { trace.push('wiz'); return o.wiz ?? true }
    if (s.includes('elementFromPoint')) return { ok: true, why: 'ok' }
    if (s.includes('const scan =')) return { candidates: [], context: { lang: 'ko' } }
    if (s.includes('const find =')) {
      trace.push('agent-probe')
      if (o.agent === 'throw') throw new Error('Script failed to execute')
      if (agentSeq) return agentSeq.length > 1 ? agentSeq.shift() : agentSeq[0]
      return o.agent ?? { found: true, on: false }
    }
    if (s.includes('batchexecute capture installed')) { trace.push('capture-inject'); return undefined }
    if (s.startsWith('!!window.__autoflowcut_rpc_capture__')) { trace.push('capture-probe'); return captureFlags.length > 1 ? captureFlags.shift() : captureFlags[0] }
    if (s.includes('settings-summary')) { trace.push('summary'); return o.summary ?? { text: '🍌 Nano Banana 2 x1', ligatures: ['crop_16_9'] } }
    if (s.includes("querySelectorAll('p')")) { trace.push('read-text'); return o.editorText !== undefined ? o.editorText : injectedPrompt }
    if (s.includes('aria-disabled')) { trace.push('submit-enabled'); return o.submitEnabled ?? true }
    if (s.includes('interactiveCount')) return { hasComposer: true, interactiveCount: 80, url }
    if (s.includes('getMediaUrlRedirect')) { trace.push('dom-image-probe'); return [] }
    return null
  })
  const flowView = {
    getBounds: () => ({ ...bounds }),
    setBounds: vi.fn((b) => { bounds = { ...b }; trace.push(`bounds:${b.width}x${b.height}`) }),
    webContents: {
      executeJavaScript, getURL: () => url, loadURL: vi.fn(async () => {}), focus: vi.fn(() => { trace.push('focus') }), sendInputEvent: vi.fn(), isDestroyed: () => false, session: null,
      // R2-2#1: DOM 단계 전에 뷰가 OS 포커스를 갖고 있었나 — 기본은 "아니다"(실기: 메인 창의 렌더러가 포커스를 갖는다).
      isFocused: () => !!o.focused,
    },
  }
  // R2-2#1: 메인 창 — DOM 단계가 끝나면 포커스를 돌려받는 쪽. 호출 시각은 trace 로 본다.
  const mainWindow = { getContentBounds: () => ({ width: 1280, height: 800 }), getBounds: () => ({ x: 0, y: 0 }), webContents: { focus: vi.fn(() => { trace.push('main-focus') }) } }
  // R2-2#6: 진단 보고가 영영 settle 하지 않아도(먹통 Sentry/훅) collect 는 끝나야 한다.
  const onDomFailure = o.domFailureHangs ? vi.fn(() => new Promise(() => {})) : vi.fn(async () => {})
  const helpers = createSharedHelpers({
    getFlowView: () => flowView,
    getMainWindow: () => mainWindow,
    constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' },
    onDomFailure,
  })
  const pendingGenerations = new Map()
  const ctx = buildReportCtx({
    getPendingGeneration: () => null, setPendingGeneration: () => {}, pendingGenerations,
    getPendingVideoGeneration: () => null, setPendingVideoGeneration: () => {},
  })
  const page = {
    send: (over = {}) => routeReportResponse({ kind: 'batchexecute-send', doc: DOC, rpcid: 'ogiZ0b', rpcids: ['ogiZ0b'], seq: 1, prompts: [PROMPT], sentAt: Date.now() / 1000, ...over }, ctx),
    loadend: (over = {}) => routeReportResponse({ kind: 'batchexecute', doc: DOC, rpcid: 'ogiZ0b', seq: 1, status: 200, responseText: sample('ogiZ0b').respBody, endedAt: Date.now() / 1000, ...over }, ctx),
  }
  const onSubmit = o.onSubmit === undefined ? (() => { page.send(); page.loadend() }) : o.onSubmit
  const trustedClickOnFlowView = vi.fn(async (_sel, opts) => {
    trace.push('click:' + (opts?.step || '?'))
    if (opts?.step === 'compose-submit') { trace.push('armed:' + pendingGenerations.size); if (onSubmit) await onSubmit(page, pendingGenerations) }
    if (opts?.step === 'compose-submit' && o.clickResult) return o.clickResult
    return { success: o.clickSuccess ?? true }
  })
  const sessionFetch = o.fetch || vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: { get: () => 'image/png' } }))
  const legacy = {
    configureFlowMode: vi.fn(async () => ({ success: true })), setFlowPageInject: vi.fn(async () => ({ success: true })), clearFlowPageInject: vi.fn(async () => {}),
    applyAgentDefaults: vi.fn(async () => ({ success: true })), getRecaptchaToken: vi.fn(async () => null),
  }
  const ipcMain = makeIpcMain()
  registerFlowAPIIPC(ipcMain, {
    getFlowView: () => flowView,
    getMainWindow: () => mainWindow,
    getCurrentMode: () => o.mode ?? 'flow',
    getFlowAgentOn: () => !!o.flowAgentOn,
    parseFlowResponse: () => null, getEnterToolClicked: () => true, setEnterToolClicked: vi.fn(),
    setCapturedProjectId: vi.fn(), getCapturedProjectId: () => null,
    pendingGenerations, collectedMediaIds: new Set(),
    getPendingGeneration: () => null, setPendingGeneration: vi.fn(),
    flowPageFetch: vi.fn(), extractMediaIds: () => [], extractFifeUrls: () => [], extractBase64Images: () => [],
    fetchMediaAsBase64: vi.fn(), listAgentModels: vi.fn(), selectFlowModeTab: vi.fn(),
    getApiBase: () => 'https://labs.google/fx/api/trpc', FLOW_URL: 'https://labs.google/fx/tools/flow',
    ...helpers,                 // 실제 헬퍼(ensureAgentOff · ensureOnProjectComposer · reportDomFailure …)
    ...legacy,                  // R2#4: 옛 deps 스파이는 실제 헬퍼 **뒤에** — 앞에 두면 실제 configureFlowMode 가 스파이를 덮어 "미호출" 단언이 공허해진다
    trustedClickOnFlowView,     // 클릭만 가짜 — 제출 클릭이 페이지 이벤트를 라우터로 흘린다
    sessionFetch,
  })
  const generate = (p = {}) => ipcMain.invoke('flow:generate-image', { prompt: PROMPT, aspectRatio: '16:9', model: 'Nano Banana 2', projectId: PROJECT, referenceImages: [], batchCount: 1, asyncMode: false, ...p })
  return { ipcMain, generate, trace, executeJavaScript, trustedClickOnFlowView, sessionFetch, onDomFailure, pendingGenerations, page, legacy, flowView, mainWindow }
}

/** 가짜 시계에서 핸들러 promise 를 굴린다(ensureAgentOff 의 350ms sleep 등). */
async function settle(promise, maxMs = 5000) {
  let done = false
  const p = promise.then((v) => { done = true; return v })
  for (let t = 0; t < maxMs && !done; t += 100) await vi.advanceTimersByTimeAsync(100)
  return p
}

let logSpy, warnSpy, errSpy
beforeEach(() => {
  vi.useFakeTimers({ now: NOW_S * 1000 })
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore() })
const logged = () => [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errSpy.mock.calls].map((c) => c.map(String).join(' ')).join('\n')
const idx = (arr, tag) => arr.findIndex((x) => x === tag || x.startsWith(tag))

describe('flow:generate-image (angular) — 동기', () => {
  it('성공: images[0] {base64, mediaId, width 1376, height 768, seed}; sessionFetch 는 헤더 없이 1회; 순서 단언; 로그 형식', async () => {
    const h = harness()
    const r = await settle(h.generate())
    expect(r).toEqual({ success: true, images: [{ base64: 'data:image/png;base64,AQID', mediaId: maskedUuid(5), width: 1376, height: 768, seed: 1687588041 }] })
    expect(h.sessionFetch).toHaveBeenCalledTimes(1)
    expect(h.sessionFetch.mock.calls[0]).toEqual([expect.stringMatching(new RegExp('^https://flow-content\\.google/image/' + maskedUuid(5) + '\\?'))])
    const t = h.trace
    expect(idx(t, 'agent-probe')).toBeGreaterThanOrEqual(0)
    expect(idx(t, 'agent-probe')).toBeLessThan(idx(t, 'capture-probe'))
    expect(idx(t, 'capture-probe')).toBeLessThan(idx(t, 'settings-driver'))
    expect(idx(t, 'settings-driver')).toBeLessThan(idx(t, 'focus'))
    expect(idx(t, 'focus')).toBeLessThan(idx(t, 'click:compose-editor'))
    expect(idx(t, 'click:compose-editor')).toBeLessThan(idx(t, 'set-text:visible'))
    expect(idx(t, 'set-text:visible')).toBeLessThan(idx(t, 'read-text'))
    // R2#1: 보이는 뷰(957×1022)는 손대지 않는다 — 실기 게이트가 이 경로로 통과했다.
    expect(h.flowView.setBounds).not.toHaveBeenCalled()
    expect(idx(t, 'read-text')).toBeLessThan(idx(t, 'submit-enabled'))
    expect(idx(t, 'submit-enabled')).toBeLessThan(idx(t, 'click:compose-submit'))
    expect(t).toContain('armed:1')
    expect(h.pendingGenerations.size).toBe(0)
    expect(logged()).toMatch(/\[Flow API\] \[Angular\] image 1376x768 ratio=ok/)
    // R1#11: gen id 는 뒤 8자(앞 8자는 항상 "gen-1790")
    expect(logged()).toMatch(/\[Flow API\] \[Angular\] submitted gen=\S+ async=false/)
    expect(logged()).not.toMatch(/submitted gen=gen-1790/)
    // 호스트·미디어 id 앞 8자·바이트 수만, 그리고 서명이 없음을 본다(M2-R5 J2: 픽스처 id 는 로더가 UUID 모양으로 푼다).
    expect(logged()).toMatch(/\[Flow API\] \[AsyncCollect\] download host=flow-content\.google media=\S{1,8} bytes=3/)
    expect(logged()).not.toContain(PROMPT)
    expect(logged()).not.toContain('Signature')
    for (const fn of Object.values(h.legacy)) expect(fn).not.toHaveBeenCalled()
    expect(h.trace).not.toContain('dom-image-probe')
  })

  // 뷰가 0×0 인 실제 상황 = 모달(씬 상세)이 열려 있거나 드래그 중 — 레이아웃의 updateBounds 가 0×0 을 유지한다.
  //   그 상태를 layout 의 modalVisible 로 만든다(안 그러면 헬퍼의 복원(updateBounds)이 split 크기로 되살려 "숨음"이 사라진다).
  it('숨은 뷰(0×0): 편집기 클릭 전에 화면 밖으로 키우고 OS 포커스 → 주입·재판독 동안 보이는 상태 → 끝나면 레이아웃으로 원복 (R2#1)', async () => {
    setModalVisible(true)
    const h = harness({ hidden: true })
    let r
    try { r = await settle(h.generate()) } finally { setModalVisible(false) }
    expect(r.success).toBe(true)
    const t = h.trace
    const firstEnlarge = t.findIndex((x) => /^bounds:\d+x\d+$/.test(x) && !x.endsWith('0x0'))
    expect(firstEnlarge).toBeGreaterThanOrEqual(0)
    expect(firstEnlarge).toBeLessThan(idx(t, 'focus'))
    expect(idx(t, 'focus')).toBeLessThan(idx(t, 'click:compose-editor'))
    expect(t).toContain('set-text:visible')
    expect(t).not.toContain('set-text:hidden')
    expect(idx(t, 'set-text:visible')).toBeLessThan(idx(t, 'read-text'))
    // 자동화 뷰포트는 DOM 단계 전체(에이전트 OFF → 설정 → 편집기 → 제출 클릭)를 덮는다 — 마지막 setBounds(레이아웃 원복)는
    //   submit 클릭 뒤. 그 전엔 신뢰 클릭 헬퍼가 0×0 을 다시 키우고 접는 왕복이 없다.
    const lastBounds = t.map((x, i) => [x, i]).filter(([x]) => x.startsWith('bounds:')).at(-1)[1]
    expect(lastBounds).toBeGreaterThan(idx(t, 'click:compose-submit'))
    expect(firstEnlarge).toBeLessThan(idx(t, 'agent-probe'))
  })

  // 2026-09-25 실기: 스플릿 뷰가 597×872 였고 flow.google.com 이 그 폭에선 에이전트 칩을 렌더하지 않아
  //   ensureAgentOff 가 not_found → flow-agent-off-failed 로 멈췄다(957×1022 에선 통과). 좁은 뷰도 숨은 뷰처럼
  //   DOM 단계 동안 화면 밖 정본 크기로 둔다.
  it('좁은 뷰(597×872): 에이전트 OFF 확인 전에 화면 밖 정본 크기(≥ 최소 폭)로 키우고, 제출 클릭 뒤 레이아웃으로 원복한다', async () => {
    const h = harness({ bounds: { x: 0, y: 0, width: 597, height: 872 } })
    const r = await settle(h.generate())
    expect(r.success).toBe(true)
    const t = h.trace
    const firstEnlarge = t.findIndex((x) => /^bounds:\d+x\d+$/.test(x))
    expect(firstEnlarge).toBeGreaterThanOrEqual(0)
    const [w, hgt] = t[firstEnlarge].replace('bounds:', '').split('x').map(Number)
    expect(w).toBeGreaterThanOrEqual(700)
    expect(hgt).toBeGreaterThanOrEqual(600)
    expect(firstEnlarge).toBeLessThan(idx(t, 'agent-probe'))
    expect(idx(t, 'agent-probe')).toBeLessThan(idx(t, 'settings-driver'))
    const lastBounds = t.map((x, i) => [x, i]).filter(([x]) => x.startsWith('bounds:')).at(-1)[1]
    expect(lastBounds).toBeGreaterThan(idx(t, 'click:compose-submit'))
    expect(logged()).toMatch(/\[Flow API\] \[Angular\] view narrow 597x872 → automation viewport \d+x\d+ offscreen/)
  })

  it('숨은 뷰: 편집기 클릭이 실패해도 bounds 를 원복한다(0×0 으로 — 모달이 열려 있으므로)', async () => {
    setModalVisible(true)
    const h = harness({ hidden: true })
    h.trustedClickOnFlowView.mockImplementation(async (_sel, opts) => { h.trace.push('click:' + (opts?.step || '?')); return { success: opts?.step !== 'compose-editor' } })
    let r
    try { r = await settle(h.generate()) } finally { setModalVisible(false) }
    expect(r).toMatchObject({ success: false, errorKind: 'text-injection-failed' })
    const t = h.trace
    const enlarge = t.findIndex((x) => /^bounds:\d+x\d+$/.test(x) && !x.endsWith('0x0'))
    expect(enlarge).toBeGreaterThanOrEqual(0)
    expect(enlarge).toBeLessThan(idx(t, 'click:compose-editor'))
    const restore = t.lastIndexOf('bounds:0x0')
    expect(restore).toBeGreaterThan(idx(t, 'click:compose-editor'))
    expect(h.flowView.getBounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('다운로드 본문 읽기 실패(arrayBuffer reject) → flow-download-error httpStatus 0, IPC 는 reject 하지 않는다 (R1#9)', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => { throw new Error('socket hang up') }, headers: { get: () => 'image/png' } }))
    const h = harness({ fetch })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'flow-download-error', error: 'flow-download-error', httpStatus: 0 })
  })

  it('편집기 텍스트가 프롬프트와 다르면 text-injection-failed — 클릭 없음', async () => {
    const h = harness({ editorText: '다른 텍스트' })
    const r = await settle(h.generate())
    expect(r).toMatchObject({ success: false, errorKind: 'text-injection-failed' })
    expect(h.trace).not.toContain('click:compose-submit')
  })

  it('제출 버튼이 비활성이면 generate-button-unavailable — 클릭 없음', async () => {
    const h = harness({ submitEnabled: false })
    const r = await settle(h.generate())
    expect(r).toMatchObject({ success: false, errorKind: 'generate-button-unavailable' })
    expect(h.trace).not.toContain('click:compose-submit')
  })

  it('치수 불일치(9:16 요청, 1376x768 응답) → flow-aspect-mismatch, sessionFetch 미호출', async () => {
    const h = harness({ summary: { text: 'x', ligatures: ['crop_9_16'] } })
    const r = await settle(h.generate({ aspectRatio: '9:16' }))
    expect(r).toMatchObject({ success: false, errorKind: 'flow-aspect-mismatch', error: 'flow-aspect-mismatch' })
    expect(h.sessionFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['실패 프레임 code 8', { responseText: respBodyFailure('ogiZ0b', 8) }, { error: 'RESOURCE_EXHAUSTED', errorKind: 'flow-rpc-error', rpcCode: 8 }, false],
    ['실패 프레임 code 7', { responseText: respBodyFailure('ogiZ0b', 7) }, { error: 'flow-rpc-error', rpcCode: 7 }, false],
    ['실패 프레임 code 16', { responseText: respBodyFailure('ogiZ0b', 16) }, { error: 'flow-rpc-error', rpcCode: 16, authFailed: true }, true],
    ['HTTP 403', { status: 403, responseText: 'Forbidden' }, { error: 'flow-rpc-error', rpcStatus: 403 }, false],
    ['HTTP 401', { status: 401, responseText: '' }, { error: 'flow-rpc-error', rpcStatus: 401, authFailed: true }, true],
  ])('%s → 매핑 결과, authFailed 는 401/16 만', async (_l, loadendOver, expected, auth) => {
    const h = harness({ onSubmit: (page) => { page.send(); page.loadend(loadendOver) } })
    const r = await settle(h.generate())
    expect(r.success).toBe(false)
    expect(r).toMatchObject(expected)
    expect(!!r.authFailed).toBe(auth)
    expect(isFlowAuthError(r)).toBe(false)
    expect(!!markFlowAuthFailure(r).authFailed).toBe(auth)
    expect(h.sessionFetch).not.toHaveBeenCalled()
  })

  it('다운로드 403 → {error:"flow-download-error", httpStatus:403}, authFailed 없음', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }))
    const h = harness({ fetch })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'flow-download-error', error: 'flow-download-error', httpStatus: 403 })
    expect(isFlowAuthError(r)).toBe(false)
  })

  it('파서 shape 실패 → rpc-shape 에러 + onDomFailure(내용 없음)', async () => {
    const p = samplePayload('ogiZ0b'); p[0][0][6].splice(2, 1)
    const h = harness({ onSubmit: (page) => { page.send(); page.loadend({ responseText: respBodyWithPayload('ogiZ0b', p) }) } })
    const r = await settle(h.generate())
    expect(r).toMatchObject({ success: false, errorKind: 'flow-rpc-error', error: 'rpc-shape:ogiZ0b@[0][0][6][2]' })
    expect(h.onDomFailure).toHaveBeenCalled()
    const call = h.onDomFailure.mock.calls.find((c) => String(c[0]).startsWith('rpc-shape'))
    expect(call[0]).toBe('rpc-shape:ogiZ0b@[0][0][6][2]')
    expect(JSON.stringify(call[1])).not.toContain(PROMPT)
  })

  it('clear-generations 가 대기 중인 동기 생성을 flow-generation-cleared 로 settle 한다', async () => {
    const h = harness({ onSubmit: null })   // 페이지가 send 만 하고 응답이 없다고 가정 — 아무것도 안 함
    const p = h.generate()
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(100)   // ensureAgentOff 의 350ms 등을 지나 arm 까지
    expect(h.pendingGenerations.size).toBe(1)
    await h.ipcMain.invoke('flow:clear-generations', {})
    const r = await settle(p)
    expect(r).toMatchObject({ success: false, errorKind: 'flow-generation-cleared' })
    expect(h.pendingGenerations.size).toBe(0)
  })
})

describe('flow:generate-image (angular) — 진입 거부(DOM 미접근)', () => {
  it('accounts.google.com → flow-session-missing + authFailed, 페이지 스크립트 미실행', async () => {
    const h = harness({ url: 'https://accounts.google.com/v3/signin/identifier?continue=x' })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'flow-session-missing', error: 'not-on-flow', authFailed: true })
    expect(h.executeJavaScript).not.toHaveBeenCalled()
    expect(h.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('옛 도메인(labs.google/fx) 은 legacy 경고 로그 + WIZ 판정(없으면 wiz-missing)', async () => {
    const h = harness({ url: 'https://labs.google/fx/tools/flow/project/x', wiz: false })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'flow-session-missing', error: 'wiz-missing', authFailed: true })
    expect(logged()).toContain('legacy labs.google URL')
    expect(h.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('WIZ 없음 → flow-session-missing(wiz-missing) + authFailed, 클릭 없음', async () => {
    const h = harness({ wiz: false })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'flow-session-missing', error: 'wiz-missing', authFailed: true })
    expect(h.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('flowAgentOn → flow-agent-mode-unsupported (에이전트 프로브·클릭 없음)', async () => {
    const h = harness({ flowAgentOn: true })
    const r = await settle(h.generate())
    expect(r).toMatchObject({ success: false, errorKind: 'flow-agent-mode-unsupported' })
    expect(h.trace).not.toContain('agent-probe')
    expect(h.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('referenceImages 비어있지 않음 → flow-references-unsupported (이중 방어)', async () => {
    const h = harness()
    const r = await settle(h.generate({ referenceImages: [{ mediaId: 'm' }] }))
    expect(r).toMatchObject({ success: false, errorKind: 'flow-references-unsupported' })
    expect(h.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('API 모드 → Flow inactive (뷰 미접근)', async () => {
    const h = harness({ mode: 'api' })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, error: 'Flow inactive (API mode)' })
    expect(h.executeJavaScript).not.toHaveBeenCalled()
  })
})

describe('flow:generate-image (angular) — 에이전트·캡처·설정', () => {
  it.each([
    ['still ON', [{ found: true, on: true }, { found: true, on: true }]],
    ['not_found', { found: false }],
    ['probe throws', 'throw'],
  ])('ensureAgentOff 실패(%s) → flow-agent-off-failed, 제출 클릭 없음', async (_l, agent) => {
    const h = harness({ agent })
    const r = await settle(h.generate(), 20000)
    expect(r).toMatchObject({ success: false, errorKind: 'flow-agent-off-failed' })
    expect(h.trace).not.toContain('click:compose-submit')
  })

  it('칩 ON → trusted click 후 재프로브 OFF → 진행', async () => {
    const h = harness({ agent: [{ found: true, on: true }, { found: true, on: false }] })
    const r = await settle(h.generate())
    expect(r.success).toBe(true)
    // ensureAgentOff 는 헬퍼 내부의 실제 trustedClickOnFlowView 를 쓴다(하네스 가짜가 아님) — 실제 마우스 이벤트로 관찰.
    expect(h.flowView.webContents.sendInputEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouseDown' }))
    expect(h.trace).toContain('click:compose-submit')
  })

  it('캡처 미설치 → 주입 → 재프로브 → 그래도 없으면 flow-capture-not-installed(클릭 없음); 재프로브 성공이면 진행', async () => {
    const bad = harness({ captureFlag: [false, false] })
    const r1 = await settle(bad.generate())
    expect(r1).toMatchObject({ success: false, errorKind: 'flow-capture-not-installed' })
    expect(bad.trace).toContain('capture-inject')
    expect(bad.trace).not.toContain('click:compose-submit')
    const good = harness({ captureFlag: [false, true] })
    const r2 = await settle(good.generate())
    expect(r2.success).toBe(true)
    expect(good.trace).toContain('capture-inject')
  })

  it('설정 실패(flow-image-model-mismatch) → params 포함, 클릭 없음, onDomFailure(settings:…) 내용 없음', async () => {
    const h = harness({ settings: { ok: false, kind: 'flow-image-model-mismatch', reason: 'flow-image-model-mismatch', params: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' }, steps: { mode: 'already' } } })
    const r = await settle(h.generate({ model: 'Nano Banana Pro' }))
    expect(r).toMatchObject({ success: false, errorKind: 'flow-image-model-mismatch', error: 'flow-image-model-mismatch', errorParams: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' } })
    expect(h.trace).not.toContain('click:compose-submit')
    const call = h.onDomFailure.mock.calls.find((c) => String(c[0]).startsWith('settings:'))
    expect(call).toBeTruthy()
    expect(JSON.stringify(call[1])).not.toContain(PROMPT)
  })

  it('설정 실패(flow-settings-not-applied, reason) → 클릭 없음', async () => {
    const h = harness({ settings: { ok: false, kind: 'flow-settings-not-applied', reason: 'ratio-not-offered:21:9', steps: {} } })
    const r = await settle(h.generate({ aspectRatio: '21:9' }))
    expect(r).toMatchObject({ success: false, errorKind: 'flow-settings-not-applied' })
    expect(h.trace).not.toContain('click:compose-submit')
  })
})

describe('flow:generate-image (angular) — 비동기 + check/collect + 마감', () => {
  it('제출 → {generationId, submitted}; check(completed, DOM 프로브 없음) → collect(images, 맵에서 제거)', async () => {
    const h = harness({ onSubmit: null })
    const r = await settle(h.generate({ asyncMode: true }))
    expect(r).toMatchObject({ success: true, submitted: true })
    expect(r.generationId).toMatch(/^gen-/)
    let st = await h.ipcMain.invoke('flow:check-generation', { generationId: r.generationId })
    expect(st).toMatchObject({ success: true, completed: false, via: 'rpc' })
    h.page.send(); h.page.loadend()
    st = await h.ipcMain.invoke('flow:check-generation', { generationId: r.generationId })
    expect(st).toMatchObject({ success: true, completed: true, via: 'rpc' })
    expect(h.trace).not.toContain('dom-image-probe')
    const c = await h.ipcMain.invoke('flow:collect-generation', { generationId: r.generationId })
    expect(c).toMatchObject({ success: true, images: [{ mediaId: maskedUuid(5), width: 1376, height: 768 }] })
    expect(h.pendingGenerations.has(r.generationId)).toBe(false)
  })

  it('send 없이 15s → gen 은 맵에 남고 completed+flow-submit-not-sent → check completed → collect 그 kind, 그 뒤 삭제', async () => {
    const h = harness({ onSubmit: null })
    const r = await settle(h.generate({ asyncMode: true }))
    await vi.advanceTimersByTimeAsync(15000 + 10)
    const gen = h.pendingGenerations.get(r.generationId)
    expect(gen).toMatchObject({ completed: true, error: 'flow-submit-not-sent' })
    expect(await h.ipcMain.invoke('flow:check-generation', { generationId: r.generationId })).toMatchObject({ completed: true })
    expect(await h.ipcMain.invoke('flow:collect-generation', { generationId: r.generationId })).toMatchObject({ success: false, errorKind: 'flow-submit-not-sent', error: 'flow-submit-not-sent' })
    expect(h.pendingGenerations.has(r.generationId)).toBe(false)
    // R1#5 (D8-9): 제출 마감은 submit:<kind> 로 보고된다 — 내용 없이.
    const call = h.onDomFailure.mock.calls.find((c) => c[0] === 'submit:flow-submit-not-sent')
    expect(call).toBeTruthy()
    expect(JSON.stringify(call[1])).not.toContain(PROMPT)
  })

  it('send 뒤 loadend 없이 100s → flow-submit-lost', async () => {
    const h = harness({ onSubmit: (page) => { page.send() } })
    const r = await settle(h.generate({ asyncMode: true }))
    await vi.advanceTimersByTimeAsync(99000)
    expect(h.pendingGenerations.get(r.generationId).completed).toBe(false)
    await vi.advanceTimersByTimeAsync(1100)
    expect(await h.ipcMain.invoke('flow:collect-generation', { generationId: r.generationId })).toMatchObject({ success: false, errorKind: 'flow-submit-lost' })
    expect(h.onDomFailure.mock.calls.some((c) => c[0] === 'submit:flow-submit-lost')).toBe(true)
  })

  it('커밋 네비게이션(failBoundUnfinished) → flow-submit-lost', async () => {
    const h = harness({ onSubmit: (page) => { page.send() } })
    const r = await settle(h.generate({ asyncMode: true }))
    expect(failBoundUnfinished(h.pendingGenerations)).toBe(1)
    expect(await h.ipcMain.invoke('flow:collect-generation', { generationId: r.generationId })).toMatchObject({ success: false, errorKind: 'flow-submit-lost' })
  })

  // M2-R1 F4(b): 이미지도 같은 꼴 — dispatched 클릭 실패는 gen 을 지우지 않고 waiter/마감 경로(늦은 send 는 바인딩, 없으면 not-sent + postClick).
  it('dispatched 클릭 실패: 늦은 send/loadend → 정상 images; send 없음 → 15s 뒤 flow-submit-not-sent + postClick; 비동기는 gen 을 armed 로 둔다', async () => {
    const late = harness({ onSubmit: null, clickResult: { success: false, dispatched: true, error: 'View bounds changed mid-click' } })
    const pLate = late.generate()
    await vi.advanceTimersByTimeAsync(2000)
    expect(late.pendingGenerations.size).toBe(1)
    late.page.send(); late.page.loadend()
    expect(await settle(pLate, 20000)).toMatchObject({ success: true, images: [{ mediaId: maskedUuid(5) }] })
    const none = harness({ onSubmit: null, clickResult: { success: false, dispatched: true, error: 'View bounds changed mid-click' } })
    expect(await settle(none.generate(), 20000)).toMatchObject({ success: false, errorKind: 'flow-submit-not-sent', postClick: true })
    expect(none.pendingGenerations.size).toBe(0)
    const asyncH = harness({ onSubmit: null, clickResult: { success: false, dispatched: true, error: 'View bounds changed mid-click' } })
    const ra = await settle(asyncH.generate({ asyncMode: true }))
    expect(ra).toMatchObject({ success: true, submitted: true })
    expect(asyncH.pendingGenerations.has(ra.generationId)).toBe(true)
  })

  it('collect 는 미완료면 "not completed yet"(삭제 없음)', async () => {
    const h = harness({ onSubmit: null })
    const r = await settle(h.generate({ asyncMode: true }))
    expect(await h.ipcMain.invoke('flow:collect-generation', { generationId: r.generationId })).toMatchObject({ success: false, error: 'Generation not completed yet' })
    expect(h.pendingGenerations.has(r.generationId)).toBe(true)
  })
})

// ─── R2-2 부록 #1 / #6 / #7 (플랜 §12 #45 · #47 · #48) ───────────────────────────────────────────────────────
describe('flow:generate-image (angular) — 포커스 반환 (R2-2#1, §12 #45)', () => {
  it('뷰가 넓고 이미 포커스를 갖고 있었으면(957×1022, isFocused) 메인 창에 포커스를 돌려주지 않는다', async () => {
    const h = harness({ focused: true })
    const r = await settle(h.generate())
    expect(r.success).toBe(true)
    expect(h.mainWindow.webContents.focus).not.toHaveBeenCalled()
  })

  it('뷰가 포커스를 갖고 있지 않았으면(보이는 뷰라도) 재판독·제출 클릭 뒤 메인 창에 포커스를 돌려준다', async () => {
    const h = harness({ focused: false })
    const r = await settle(h.generate())
    expect(r.success).toBe(true)
    expect(h.mainWindow.webContents.focus).toHaveBeenCalledTimes(1)
    const t = h.trace
    expect(idx(t, 'read-text')).toBeLessThan(idx(t, 'main-focus'))
    expect(idx(t, 'click:compose-submit')).toBeLessThan(idx(t, 'main-focus'))
  })

  it('자동화 뷰포트에 들어갔으면 조기 반환(편집기 클릭 실패)에서도 레이아웃 원복 뒤 메인 창에 포커스를 돌려준다', async () => {
    setModalVisible(true)
    const h = harness({ hidden: true, focused: true })
    h.trustedClickOnFlowView.mockImplementation(async (_sel, opts) => { h.trace.push('click:' + (opts?.step || '?')); return { success: opts?.step !== 'compose-editor' } })
    let r
    try { r = await settle(h.generate()) } finally { setModalVisible(false) }
    expect(r).toMatchObject({ success: false, errorKind: 'text-injection-failed' })
    expect(h.mainWindow.webContents.focus).toHaveBeenCalledTimes(1)
    const t = h.trace
    expect(t.lastIndexOf('bounds:0x0')).toBeLessThan(idx(t, 'main-focus'))
    expect(idx(t, 'click:compose-editor')).toBeLessThan(idx(t, 'main-focus'))
  })
})

describe('flow:generate-image (angular) — report() 는 collect 를 막지 않는다 (R2-2#6, §12 #47)', () => {
  it('onDomFailure 가 영영 settle 하지 않아도 flow-submit-not-sent gen 의 collect 는 끝난다', async () => {
    const h = harness({ onSubmit: null, domFailureHangs: true })
    const r = await settle(h.generate({ asyncMode: true }))
    await vi.advanceTimersByTimeAsync(15000 + 10)
    expect(h.pendingGenerations.get(r.generationId)).toMatchObject({ completed: true, error: 'flow-submit-not-sent' })
    let collected = null
    h.ipcMain.invoke('flow:collect-generation', { generationId: r.generationId }).then((c) => { collected = c })
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(100)
    expect(collected).toMatchObject({ success: false, errorKind: 'flow-submit-not-sent', error: 'flow-submit-not-sent' })
    expect(h.onDomFailure).toHaveBeenCalledWith('submit:flow-submit-not-sent', expect.objectContaining({ reason: 'flow-submit-not-sent' }))
  })
})

describe('flow:generate-image (angular) — 숨은 뷰의 원복은 스냅샷이 아니라 레이아웃이다 (R2-2#7, §12 #48)', () => {
  it('주입 도중 모달이 닫히면(setModalVisible(false)) 최종 bounds 는 0×0 이 아니라 스플릿 레이아웃이다', async () => {
    setModalVisible(true)
    const h = harness({ hidden: true, onSetText: () => setModalVisible(false) })
    let r
    try { r = await settle(h.generate()) } finally { setModalVisible(false) }
    expect(r.success).toBe(true)
    // layout.js 기본 split-left · ratio 0.5 · GAP 3 · 창 1280×800 → {0,0,637,800}
    expect(h.flowView.getBounds()).toEqual({ x: 0, y: 0, width: 637, height: 800 })
    const t = h.trace
    expect(t.filter((x) => x.startsWith('bounds:')).at(-1)).toBe('bounds:637x800')
    expect(t.lastIndexOf('bounds:637x800')).toBeGreaterThan(idx(t, 'click:compose-submit'))
  })
})
