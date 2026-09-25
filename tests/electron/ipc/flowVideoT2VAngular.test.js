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
import { failBoundUnfinished } from '../../../electron/flow-rpc-router.js'
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
      return o.settings ?? { ok: true, closed: true, steps: { mode: 'clicked(videocam)', ratio: 'already(crop_16_9)', duration: 'already(6)', resolution: 'already(720p)', count: 'already(x1)', model: 'already', input: 'material' } }
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
    if (s.includes('settings-summary')) { trace.push('summary'); return o.summary ?? { text: '동영상 · 720p · 6초 x1', ligatures: ['crop_16_9'] } }
    if (s.includes("querySelectorAll('p')")) { trace.push('read-text'); return o.editorText !== undefined ? o.editorText : injectedPrompt }
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
  })
  const generate = (p = {}) => ipcMain.invoke('flow:generate-video-t2v', {
    token: null, prompt: PROMPT, projectId: PROJECT, model: 'Omni Flash', aspectRatio: '16:9', duration: 6, resolution: '720p', videoBatchCount: 1, seed: null, segments: null, ...p,
  })
  return { ipcMain, generate, trace, executeJavaScript, trustedClickOnFlowView, sessionFetch, onDomFailure, pendingGenerations, page, legacy, flowView, mainWindow, targets: () => settingsTargets, creditReadsAt }
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
    expect(idx(t, 'main-focus')).toBeGreaterThan(lastBounds)
    expect(logged()).toMatch(/\[Flow Video T2V\] \[Angular\] view hidden 0x0 → automation viewport \d+x\d+ offscreen/)
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

  it('바인딩 없는 YhhmEf loadend(UUID) → [Flow RPC] YhhmEf unbound loadend media=<8> + onDomFailure(submit:unbound-loadend, media 앞 8자) — 전체 id·프롬프트 없음, throw 없음 (M2-R7 L1)', async () => {
    const h = harness({ onSubmit: null })
    expect(h.page.loadend({ seq: 9 })).toEqual({ ok: true, dropped: 'unbound' })
    expect(logged()).toMatch(/\[Flow RPC\] YhhmEf unbound loadend media=00000011\b/)
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
