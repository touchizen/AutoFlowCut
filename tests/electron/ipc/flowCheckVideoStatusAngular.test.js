// @vitest-environment node
//
// M2-5 — flow.google.com(Angular) 영상 상태 폴 핸들러(flow:check-video-status). 앱이 페이지 컨텍스트 XHR 로 jwpduf 를 **id 당 1회**
// 부르고(§5-4: 다중 id 형식 미관측), 상태 [5][8][0] 이 3(완료)이면 as29s 로 mp4 서명 URL 을 받는다(호스트 flow-content.google 필수).
//   6·2 → pending · 3 → complete(+videoUrl) · 그 외 → pending+unknownState(warn 1회) · 읽기 RPC 실패는 그 항목만 pending+pollError
//   (최상위 success:true 유지 — 항목별 폴 예산만 소모) · as29s 실패는 유계(3회 pending) 뒤 4회째 flow-video-fetch-failed(+mediaId,
//   download-only 허용) · authFailed 는 HTTP 401 / code 16 만(최상위) · 완료 폴의 모델키 재검사는 **없다**(D8-6) · token 없이.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerVideoIPC } from '../../../electron/ipc/video.js'
import { createSharedHelpers } from '../../../electron/ipc/shared.js'
import { isFlowAuthError, markFlowAuthFailure } from '../../../src/engine/engineFlow.js'
import { sample, samplePayload, respBodyWithPayload, respBodyFailure, maskedUuid } from '../../fixtures/flow-batchexecute-samples.js'

const FLOW_URL_OK = 'https://flow.google.com/project/134cf5b5-6a64-47b8-8709-6de4c6b0e44c'
const UUID11 = maskedUuid(11)   // M2-R5 J2: 픽스처의 <uuid#11> 은 로더가 UUID 모양으로 푼다

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
}

/** R:143-149 첫 폴(상태 [2]) — jwpduf 샘플(마지막 폴)에서 역산. */
function firstPollBody() {
  const p = samplePayload('jwpduf')
  p[1] = null
  p[2][0][5] = p[2][0][5].slice(0, 10)
  p[2][0][5][8] = [2]
  return respBodyWithPayload('jwpduf', p)
}
/** 상태를 바꾼 jwpduf 본문. */
function pollBodyWithState(state, mediaId = UUID11) {
  const p = samplePayload('jwpduf')
  p[2][0][0] = mediaId
  p[2][0][5][8] = [state]
  return respBodyWithPayload('jwpduf', p)
}
const asBody = () => respBodyWithPayload('as29s', samplePayload('as29s'))

/**
 * @param {object} o
 *   url · wiz · jwpduf(응답 순서: {status,text} | Error) · as29s(응답 순서) · mode
 */
function harness(o = {}) {
  const url = o.url ?? FLOW_URL_OK
  const jw = Array.isArray(o.jwpduf) ? [...o.jwpduf] : [{ status: 200, text: sample('jwpduf').respBody }]
  const as = Array.isArray(o.as29s) ? [...o.as29s] : [{ status: 200, text: asBody() }]
  const wizSeq = Array.isArray(o.wiz) ? [...o.wiz] : [o.wiz ?? true]   // M2-R2 G2: 폴마다 다른 WIZ 판정(배열이면 순서대로, 마지막 값 유지)
  const rpcCalls = []
  const next = (q) => (q.length > 1 ? q.shift() : q[0])
  const executeJavaScript = vi.fn(async (script) => {
    const s = String(script)
    if (s.includes('WIZ_global_data.SNlM0e')) return next(wizSeq)
    const m = s.match(/rpcid: "(jwpduf|as29s|nzlxg)", payload: (.*?), wiz: wiz/)
    if (m) {
      rpcCalls.push([m[1], m[2]])
      const r = next(m[1] === 'jwpduf' ? jw : as)
      if (r instanceof Error) throw r
      return r
    }
    return null
  })
  const flowView = { getBounds: () => ({ x: 0, y: 0, width: 957, height: 1022 }), setBounds: vi.fn(), webContents: { executeJavaScript, getURL: () => url, isDestroyed: () => false, focus: vi.fn(), sendInputEvent: vi.fn() } }
  const onDomFailure = vi.fn(async () => {})
  const helpers = createSharedHelpers({
    getFlowView: () => flowView, getMainWindow: () => null,
    constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' }, onDomFailure,
  })
  const sessionFetch = vi.fn()
  const ipcMain = makeIpcMain()
  registerVideoIPC(ipcMain, {
    getFlowView: () => flowView, getMainWindow: () => null, getCurrentMode: () => o.mode ?? 'flow', getFlowAgentOn: () => false,
    parseFlowResponse: () => null, setCapturedProjectId: vi.fn(), getCapturedProjectId: () => null, pendingGenerations: new Map(),
    getPendingVideoGeneration: () => null, setPendingVideoGeneration: vi.fn(), flowPageFetch: vi.fn(), getApiBase: () => null,
    ...helpers, sessionFetch,
  })
  const check = (ids = [UUID11], extra = {}) => ipcMain.invoke('flow:check-video-status', { token: null, generationIds: ids, projectId: 'p', ...extra })
  return { ipcMain, check, executeJavaScript, rpcCalls, onDomFailure, sessionFetch, flowView }
}

let logSpy, warnSpy, errSpy
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore(); vi.restoreAllMocks() })
/** M2-R3 H7: 핸들러의 Date.now 를 손시계로 — 게이트 연속 실패의 경과 시간 판정(≥25s)을 폴 간격(10s)·동시 호출로 검사한다. */
function clock(start = 1790240102500) {
  let t = start
  vi.spyOn(Date, 'now').mockImplementation(() => t)
  return { tick: (ms) => { t += ms } }
}
const logged = () => [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errSpy.mock.calls].map((c) => c.map(String).join(' ')).join('\n')

describe('flow:check-video-status (angular) — 폴', () => {
  it('R 첫 폴(상태 2) → pending; jwpduf 는 id 당 1회, payload [null,null,[["<id>"]]], as29s 미호출, 로그 state=2 → pending', async () => {
    const h = harness({ jwpduf: [{ status: 200, text: firstPollBody() }] })
    const r = await h.check()
    expect(r).toEqual({ success: true, statuses: [{ status: 'pending' }] })
    expect(h.rpcCalls).toEqual([['jwpduf', `[null,null,[["${UUID11}"]]]`]])
    expect(logged()).toMatch(/\[Flow VideoStatus\] \[Angular\] \S{1,8} state=2 → pending/)
    expect(h.sessionFetch).not.toHaveBeenCalled()
  })

  it('상태 6(제출됨) 도 pending', async () => {
    const h = harness({ jwpduf: [{ status: 200, text: pollBodyWithState(6) }] })
    expect(await h.check()).toEqual({ success: true, statuses: [{ status: 'pending' }] })
  })

  it('S3(상태 3) → as29s(["<id>"]) → complete + videoUrl(flow-content.google/video/) + mediaId; 로그에 서명 없음', async () => {
    const h = harness()
    const r = await h.check()
    expect(r.success).toBe(true)
    expect(r.statuses).toHaveLength(1)
    expect(r.statuses[0]).toMatchObject({ status: 'complete', mediaId: UUID11 })
    expect(r.statuses[0].videoUrl).toMatch(/^https:\/\/flow-content\.google\/video\//)
    expect(r.statuses[0]).not.toHaveProperty('error')
    expect(h.rpcCalls).toEqual([['jwpduf', `[null,null,[["${UUID11}"]]]`], ['as29s', `["${UUID11}"]`]])
    const L = logged()
    expect(L).toMatch(/\[Flow VideoStatus\] \[Angular\] \S{1,8} state=3 → complete, as29s host=flow-content\.google/)
    expect(L).not.toContain('Signature')
    expect(L).not.toContain('Expires')
  })

  it('완료 폴의 모델키 재검사는 없다 — [2][0][7][0][12] 가 veo_… 여도 complete', async () => {
    const p = samplePayload('jwpduf'); p[2][0][7][0][12] = 'veo_3_1_t2v_fast_6s'
    const h = harness({ jwpduf: [{ status: 200, text: respBodyWithPayload('jwpduf', p) }] })
    const r = await h.check()
    expect(r.statuses[0]).toMatchObject({ status: 'complete', mediaId: UUID11 })
    expect(r.statuses[0]).not.toHaveProperty('errorKind')
  })

  it('jwpduf 실패 프레임 code 8 → 그 항목만 {pending, pollError, rpcCode:8}, 최상위 success:true(quota 문구 없음)', async () => {
    const h = harness({ jwpduf: [{ status: 200, text: respBodyFailure('jwpduf', 8) }] })
    const r = await h.check()
    expect(r).toEqual({ success: true, statuses: [{ status: 'pending', pollError: 'flow-rpc-error', rpcCode: 8 }] })
    expect(JSON.stringify(r)).not.toMatch(/RESOURCE_EXHAUSTED|quota/i)
  })

  it('jwpduf HTTP 403 / status 0 / shape → 그 항목만 pending+pollError(rpcStatus), authFailed 없음; shape 는 onDomFailure(rpc-shape:jwpduf@…)', async () => {
    const a = harness({ jwpduf: [{ status: 403, text: 'Forbidden' }] })
    expect(await a.check()).toEqual({ success: true, statuses: [{ status: 'pending', pollError: 'flow-rpc-error', rpcStatus: 403 }] })
    const b = harness({ jwpduf: [{ status: 0, error: 'timeout' }] })
    expect(await b.check()).toEqual({ success: true, statuses: [{ status: 'pending', pollError: 'flow-rpc-error', rpcStatus: 0 }] })
    const c = harness({ jwpduf: [{ status: 200, text: respBodyWithPayload('jwpduf', [null, null, null]) }] })
    const rc = await c.check()
    expect(rc).toEqual({ success: true, statuses: [{ status: 'pending', pollError: 'flow-rpc-error' }] })
    expect(c.onDomFailure.mock.calls.some((x) => x[0] === 'rpc-shape:jwpduf@[2]')).toBe(true)
    for (const r of [await harness({ jwpduf: [{ status: 403, text: 'x' }] }).check()]) expect(isFlowAuthError({ success: false, error: r.statuses[0].pollError })).toBe(false)
  })

  it('상태 9(미지) → pending + unknownState:9, warn 은 같은 id·상태에 1회', async () => {
    const h = harness({ jwpduf: [{ status: 200, text: pollBodyWithState(9) }] })
    expect(await h.check()).toEqual({ success: true, statuses: [{ status: 'pending', unknownState: 9 }] })
    expect(await h.check()).toEqual({ success: true, statuses: [{ status: 'pending', unknownState: 9 }] })
    expect(warnSpy.mock.calls.filter((c) => /unknown state/.test(String(c[0]))).length).toBe(1)
  })

  it('as29s 실패 3회(HTTP 500·호스트 불일치) → pending+pollError, 4회째 → {failed, flow-video-fetch-failed, mediaId}(download-only 허용); 성공하면 카운터 리셋', async () => {
    const evil = samplePayload('as29s'); evil[7][0][8] = 'https://evil.example/video/x?Signature=SIGSECRET'
    const h = harness({ as29s: [{ status: 500, text: 'oops' }, { status: 200, text: respBodyWithPayload('as29s', evil) }, { status: 500, text: 'oops' }, { status: 500, text: 'oops' }, { status: 200, text: asBody() }] })
    for (let i = 0; i < 3; i++) {
      const r = await h.check()
      expect(r.success).toBe(true)
      expect(r.statuses[0]).toMatchObject({ status: 'pending', pollError: 'flow-rpc-error' })
      expect(r.statuses[0]).not.toHaveProperty('mediaId')
    }
    const r4 = await h.check()
    expect(r4).toEqual({ success: true, statuses: [{ status: 'failed', errorKind: 'flow-video-fetch-failed', error: 'flow-video-fetch-failed', mediaId: UUID11 }] })
    expect(logged()).not.toContain('SIGSECRET')
    // 다음 폴에서 as29s 가 성공하면 complete
    const r5 = await h.check()
    expect(r5.statuses[0]).toMatchObject({ status: 'complete', mediaId: UUID11 })
  })

  // M2-R1 F11(d)(A11): "성공하면 리셋" 을 정말 핀한다 — 실패 2 → 성공(리셋) → 실패 3 은 아직 pending, 4회째 failed. (리셋이 없으면 성공 뒤 두 번째
  //   실패에서 이미 4회가 돼 일찍 failed 로 떨어진다.)
  it('as29s 실패 2 → 성공(리셋) → 실패 3 → 여전히 pending, 4회째 → failed(mediaId)', async () => {
    const bad = { status: 500, text: 'oops' }
    const h = harness({ as29s: [bad, bad, { status: 200, text: asBody() }, bad, bad, bad, bad] })
    const pend = { status: 'pending', pollError: 'flow-rpc-error', rpcStatus: 500 }
    expect((await h.check()).statuses[0]).toEqual(pend)
    expect((await h.check()).statuses[0]).toEqual(pend)
    expect((await h.check()).statuses[0]).toMatchObject({ status: 'complete', mediaId: UUID11 })
    for (let i = 0; i < 3; i++) expect((await h.check()).statuses[0]).toEqual(pend)
    expect((await h.check()).statuses[0]).toEqual({ status: 'failed', errorKind: 'flow-video-fetch-failed', error: 'flow-video-fetch-failed', mediaId: UUID11 })
  })

  it.each([
    ['jwpduf HTTP 401', { jwpduf: [{ status: 401, text: '' }] }, { rpcStatus: 401 }],
    ['jwpduf code 16', { jwpduf: [{ status: 200, text: respBodyFailure('jwpduf', 16) }] }, { rpcCode: 16 }],
    ['as29s HTTP 401', { as29s: [{ status: 401, text: '' }] }, { rpcStatus: 401 }],
  ])('%s → 최상위 {success:false, flow-rpc-error, authFailed:true}(문구 중립)', async (_l, opts, expected) => {
    const r = await harness(opts).check()
    expect(r).toEqual({ success: false, errorKind: 'flow-rpc-error', error: 'flow-rpc-error', authFailed: true, ...expected })
    expect(isFlowAuthError(r)).toBe(false)
    expect(markFlowAuthFailure(r).authFailed).toBe(true)
  })

  it('id 2개 → jwpduf 2회(순서대로), statuses 는 입력 순서(첫째 pending, 둘째 complete)', async () => {
    const h = harness({ jwpduf: [{ status: 200, text: pollBodyWithState(2, '<uuid#21>') }, { status: 200, text: sample('jwpduf').respBody }] })
    const r = await h.check(['<uuid#21>', UUID11])
    expect(r.success).toBe(true)
    expect(r.statuses.map((s) => s.status)).toEqual(['pending', 'complete'])
    expect(r.statuses[1].mediaId).toBe(UUID11)
    expect(h.rpcCalls.map((c) => c[0])).toEqual(['jwpduf', 'jwpduf', 'as29s'])
    expect(h.rpcCalls[0][1]).toContain('<uuid#21>')
    expect(h.rpcCalls[1][1]).toContain(UUID11)
  })

  it('응답 레코드의 mediaId 가 폴한 id 와 다르면 그 항목은 pending+pollError(오배정 없음)', async () => {
    const h = harness({ jwpduf: [{ status: 200, text: pollBodyWithState(3, '<uuid#99>') }] })
    const r = await h.check()
    expect(r.statuses[0]).toMatchObject({ status: 'pending', pollError: 'flow-rpc-error' })
    expect(h.rpcCalls.map((c) => c[0])).toEqual(['jwpduf'])
  })

  // M2-R1 F7(A7): (a) 입력 id 마다 정확히 하나, 입력 순서 — 무효 id 를 걸러내면 statuses 가 짧아져 engineFlow 의 index-zip 이 aligned=false 로
  //   전원 pending(120×10s)으로 묶는다. 무효 id 는 회수할 게 없으니 {failed, flow-video-fetch-failed}(mediaId 없음). (b) "폴한 id 의 레코드 없음"
  //   (삭제·옛 세션의 generating 잔존)은 as29s 처럼 유계 — 3회 pending+pollError, 4회째 {failed, …, mediaId:id}; 레코드가 오면 카운터 리셋.
  it('[유효, "", 유효] → statuses 3개 입력 순서 정렬(무효는 failed/fetch-failed, mediaId 없음); jwpduf 는 유효 id 만; 세션 게이트 실패도 입력 순서 유지', async () => {
    const h = harness({ jwpduf: [{ status: 200, text: pollBodyWithState(2, '<uuid#21>') }, { status: 200, text: sample('jwpduf').respBody }] })
    const r = await h.check(['<uuid#21>', '', UUID11])
    expect(r.success).toBe(true)
    expect(r.statuses).toHaveLength(3)
    expect(r.statuses[0]).toEqual({ status: 'pending' })
    expect(r.statuses[1]).toEqual({ status: 'failed', errorKind: 'flow-video-fetch-failed', error: 'flow-video-fetch-failed' })
    expect(r.statuses[1]).not.toHaveProperty('mediaId')
    expect(r.statuses[2]).toMatchObject({ status: 'complete', mediaId: UUID11 })
    expect(h.rpcCalls.map((c) => c[0])).toEqual(['jwpduf', 'jwpduf', 'as29s'])
    const g = harness({ wiz: false })
    expect(await g.check(['', UUID11])).toEqual({ success: true, statuses: [{ status: 'failed', errorKind: 'flow-video-fetch-failed', error: 'flow-video-fetch-failed' }, { status: 'pending', pollError: 'flow-session-missing' }] })
  })

  // M2-R2 G3(B6): "레코드 없음" 은 Flow 에 그 미디어가 없다는 뜻(삭제·옛 id) — fetch-failed("다시 시도") 가 아니라 자기 kind flow-video-not-found
  //   ("Flow 에 더 이상 없음, 재생성") 로 닫는다. mediaId 는 그대로(과금 안전 — Start 가 재제출하지 않는다). 무효 id 는 fetch-failed 유지(:220).
  it('레코드 없음 ×2 → 레코드(pending, 리셋) → 없음 ×3 은 pending+pollError, 4회째 {failed, flow-video-not-found, mediaId:id}', async () => {
    const none = { status: 200, text: pollBodyWithState(2, '<uuid#99>') }
    const found = { status: 200, text: pollBodyWithState(2) }
    const h = harness({ jwpduf: [none, none, found, none, none, none, none, found] })
    const pend = { status: 'pending', pollError: 'flow-rpc-error' }
    expect((await h.check()).statuses[0]).toEqual(pend)
    expect((await h.check()).statuses[0]).toEqual(pend)
    expect((await h.check()).statuses[0]).toEqual({ status: 'pending' })          // 레코드가 왔다 — 카운터 리셋
    for (let i = 0; i < 3; i++) expect((await h.check()).statuses[0]).toEqual(pend)
    expect((await h.check()).statuses[0]).toEqual({ status: 'failed', errorKind: 'flow-video-not-found', error: 'flow-video-not-found', mediaId: UUID11 })
    expect(h.rpcCalls.every((c) => c[0] === 'jwpduf')).toBe(true)
  })
})

describe('flow:check-video-status (angular) — 진입', () => {
  it('generationIds 비어 있음 → {success:true, statuses:[]}, RPC 없음', async () => {
    const h = harness()
    expect(await h.check([])).toEqual({ success: true, statuses: [] })
    expect(h.rpcCalls).toEqual([])
  })

  // M2-R1 F3(A3/B3): 세션 게이트 실패는 일시적일 수 있다(뷰 재로드 중 WIZ 없음·다른 페이지) — 최상위 authFailed 로 닫으면 훅이 이미
  //   과금된 pending 전부를 errorKind:'auth'(mediaId null) 로 잃는다. 요청 id 마다 {pending, pollError:'flow-session-missing'} 로
  //   항목별 폴 예산만 소모한다. authFailed 는 읽기 RPC 의 HTTP 401 / code 16 만.
  it('세션 게이트 실패(accounts.google.com / WIZ 없음) → 최상위 authFailed 아님 — 요청 id 마다 {pending, pollError:flow-session-missing}, success:true', async () => {
    const a = harness({ url: 'https://accounts.google.com/signin' })
    const ra = await a.check(['<uuid#21>', UUID11])
    expect(ra).toEqual({ success: true, statuses: [{ status: 'pending', pollError: 'flow-session-missing' }, { status: 'pending', pollError: 'flow-session-missing' }] })
    expect(a.executeJavaScript).not.toHaveBeenCalled()
    const b = harness({ wiz: false })
    const rb = await b.check()
    expect(rb).toEqual({ success: true, statuses: [{ status: 'pending', pollError: 'flow-session-missing' }] })
    expect(b.rpcCalls).toEqual([])
    for (const r of [ra, rb]) {
      expect(r).not.toHaveProperty('authFailed')
      expect(JSON.stringify(r)).not.toMatch(/wiz-missing|not-on-flow/)
      expect(markFlowAuthFailure(r)).not.toHaveProperty('authFailed')
    }
  })

  // M2-R2 G2(A2): 게이트 실패가 **연속 3회**(≈30s)면 뷰 재로드가 아니라 실제 로그아웃(accounts.google.com 에 앉음)이다 — 최상위
  //   {success:false, authFailed, flow-session-missing}(error 에 raw reason 없음)으로 배치를 끝내 로그인 안내를 띄운다. 그 전엔 120×10s 를
  //   "Polling…" 으로 흘리고 원인 없는 "Polling timeout" 으로 닫았다. 지나가는 게이트가 있으면 카운터 리셋(F3 의 일시 실패 허용 유지), 발화 뒤에도 리셋.
  //   M2-R3 H7(B3): 폴 루프의 10s 간격으로 — 발화 조건은 연속 ≥3회 **그리고** 첫 실패로부터 ≥25s(아래 H7 블록) → 10s 간격에선 4회째(첫 실패 30s 뒤)가 발화한다.
  it('세션 게이트 실패 ×2 → 항목별 pollError; 통과(리셋); 실패 ×3(0·10·20s) → pollError; 4회째(30s) → 최상위 authFailed(flow-session-missing, raw reason 없음); 발화 뒤 다음 실패는 다시 1회째', async () => {
    const c = clock()
    const h = harness({ wiz: [false, false, true, false, false, false, false, false] })
    const pend = { success: true, statuses: [{ status: 'pending', pollError: 'flow-session-missing' }] }
    const poll = async () => { const r = await h.check(); c.tick(10000); return r }
    expect(await poll()).toEqual(pend)
    expect(await poll()).toEqual(pend)
    expect((await poll()).statuses[0]).toMatchObject({ status: 'complete', mediaId: UUID11 })   // 통과 — 리셋
    expect(await poll()).toEqual(pend)
    expect(await poll()).toEqual(pend)
    expect(await poll()).toEqual(pend)   // 3회째지만 20s — 아직
    const r = await poll()
    expect(r).toEqual({ success: false, errorKind: 'flow-session-missing', error: 'flow-session-missing', authFailed: true })
    expect(JSON.stringify(r)).not.toMatch(/wiz-missing|not-on-flow/)
    expect(markFlowAuthFailure(r).authFailed).toBe(true)
    expect(await poll()).toEqual(pend)
  })

  it('not-on-flow(accounts.google.com) 도 같은 셈 — 10s 간격 4회째(30s) 최상위 authFailed, executeJavaScript 미호출', async () => {
    const c = clock()
    const h = harness({ url: 'https://accounts.google.com/signin' })
    const poll = async () => { const r = await h.check(); c.tick(10000); return r }
    expect(await poll()).toMatchObject({ success: true })
    expect(await poll()).toMatchObject({ success: true })
    expect(await poll()).toMatchObject({ success: true })
    expect(await poll()).toEqual({ success: false, errorKind: 'flow-session-missing', error: 'flow-session-missing', authFailed: true })
    expect(h.executeJavaScript).not.toHaveBeenCalled()
  })
})

// M2-R3 H7(B3): gateFailures 는 핸들러 인스턴스의 **호출** 수라 폴 라운드도 시간도 아니다 — Phase 0 의 병렬 retryVideoDownload 5개가 한 번의 일시 게이트 실패에
//   [pollError, pollError, AUTH, …] 를 받았고(스크래치 재현), 배치 사이·수동 Retry 의 잔여 카운트도 더해졌다. 발화 조건을 "연속 ≥3회 **그리고** 첫 실패로부터 ≥25s"
//   (firstFailedAt) 로 — 10s 폴 루프의 3회째(≈30s)는 그대로 발화하고, 동시 호출·짧은 재시도는 항목별 pollError 로만 남는다. 통과하면 둘 다 리셋.
describe('flow:check-video-status (angular) — 게이트 격상은 횟수 + 경과 시간 (M2-R3 H7)', () => {
  const PEND = { success: true, statuses: [{ status: 'pending', pollError: 'flow-session-missing' }] }
  const AUTH = { success: false, errorKind: 'flow-session-missing', error: 'flow-session-missing', authFailed: true }

  it('한 번의 게이트 실패 동안 동시 호출 5개(Phase 0 병렬 재시도) → 전부 항목별 pollError, authFailed 없음', async () => {
    clock()
    const h = harness({ wiz: false })
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => h.check()))
    for (const r of rs) expect(r).toEqual(PEND)
  })

  it('5s 안의 실패 3회(2s 간격) → 아직 pollError; 실패가 이어져 첫 실패로부터 25s 를 넘는 순간 authFailed; 발화 뒤 리셋', async () => {
    const c = clock()
    const h = harness({ wiz: false })
    for (let i = 0; i < 3; i++) { expect(await h.check()).toEqual(PEND); c.tick(2000) }   // 0s · 2s · 4s → 6s
    expect(await h.check()).toEqual(PEND); c.tick(10000)                                    // 6s → 16s
    expect(await h.check()).toEqual(PEND); c.tick(10000)                                    // 16s → 26s
    expect(await h.check()).toEqual(AUTH)                                                   // 26s ≥ 25s, 6회째
    expect(await h.check()).toEqual(PEND)                                                   // 발화 뒤 다시 1회째
  })

  it('30s 에 걸친 실패 3회(15s 간격) → 3회째 authFailed; 사이에 통과가 있으면 시각도 리셋돼 다시 25s 가 필요하다', async () => {
    const c = clock()
    const h = harness({ wiz: [false, false, false, true, false, false, false, false] })
    expect(await h.check()).toEqual(PEND); c.tick(15000)
    expect(await h.check()).toEqual(PEND); c.tick(15000)
    expect(await h.check()).toEqual(AUTH)
    expect((await h.check()).statuses[0]).toMatchObject({ status: 'complete', mediaId: UUID11 })   // 통과 — 횟수·시각 리셋
    c.tick(60000)
    expect(await h.check()).toEqual(PEND); c.tick(1000)   // 새 첫 실패(시각은 여기부터)
    expect(await h.check()).toEqual(PEND); c.tick(1000)
    expect(await h.check()).toEqual(PEND); c.tick(10000)  // 3회째지만 2s 경과 — 아직 (M2-R4 I3: 다음 실패까지 20s 넘게 비면 새 연속이라 10s 폴 간격으로 잇는다)
    expect(await h.check()).toEqual(PEND); c.tick(10000)  // 12s
    expect(await h.check()).toEqual(PEND); c.tick(10000)  // 22s
    expect(await h.check()).toEqual(AUTH)                 // 6회째, 32s 경과
  })
})

// M2-R4 I3(A2 = B2): H7 의 연속은 시간으로 만료되지 않았다 — gateFirstFailedAt 은 통과·발화 때만 리셋되므로 옛 실패 하나(Stop 직전 마지막 폴·수동 Retry)가 ≥25s 조건을 영원히 참으로 두고,
//   10분 뒤 뷰 재로드 한 번에 Phase 0 의 병렬 재시도 5개 중 둘째가 "3회째·600s" 로 최상위 authFailed 가 됐다(B3 재현). 이제 lastFailedAt 을 적어 직전 실패에서 20s 넘게 지난 실패는
//   새 연속(횟수·첫 시각 리셋)이고, 직전 실패에서 1s 안의 호출(동시 재시도)은 한 번으로 센다. 횟수 조건(≥3)은 그래서 1s 안 연쇄 호출(수십 항목의 Phase 0 청크 연속)에서만 시간과 갈라진다.
describe('flow:check-video-status (angular) — 게이트 연속은 시간으로 만료되고 동시 호출은 한 번 (M2-R4 I3)', () => {
  const PEND = { success: true, statuses: [{ status: 'pending', pollError: 'flow-session-missing' }] }
  const AUTH = { success: false, errorKind: 'flow-session-missing', error: 'flow-session-missing', authFailed: true }

  it('옛 실패 1회 → 10분 뒤 한 번의 재로드 동안 동시 호출 5개(Phase 0 병렬 재시도) → 전부 항목별 pollError, authFailed 없음', async () => {
    const c = clock()
    const h = harness({ wiz: false })
    expect(await h.check()).toEqual(PEND)   // Stop 직전의 마지막 폴 — 통과 없이 남는다
    c.tick(600000)
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => h.check()))
    expect(rs).toEqual([PEND, PEND, PEND, PEND, PEND])
    c.tick(1500)   // 재로드가 끝나기 전 다음 재시도(같은 연속·다른 순간) — 옛 실패가 첫 시각으로 살아 있으면 여기서 authFailed 가 된다
    expect(await h.check()).toEqual(PEND)
  })

  it('30s 떨어진 실패 2회 → 둘 다 pollError(새 연속); 그 뒤 10s 간격으로 이어지면 두 번째 실패를 첫 시각으로 4회째(30s)에 authFailed', async () => {
    const c = clock()
    const h = harness({ wiz: false })
    expect(await h.check()).toEqual(PEND); c.tick(30000)
    expect(await h.check()).toEqual(PEND); c.tick(10000)   // 30s 뒤 — 새 연속의 1회째(첫 시각 30s)
    expect(await h.check()).toEqual(PEND); c.tick(10000)   // 2회째 40s
    expect(await h.check()).toEqual(PEND); c.tick(10000)   // 3회째 50s(20s 경과 — 아직)
    expect(await h.check()).toEqual(AUTH)                  // 4회째 60s(30s 경과)
  })

  it('횟수 조건: 1s 안의 연쇄 호출(500ms 간격 ×53, 26s)은 한 번의 실패로 세어 시간이 지나도 pollError; 10s 간격의 폴이 이어지면 3회째에 authFailed', async () => {
    const c = clock()
    const h = harness({ wiz: false })
    for (let i = 0; i < 53; i++) { expect(await h.check(), `call ${i}`).toEqual(PEND); c.tick(500) }   // 0 → 26.5s, 횟수 1
    c.tick(10000)
    expect(await h.check()).toEqual(PEND); c.tick(10000)   // 2회째(36.5s)
    expect(await h.check()).toEqual(AUTH)                  // 3회째(46.5s ≥ 25s)
  })
})
