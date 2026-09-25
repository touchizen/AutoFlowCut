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
import { _resetDomStageForTests, releaseDomStage } from '../../../electron/ipc/flow-angular.js'   // M2-CLOSE O2: DOM 단계 직렬화 기록은 모듈 상태 · M2-LAST P1: 문서가 죽으면 푼다
import { isFlowAuthError, markFlowAuthFailure } from '../../../src/engine/engineFlow.js'
import { setModalVisible, setLayoutDragging } from '../../../electron/ipc/layout.js'   // M2-LAST P4: 드래그 중 진입 거부
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
  // M2-FINAL Q1: main 의 shieldFocusTarget 흉내 — 핸들러가 setShieldFocusTarget 로 세운 행선지(기본 'flow'); 가짜 방패의 focus() 가 그 규칙대로 Flow 뷰/메인 창에 포커스를 준다.
  //   o.shieldFocusAt = trace 태그 — 그 exec 가 돌 때 사용자가 방패를 누른 것처럼 방패 focus 를 일으킨다.
  let shieldTarget = 'flow'
  let lastShield = null
  const tap = (tag) => { trace.push(tag); if (o.shieldFocusAt === tag && lastShield) lastShield.focus() }
  // R2#1: 뷰 bounds 는 가변 — hidden 변형은 0×0 에서 시작하고 setBounds 가 갱신한다(실제 WebContentsView 처럼).
  let bounds = o.bounds ? { ...o.bounds } : o.hidden ? { x: 0, y: 0, width: 0, height: 0 } : { x: 0, y: 0, width: 957, height: 1022 }
  const captureFlags = Array.isArray(o.captureFlag) ? [...o.captureFlag] : [true]
  const agentSeq = Array.isArray(o.agent) ? [...o.agent] : null
  const summarySeq = Array.isArray(o.summary) ? [...o.summary] : null   // M2-CLOSE O3: 요약 판독 순서(트리거 전 · 닫힌 뒤) — 마지막 값이 남는다
  const settingsSeq = Array.isArray(o.settings) ? [...o.settings] : null   // M2-LAST P1: 드라이버 결과 순서(항목별 — undefined 는 기본값) — 마지막 값이 남는다
  const editorSeq = Array.isArray(o.editorText) ? [...o.editorText] : null   // M2-LAST P2: 편집기 재판독 순서(주입 뒤 · 제출 클릭 직전) — 마지막 값이 남는다
  let injectedPrompt = null
  const executeJavaScript = vi.fn(async (script) => {
    const s = String(script)
    // 마커 있는 스크립트 먼저 — 설정 드라이버도 `const scan =` 을 품고 있어 진단 프로브 검사와 겹친다.
    if (s.includes('__af_settings_driver__')) {
      trace.push('settings-driver')
      const next = settingsSeq ? (settingsSeq.length > 1 ? settingsSeq.shift() : settingsSeq[0]) : o.settings
      return next ?? { ok: true, closed: true, steps: { mode: 'already', model: 'verified', ratio: 'already(crop_16_9)', count: 'already' } }
    }
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
    if (s.startsWith('!!window.__autoflowcut_rpc_capture__')) { tap('capture-probe'); return captureFlags.length > 1 ? captureFlags.shift() : captureFlags[0] }
    if (s.includes('settings-summary')) { trace.push('summary'); if (summarySeq) return summarySeq.length > 1 ? summarySeq.shift() : summarySeq[0]; return o.summary ?? { text: '🍌 Nano Banana 2 x1', ligatures: ['crop_16_9'] } }
    if (s.includes("querySelectorAll('p')")) { trace.push('read-text'); if (editorSeq) return editorSeq.length > 1 ? editorSeq.shift() : editorSeq[0]; return o.editorText !== undefined ? o.editorText : injectedPrompt }
    if (s.includes('aria-disabled')) { tap('submit-enabled'); return o.submitEnabled ?? true }
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
    // M2-FINAL Q1: 실제 헬퍼처럼 히트테스트 뒤·mouseDown 직전에 beforeDispatch 를 묻고 false·throw 면 미디스패치 거부(armed:/onSubmit 없음 = mouseDown 없음)
    if (typeof opts?.beforeDispatch === 'function') {
      let go = false
      try { go = !!(await opts.beforeDispatch()) } catch (_e) { go = false }
      if (!go) { trace.push('dispatch-refused'); return { success: false, error: 'Refused before dispatch' } }
    }
    if (opts?.step === 'compose-submit') { trace.push('armed:' + pendingGenerations.size); if (onSubmit) await onSubmit(page, pendingGenerations) }
    if (opts?.step === 'compose-submit' && o.clickResult) return o.clickResult
    return { success: o.clickSuccess ?? true }
  })
  const sessionFetch = o.fetch || vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: { get: () => 'image/png' } }))
  const legacy = {
    configureFlowMode: vi.fn(async () => ({ success: true })), setFlowPageInject: vi.fn(async () => ({ success: true })), clearFlowPageInject: vi.fn(async () => {}),
    applyAgentDefaults: vi.fn(async () => ({ success: true })), getRecaptchaToken: vi.fn(async () => null),
  }
  // M2-CLOSE O1/O3: main 의 createInputShield · setAutomationKeyLock 흉내 — 생성/제거·잠금/해제 시각을 trace 에(영상 하네스와 같은 꼴)
  const createInputShield = vi.fn(() => {
    trace.push('shield:on')
    // M2-FINAL Q1: main 의 makeInputShield focus 핸들러 흉내 — 'main' 이면 메인 창(main-focus), 아니면 Flow 뷰(focus)
    lastShield = { remove: vi.fn(() => { trace.push('shield:off') }), focus: () => { (shieldTarget === 'main' ? mainWindow : flowView).webContents.focus() } }
    return lastShield
  })
  const setShieldFocusTarget = vi.fn((t) => { shieldTarget = t; trace.push('shield-target:' + t) })   // M2-FINAL Q1
  const setAutomationKeyLock = vi.fn((on) => { trace.push(on ? 'keylock:on' : 'keylock:off') })
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
    createInputShield,          // M2-CLOSE O3: 제자리 뷰포트 동안의 입력 방패(가짜)
    setAutomationKeyLock,       // M2-CLOSE O1: DOM 단계 동안의 키 입력 잠금(가짜)
    setShieldFocusTarget,       // M2-FINAL Q1: 방패 focus 의 행선지(가짜)
  })
  const generate = (p = {}) => ipcMain.invoke('flow:generate-image', { prompt: PROMPT, aspectRatio: '16:9', model: 'Nano Banana 2', projectId: PROJECT, referenceImages: [], batchCount: 1, asyncMode: false, ...p })
  return { ipcMain, generate, trace, executeJavaScript, trustedClickOnFlowView, sessionFetch, onDomFailure, pendingGenerations, page, legacy, flowView, mainWindow, createInputShield, setAutomationKeyLock, setShieldFocusTarget }
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
  _resetDomStageForTests()   // M2-CLOSE O2: 앞 테스트가 남긴 좀비(영영 미해결 드라이버)가 다음 테스트의 단계를 막지 않게
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
    expect(logged()).toMatch(/\[Flow API\] \[Angular\] view narrow 597x872 → automation viewport \d+x\d+ in-place/)
    // 실기(2026-09-25): 화면 밖 bounds 는 페이지 크기를 못 바꿨다 — 첫 setBounds 는 창 안 제자리(x=0,y=0), 폭 ≥ 700.
    expect(h.flowView.setBounds.mock.calls[0][0]).toMatchObject({ x: 0, y: 0 })
    expect(h.flowView.setBounds.mock.calls[0][0].width).toBeGreaterThanOrEqual(700)
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
  it('뷰가 넓고 이미 포커스를 갖고 있었으면(957×1022, isFocused) finally 는 메인 창에 포커스를 돌려주지 않는다 — 클릭 전 P2 반환 한 번뿐(클릭 뒤 없음)', async () => {
    const h = harness({ focused: true })
    const r = await settle(h.generate())
    expect(r.success).toBe(true)
    expect(h.mainWindow.webContents.focus).toHaveBeenCalledTimes(1)   // M2-LAST P2: 재판독 뒤·클릭 전의 반환
    expect(h.trace.lastIndexOf('main-focus')).toBeLessThan(idx(h.trace, 'click:compose-submit'))
  })

  it('뷰가 포커스를 갖고 있지 않았으면(보이는 뷰라도) 재판독 뒤(P2)와 제출 클릭 뒤(finally) 메인 창에 포커스를 돌려준다', async () => {
    const h = harness({ focused: false })
    const r = await settle(h.generate())
    expect(r.success).toBe(true)
    expect(h.mainWindow.webContents.focus).toHaveBeenCalledTimes(2)   // M2-LAST P2: 클릭 전 한 번 + finally 한 번
    const t = h.trace
    expect(idx(t, 'read-text')).toBeLessThan(idx(t, 'main-focus'))
    expect(idx(t, 'click:compose-submit')).toBeLessThan(t.lastIndexOf('main-focus'))
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

// M2-CLOSE O1(A1): 이미지도 같은 래퍼 — DOM 단계 동안 키 입력 잠금(진입에 켜고 같은 finally 에서 끈다), 바인딩·완료된 gen 의 미디스패치 클릭 실패는 post-click 경로.
describe('flow:generate-image (angular) — DOM 단계의 키 입력 잠금 · 바인딩된 gen 의 클릭 실패 (M2-CLOSE O1)', () => {
  const NARROW = { x: 0, y: 0, width: 597, height: 872 }
  const at = (t, tag) => t.findIndex((x) => x === tag)

  it('좁은 뷰·넓은 뷰 둘 다: 잠금은 에이전트 프로브 전에 켜지고 제출 클릭 뒤 한 번 꺼진다', async () => {
    for (const o of [{ bounds: NARROW }, {}]) {
      const h = harness(o)
      expect((await settle(h.generate())).success).toBe(true)
      expect(at(h.trace, 'keylock:on')).toBeLessThan(idx(h.trace, 'agent-probe'))
      expect(at(h.trace, 'keylock:off')).toBeGreaterThan(idx(h.trace, 'click:compose-submit'))
      expect(h.setAutomationKeyLock.mock.calls).toEqual([[true], [false]])
    }
  })

  it('조기 반환(설정 실패)·throw(편집기 클릭 reject)·워치독(드라이버 매달림 120s) 전부 잠금을 정확히 한 번 푼다', async () => {
    const early = harness({ bounds: NARROW, settings: { ok: false, kind: 'flow-settings-not-applied', reason: 'input-mode-not-material', steps: {} } })
    expect((await settle(early.generate())).errorKind).toBe('flow-settings-not-applied')
    expect(early.setAutomationKeyLock.mock.calls).toEqual([[true], [false]])
    const thrown = harness({ bounds: NARROW })
    thrown.trustedClickOnFlowView.mockImplementation(async (_sel, opts) => { thrown.trace.push('click:' + (opts?.step || '?')); if (opts?.step === 'compose-editor') throw new Error('boom'); return { success: true } })
    expect(await settle(thrown.generate().catch(() => 'threw'))).toBe('threw')
    expect(thrown.setAutomationKeyLock.mock.calls).toEqual([[true], [false]])
    const hung = harness({ bounds: NARROW, settings: new Promise(() => {}) })
    const p = hung.generate()
    await vi.advanceTimersByTimeAsync(119000)
    expect(hung.trace).not.toContain('keylock:off')
    expect(await settle(p, 5000)).toMatchObject({ success: false, errorKind: 'flow-settings-not-applied', reason: 'dom-stage-timeout' })
    expect(hung.setAutomationKeyLock.mock.calls).toEqual([[true], [false]])
  })

  it('클릭 전에 send 가 바인딩된 gen(사용자의 Enter) → 미디스패치 클릭 실패에도 gen 을 지우지 않고 loadend 로 images; 완료된 gen 도 같다; 둘 다 아니면 click-failed', async () => {
    const bound = harness({ onSubmit: (page) => { page.send(); setTimeout(() => page.loadend(), 2000) }, clickResult: { success: false, error: 'Target not at point (disabled)' } })
    expect(await settle(bound.generate(), 10000)).toMatchObject({ success: true, images: [{ mediaId: maskedUuid(5) }] })
    expect(bound.pendingGenerations.size).toBe(0)
    const done = harness({ clickResult: { success: false, error: 'Target not at point (disabled)' } })
    expect(await settle(done.generate())).toMatchObject({ success: true, images: [{ mediaId: maskedUuid(5) }] })
    const none = harness({ onSubmit: null, clickResult: { success: false, error: 'Target not at point (other)' } })
    expect(await settle(none.generate())).toMatchObject({ success: false, errorKind: 'generate-button-click-failed' })
    expect(none.pendingGenerations.size).toBe(0)
  })
})

// M2-CLOSE O3(B1/A3): 이미지 하네스엔 방패·워치독 핀이 하나도 없었다 — clickStarted 와 세 체크포인트 전부 지워도 초록. 워치독이 제출 클릭 중에 울리면(클릭은 30s + 뮤텍스)
//   pre-click dom-stage-timeout 으로 돌아오는데 페이지는 제출·과금했고 gen 은 send 마감 없이 맵에 남아 배치가 같은 씬을 또 과금한다. 영상 스위트와 같은 핀을 이미지에도 둔다.
describe('flow:generate-image (angular) — 워치독 · 좀비 · 방패 (M2-CLOSE O3)', () => {
  const NARROW = { x: 0, y: 0, width: 597, height: 872 }
  const at = (t, tag) => t.findIndex((x) => x === tag)

  it('(b) 드라이버가 영영 매달리면 120s 에 같은 finally 로 방패 제거·레이아웃 복원 후 클릭 전 dom-stage-timeout — 제출 없음·맵 0', async () => {
    const h = harness({ bounds: NARROW, settings: new Promise(() => {}) })
    const p = h.generate()
    await vi.advanceTimersByTimeAsync(119000)
    expect(h.trace).not.toContain('shield:off')
    const r = await settle(p, 5000)
    expect(r).toEqual({ success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason: 'dom-stage-timeout' })
    expect(at(h.trace, 'shield:off')).toBeGreaterThan(at(h.trace, 'shield:on'))
    expect(h.flowView.getBounds()).toEqual({ x: 0, y: 0, width: 637, height: 800 })
    expect(h.trace).not.toContain('click:compose-submit')
    expect(h.pendingGenerations.size).toBe(0)
    expect(logged()).toMatch(/DOM stage timed out/)
  })

  it('(a) 제출 클릭이 이미 나간 뒤(클릭 125s)에 120s 가 지나면 timeout 이 아니라 정상 제출 경로(늦은 loadend → images) — 방패는 클릭 뒤 제거', async () => {
    const h = harness({ bounds: NARROW, onSubmit: async (page) => { await new Promise((r) => setTimeout(r, 125000)); page.send(); page.loadend() } })
    const r = await settle(h.generate(), 140000)
    expect(r).toMatchObject({ success: true, images: [{ mediaId: maskedUuid(5) }] })
    expect(logged()).not.toMatch(/dom-stage-timeout|DOM stage timed out/)
    expect(at(h.trace, 'shield:off')).toBeGreaterThan(idx(h.trace, 'click:compose-submit'))
  })

  // 매달리는 자리는 각 체크포인트 **직전**의 exec — 그 뒤의 것(드라이버 안)은 O2 의 isAborted 가드가 먼저 자른다. 체크포인트 앞에서 멈춘 좀비는 applyComposerSettings 를
  //   부르지도 않으므로 좀비의 settings:dom-stage-aborted 진단 보고도 없다(잡음 없음).
  const SUMMARY = { text: '🍌 Nano Banana 2 x1', ligatures: ['crop_16_9'] }
  it.each([
    ['에이전트 프로브(설정 전 체크포인트)', () => ({ agent: new Promise((r) => setTimeout(() => r({ found: true, on: false }), 121000)) }), ['settings-driver', 'focus', 'click:compose-editor', 'click:compose-submit']],
    ['캡처 플래그 프로브(설정 전 체크포인트)', () => ({ captureFlag: [new Promise((r) => setTimeout(() => r(true), 121000))] }), ['settings-driver', 'focus', 'click:compose-editor', 'click:compose-submit']],
    ['설정 드라이버(O2 가드가 닫힌 요약 판독 앞에서 자른다)', () => ({ settings: new Promise((r) => setTimeout(() => r({ ok: true, closed: true, steps: {} }), 121000)) }), ['focus', 'click:compose-editor', 'click:compose-submit']],
    ['닫힌 요약 재판독(편집기 전 체크포인트)', () => ({ summary: [SUMMARY, new Promise((r) => setTimeout(() => r(SUMMARY), 121000))] }), ['focus', 'click:compose-editor', 'click:compose-submit']],
    ['제출 가능 프로브(arm 전 체크포인트)', () => ({ submitEnabled: new Promise((r) => setTimeout(() => r(true), 121000)) }), ['click:compose-submit']],
    ['편집기 재판독(arm 전 체크포인트)', () => ({ editorText: new Promise((r) => setTimeout(() => r(PROMPT), 121000)) }), ['click:compose-submit']],
    // M2-FINAL Q3(B2): P2 의 두 번째 재판독(arm 체크포인트 앞)에 매달린 좀비 — 재판독이 체크포인트 아래로 옮겨지면 좀비가 arm·클릭한다
    ['두 번째 재판독(P2 — arm 체크포인트 앞, 125s 에 풀림)', () => ({ editorText: [PROMPT, new Promise((r) => setTimeout(() => r(PROMPT), 125000))] }), ['click:compose-submit']],
  ])('(c) %s 에 매달렸다 121s 에 풀린 좀비 → 그 뒤 단계 없음·arm 없음·맵 0·shield:off 1회', async (_n, mk, absent) => {
    const h = harness({ bounds: NARROW, ...mk() })
    expect(await settle(h.generate(), 125000)).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    await vi.advanceTimersByTimeAsync(10000)
    for (const tag of absent) expect(h.trace, tag).not.toContain(tag)
    if (absent.includes('settings-driver')) expect(h.onDomFailure.mock.calls.map((c) => c[0])).not.toContain('settings:dom-stage-aborted')
    expect(h.trace.filter((x) => x.startsWith('armed:'))).toEqual([])
    expect(h.pendingGenerations.size).toBe(0)
    expect(h.trace.filter((x) => x === 'shield:off')).toHaveLength(1)
  })
})

// M2-CLOSE O5(A5): 이미지도 같다 — 주입 exec 직전에 flowView.webContents.focus() 를 다시 건다.
describe('flow:generate-image (angular) — 주입 직전 포커스 재확보 (M2-CLOSE O5)', () => {
  it('SET_EDITOR_TEXT_JS 바로 앞의 trace 는 focus 다(편집기 클릭 뒤 두 번째 focus)', async () => {
    const h = harness({ bounds: { x: 0, y: 0, width: 597, height: 872 } })
    expect((await settle(h.generate())).success).toBe(true)
    const t = h.trace
    const inject = t.indexOf('set-text:visible')
    expect(inject).toBeGreaterThan(0)
    expect(t[inject - 1]).toBe('focus')
    expect(t.filter((x) => x === 'focus')).toHaveLength(2)
    expect(t.lastIndexOf('focus')).toBeGreaterThan(idx(t, 'click:compose-editor'))
  })
})

// M2-LAST P1(A1 = B1): 이미지도 같은 모듈 상태를 본다 — 문서가 죽어(main 의 did-navigate·render-process-gone) releaseDomStage 가 불리면 영영 미해결 좀비 뒤의 다음 항목이 기다리지 않는다.
describe('flow:generate-image (angular) — 문서가 죽으면 DOM 단계 직렬화를 푼다 (M2-LAST P1)', () => {
  it('영영 미해결 좀비 → releaseDomStage("render-process-gone") → 다음 항목은 기다리지 않고 진행해 images; 로그 "DOM stage released (render-process-gone)"', async () => {
    const h = harness({ bounds: { x: 0, y: 0, width: 597, height: 872 }, settings: [new Promise(() => {}), undefined] })   // 첫 항목의 드라이버만 영영 매달린다
    expect(await settle(h.generate(), 125000)).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    expect(releaseDomStage('render-process-gone')).toBe(true)
    expect(logged()).toMatch(/\[Flow API\] DOM stage released \(render-process-gone\)/)
    expect(await settle(h.generate(), 15000)).toMatchObject({ success: true, images: [{ mediaId: maskedUuid(5) }] })   // 예산 15s — 풀리지 않았으면 dom-stage-busy 로 빨갛다
    expect(h.trace.filter((x) => x === 'agent-probe')).toHaveLength(2)
    expect(logged()).not.toMatch(/still busy/)
  })
})

// M2-LAST P2(B2): 이미지도 같다 — 재판독이 맞은 즉시 메인 창에 OS 포커스(IME 조합이 붙을 편집기 포커스를 없앤다), 제출 클릭 직전 재판독이 다르면 클릭·arm 없이 클릭 전 실패.
describe('flow:generate-image (angular) — 클릭 전 OS 포커스 반환 · 제출 직전 재판독 (M2-LAST P2)', () => {
  const NARROW = { x: 0, y: 0, width: 597, height: 872 }
  const count = (t, tag) => t.filter((x) => x === tag).length

  it('재판독이 맞으면 제출 가능 프로브 전에 메인 창에 포커스(read-text < main-focus < submit-enabled); 제출 클릭 바로 앞은 두 번째 read-text — 좁은 뷰·넓은 뷰(포커스 있던 뷰 포함)', async () => {
    for (const o of [{ bounds: NARROW }, {}, { focused: true }]) {
      const h = harness(o)
      expect(await settle(h.generate())).toMatchObject({ success: true, images: [{ mediaId: maskedUuid(5) }] })
      const t = h.trace
      expect(idx(t, 'read-text')).toBeLessThan(idx(t, 'main-focus'))
      expect(idx(t, 'main-focus')).toBeLessThan(idx(t, 'submit-enabled'))
      expect(count(t, 'read-text')).toBe(3)   // M2-FINAL Q1: 세 번째 재판독은 제출 클릭 안(beforeDispatch — 히트테스트 뒤·mouseDown 직전)
      expect(t[idx(t, 'click:compose-submit') - 1]).toBe('read-text')
      // finally 의 반환은 그대로: 뷰포트에 들어갔거나 포커스가 없던 뷰면 클릭 뒤 한 번 더, 넓고 포커스 있던 뷰면 클릭 전 한 번뿐
      expect(count(t, 'main-focus')).toBe(o.focused ? 1 : 2)
    }
  })

  it('재판독 뒤·클릭 전에 편집기 텍스트가 달라지면 제출 클릭·arm 없이 클릭 전 text-injection-failed(reason editor-changed-before-click) — 맵 0·보고 내용 없음', async () => {
    const h = harness({ editorText: [PROMPT, PROMPT + '한'] })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'text-injection-failed', error: 'text-injection-failed', reason: 'editor-changed-before-click' })
    expect(h.trace).not.toContain('click:compose-submit')
    expect(h.trace.filter((x) => x.startsWith('armed:'))).toEqual([])
    expect(h.pendingGenerations.size).toBe(0)
    expect(count(h.trace, 'read-text')).toBe(2)
    expect(h.onDomFailure.mock.calls.some((c) => c[0] === 'compose-text' && c[1]?.reason === 'editor-changed-before-click')).toBe(true)
    expect(logged()).toMatch(/editor text changed between the read-back and the submit click promptLen=\d+ editorLen=\d+/)
    for (const c of h.onDomFailure.mock.calls) expect(JSON.stringify(c)).not.toContain(PROMPT)
    expect(logged()).not.toContain(PROMPT)
  })
})

// M2-LAST P3(A2): 이미지도 같다 — 캐럿 클릭 중 워치독이 울린 좀비는 finally 뒤에 재포커스·주입하지 않는다.
describe('flow:generate-image (angular) — 캐럿 클릭 중 워치독이 울린 좀비는 재포커스·주입하지 않는다 (M2-LAST P3)', () => {
  it('compose-editor 클릭이 121s 에 돌아온 좀비 → keylock:off 뒤에 focus·set-text·read-text·main-focus·submit-enabled·제출 클릭 없음, 맵 0, shield:off 1회', async () => {
    const h = harness({ bounds: { x: 0, y: 0, width: 597, height: 872 } })
    h.trustedClickOnFlowView.mockImplementation(async (_sel, opts) => {
      h.trace.push('click:' + (opts?.step || '?'))
      if (opts?.step === 'compose-editor') await new Promise((r) => setTimeout(r, 121000))
      return { success: true }
    })
    expect(await settle(h.generate(), 125000)).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    await vi.advanceTimersByTimeAsync(10000)
    const t = h.trace
    const off = t.indexOf('keylock:off')
    expect(off).toBeGreaterThan(t.indexOf('click:compose-editor'))
    const after = t.slice(off + 1)
    expect(after).not.toContain('focus')
    expect(after.filter((x) => x.startsWith('set-text'))).toEqual([])
    expect(after).not.toContain('read-text')
    expect(after).not.toContain('main-focus')
    expect(after).not.toContain('submit-enabled')
    expect(t).not.toContain('click:compose-submit')
    expect(h.pendingGenerations.size).toBe(0)
    expect(t.filter((x) => x === 'shield:off')).toHaveLength(1)
  })
})

// M2-LAST P4(A3): 거부 경로(dom-stage-busy · layout-dragging)는 키 잠금을 건드리지 않는다 — 이미지 스위트엔 두 거부 핀이 없었다(잠금을 거부 앞에서 잡고 안 풀어도 초록).
//   잠금이 거부 뒤에 남으면 Flow 뷰로 가는 모든 키가 영구히 막힌다(P1 이전엔 busy 가 영구였으니 함께 영구).
describe('flow:generate-image (angular) — 클릭 전 거부는 키 잠금을 건드리지 않는다 (M2-LAST P4)', () => {
  const NARROW = { x: 0, y: 0, width: 597, height: 872 }
  const count = (t, tag) => t.filter((x) => x === tag).length

  it('직전 단계의 좀비가 살아 있으면(드라이버 영영 미해결) 다음 항목은 10s 기다린 뒤 클릭 전 dom-stage-busy — bounds·방패·프로브·클릭 없음, 잠금 호출은 첫 항목의 on/off 뿐', async () => {
    const h = harness({ bounds: NARROW, settings: new Promise(() => {}) })
    expect(await settle(h.generate(), 125000)).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    const setBoundsCalls = h.flowView.setBounds.mock.calls.length
    const r2 = await settle(h.generate(), 15000)
    expect(r2).toEqual({ success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason: 'dom-stage-busy' })
    expect(count(h.trace, 'agent-probe')).toBe(1)
    expect(count(h.trace, 'shield:on')).toBe(1)
    expect(h.flowView.setBounds.mock.calls.length).toBe(setBoundsCalls)
    expect(h.trace).not.toContain('click:compose-submit')
    expect(h.pendingGenerations.size).toBe(0)
    expect(logged()).toMatch(/DOM stage still busy after 10s → refusing before click/)
    expect(h.setAutomationKeyLock.mock.calls).toEqual([[true], [false]])
  })

  it('5s 가 지나도 드래그 중이면 클릭 전 flow-settings-not-applied(reason layout-dragging) — bounds·방패·프로브·클릭 없음, 잠금 호출 없음', async () => {
    setLayoutDragging(true)
    try {
      const h = harness({ hidden: true })
      const r = await settle(h.generate(), 10000)
      expect(r).toEqual({ success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason: 'layout-dragging' })
      expect(h.flowView.setBounds).not.toHaveBeenCalled()
      expect(h.createInputShield).not.toHaveBeenCalled()
      expect(h.trace).not.toContain('agent-probe')
      expect(h.trace).not.toContain('click:compose-submit')
      expect(h.pendingGenerations.size).toBe(0)
      expect(logged()).toMatch(/layout still dragging/)
      expect(h.setAutomationKeyLock).not.toHaveBeenCalled()
    } finally { setLayoutDragging(false) }
  })
})

// M2-FINAL Q1(A1 = B1): 이미지도 같다 — (a) focusMainWindow 가 setShieldFocusTarget('main') 을 세워 그 뒤의 방패 focus 는 메인 창으로(방패 생성 시 'flow', finally 리셋),
//   (b) 제출 신뢰 클릭의 beforeDispatch 가 히트테스트 뒤·mouseDown 직전에 편집기를 마지막으로 재판독해 다르면 미디스패치 거부 → gen 삭제 + 클릭 전 text-injection-failed.
describe('flow:generate-image (angular) — 방패 포커스의 단계 플래그 · mouseDown 직전 마지막 재판독 (M2-FINAL Q1)', () => {
  const NARROW = { x: 0, y: 0, width: 597, height: 872 }
  const count = (t, tag) => t.filter((x) => x === tag).length

  it('(a) 메인 창으로 넘긴 뒤(제출 가능 프로브 중)의 방패 focus 는 메인 창으로 — main-focus 뒤 제출 클릭까지 Flow focus 없음; shield-target flow → main → flow(리셋은 shield:off 뒤)', async () => {
    const h = harness({ bounds: NARROW, shieldFocusAt: 'submit-enabled' })
    expect(await settle(h.generate())).toMatchObject({ success: true, images: [{ mediaId: maskedUuid(5) }] })
    const t = h.trace
    const handOff = idx(t, 'main-focus')
    const click = idx(t, 'click:compose-submit')
    expect(handOff).toBeGreaterThan(0)
    expect(t.slice(handOff, click)).not.toContain('focus')
    expect(t.slice(handOff, click).filter((x) => x === 'main-focus')).toHaveLength(2)
    expect(count(t, 'main-focus')).toBe(3)
    expect(t[idx(t, 'shield:on') - 1]).toBe('shield-target:flow')
    expect(t[handOff - 1]).toBe('shield-target:main')
    const lastTarget = t.map((x, i) => [x, i]).filter(([x]) => x.startsWith('shield-target:')).pop()
    expect(lastTarget[0]).toBe('shield-target:flow')
    expect(lastTarget[1]).toBeGreaterThan(idx(t, 'shield:off'))
    expect(h.setShieldFocusTarget.mock.calls).toEqual([['flow'], ['main'], ['flow']])
  })

  it('(a 대조군) 넘기기 전(캡처 프로브 중)의 방패 focus 는 O5 대로 Flow 뷰로 — capture-probe 바로 뒤 focus, main-focus 는 2회', async () => {
    const h = harness({ bounds: NARROW, shieldFocusAt: 'capture-probe' })
    expect(await settle(h.generate())).toMatchObject({ success: true, images: [{ mediaId: maskedUuid(5) }] })
    const t = h.trace
    expect(t[idx(t, 'capture-probe') + 1]).toBe('focus')
    expect(count(t, 'focus')).toBe(3)
    expect(count(t, 'main-focus')).toBe(2)
  })

  it('(b) 히트테스트 뒤·mouseDown 직전의 재판독이 다르면 미디스패치 거부 → mouseDown·send 없음, gen 삭제(맵 0), 클릭 전 text-injection-failed(reason editor-changed-before-click), 보고 내용 없음', async () => {
    const h = harness({ bounds: NARROW, editorText: [PROMPT, PROMPT, PROMPT + '한'] })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'text-injection-failed', error: 'text-injection-failed', reason: 'editor-changed-before-click' })
    expect(r).not.toHaveProperty('postClick')
    expect(h.trace).toContain('click:compose-submit')
    expect(h.trace).toContain('dispatch-refused')
    expect(h.trace.filter((x) => x.startsWith('armed:'))).toEqual([])
    expect(count(h.trace, 'read-text')).toBe(3)
    expect(h.trace.indexOf('dispatch-refused')).toBeGreaterThan(h.trace.lastIndexOf('read-text'))
    expect(h.pendingGenerations.size).toBe(0)
    expect(h.onDomFailure.mock.calls.some((c) => c[0] === 'compose-text' && c[1]?.reason === 'editor-changed-before-click')).toBe(true)
    expect(logged()).toMatch(/editor text changed between the hit-test and the mouseDown promptLen=\d+ editorLen=\d+ → refused before dispatch/)
    for (const c of h.onDomFailure.mock.calls) expect(JSON.stringify(c)).not.toContain(PROMPT)
    expect(logged()).not.toContain(PROMPT)
    expect(h.trace.filter((x) => x === 'shield:off')).toHaveLength(1)
    expect(h.setAutomationKeyLock.mock.calls).toEqual([[true], [false]])
  })
})
