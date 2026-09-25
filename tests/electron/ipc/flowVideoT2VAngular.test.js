// @vitest-environment node
//
// M2-4 — flow.google.com(Angular) 텍스트→영상 제출 핸들러(flow:generate-video-t2v). 하네스는 이미지 하네스(flowGenerateImageAngular)와
// 같은 꼴 — 실제 createSharedHelpers(onDomFailure 스파이) 를 deps 에 스프레드하고 trustedClickOnFlowView 만 가짜로 바꿔 제출 클릭이
// "페이지의 YhhmEf send/loadend" 를 라우터로 흘리게 한다. 읽기 RPC(nzlxg 크레딧) 는 페이지 XHR 스크립트를 executeJavaScript 로 받는다.
//   순서: 세션(URL·WIZ) → 에이전트 모드/@멘션 칩 거부 → 프로젝트 → ensureAgentOff → 캡처 플래그 → **크레딧 before(nzlxg)** → 설정(video·count 1)
//         → 편집기 → 제출 가능 → arm(YhhmEf, want) → 클릭 → loadend → 모델키 표 검증 → {success, generationId:<mediaId>, creditsLeft}
//   클릭 **뒤** 실패는 전부 postClick:true, 클릭 전 거부(세션·칩·입력·설정·크레딧 판독 실패) 는 postClick 없음. 거부한 미디어 id 는
//   rejectedMediaId(s) 로만(mediaId/generationId 키 없음). 완료 폴의 모델키 재검사는 없다(D8-6).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerVideoIPC } from '../../../electron/ipc/video.js'
import { createSharedHelpers } from '../../../electron/ipc/shared.js'
import { routeReportResponse, buildReportCtx } from '../../../electron/reportResponseRouter.js'
import { failBoundUnfinished, _resetUnboundCloseRecordsForTests } from '../../../electron/flow-rpc-router.js'
import { _resetDomStageForTests, releaseDomStage } from '../../../electron/ipc/flow-angular.js'   // M2-CLOSE O2: DOM 단계 직렬화 기록은 모듈 상태 · M2-LAST P1: 문서가 죽으면 푼다
import { setLayoutDragging } from '../../../electron/ipc/layout.js'   // M2-LIVE N1: 드래그 중 진입
import { isFlowAuthError, markFlowAuthFailure } from '../../../src/engine/engineFlow.js'
import { isQuotaExhaustedError } from '../../../src/utils/quotaStop.js'
import { sample, samplePayload, respBodyWithPayload, respBodyFailure, maskedUuid } from '../../fixtures/flow-batchexecute-samples.js'

const PROJECT = '134cf5b5-6a64-47b8-8709-6de4c6b0e44c'
const FLOW_URL_OK = `https://flow.google.com/project/${PROJECT}`
const PROMPT = '왕이 궁전 내부를 산책하는 영상'
const UUID11 = maskedUuid(11)   // M2-R5 J2: 픽스처의 <uuid#11> 은 로더가 UUID 모양으로 푼다
const DOC = 'e'.repeat(32)
const NOW_S = 1790240102.5

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
}

/** nzlxg 응답 본문(크레딧 n). */
const creditsBody = (n) => respBodyWithPayload('nzlxg', [n, 1, 2, 2, null, n])

/**
 * @param {object} o
 *   url · wiz · agent · captureFlag · settings(드라이버 결과) · summary · editorText · submitEnabled · flowAgentOn · mode
 *   · credits(nzlxg 결과 순서: 숫자 | {status,text} | Error) · onSubmit(page) · clickSuccess · hidden · bounds
 */
function harness(o = {}) {
  const url = o.url ?? FLOW_URL_OK
  const trace = []
  let bounds = o.bounds ? { ...o.bounds } : o.hidden ? { x: 0, y: 0, width: 0, height: 0 } : { x: 0, y: 0, width: 957, height: 1022 }
  const captureFlags = Array.isArray(o.captureFlag) ? [...o.captureFlag] : [true]
  const agentSeq = Array.isArray(o.agent) ? [...o.agent] : null
  const summarySeq = Array.isArray(o.summary) ? [...o.summary] : null   // M2-CLOSE O3: 요약 판독 순서(트리거 전 · 닫힌 뒤) — 마지막 값이 남는다
  const settingsSeq = Array.isArray(o.settings) ? [...o.settings] : null   // M2-LAST P1: 드라이버 결과 순서(항목별 — undefined 는 기본값) — 마지막 값이 남는다
  const editorSeq = Array.isArray(o.editorText) ? [...o.editorText] : null   // M2-LAST P2: 편집기 재판독 순서(주입 뒤 · 제출 클릭 직전) — 마지막 값이 남는다
  const credits = Array.isArray(o.credits) ? [...o.credits] : [1050]
  let injectedPrompt = null
  let settingsTargets = null
  const creditReadsAt = []
  const executeJavaScript = vi.fn(async (script) => {
    const s = String(script)
    if (s.includes('__af_settings_driver__')) {
      trace.push('settings-driver')
      const m = s.match(/core\(document, (\{.*?\}), \{ scan: scan/)
      settingsTargets = m ? JSON.parse(m[1]) : null
      const next = settingsSeq ? (settingsSeq.length > 1 ? settingsSeq.shift() : settingsSeq[0]) : o.settings
      return next ?? { ok: true, closed: true, steps: { mode: 'clicked(videocam)', ratio: 'already(crop_16_9)', duration: 'already(6)', resolution: 'already(720p)', count: 'already(x1)', model: 'already', input: 'material' } }
    }
    if (s.includes('__af_settings_panel_open__')) return false
    if (s.includes('__af_set_editor_text__')) {
      trace.push(bounds.width > 0 && bounds.height > 0 ? 'set-text:visible' : 'set-text:hidden')
      const m = s.match(/const text = (".*?");/)
      injectedPrompt = m ? JSON.parse(m[1]) : null
      return { ok: true }
    }
    if (s.includes('WIZ_global_data.SNlM0e')) { trace.push('wiz'); return o.wiz ?? true }
    if (s.includes('"nzlxg"')) {
      trace.push('credits')
      creditReadsAt.push(Date.now())
      const next = credits.length > 1 ? credits.shift() : credits[0]
      if (next instanceof Error) throw next
      if (typeof next === 'number') return { status: 200, text: creditsBody(next) }
      return next
    }
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
    if (s.includes('settings-summary')) { trace.push('summary'); if (summarySeq) return summarySeq.length > 1 ? summarySeq.shift() : summarySeq[0]; return o.summary ?? { text: '동영상 · 720p · 6초 x1', ligatures: ['crop_16_9'] } }
    if (s.includes("querySelectorAll('p')")) { trace.push('read-text'); if (editorSeq) return editorSeq.length > 1 ? editorSeq.shift() : editorSeq[0]; return o.editorText !== undefined ? o.editorText : injectedPrompt }
    if (s.includes('aria-disabled')) { trace.push('submit-enabled'); return o.submitEnabled ?? true }
    if (s.includes('interactiveCount')) return { hasComposer: true, interactiveCount: 80, url }
    return null
  })
  const flowView = {
    getBounds: () => ({ ...bounds }),
    setBounds: vi.fn((b) => { bounds = { ...b }; trace.push(`bounds:${b.width}x${b.height}`) }),
    webContents: { executeJavaScript, getURL: () => url, loadURL: vi.fn(async () => {}), focus: vi.fn(() => { trace.push('focus') }), sendInputEvent: vi.fn(), isDestroyed: () => false, session: null, isFocused: () => !!o.focused },
  }
  const mainWindow = { getContentBounds: () => ({ width: 1280, height: 800 }), getBounds: () => ({ x: 0, y: 0 }), webContents: { focus: vi.fn(() => { trace.push('main-focus') }) } }
  const onDomFailure = vi.fn(async () => {})
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
    reportDomFailure: helpers.reportDomFailure,   // M2-R7 L1: main.js 와 같이 — 라우터의 unbound YhhmEf loadend 보고
  })
  const page = {
    send: (over = {}) => routeReportResponse({ kind: 'batchexecute-send', doc: DOC, rpcid: 'YhhmEf', rpcids: ['YhhmEf'], seq: 1, prompts: [PROMPT], sentAt: Date.now() / 1000, ...over }, ctx),
    loadend: (over = {}) => routeReportResponse({ kind: 'batchexecute', doc: DOC, rpcid: 'YhhmEf', seq: 1, status: 200, responseText: sample('YhhmEf').respBody, endedAt: Date.now() / 1000, ...over }, ctx),
  }
  const onSubmit = o.onSubmit === undefined ? (() => { page.send(); page.loadend() }) : o.onSubmit
  const trustedClickOnFlowView = vi.fn(async (_sel, opts) => {
    trace.push('click:' + (opts?.step || '?'))
    if (opts?.step === 'compose-submit') { trace.push('armed:' + pendingGenerations.size); if (onSubmit) await onSubmit(page, pendingGenerations) }
    if (opts?.step === 'compose-submit' && o.clickResult) return o.clickResult
    return { success: o.clickSuccess ?? true }
  })
  const sessionFetch = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: { get: () => 'video/mp4' } }))
  // M2-LIVE N1: main 의 createInputShield 흉내 — 생성/제거를 trace 에 남긴다(shield:on / shield:off)
  const createInputShield = vi.fn(() => { trace.push('shield:on'); return { remove: vi.fn(() => { trace.push('shield:off') }) } })
  // M2-CLOSE O1: main 의 setAutomationKeyLock 흉내 — 잠금/해제 시각을 trace 에(keylock:on / keylock:off)
  const setAutomationKeyLock = vi.fn((on) => { trace.push(on ? 'keylock:on' : 'keylock:off') })
  const legacy = {
    configureFlowMode: vi.fn(async () => ({ success: true })), switchFlowToVideoMode: vi.fn(async () => ({ success: true })),
    setFlowPageInject: vi.fn(async () => ({ success: true })), clearFlowPageInject: vi.fn(async () => {}),
    applyAgentDefaults: vi.fn(async () => ({ success: true })), getRecaptchaToken: vi.fn(async () => null), ensureAgentOn: vi.fn(async () => ({ success: true })),
  }
  const ipcMain = makeIpcMain()
  registerVideoIPC(ipcMain, {
    getFlowView: () => flowView,
    getMainWindow: () => mainWindow,
    getCurrentMode: () => o.mode ?? 'flow',
    getFlowAgentOn: () => !!o.flowAgentOn,
    parseFlowResponse: () => null,
    setCapturedProjectId: vi.fn(), getCapturedProjectId: () => null,
    pendingGenerations,
    getPendingVideoGeneration: () => null, setPendingVideoGeneration: vi.fn(),
    flowPageFetch: vi.fn(), getApiBase: () => null,
    ...helpers,                 // 실제 헬퍼(ensureAgentOff · ensureOnProjectComposer · reportDomFailure …)
    ...legacy,                  // 옛 deps 스파이는 실제 헬퍼 **뒤에**(R2#4)
    trustedClickOnFlowView,     // 클릭만 가짜 — 제출 클릭이 페이지 이벤트를 라우터로 흘린다
    sessionFetch,
    createInputShield,          // M2-LIVE N1: 제자리 뷰포트 동안의 입력 방패(가짜 — trace 로 생성·제거 시각을 본다)
    setAutomationKeyLock,       // M2-CLOSE O1: DOM 단계 동안의 키 입력 잠금(가짜)
  })
  const generate = (p = {}) => ipcMain.invoke('flow:generate-video-t2v', {
    token: null, prompt: PROMPT, projectId: PROJECT, model: 'Omni Flash', aspectRatio: '16:9', duration: 6, resolution: '720p', videoBatchCount: 1, seed: null, segments: null, ...p,
  })
  return { ipcMain, generate, trace, executeJavaScript, trustedClickOnFlowView, sessionFetch, onDomFailure, pendingGenerations, page, legacy, flowView, mainWindow, targets: () => settingsTargets, creditReadsAt, createInputShield, setAutomationKeyLock }
}

/** 가짜 시계에서 핸들러 promise 를 굴린다(ensureAgentOff 의 350ms sleep · 마감 타이머 등). */
async function settle(promise, maxMs = 5000) {
  let done = false
  const p = promise.then((v) => { done = true; return v })
  for (let t = 0; t < maxMs && !done; t += 100) await vi.advanceTimersByTimeAsync(100)
  return p
}

let logSpy, warnSpy, errSpy
beforeEach(() => {
  _resetUnboundCloseRecordsForTests()   // M2-R8 M4: 라우터의 "최근 앱 닫힘" 기록은 모듈 상태
  _resetDomStageForTests()              // M2-CLOSE O2: 앞 테스트가 남긴 좀비(영영 미해결 드라이버)가 다음 테스트의 단계를 막지 않게
  vi.useFakeTimers({ now: NOW_S * 1000 })
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore() })
const logged = () => [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errSpy.mock.calls].map((c) => c.map(String).join(' ')).join('\n')
const idx = (arr, tag) => arr.findIndex((x) => x === tag || x.startsWith(tag))

/** 제출 응답 사본의 모델키를 바꾼다. */
function payloadWithModelKey(key) {
  const p = samplePayload('YhhmEf')
  p[3][0][7][0][12] = key
  return p
}

describe('flow:generate-video-t2v (angular) — 성공 경로', () => {
  it('순서: ensureAgentOff → 캡처 → 크레딧 before(nzlxg) → 설정(video, count 1) → 편집기 → 제출 가능 → arm → 클릭 → {success, generationId:<mediaId>, creditsLeft:1040}; §4 로그', async () => {
    const h = harness()
    const r = await settle(h.generate())
    expect(r).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
    expect(r).not.toHaveProperty('postClick')
    const t = h.trace
    expect(idx(t, 'agent-probe')).toBeGreaterThanOrEqual(0)
    expect(idx(t, 'agent-probe')).toBeLessThan(idx(t, 'capture-probe'))
    expect(idx(t, 'capture-probe')).toBeLessThan(idx(t, 'credits'))
    expect(idx(t, 'credits')).toBeLessThan(idx(t, 'settings-driver'))
    expect(idx(t, 'settings-driver')).toBeLessThan(idx(t, 'focus'))
    expect(idx(t, 'focus')).toBeLessThan(idx(t, 'click:compose-editor'))
    expect(idx(t, 'click:compose-editor')).toBeLessThan(idx(t, 'set-text:visible'))
    expect(idx(t, 'set-text:visible')).toBeLessThan(idx(t, 'read-text'))
    expect(idx(t, 'read-text')).toBeLessThan(idx(t, 'submit-enabled'))
    expect(idx(t, 'submit-enabled')).toBeLessThan(idx(t, 'click:compose-submit'))
    expect(t).toContain('armed:1')
    expect(t.filter((x) => x === 'credits')).toHaveLength(1)   // 성공 경로는 크레딧을 한 번만 읽는다
    // 설정 목표: video · count 는 항상 1 · duration/resolution/ratio/model 전달
    expect(h.targets()).toEqual({ mode: 'video', ratio: '16:9', count: 1, model: 'Omni Flash', duration: 6, resolution: '720p' })
    expect(h.pendingGenerations.size).toBe(0)
    expect(h.sessionFetch).not.toHaveBeenCalled()   // 제출은 다운로드하지 않는다(상태 폴이 한다)
    const L = logged()
    expect(L).toMatch(/\[Flow Video T2V\] \[Angular\] credits before=1050/)
    expect(L).toMatch(/\[Flow RPC\] YhhmEf send doc=\S{8} seq=1 bound=\S+/)
    expect(L).toMatch(/\[Flow RPC\] YhhmEf loadend seq=1 status=200/)
    expect(L).toMatch(/\[Flow Video T2V\] \[Angular\] submitted media=\S{1,8} creditsLeft=1040 modelKey=abra_t2v_6s/)
    expect(L.indexOf('credits before=1050')).toBeLessThan(L.indexOf('submitted media='))
    expect(L).not.toContain(PROMPT)
    expect(L).not.toContain('Signature')
    for (const fn of Object.values(h.legacy)) expect(fn).not.toHaveBeenCalled()
  })

  it('videoBatchCount:2 를 요청해도 설정 계획은 count 1 (영상은 항상 x1)', async () => {
    const h = harness()
    const r = await settle(h.generate({ videoBatchCount: 2 }))
    expect(r.success).toBe(true)
    expect(h.targets().count).toBe(1)
  })

  it('[3][0][5][8](상태) 삭제 사본 → 성공 + warnings=state-missing 로그(실패 아님)', async () => {
    const p = samplePayload('YhhmEf'); delete p[3][0][5][8]
    const h = harness({ onSubmit: (page) => { page.send(); page.loadend({ responseText: respBodyWithPayload('YhhmEf', p) }) } })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
    expect(logged()).toMatch(/warnings=state-missing/)
  })

  it('숨은 뷰(0×0): DOM 단계 동안 자동화 뷰포트 → 클릭 뒤 원복 + 메인 창 포커스 반환(이미지와 같은 래퍼)', async () => {
    const h = harness({ hidden: true })
    const r = await settle(h.generate())
    expect(r.success).toBe(true)
    const t = h.trace
    const enlarge = t.findIndex((x) => /^bounds:\d+x\d+$/.test(x) && !x.endsWith('0x0'))
    expect(enlarge).toBeGreaterThanOrEqual(0)
    expect(enlarge).toBeLessThan(idx(t, 'agent-probe'))
    const lastBounds = t.map((x, i) => [x, i]).filter(([x]) => x.startsWith('bounds:')).at(-1)[1]
    expect(lastBounds).toBeGreaterThan(idx(t, 'click:compose-submit'))
    expect(t.lastIndexOf('main-focus')).toBeGreaterThan(lastBounds)   // M2-LAST P2: 첫 main-focus 는 클릭 전(재판독 뒤) — finally 의 반환은 마지막
    expect(logged()).toMatch(/\[Flow Video T2V\] \[Angular\] view hidden 0x0 → automation viewport \d+x\d+ in-place/)
    // 실기(2026-09-25): 화면 밖 bounds 는 페이지 크기를 못 바꿨다 — 첫 setBounds 는 창 안 제자리(x=0,y=0), 폭 ≥ 700.
    expect(h.flowView.setBounds.mock.calls[0][0]).toMatchObject({ x: 0, y: 0 })
    expect(h.flowView.setBounds.mock.calls[0][0].width).toBeGreaterThanOrEqual(700)
  })
})

describe('flow:generate-video-t2v (angular) — 200 뒤의 거부 (postClick + rejectedMediaId(s), mediaId/generationId 없음)', () => {
  it('모델키 불일치(veo_3_1_t2v_fast_6s) → flow-video-settings-mismatch {expected, actual} + rejectedMediaId + postClick; onDomFailure(submit:…) 내용 없음', async () => {
    const h = harness({ onSubmit: (page) => { page.send(); page.loadend({ responseText: respBodyWithPayload('YhhmEf', payloadWithModelKey('veo_3_1_t2v_fast_6s')) }) } })
    const r = await settle(h.generate())
    expect(r).toEqual({
      success: false, errorKind: 'flow-video-settings-mismatch', error: 'flow-video-settings-mismatch',
      errorParams: { expected: 'Omni Flash 6s 16:9 720p', actual: 'veo_3_1_t2v_fast_6s' }, rejectedMediaId: UUID11, postClick: true,
    })
    expect(r).not.toHaveProperty('mediaId')
    expect(r).not.toHaveProperty('generationId')
    expect(isFlowAuthError(r)).toBe(false)
    const call = h.onDomFailure.mock.calls.find((c) => c[0] === 'submit:flow-video-settings-mismatch')
    expect(call).toBeTruthy()
    expect(JSON.stringify(call[1])).not.toContain(PROMPT)
    expect(h.pendingGenerations.size).toBe(0)
  })

  it('요청과 맞는 키 변형은 통과: Omni 9:16 요청 ↔ abra_t2v_6s(키에 비율 없음 — 패널이 보장)', async () => {
    const h = harness({ summary: { text: 'x', ligatures: ['crop_9_16'] } })
    const r = await settle(h.generate({ aspectRatio: '9:16' }))
    expect(r).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
  })

  it('[3] 레코드 2개 → flow-video-count-mismatch + rejectedMediaIds 2개 + postClick', async () => {
    const p = samplePayload('YhhmEf')
    const second = JSON.parse(JSON.stringify(p[3][0])); second[0] = '<uuid#12>'
    p[3].push(second)
    const h = harness({ onSubmit: (page) => { page.send(); page.loadend({ responseText: respBodyWithPayload('YhhmEf', p) }) } })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'flow-video-count-mismatch', error: 'flow-video-count-mismatch', rejectedMediaIds: [UUID11, '<uuid#12>'], postClick: true })
    expect(r).not.toHaveProperty('mediaId')
    expect(r).not.toHaveProperty('generationId')
  })

  it('[3][0][7][0][12](모델키) 삭제 → rpc-shape 실패 + rejectedMediaId + postClick, onDomFailure(rpc-shape:…)', async () => {
    const p = samplePayload('YhhmEf'); delete p[3][0][7][0][12]
    const h = harness({ onSubmit: (page) => { page.send(); page.loadend({ responseText: respBodyWithPayload('YhhmEf', p) }) } })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'flow-rpc-error', error: 'rpc-shape:YhhmEf@[3][0][7][0][12]', rejectedMediaId: UUID11, postClick: true })
    expect(h.onDomFailure.mock.calls.some((c) => c[0] === 'rpc-shape:YhhmEf@[3][0][7][0][12]')).toBe(true)
  })

  // M2-R3 H1(A1, BLOCKER): [3][0][7][0][12] 에 사용자 텍스트가 오면(응답 모양 변화) 옛 코드는 문자열 검사만 통과시켜 mismatch 경로가 `modelKey=<텍스트>` 를
  //   main 로그·reportDomFailure·errorParams.actual 에 그대로 실었다. 파서가 모델키 문법을 검증해 shape 실패(+rejectedMediaId)로 닫으므로 값은 어디에도 안 나간다.
  it('[3][0][7][0][12] 에 사용자 텍스트(공백·유니코드·URL) → rpc-shape 실패 + rejectedMediaId + postClick; 그 텍스트는 console.*·onDomFailure·결과 어디에도 없다', async () => {
    const USER_TEXT = '왕이 궁전 내부를 산책 https://evil.example/x?y=1 Hello World'
    const h = harness({ onSubmit: (page) => { page.send(); page.loadend({ responseText: respBodyWithPayload('YhhmEf', payloadWithModelKey(USER_TEXT)) }) } })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'flow-rpc-error', error: 'rpc-shape:YhhmEf@[3][0][7][0][12]', rejectedMediaId: UUID11, postClick: true })
    expect(JSON.stringify(r)).not.toContain('evil.example')
    expect(logged()).not.toContain('evil.example')
    expect(logged()).not.toContain('Hello World')
    expect(JSON.stringify(h.onDomFailure.mock.calls)).not.toContain('evil.example')
    expect(h.onDomFailure.mock.calls.some((c) => c[0] === 'rpc-shape:YhhmEf@[3][0][7][0][12]')).toBe(true)
  })

  it.each([
    ['실패 프레임 code 8', { responseText: respBodyFailure('YhhmEf', 8) }, { error: 'RESOURCE_EXHAUSTED', errorKind: 'flow-rpc-error', rpcCode: 8 }, false],
    ['실패 프레임 code 7', { responseText: respBodyFailure('YhhmEf', 7) }, { error: 'flow-rpc-error', rpcCode: 7 }, false],
    ['실패 프레임 code 16', { responseText: respBodyFailure('YhhmEf', 16) }, { error: 'flow-rpc-error', rpcCode: 16, authFailed: true }, true],
    ['HTTP 403', { status: 403, responseText: 'Forbidden' }, { error: 'flow-rpc-error', rpcStatus: 403 }, false],
    ['HTTP 401', { status: 401, responseText: '' }, { error: 'flow-rpc-error', rpcStatus: 401, authFailed: true }, true],
    ['status 0', { status: 0, responseText: '' }, { error: 'flow-rpc-error', rpcStatus: 0 }, false],
  ])('%s → 매핑 결과 + postClick, authFailed 는 401/16 만', async (_l, loadendOver, expected, auth) => {
    const h = harness({ onSubmit: (page) => { page.send(); page.loadend(loadendOver) } })
    const r = await settle(h.generate())
    expect(r.success).toBe(false)
    expect(r).toMatchObject({ ...expected, postClick: true })
    expect(!!r.authFailed).toBe(auth)
    expect(isFlowAuthError(r)).toBe(false)
    expect(!!markFlowAuthFailure(r).authFailed).toBe(auth)
    expect(r).not.toHaveProperty('rejectedMediaId')
  })

  it('한 배치에 rpc 여럿(multi) → flow-rpc-multi-batch + postClick', async () => {
    const h = harness({ onSubmit: (page) => { page.send({ rpcids: ['YhhmEf', 'Zzl0ze'], multi: true }) } })
    const r = await settle(h.generate())
    expect(r).toMatchObject({ success: false, errorKind: 'flow-rpc-multi-batch', error: 'flow-rpc-multi-batch', postClick: true })
    expect(h.onDomFailure.mock.calls.some((c) => c[0] === 'submit:flow-rpc-multi-batch')).toBe(true)
  })
})

describe('flow:generate-video-t2v (angular) — 마감·크레딧', () => {
  // M2-R7 L1(A1): send 마감 15s 는 최종이 아니다 — 페이지의 reCAPTCHA execute + batchexecute send 가 클릭 뒤 15s 를 넘기면(모달로 뷰가 0×0 이라 throttle ·
  //   느린 네트워크) 전엔 gen 이 not-sent 로 닫혀 맵에서 지워지고 그 뒤의 send/loadend 는 unbound 로 버려졌다 — 서버는 10크레딧을 과금했는데 행은 id 없이
  //   "다시 시도"(다음 Start 가 같은 씬에 또 10크레딧). 이제 15s 엔 크레딧만 재판독(줄었으면 즉시 lost)하고 클릭 뒤 100s 까지 바인딩 가능한 채로 기다린다;
  //   100s 까지 send 가 없으면 not-sent 로 닫히고 마지막 재판독에서 줄었으면 lost.
  it('send 없이 100s + 크레딧 불변(1050→1050→1050) → flow-submit-not-sent + postClick — 15s 엔 표시·재판독만(gen 은 맵에 남아 바인딩 가능), 100s 마감 뒤 마지막 재판독 (M2-R7 L1)', async () => {
    const h = harness({ onSubmit: null, credits: [1050, 1050, 1050] })
    const p = h.generate()
    await vi.advanceTimersByTimeAsync(20000)
    expect(h.pendingGenerations.size).toBe(1)   // 전엔 15s 에 not-sent 로 닫혀 지워졌다
    expect([...h.pendingGenerations.values()][0]).toMatchObject({ completed: false, sendDeadlinePassed: true, doc: null })
    expect(h.trace.filter((x) => x === 'credits')).toHaveLength(2)
    const r = await settle(p, 120000)
    expect(r).toMatchObject({ success: false, errorKind: 'flow-submit-not-sent', error: 'flow-submit-not-sent', postClick: true })
    expect(h.trace.filter((x) => x === 'credits')).toHaveLength(3)
    // M2-R1 F4(d): 첫 재판독은 arm 직후가 아니라 send 마감(15s)이 울린 뒤; 마지막 재판독은 100s 마감 뒤(M2-R7 L1)
    expect(h.creditReadsAt[1] - h.creditReadsAt[0]).toBeGreaterThanOrEqual(15000)
    expect(h.creditReadsAt[2] - h.creditReadsAt[0]).toBeGreaterThanOrEqual(100000)
    expect(h.onDomFailure.mock.calls.some((c) => c[0] === 'submit:flow-submit-not-sent')).toBe(true)
    expect(h.pendingGenerations.size).toBe(0)
  })

  it('send 없이 15s + 크레딧 감소(1050→1040) → 유예 없이 즉시 flow-submit-lost 로 격상 + postClick(크레딧 두 번 — 100s 를 기다리지 않는다); 감소분은 로그 숫자로만(errorParams 없음)', async () => {
    const h = harness({ onSubmit: null, credits: [1050, 1040] })
    const r = await settle(h.generate(), 20000)
    expect(r).toMatchObject({ success: false, errorKind: 'flow-submit-lost', error: 'flow-submit-lost', postClick: true })
    expect(r).not.toHaveProperty('errorParams')
    expect(h.trace.filter((x) => x === 'credits')).toHaveLength(2)
    expect(logged()).toMatch(/credits (dropped|delta).*before=1050 after=1040/)
    expect(h.onDomFailure.mock.calls.some((c) => c[0] === 'submit:flow-submit-lost')).toBe(true)
    expect(h.pendingGenerations.size).toBe(0)
  })

  it('send 없이 100s + 15s 재판독은 불변(1050) · 100s 마감 뒤 마지막 재판독에서 감소(1040) → flow-submit-lost 로 격상 + postClick (M2-R7 L1)', async () => {
    const h = harness({ onSubmit: null, credits: [1050, 1050, 1040] })
    const r = await settle(h.generate(), 120000)
    expect(r).toMatchObject({ success: false, errorKind: 'flow-submit-lost', error: 'flow-submit-lost', postClick: true })
    expect(h.trace.filter((x) => x === 'credits')).toHaveLength(3)
    expect(logged()).toMatch(/credits dropped without a captured send before=1050 after=1040/)
    expect(h.onDomFailure.mock.calls.some((c) => c[0] === 'submit:flow-submit-lost')).toBe(true)
  })

  it('유예: 클릭 뒤 16s 의 send 가 바인딩되고 22s 의 loadend 로 {success:true, generationId} — 크레딧은 두 번(클릭 전 · 15s)만, submit: 보고 없음 (M2-R7 L1)', async () => {
    let clickedAt = 0
    const h = harness({ onSubmit: () => { clickedAt = Date.now() }, credits: [1050, 1050] })
    const p = h.generate()
    while (!clickedAt) await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(16000)
    expect(h.pendingGenerations.size).toBe(1)
    const gen = [...h.pendingGenerations.values()][0]
    expect(gen).toMatchObject({ completed: false, sendDeadlinePassed: true, doc: null })
    expect(h.trace.filter((x) => x === 'credits')).toHaveLength(2)
    h.page.send()
    expect(gen.doc).toBe(DOC)
    await vi.advanceTimersByTimeAsync(6000)
    h.page.loadend()
    const r = await settle(p)
    expect(r).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
    expect(h.trace.filter((x) => x === 'credits')).toHaveLength(2)
    expect(h.onDomFailure.mock.calls.filter((c) => String(c[0]).startsWith('submit:'))).toEqual([])
    expect(h.pendingGenerations.size).toBe(0)
    expect(logged()).toMatch(/\[Flow Video T2V\] \[Angular\] submitted media=00000011 creditsLeft=1040 modelKey=abra_t2v_6s/)
  })

  // M2-R8 M1(A1 = B1): onSendDeadline 의 `gen.doc != null` 가드 — 15s 재판독이 진행 중인 사이 늦은 send 가 바인딩되고 그 send 의 과금(1050→1040)이 재판독에 보이면, 가드가 없으면
  //   훅이 바인딩된 gen 을 lost 로 닫고 진짜 loadend 는 unbound 로 버려진다(과금된 영상이 id 없는 error 행 — 다음 Start 가 또 과금). 재판독 중 바인딩되면 loadend 가 판정한다.
  it('15s 재판독이 진행 중일 때 늦은 send 가 바인딩되면(gen.doc != null) 훅은 닫지 않는다 — 재판독이 1040 을 보여도 loadend 가 {success, creditsLeft:1040} 로 판정 (M2-R8 M1)', async () => {
    let resolveRead = null
    const deferred = new Promise((r) => { resolveRead = r })
    const h = harness({ onSubmit: null, credits: [1050, deferred] })
    const p = h.generate()
    while (h.trace.filter((x) => x === 'credits').length < 2) await vi.advanceTimersByTimeAsync(100)   // 15s 마감 → 훅의 재판독이 떠 있다(deferred)
    const gen = [...h.pendingGenerations.values()][0]
    expect(gen).toMatchObject({ completed: false, sendDeadlinePassed: true, doc: null })
    h.page.send()                                              // 재판독이 돌아오기 전에 늦은 send 가 바인딩된다
    expect(gen.doc).toBe(DOC)
    resolveRead({ status: 200, text: creditsBody(1040) })      // 그 send 의 과금이 보이는 재판독
    await vi.advanceTimersByTimeAsync(200)
    expect(gen.completed).toBe(false)                          // 가드: 바인딩된 gen 은 훅이 닫지 않는다
    h.page.loadend()
    const r = await settle(p)
    expect(r).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
    expect(h.onDomFailure.mock.calls.filter((c) => String(c[0]).startsWith('submit:'))).toEqual([])
    expect(h.pendingGenerations.size).toBe(0)
  })

  // M2-R8 M5(A5): 15s 재판독이 실패하면(null) "credits unchanged" 는 거짓이다 — "credits unreadable" 로 적는다(숫자 없음). 유예는 그대로.
  it('15s 재판독 실패(nzlxg HTTP 500) → "credits unreadable — waiting for a late send" 로그(숫자 없음, "unchanged" 아님), gen 은 유예 그대로 → 100s 에 not-sent (M2-R8 M5)', async () => {
    const h = harness({ onSubmit: null, credits: [1050, { status: 500, text: 'oops' }, 1050] })
    const p = h.generate()
    while (h.trace.filter((x) => x === 'credits').length < 2) await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(200)
    expect(logged()).toMatch(/\[Flow Video T2V\] \[Angular\] send deadline passed gen=\S+ credits unreadable — waiting for a late send/)
    expect(logged()).not.toMatch(/credits unchanged/)
    expect(logged()).not.toMatch(/credits unreadable[^\n]*\d/)
    expect([...h.pendingGenerations.values()][0]).toMatchObject({ completed: false, sendDeadlinePassed: true, doc: null })
    const r = await settle(p, 120000)
    expect(r).toMatchObject({ success: false, errorKind: 'flow-submit-not-sent', postClick: true })
    expect(h.trace.filter((x) => x === 'credits')).toHaveLength(3)
  })

  // M2-R8 M4(B2 + A4): 캡처는 문서마다 주입돼 사용자가 Flow 뷰에서 손으로 만든 영상의 YhhmEf 도 보고했다 — 거짓 "DOM step failed"(Sentry·바탕화면 파일·세션 슬롯)와 그 dedupe 로
  //   진짜 보고(앱이 lost 로 닫은 뒤의 과금 미디어)가 가려졌다. 앱이 최근(≤120s) loadend 없이 닫은 YhhmEf gen 이 있을 때만 보고, 아니면 로그만.
  it('바인딩 없는 YhhmEf loadend(UUID) — 최근 앱이 닫은 gen 없음(손 제출) → 로그만 "(no recent app close — not reported)", onDomFailure 없음 (M2-R8 M4)', async () => {
    const h = harness({ onSubmit: null })
    expect(h.page.loadend({ seq: 9 })).toEqual({ ok: true, dropped: 'unbound' })
    expect(logged()).toMatch(/\[Flow RPC\] YhhmEf unbound loadend media=00000011 \(no recent app close — not reported\)/)
    await vi.advanceTimersByTimeAsync(100)
    expect(h.onDomFailure.mock.calls.find((c) => c[0] === 'submit:unbound-loadend')).toBeUndefined()
    expect(logged()).not.toContain(UUID11)
  })

  it('앱이 15s 크레딧 감소로 lost 로 닫은 뒤(loadend 없음) 뒤늦은 미바인딩 loadend(UUID) → [Flow RPC] YhhmEf unbound loadend media=<8> + onDomFailure(submit:unbound-loadend, media 앞 8자) — 전체 id·프롬프트 없음 (M2-R7 L1 · M2-R8 M4)', async () => {
    const h = harness({ onSubmit: null, credits: [1050, 1040] })
    const r = await settle(h.generate(), 20000)
    expect(r).toMatchObject({ success: false, errorKind: 'flow-submit-lost' })
    expect(h.page.loadend({ seq: 9 })).toEqual({ ok: true, dropped: 'unbound' })
    expect(logged()).toMatch(/\[Flow RPC\] YhhmEf unbound loadend media=00000011\b/)
    expect(logged()).not.toMatch(/not reported/)
    await vi.advanceTimersByTimeAsync(100)
    const call = h.onDomFailure.mock.calls.find((c) => c[0] === 'submit:unbound-loadend')
    expect(call).toBeTruthy()
    expect(call[1]).toMatchObject({ reason: 'unbound-loadend', rpc: 'YhhmEf', seq: 9, media: '00000011' })
    const dumped = JSON.stringify(call[1]) + logged()
    expect(dumped).not.toContain(UUID11)
    expect(dumped).not.toContain(PROMPT)
  })

  it('send 뒤 loadend 없이 100s → flow-submit-lost + postClick', async () => {
    const h = harness({ onSubmit: (page) => { page.send() } })
    const r = await settle(h.generate(), 120000)
    expect(r).toMatchObject({ success: false, errorKind: 'flow-submit-lost', postClick: true })
  })

  it('커밋 네비게이션(failBoundUnfinished) → flow-submit-lost + postClick', async () => {
    const h = harness({ onSubmit: (_page, map) => { h.page.send(); expect(failBoundUnfinished(map)).toBe(1) } })
    const r = await settle(h.generate())
    expect(r).toMatchObject({ success: false, errorKind: 'flow-submit-lost', postClick: true })
  })

  // M2-R1 F4(b)(c) (A4/B5): mouseDown 이 나간 뒤의 클릭 실패(dispatched)는 페이지가 제출(과금)했을 수 있다 — gen 을 지우지 않고 waiter/마감
  //   경로로 간다. send 마감은 클릭이 **돌아온 뒤**에 arm(클릭은 뮤텍스 대기 포함 30s 까지 걸릴 수 있다). 클릭 중 이미 바인딩됐으면 재arm 없음.
  it('dispatched 클릭 실패 + 늦은 send/loadend(2s 뒤) → gen 이 바인딩돼 정상 결과; 늦은 send 없음 → 100s 뒤 flow-submit-not-sent + postClick + 크레딧 재판독(15s·100s)', async () => {
    const late = harness({ onSubmit: null, clickResult: { success: false, dispatched: true, error: 'View bounds changed mid-click' } })
    const pLate = late.generate()
    await vi.advanceTimersByTimeAsync(2000)
    expect(late.pendingGenerations.size).toBe(1)          // gen 은 아직 armed(지워지지 않았다)
    late.page.send(); late.page.loadend()
    const rLate = await settle(pLate, 20000)
    expect(rLate).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
    // M2-R7 L1: 늦은 send 없음 → 15s 재판독(불변) → 유예 → 100s 에 not-sent + 마지막 재판독(크레딧 세 번)
    const none = harness({ onSubmit: null, credits: [1050, 1050, 1050], clickResult: { success: false, dispatched: true, error: 'View bounds changed mid-click' } })
    const rNone = await settle(none.generate(), 120000)
    expect(rNone).toMatchObject({ success: false, errorKind: 'flow-submit-not-sent', error: 'flow-submit-not-sent', postClick: true })
    expect(none.trace.filter((x) => x === 'credits')).toHaveLength(3)
    expect(none.pendingGenerations.size).toBe(0)
  })

  it('느린 클릭(20s, 뮤텍스 대기) 뒤 25s 에 send 가 오면 여전히 바인딩된다 — send 마감은 클릭이 돌아온 뒤 15s', async () => {
    const h = harness({ onSubmit: async () => { await new Promise((r) => setTimeout(r, 20000)) } })
    const p = h.generate()
    await vi.advanceTimersByTimeAsync(25000)
    expect(h.pendingGenerations.size).toBe(1)
    h.page.send(); h.page.loadend()
    const r = await settle(p, 20000)
    expect(r).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
    expect(h.trace.filter((x) => x === 'credits')).toHaveLength(1)
  })

  it('클릭 전 크레딧 판독 실패(nzlxg HTTP 500) → 클릭 없이 중립 flow-rpc-error(rpcStatus) — postClick 없음(fail-closed)', async () => {
    const h = harness({ credits: [{ status: 500, text: 'oops' }] })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'flow-rpc-error', error: 'flow-rpc-error', rpcStatus: 500 })
    expect(h.trace).not.toContain('click:compose-submit')
    expect(h.trace).not.toContain('settings-driver')
    expect(isFlowAuthError(r)).toBe(false)
  })

  // M2-R1 F5(A5/B4): (a) nzlxg 모양이 바뀌어 크레딧이 숫자가 아니면(creditsBefore null) 클릭 전에 거부 — null 로 진행하면 not-sent→lost 격상이
  //   조용히 꺼진다(fail-closed 위반). (b) 읽기 RPC 의 code 8 은 중립 flow-rpc-error(rpcCode 필드) — 'RESOURCE_EXHAUSTED' 문구를 실으면 훅의
  //   quota 감지가 **읽기**에서 발화해 배치를 멈춘다(D5: 읽기 code 8 은 일시).
  it('크레딧 모양 드리프트(payload[0] 가 숫자 아님) → 클릭 전 flow-rpc-error, 로그 "credits read shape unexpected", postClick 없음', async () => {
    const h = harness({ credits: [{ status: 200, text: respBodyWithPayload('nzlxg', ['1050', 1, 2, 2, null, '1050']) }] })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'flow-rpc-error', error: 'flow-rpc-error' })
    expect(h.trace).not.toContain('click:compose-submit')
    expect(h.trace).not.toContain('settings-driver')
    expect(logged()).toMatch(/credits read shape unexpected/)
    expect(logged()).not.toMatch(/credits before=null/)
  })

  it('클릭 전 크레딧 판독의 실패 프레임 code 8 → 중립 {flow-rpc-error, rpcCode:8} — RESOURCE_EXHAUSTED 문구 없음(quota 감지 미발화), 클릭 없음', async () => {
    const h = harness({ credits: [{ status: 200, text: respBodyFailure('nzlxg', 8) }] })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'flow-rpc-error', error: 'flow-rpc-error', rpcCode: 8 })
    expect(isQuotaExhaustedError(r)).toBe(false)
    expect(isQuotaExhaustedError(r.error)).toBe(false)
    expect(h.trace).not.toContain('click:compose-submit')
  })
})

describe('flow:generate-video-t2v (angular) — 클릭 전 거부(postClick 없음, 제출 클릭 없음)', () => {
  it('accounts.google.com → flow-session-missing + authFailed, 페이지 스크립트 미실행', async () => {
    const h = harness({ url: 'https://accounts.google.com/v3/signin/identifier?continue=x' })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'flow-session-missing', error: 'not-on-flow', authFailed: true })
    expect(h.executeJavaScript).not.toHaveBeenCalled()
  })

  it('WIZ 없음 → flow-session-missing(wiz-missing) + authFailed', async () => {
    const h = harness({ wiz: false })
    expect(await settle(h.generate())).toEqual({ success: false, errorKind: 'flow-session-missing', error: 'wiz-missing', authFailed: true })
    expect(h.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('flowAgentOn → flow-agent-mode-unsupported; segments(@멘션 칩) → flow-mention-chips-unsupported (이중 방어, 에이전트 프로브 없음)', async () => {
    const a = harness({ flowAgentOn: true })
    expect(await settle(a.generate())).toMatchObject({ success: false, errorKind: 'flow-agent-mode-unsupported' })
    expect(a.trace).not.toContain('agent-probe')
    const b = harness()
    const r = await settle(b.generate({ segments: [{ type: 'mention', name: 'king', entityId: 'e1' }] }))
    expect(r).toMatchObject({ success: false, errorKind: 'flow-mention-chips-unsupported' })
    expect(r).not.toHaveProperty('postClick')
    expect(b.trace).not.toContain('agent-probe')
    expect(b.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it.each([
    ['still ON', [{ found: true, on: true }, { found: true, on: true }]],
    ['not_found', { found: false }],
    ['probe throws', 'throw'],
  ])('ensureAgentOff 실패(%s) → flow-agent-off-failed, 크레딧 판독·설정·클릭 없음', async (_l, agent) => {
    const h = harness({ agent })
    const r = await settle(h.generate(), 20000)
    expect(r).toMatchObject({ success: false, errorKind: 'flow-agent-off-failed' })
    expect(r).not.toHaveProperty('postClick')
    expect(h.trace).not.toContain('credits')
    expect(h.trace).not.toContain('click:compose-submit')
  })

  it('캡처 미설치 → flow-capture-not-installed(클릭 없음)', async () => {
    const h = harness({ captureFlag: [false, false] })
    expect(await settle(h.generate())).toMatchObject({ success: false, errorKind: 'flow-capture-not-installed' })
    expect(h.trace).toContain('capture-inject')
    expect(h.trace).not.toContain('click:compose-submit')
  })

  it('설정 실패(flow-resolution-not-offered {requested}) → params 포함, 클릭 없음, onDomFailure(settings:…) 내용 없음', async () => {
    const h = harness({ settings: { ok: false, kind: 'flow-resolution-not-offered', reason: 'resolution-not-offered:1080p', params: { requested: '1080p' }, steps: { mode: 'already(videocam)' } } })
    const r = await settle(h.generate({ resolution: '1080p' }))
    expect(r).toEqual({ success: false, errorKind: 'flow-resolution-not-offered', error: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } })
    expect(h.trace).not.toContain('click:compose-submit')
    // M2-R1 F11(b)(A11/B2): 요청 해상도가 드라이버까지 그대로 간다 — 핸들러가 720p 로 다운그레이드하면 과금되는 720p 영상이 조용히 나온다.
    expect(h.targets().resolution).toBe('1080p')
    const call = h.onDomFailure.mock.calls.find((c) => String(c[0]).startsWith('settings:'))
    expect(call).toBeTruthy()
    expect(JSON.stringify(call[1])).not.toContain(PROMPT)
  })

  // M2-R1 F11(a)(A11/B2): 해상도 미지정/무효는 렌더러 배관 결함 — 720p 기본값을 주면 1080p 요청이 720p 로 과금된다. 클릭 전 거부.
  it.each([[undefined], [''], [null]])('resolution=%s → 클릭 전 flow-settings-not-applied(720p 기본값 없음), 로그 "resolution missing", 설정 드라이버·클릭 없음', async (resolution) => {
    const h = harness()
    const r = await settle(h.generate({ resolution }))
    // M2-R2 G4(B2): F11 거부도 드라이버 reason 과 같은 자리에 'resolution-missing' — 훅의 F8 서명이 배치 전체 이유로 안다.
    expect(r).toEqual({ success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason: 'resolution-missing' })
    expect(h.trace).not.toContain('settings-driver')
    expect(h.trace).not.toContain('click:compose-submit')
    expect(h.targets()).toBeNull()
    expect(logged()).toMatch(/resolution missing/)
  })

  // M2-R2 G4(B2): flow-settings-not-applied 는 params 가 {} 라 F8 서명(kind+params)이 항상 같다 — 드라이버 reason 을 **params 가 아닌** 필드 reason 으로 실어
  //   훅이 배치 전체 이유(model-/ratio-not-offered·input-mode·submenu·menu-not-open·resolution-missing)만 종결하게 한다. 렌더되지 않는다(errorParams 없음).
  it('설정 실패(flow-settings-not-applied, input-mode-not-material) → 클릭 없음, reason 필드(errorParams 없음)', async () => {
    const h = harness({ settings: { ok: false, kind: 'flow-settings-not-applied', reason: 'input-mode-not-material', steps: {} } })
    expect(await settle(h.generate())).toEqual({ success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason: 'input-mode-not-material' })
    expect(h.trace).not.toContain('click:compose-submit')
    const d = harness({ settings: { ok: false, reason: 'duration-not-offered:10', steps: {} } })
    expect(await settle(d.generate())).toEqual({ success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason: 'duration-not-offered:10' })
  })

  it('편집기 불일치 → text-injection-failed; 제출 버튼 비활성 → generate-button-unavailable; 클릭 실패 → generate-button-click-failed(맵 비움)', async () => {
    expect(await settle(harness({ editorText: '다른 텍스트' }).generate())).toMatchObject({ success: false, errorKind: 'text-injection-failed' })
    expect(await settle(harness({ submitEnabled: false }).generate())).toMatchObject({ success: false, errorKind: 'generate-button-unavailable' })
    const h = harness({ onSubmit: null })
    h.trustedClickOnFlowView.mockImplementation(async (_sel, opts) => { h.trace.push('click:' + (opts?.step || '?')); return { success: opts?.step !== 'compose-submit' } })
    const r = await settle(h.generate())
    expect(r).toMatchObject({ success: false, errorKind: 'generate-button-click-failed' })
    expect(r).not.toHaveProperty('postClick')
    expect(h.pendingGenerations.size).toBe(0)
    expect(h.trace.filter((x) => x === 'credits')).toHaveLength(1)   // M2-R1 F4: 미발송 실패는 마감·재판독 경로를 타지 않는다
  })

  it('API 모드 → Flow inactive (뷰 미접근)', async () => {
    const h = harness({ mode: 'api' })
    expect(await settle(h.generate())).toEqual({ success: false, error: 'Flow inactive (API mode)' })
    expect(h.executeJavaScript).not.toHaveBeenCalled()
  })
})

describe('설정 실패의 shape 진단은 onDomFailure 로 간다 (M2 실기)', () => {
  it('group-not-found:duration + shape → 결과는 그대로, onDomFailure(settings:group-not-found:duration) 의 extra 에 shape', async () => {
    const shape = { groups: ['mode', 'ratio', 'resolution', 'count'], unclassified: [{ labels: ['4초 · 오디오 포함'], ligatures: [] }] }
    const h = harness({ settings: { ok: false, kind: 'flow-settings-not-applied', reason: 'group-not-found:duration', steps: { mode: 'already(videocam)' }, shape, closed: true } })
    const r = await settle(h.generate())
    expect(r).toMatchObject({ success: false, errorKind: 'flow-settings-not-applied', reason: 'group-not-found:duration' })
    const call = h.onDomFailure.mock.calls.find((c) => c[0] === 'settings:group-not-found:duration')
    expect(call).toBeTruthy()
    expect(JSON.stringify(call)).toContain('오디오 포함')
  })
})

// M2-LIVE N1(A1/B6/A8): 제자리 자동화 뷰포트는 DOM 단계 내내 Flow 뷰(네이티브)를 앱 위에 둔다 — 사용자의 클릭이 컴포저·제출 화살표·설정 라디오에 닿으면
//   과금·고아·잘못된 설정이 된다. 뷰포트를 키운 동안 **최상위 투명 방패 뷰**(deps.createInputShield)가 포인터 입력을 삼키고(신뢰 클릭은 sendInputEvent 라 OS 히트테스트를
//   거치지 않는다), 같은 finally 에서 레이아웃 복원 전에 제거된다(정상·조기 반환·throw·워치독 전부). 드래그 중 진입은 드래그 끝을 ≤5s 기다리고, 그래도면 클릭 전 layout-dragging.
//   워치독: DOM 단계 120s — 제출 클릭 전이면 같은 finally 를 지나 dom-stage-timeout(클릭 없음), 클릭이 이미 나갔으면 기존 post-click 경로.
describe('flow:generate-video-t2v (angular) — 제자리 뷰포트의 입력 방패 · 드래그 대기 · 워치독 (M2-LIVE N1)', () => {
  const NARROW = { x: 0, y: 0, width: 597, height: 872 }
  const at = (t, tag) => t.findIndex((x) => x === tag)

  it('좁은 뷰: 방패는 제자리 확장 직후·에이전트 프로브 전에 생기고, 제출 클릭 뒤 레이아웃 복원 전에 제거된다 — 포커스 반환은 그 뒤', async () => {
    const h = harness({ bounds: NARROW })
    const r = await settle(h.generate())
    expect(r.success).toBe(true)
    const t = h.trace
    expect(h.createInputShield).toHaveBeenCalledTimes(1)
    const enlarge = t.findIndex((x) => /^bounds:\d+x\d+$/.test(x))
    expect(enlarge).toBeGreaterThanOrEqual(0)
    expect(at(t, 'shield:on')).toBeGreaterThan(enlarge)
    expect(at(t, 'shield:on')).toBeLessThan(idx(t, 'agent-probe'))
    const restore = t.map((x, i) => [x, i]).filter(([x]) => x.startsWith('bounds:')).at(-1)[1]
    expect(at(t, 'shield:off')).toBeGreaterThan(idx(t, 'click:compose-submit'))
    expect(at(t, 'shield:off')).toBeLessThan(restore)
    expect(restore).toBeLessThan(t.lastIndexOf('main-focus'))   // M2-LAST P2: 첫 main-focus 는 클릭 전(재판독 뒤) — finally 의 반환은 마지막
  })

  it('넓은 보이는 뷰(957×1022)는 뷰포트도 방패도 없다', async () => {
    const h = harness()
    expect((await settle(h.generate())).success).toBe(true)
    expect(h.createInputShield).not.toHaveBeenCalled()
    expect(h.trace).not.toContain('shield:on')
  })

  it('조기 반환(설정 실패, 클릭 전)에도 방패를 제거한다', async () => {
    const h = harness({ bounds: NARROW, settings: { ok: false, kind: 'flow-settings-not-applied', reason: 'input-mode-not-material', steps: {} } })
    const r = await settle(h.generate())
    expect(r).toMatchObject({ success: false, errorKind: 'flow-settings-not-applied', reason: 'input-mode-not-material' })
    expect(h.trace).not.toContain('click:compose-submit')
    expect(at(h.trace, 'shield:on')).toBeGreaterThanOrEqual(0)
    expect(at(h.trace, 'shield:off')).toBeGreaterThan(at(h.trace, 'shield:on'))
    expect(h.flowView.getBounds()).toEqual({ x: 0, y: 0, width: 637, height: 800 })   // 레이아웃(split-left 0.5)으로 복원
  })

  it('DOM 단계가 throw 해도(편집기 신뢰 클릭 reject) 방패를 제거하고 레이아웃을 복원한다', async () => {
    const h = harness({ bounds: NARROW })
    h.trustedClickOnFlowView.mockImplementation(async (_sel, opts) => { h.trace.push('click:' + (opts?.step || '?')); if (opts?.step === 'compose-editor') throw new Error('boom'); return { success: true } })
    let err = null
    const r = await settle(h.generate().catch((e) => { err = e; return 'threw' }))
    expect(r).toBe('threw')
    expect(err?.message).toBe('boom')
    expect(at(h.trace, 'shield:off')).toBeGreaterThan(at(h.trace, 'shield:on'))
    expect(h.flowView.getBounds()).toEqual({ x: 0, y: 0, width: 637, height: 800 })
    expect(h.trace).not.toContain('click:compose-submit')
  })

  it('드래그 중 진입: 드래그가 끝날 때까지(≤5s) 확장·프로브를 미루고, 끝나면 정상 진행', async () => {
    setLayoutDragging(true)
    try {
      const h = harness({ hidden: true })   // 드래그 중엔 레이아웃이 뷰를 0×0 으로 접어 둔다
      const p = h.generate()
      await vi.advanceTimersByTimeAsync(1500)
      expect(h.flowView.setBounds).not.toHaveBeenCalled()
      expect(h.trace).not.toContain('agent-probe')
      expect(h.trace).not.toContain('shield:on')
      setLayoutDragging(false)
      const r = await settle(p)
      expect(r).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
      expect(at(h.trace, 'shield:on')).toBeLessThan(idx(h.trace, 'agent-probe'))
    } finally { setLayoutDragging(false) }
  })

  it('5s 가 지나도 드래그 중이면 클릭 전 flow-settings-not-applied(reason layout-dragging) — bounds·방패·크레딧·클릭 없음', async () => {
    setLayoutDragging(true)
    try {
      const h = harness({ hidden: true })
      const r = await settle(h.generate(), 10000)
      expect(r).toEqual({ success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason: 'layout-dragging' })
      expect(h.flowView.setBounds).not.toHaveBeenCalled()
      expect(h.createInputShield).not.toHaveBeenCalled()
      expect(h.trace).not.toContain('credits')
      expect(h.trace).not.toContain('click:compose-submit')
      expect(h.pendingGenerations.size).toBe(0)
      expect(logged()).toMatch(/layout still dragging/)
      expect(h.setAutomationKeyLock).not.toHaveBeenCalled()   // M2-LAST P4(A3): 거부 경로는 키 잠금을 건드리지 않는다
    } finally { setLayoutDragging(false) }
  })

  it('워치독: DOM 단계(설정 드라이버)가 매달리면 120s 에 같은 finally 로 방패 제거·레이아웃 복원 후 클릭 전 dom-stage-timeout', async () => {
    const h = harness({ bounds: NARROW, settings: new Promise(() => {}) })   // 드라이버가 영영 settle 하지 않는다(먹통 렌더러)
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

  it('워치독 뒤 살아난 좀비(드라이버가 121s 에 돌아옴)는 arm·제출 클릭을 하지 않는다 — 결과는 dom-stage-timeout 그대로', async () => {
    let resolveDriver
    const h = harness({ bounds: NARROW, settings: new Promise((r) => { resolveDriver = r }) })
    const p = h.generate()
    await vi.advanceTimersByTimeAsync(121000)
    const r = await settle(p, 1000)
    expect(r).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    resolveDriver({ ok: true, closed: true, steps: { mode: 'already(videocam)', ratio: 'already(crop_16_9)', duration: 'already(6)', resolution: 'already(720p)', count: 'already(x1)', model: 'already', input: 'material' } })
    await vi.advanceTimersByTimeAsync(10000)
    expect(h.trace).not.toContain('click:compose-editor')
    expect(h.trace).not.toContain('click:compose-submit')
    expect(h.pendingGenerations.size).toBe(0)
    expect(h.trace.filter((x) => x === 'shield:off')).toHaveLength(1)
  })

  it('워치독: 제출 클릭이 이미 나간 뒤(클릭 125s)에 120s 가 지나면 timeout 결과가 아니라 기존 post-click 경로(늦은 loadend → success)', async () => {
    const h = harness({ bounds: NARROW, onSubmit: async (page) => { await new Promise((r) => setTimeout(r, 125000)); page.send(); page.loadend() }, credits: [1050, 1050] })
    const r = await settle(h.generate(), 140000)
    expect(r).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
    expect(logged()).not.toMatch(/dom-stage-timeout|DOM stage timed out/)
    expect(at(h.trace, 'shield:off')).toBeGreaterThan(idx(h.trace, 'click:compose-submit'))
  })
})

// M2-CLOSE O1(A1): 방패는 포인터만 막았다 — 편집기 단계가 Flow 뷰에 OS 포커스를 주므로(넓은 뷰든 제자리든) DOM 단계 동안 사용자의 타이핑이 프롬프트에 붙고 Enter 가 제출했다.
//   main 의 before-input-event 잠금(deps.setAutomationKeyLock)을 래퍼 진입에 켜고 같은 finally 에서 끈다(정상·조기 반환·throw·워치독 전부). 그리고 클릭 전에 이미 send 가
//   바인딩됐거나 완료된 gen(사용자의 Enter 가 제출한 경우)은 미디스패치 클릭 실패로 지우지 않고 post-click 경로로 판정한다 — 과금된 영상을 버리지 않는다.
describe('flow:generate-video-t2v (angular) — DOM 단계의 키 입력 잠금 · 바인딩된 gen 의 클릭 실패 (M2-CLOSE O1)', () => {
  const NARROW = { x: 0, y: 0, width: 597, height: 872 }
  const at = (t, tag) => t.findIndex((x) => x === tag)
  const count = (t, tag) => t.filter((x) => x === tag).length

  it('좁은 뷰: 잠금은 진입(에이전트 프로브 전)에 켜지고 제출 클릭 뒤 finally 에서 한 번 꺼진다', async () => {
    const h = harness({ bounds: NARROW })
    expect((await settle(h.generate())).success).toBe(true)
    const t = h.trace
    expect(count(t, 'keylock:on')).toBe(1)
    expect(count(t, 'keylock:off')).toBe(1)
    expect(at(t, 'keylock:on')).toBeLessThan(idx(t, 'agent-probe'))
    expect(at(t, 'keylock:off')).toBeGreaterThan(idx(t, 'click:compose-submit'))
    expect(h.setAutomationKeyLock.mock.calls).toEqual([[true], [false]])
  })

  it('넓은 보이는 뷰(957×1022)도 잠근다 — 방패는 없어도 편집기가 OS 포커스를 받는다', async () => {
    const h = harness()
    expect((await settle(h.generate())).success).toBe(true)
    expect(h.trace).not.toContain('shield:on')
    expect(at(h.trace, 'keylock:on')).toBeLessThan(idx(h.trace, 'agent-probe'))
    expect(at(h.trace, 'keylock:off')).toBeGreaterThan(idx(h.trace, 'click:compose-submit'))
    expect(h.setAutomationKeyLock.mock.calls).toEqual([[true], [false]])
  })

  it('조기 반환(설정 실패)·throw(편집기 클릭 reject)·워치독(120s) 전부 잠금을 정확히 한 번 푼다 — 워치독은 방패 제거 뒤', async () => {
    const early = harness({ bounds: NARROW, settings: { ok: false, kind: 'flow-settings-not-applied', reason: 'input-mode-not-material', steps: {} } })
    expect((await settle(early.generate())).reason).toBe('input-mode-not-material')
    expect(early.setAutomationKeyLock.mock.calls).toEqual([[true], [false]])
    const thrown = harness({ bounds: NARROW })
    thrown.trustedClickOnFlowView.mockImplementation(async (_sel, opts) => { thrown.trace.push('click:' + (opts?.step || '?')); if (opts?.step === 'compose-editor') throw new Error('boom'); return { success: true } })
    expect(await settle(thrown.generate().catch(() => 'threw'))).toBe('threw')
    expect(thrown.setAutomationKeyLock.mock.calls).toEqual([[true], [false]])
    const hung = harness({ bounds: NARROW, settings: new Promise(() => {}) })
    const p = hung.generate()
    await vi.advanceTimersByTimeAsync(119000)
    expect(hung.trace).toContain('keylock:on')
    expect(hung.trace).not.toContain('keylock:off')
    expect((await settle(p, 5000)).reason).toBe('dom-stage-timeout')
    expect(hung.setAutomationKeyLock.mock.calls).toEqual([[true], [false]])
    expect(at(hung.trace, 'keylock:off')).toBeGreaterThan(at(hung.trace, 'shield:off'))
  })

  it('클릭 전에 페이지가 이미 제출해 send 가 바인딩된 gen(사용자의 Enter) → 제출 클릭이 disabled 버튼을 미디스패치로 거부해도 gen 을 지우지 않고 loadend 로 success(postClick 없음)', async () => {
    const h = harness({ onSubmit: (page) => { page.send(); setTimeout(() => page.loadend(), 2000) }, clickResult: { success: false, error: 'Target not at point (disabled)' } })
    const r = await settle(h.generate(), 10000)
    expect(r).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
    expect(h.pendingGenerations.size).toBe(0)
    expect(logged()).toMatch(/click refused but the gen is already bound or completed gen=\S{8} — keeping it/)
    // 클릭 중 완료까지 된 gen(send+loadend) 도 같다
    const done = harness({ clickResult: { success: false, error: 'Target not at point (disabled)' } })
    expect(await settle(done.generate())).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
    // 바인딩도 완료도 없는 미디스패치 실패는 그대로 generate-button-click-failed(gen 삭제)
    const none = harness({ onSubmit: null, clickResult: { success: false, error: 'Target not at point (other)' } })
    expect(await settle(none.generate())).toMatchObject({ success: false, errorKind: 'generate-button-click-failed' })
    expect(none.pendingGenerations.size).toBe(0)
  })
})

// M2-CLOSE O2(A2): 워치독이 버린 좀비가 페이지를 계속 만지면 다음 항목의 DOM 단계와 겹친다(A 의 길이 클릭이 B 의 최종 재판독 뒤에 떨어지면 B 가 A 의 길이로 과금·거부).
//   (1) 새 단계는 직전 단계의 run 이 settle 할 때까지 ≤10s 기다리고, 그래도 살아 있으면 클릭 전 dom-stage-busy(항목 이유). (2) 좀비의 applyComposerSettings·ensureAgentOff 는
//   isAborted 를 신뢰 클릭·드라이버 exec 마다 먼저 보고 더 이상 페이지를 만지지 않는다.
describe('flow:generate-video-t2v (angular) — DOM 단계 직렬화 · 좀비의 클릭 차단 (M2-CLOSE O2)', () => {
  const NARROW = { x: 0, y: 0, width: 597, height: 872 }
  const count = (t, tag) => t.filter((x) => x === tag).length
  const OK_SETTINGS = { ok: true, closed: true, steps: { mode: 'already(videocam)', ratio: 'already(crop_16_9)', duration: 'already(6)', resolution: 'already(720p)', count: 'already(x1)', model: 'already', input: 'material' } }

  it('직전 단계의 좀비가 살아 있으면(드라이버 영영 미해결) 다음 항목은 10s 기다린 뒤 클릭 전 dom-stage-busy — bounds·방패·프로브·크레딧 없음', async () => {
    const h = harness({ bounds: NARROW, settings: new Promise(() => {}) })
    expect(await settle(h.generate(), 125000)).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    const setBoundsCalls = h.flowView.setBounds.mock.calls.length
    const p2 = h.generate()
    await vi.advanceTimersByTimeAsync(9000)
    expect(count(h.trace, 'wiz')).toBe(2)          // 세션 게이트는 지났고
    expect(count(h.trace, 'agent-probe')).toBe(1)  // 아직 DOM 단계에 들어가지 않았다
    const r2 = await settle(p2, 5000)
    expect(r2).toEqual({ success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason: 'dom-stage-busy' })
    expect(count(h.trace, 'agent-probe')).toBe(1)
    expect(count(h.trace, 'shield:on')).toBe(1)
    expect(count(h.trace, 'credits')).toBe(1)
    expect(h.flowView.setBounds.mock.calls.length).toBe(setBoundsCalls)
    expect(h.trace).not.toContain('click:compose-submit')
    expect(logged()).toMatch(/DOM stage still busy after 10s → refusing before click/)
    expect(h.setAutomationKeyLock.mock.calls).toEqual([[true], [false]])   // M2-LAST P4(A3): 첫 항목의 on/off 뿐 — 거부된 항목은 잠금을 건드리지 않는다
  })

  it('직전 단계의 좀비가 대기 중에 settle 하면(드라이버가 123s 에 돌아와 체크포인트에서 멈춤) 다음 항목은 기다렸다가 진행해 success', async () => {
    let resolveDriver
    const h = harness({ bounds: NARROW, settings: new Promise((r) => { resolveDriver = r }) })
    expect(await settle(h.generate(), 125000)).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    const p2 = h.generate()
    await vi.advanceTimersByTimeAsync(3000)
    expect(count(h.trace, 'agent-probe')).toBe(1)
    resolveDriver(OK_SETTINGS)   // 좀비가 돌아와 편집기 전 체크포인트에서 멈춘다 → run settle
    const r2 = await settle(p2, 20000)
    expect(r2).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
    expect(count(h.trace, 'agent-probe')).toBe(2)
    expect(count(h.trace, 'click:compose-submit')).toBe(1)
    expect(count(h.trace, 'click:compose-editor')).toBe(1)   // 좀비는 편집기를 누르지 않았다
    expect(logged()).not.toMatch(/still busy/)
  })

  it('설정 단계의 좀비(드라이버가 121s 에 needs-trusted 로 돌아옴)는 라디오 신뢰 클릭·드라이버 재실행·닫기 클릭을 내지 않는다', async () => {
    const h = harness({ bounds: NARROW, settings: new Promise((r) => setTimeout(() => r({ ok: false, needsTrusted: [{ group: 'duration', name: 'mat-button-toggle-group-32', label: '8초' }], steps: {} }), 121000)) })
    expect(await settle(h.generate(), 125000)).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    await vi.advanceTimersByTimeAsync(10000)
    expect(h.trace).not.toContain('click:settings-radio')
    expect(h.trace).not.toContain('click:settings-trigger-close')
    expect(count(h.trace, 'settings-driver')).toBe(1)
    expect(h.trace).not.toContain('click:compose-editor')
    expect(h.pendingGenerations.size).toBe(0)
    expect(logged()).toMatch(/\[Flow Settings\] video aborted by the DOM-stage watchdog — no further clicks or driver runs/)
  })

  it('에이전트 단계의 좀비(프로브가 121s 에 ON 으로 돌아옴)는 토글 신뢰 클릭을 내지 않는다 — 캡처 프로브로도 가지 않는다', async () => {
    const h = harness({ bounds: NARROW, agent: new Promise((r) => setTimeout(() => r({ found: true, on: true }), 121000)) })
    expect(await settle(h.generate(), 125000)).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    await vi.advanceTimersByTimeAsync(10000)
    expect(h.trace).not.toContain('click:agent-toggle-click')
    expect(h.trace).not.toContain('capture-probe')
    expect(logged()).toMatch(/ensureAgentOff: aborted by the DOM-stage watchdog — no toggle click/)
  })
})

// M2-CLOSE O3(A3/B2): 옛 좀비 핀은 드라이버를 121s 에 풀어 편집기 **전** 체크포인트에서 멈췄다 — arm 앞의 체크포인트(편집기 단계에서 워치독이 울린 경우의 유일한 방벽)는 지워도
//   초록이었다. 편집기 단계(SUBMIT_ENABLED_PROBE·재판독 — 타임아웃 없는 executeJavaScript)에 매달렸다 풀린 좀비가 arm·제출하면 행은 이미 dom-stage-timeout 인데 과금된다.
describe('flow:generate-video-t2v (angular) — 편집기 단계에서 워치독이 울린 좀비는 arm·제출하지 않는다 (M2-CLOSE O3)', () => {
  const NARROW = { x: 0, y: 0, width: 597, height: 872 }
  it.each([
    ['SUBMIT_ENABLED_PROBE', () => ({ submitEnabled: new Promise((res) => setTimeout(() => res(true), 121000)) })],
    ['편집기 재판독(READ_EDITOR_TEXT_JS)', () => ({ editorText: new Promise((res) => setTimeout(() => res(PROMPT), 121000)) })],
  ])('%s 에 매달렸다 121s 에 풀린 좀비 → arm 없음·click:compose-submit 없음·맵 0·shield:off 1회, 결과는 dom-stage-timeout', async (_n, mk) => {
    const h = harness({ bounds: NARROW, ...mk() })
    const r = await settle(h.generate(), 125000)
    expect(r).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    await vi.advanceTimersByTimeAsync(10000)
    expect(h.trace).toContain('click:compose-editor')   // 좀비는 편집기까지 갔다(워치독은 그 뒤에 울렸다)
    expect(h.trace).not.toContain('click:compose-submit')
    expect(h.trace.filter((x) => x.startsWith('armed:'))).toEqual([])
    expect(h.pendingGenerations.size).toBe(0)
    expect(h.trace.filter((x) => x === 'shield:off')).toHaveLength(1)
  })

  // 나머지 두 체크포인트(설정 전 · 편집기 전)도 그 **직전**의 exec 에 매달린 좀비로 핀 — 드라이버 안에서 풀린 좀비는 O2 의 isAborted 가드가 먼저 자르므로 체크포인트를 못 본다.
  const SUMMARY = { text: '동영상 · 720p · 6초 x1', ligatures: ['crop_16_9'] }
  it.each([
    ['크레딧 판독 nzlxg(설정 전 체크포인트)', () => ({ credits: [new Promise((r) => setTimeout(() => r({ status: 200, text: creditsBody(1050) }), 121000))] }), ['settings-driver', 'focus', 'click:compose-editor', 'click:compose-submit']],
    ['닫힌 요약 재판독(편집기 전 체크포인트)', () => ({ summary: [SUMMARY, new Promise((r) => setTimeout(() => r(SUMMARY), 121000))] }), ['focus', 'click:compose-editor', 'click:compose-submit']],
  ])('%s 에 매달렸다 121s 에 풀린 좀비 → 그 뒤 단계 없음·좀비의 settings 진단 보고 없음·맵 0·shield:off 1회', async (_n, mk, absent) => {
    const h = harness({ bounds: NARROW, ...mk() })
    expect(await settle(h.generate(), 125000)).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    await vi.advanceTimersByTimeAsync(10000)
    for (const tag of absent) expect(h.trace, tag).not.toContain(tag)
    if (absent.includes('settings-driver')) expect(h.onDomFailure.mock.calls.map((c) => c[0])).not.toContain('settings:dom-stage-aborted')
    expect(h.pendingGenerations.size).toBe(0)
    expect(h.trace.filter((x) => x === 'shield:off')).toHaveLength(1)
  })
})

// M2-CLOSE O5(A5): 캐럿 클릭 뒤 주입 전에 사용자의 방패 클릭이 OS 포커스를 가져갈 수 있다 — 주입 exec 직전에 flowView.webContents.focus() 를 다시 건다.
describe('flow:generate-video-t2v (angular) — 주입 직전 포커스 재확보 (M2-CLOSE O5)', () => {
  it('SET_EDITOR_TEXT_JS 바로 앞의 trace 는 focus 다(편집기 클릭 뒤 두 번째 focus) — 좁은 뷰·넓은 뷰 둘 다', async () => {
    for (const o of [{ bounds: { x: 0, y: 0, width: 597, height: 872 } }, {}]) {
      const h = harness(o)
      expect((await settle(h.generate())).success).toBe(true)
      const t = h.trace
      const inject = t.indexOf('set-text:visible')
      expect(inject).toBeGreaterThan(0)
      expect(t[inject - 1]).toBe('focus')
      expect(t.filter((x) => x === 'focus')).toHaveLength(2)
      expect(idx(t, 'focus')).toBeLessThan(idx(t, 'click:compose-editor'))   // 첫 focus 는 여전히 캐럿 클릭 전
      expect(t.lastIndexOf('focus')).toBeGreaterThan(idx(t, 'click:compose-editor'))
    }
  })
})

// M2-LAST P1(A1 = B1): lastDomStage 는 좀비의 run 이 settle 할 때만 비워졌다 — 문서가 죽으면(내비게이션 커밋·렌더러 크래시) 그 문서의 executeJavaScript 는 영영 settle 하지
//   않아(리뷰어 B 의 Electron 36.9.5 실측: loadURL·크래시를 가로지른 exec 는 pending 그대로) 워치독 뒤의 좀비가 프로세스가 끝날 때까지 모든 이미지·영상 항목을 10s 대기 →
//   dom-stage-busy 로 거부했다. main 의 did-navigate·render-process-gone 이 releaseDomStage(reason) 로 비우고(배선은 mainInputShieldWiring 핀), 문서 이벤트를 못 본 경우의
//   백스톱으로 워치독이 5분 넘게 전에 울린 좀비는 busy 검사에서 버린다. 같은 문서에서 아직 살아 있는 좀비의 10s 거부는 그대로(O2 핀).
describe('flow:generate-video-t2v (angular) — 문서가 죽으면 DOM 단계 직렬화를 푼다 (M2-LAST P1)', () => {
  const NARROW = { x: 0, y: 0, width: 597, height: 872 }
  const count = (t, tag) => t.filter((x) => x === tag).length

  it('영영 미해결 좀비 → releaseDomStage("did-navigate")(내비게이션 모사) → 다음 항목은 기다리지 않고 진행해 success; 로그 "DOM stage released (did-navigate)"; 살아 있는 단계가 없으면 false·로그 없음', async () => {
    const h = harness({ bounds: NARROW, settings: [new Promise(() => {}), undefined] })   // 첫 항목의 드라이버만 영영 매달린다(좀비) — 다음 항목은 기본값
    expect(await settle(h.generate(), 125000)).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    expect(releaseDomStage('did-navigate')).toBe(true)
    expect(logged()).toMatch(/\[Flow API\] DOM stage released \(did-navigate\)/)
    const r2 = await settle(h.generate(), 15000)   // 예산 15s — 풀리지 않았으면 10s 뒤 dom-stage-busy 가 돌아와 아래 단언이 빨갛다(5s 예산이면 매달린다)
    expect(r2).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
    expect(count(h.trace, 'agent-probe')).toBe(2)
    expect(count(h.trace, 'click:compose-submit')).toBe(1)
    expect(logged()).not.toMatch(/still busy/)
    // 직전 단계가 이미 settle 했으면(정상 항목 뒤의 내비게이션) 풀 것이 없다 — false, 로그 없음(프로젝트 열기마다 잡음이 되지 않게)
    expect(releaseDomStage('render-process-gone')).toBe(false)
    expect(logged()).not.toMatch(/released \(render-process-gone\)/)
  })

  it('영영 미해결 좀비: 워치독 뒤 4분엔 아직 dom-stage-busy(10s 대기) · 5분 1초엔 "stale zombie dropped" 로 버리고 다음 항목이 진행해 success', async () => {
    const h = harness({ bounds: NARROW, settings: [new Promise(() => {}), undefined] })
    expect(await settle(h.generate(), 125000)).toMatchObject({ success: false, reason: 'dom-stage-timeout' })
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    expect(await settle(h.generate(), 15000)).toMatchObject({ success: false, reason: 'dom-stage-busy' })
    expect(logged()).not.toMatch(/stale zombie dropped/)
    await vi.advanceTimersByTimeAsync(51 * 1000)   // 워치독으로부터 4분 + 10s(대기) + 51s = 5분 1초
    const r3 = await settle(h.generate(), 15000)   // 예산 15s — 백스톱이 없으면 10s 뒤 dom-stage-busy 가 돌아와 아래 단언이 빨갛다(5s 예산이면 매달린다)
    expect(r3).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
    expect(logged()).toMatch(/stale zombie dropped/)
    expect(count(h.trace, 'agent-probe')).toBe(2)
    expect(count(h.trace, 'click:compose-submit')).toBe(1)
  })
})

// M2-LAST P2(B2): O1 의 before-input-event 잠금은 PreHandleKeyboardEvent 를 지나는 키만 막는다 — 입력기(macOS 2벌식 한글)가 처리한 keydown 은 그 단계를 건너뛰고 조합 텍스트가
//   ImeSetComposition/ImeCommitText 로 들어와 포커스된 Flow 편집기에 붙는다(재판독~제출 mouseDown 사이 ≈150–300ms 의 음절이 프롬프트가 돼 과금). 재판독이 맞은 즉시 OS 포커스를
//   메인 창으로 옮기고(제출 신뢰 클릭은 sendInputEvent 라 포커스가 필요 없다), 제출 클릭 직전에 편집기를 한 번 더 읽어 달라졌으면 클릭·arm 없이 클릭 전 실패로 닫는다.
describe('flow:generate-video-t2v (angular) — 클릭 전 OS 포커스 반환 · 제출 직전 재판독 (M2-LAST P2)', () => {
  const NARROW = { x: 0, y: 0, width: 597, height: 872 }
  const count = (t, tag) => t.filter((x) => x === tag).length

  it('재판독이 맞으면 제출 가능 프로브 **전에** 메인 창에 포커스를 준다(read-text < main-focus < submit-enabled); 제출 클릭 바로 앞은 두 번째 read-text — 좁은 뷰·넓은 뷰 둘 다', async () => {
    for (const o of [{ bounds: NARROW }, {}]) {
      const h = harness(o)
      expect(await settle(h.generate())).toEqual({ success: true, generationId: UUID11, creditsLeft: 1040 })
      const t = h.trace
      expect(idx(t, 'read-text')).toBeLessThan(idx(t, 'main-focus'))
      expect(idx(t, 'main-focus')).toBeLessThan(idx(t, 'submit-enabled'))
      expect(count(t, 'read-text')).toBe(2)
      expect(t[idx(t, 'click:compose-submit') - 1]).toBe('read-text')
      expect(t.lastIndexOf('main-focus')).toBeGreaterThan(idx(t, 'click:compose-submit'))   // finally 의 반환은 그대로
      expect(count(t, 'main-focus')).toBe(2)
    }
  })

  it('재판독 뒤·클릭 전에 편집기 텍스트가 달라지면(조합 음절) 제출 클릭·arm 없이 클릭 전 text-injection-failed(reason editor-changed-before-click) — 맵 0·postClick 없음·보고 내용 없음', async () => {
    const h = harness({ editorText: [PROMPT, PROMPT + '한'] })
    const r = await settle(h.generate())
    expect(r).toEqual({ success: false, errorKind: 'text-injection-failed', error: 'text-injection-failed', reason: 'editor-changed-before-click' })
    expect(h.trace).not.toContain('click:compose-submit')
    expect(h.trace.filter((x) => x.startsWith('armed:'))).toEqual([])
    expect(h.pendingGenerations.size).toBe(0)
    expect(count(h.trace, 'read-text')).toBe(2)
    expect(idx(h.trace, 'main-focus')).toBeLessThan(idx(h.trace, 'submit-enabled'))
    expect(h.onDomFailure.mock.calls.some((c) => c[0] === 'compose-text' && c[1]?.reason === 'editor-changed-before-click')).toBe(true)
    expect(logged()).toMatch(/editor text changed between the read-back and the submit click promptLen=\d+ editorLen=\d+/)
    for (const c of h.onDomFailure.mock.calls) expect(JSON.stringify(c)).not.toContain(PROMPT)
    expect(logged()).not.toContain(PROMPT)
  })
})

// M2-LAST P3(A2): O5 의 재포커스와 주입은 편집기(캐럿) 신뢰 클릭 뒤에 ctl.aborted 검사 없이 이어졌다 — 워치독이 그 클릭 중(≤30s + 뮤텍스 대기)에 울리면 좀비가 finally(레이아웃 복원·
//   메인 포커스·잠금 해제) **뒤에** Flow 뷰로 포커스를 가져가 프롬프트를 넣고 제출 가능 상태로 둔다 — 앱에 치려던 Enter 가 미추적 과금 제출이 된다. 캐럿 클릭 직후·재포커스 전에 검사한다.
describe('flow:generate-video-t2v (angular) — 캐럿 클릭 중 워치독이 울린 좀비는 재포커스·주입하지 않는다 (M2-LAST P3)', () => {
  const NARROW = { x: 0, y: 0, width: 597, height: 872 }
  it('compose-editor 클릭이 121s 에 돌아온 좀비 → keylock:off 뒤에 focus·set-text·read-text·main-focus·submit-enabled·제출 클릭 없음, 맵 0, shield:off 1회', async () => {
    const h = harness({ bounds: NARROW })
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
