// @vitest-environment node
//
// M1-3/M1-4 — batchexecute 캡처 이벤트 ↔ pendingGenerations 상관 라우터(순수).
// 시각은 초(Date.now()/1000), 테스트는 가짜 시계 + 실제 epoch(1790240102.5).
//   send    : 후보(rpc 동일·미바인딩·미완료·setAt <= sentAt) 1개면 바인딩(프롬프트 달라도 + warn), 2개 이상이면
//             정규화 프롬프트 일치 중 최고령, 없으면 unbound. multi → flow-rpc-multi-batch.
//   loadend : {doc, seq} 로 gen 을 찾아 파싱·완료. 같은 seq 라도 doc 이 다르면 남. 완료된 gen 은 duplicate.
//   마감    : send 15s → flow-submit-not-sent, loadend 100s → flow-submit-lost. completed+error, 맵에 남는다.
//             M2-R7 L1: 영상(YhhmEf)의 send 15s 는 표시(sendDeadlinePassed)+훅뿐 — 클릭 뒤 100s 까지 바인딩 가능(grace), 그때 not-sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  failBoundUnfinished, routeRpcSend, routeRpcLoadend, routeRpcReport, markDeadline, armDeadline, settleGen,
  SEND_DEADLINE_S, LOADEND_DEADLINE_S, UNBOUND_CLOSE_TTL_S, _resetUnboundCloseRecordsForTests,
} from '../../electron/flow-rpc-router.js'
import { sample, samplePayload, respBodyWithPayload, respBodyFailure, maskedUuid } from '../fixtures/flow-batchexecute-samples.js'

const NOW_S = 1790240102.5
const DOC_A = 'a'.repeat(32)
const DOC_B = 'b'.repeat(32)
const PROMPT = '궁정안에 있는 왕'

function gen(over = {}) {
  return { rpc: 'ogiZ0b', doc: null, seq: null, sentAt: null, normPrompt: PROMPT, wantRatio: '16:9', results: null, error: null, errorKind: null, completed: false, allowDomFallback: false, waiter: null, deadlines: {}, setAt: NOW_S - 2, ...over }
}
const sendEv = (over = {}) => ({ kind: 'batchexecute-send', doc: DOC_A, rpcid: 'ogiZ0b', rpcids: ['ogiZ0b'], seq: 1, prompts: [PROMPT], sentAt: NOW_S, ...over })
const endEv = (over = {}) => ({ kind: 'batchexecute', doc: DOC_A, rpcid: 'ogiZ0b', seq: 1, status: 200, responseText: sample('ogiZ0b').respBody, endedAt: NOW_S + 21, ...over })

let warn, log
beforeEach(() => {
  _resetUnboundCloseRecordsForTests()   // M2-R8 M4: 모듈 기록(최근 앱 닫힘)은 테스트 사이에 남는다
  vi.useFakeTimers({ now: NOW_S * 1000 })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); warn.mockRestore(); log.mockRestore() })
const logged = () => [...warn.mock.calls, ...log.mock.calls].map((c) => c.map(String).join(' ')).join('\n')

describe('failBoundUnfinished(map) — 문서 커밋·렌더러 크래시', () => {
  it('바인딩됐으나 미완료인 gen → completed + flow-submit-lost, waiter resolve, 맵에 남는다', () => {
    const resolve = vi.fn()
    const bound = gen({ doc: DOC_A, seq: 1, waiter: { resolve } })
    const map = new Map([['g1', bound]])
    expect(failBoundUnfinished(map)).toBe(1)
    expect(bound).toMatchObject({ completed: true, error: 'flow-submit-lost', errorKind: 'flow-submit-lost' })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(map.has('g1')).toBe(true)
  })

  it('미바인딩 armed gen · 완료된 gen · rpc 아닌(옛 경로) gen 은 그대로', () => {
    const armed = gen()
    const done = gen({ doc: DOC_A, seq: 2, completed: true, results: [{ mediaId: 'm' }] })
    const legacy = { setAt: 1, responses: [], completed: false }
    const map = new Map([['a', armed], ['d', done], ['l', legacy]])
    expect(failBoundUnfinished(map)).toBe(0)
    expect(armed).toMatchObject({ completed: false, error: null })
    expect(done).toMatchObject({ completed: true, error: null })
    expect(legacy).toEqual({ setAt: 1, responses: [], completed: false })
  })

  it('마감 타이머를 정리한다', () => {
    const spy = vi.fn()
    const bound = gen({ doc: DOC_B, seq: 1, deadlines: { loadend: setTimeout(spy, 1000) } })
    failBoundUnfinished(new Map([['g', bound]]))
    vi.advanceTimersByTime(5000)
    expect(spy).not.toHaveBeenCalled()
    expect(bound.deadlines).toEqual({})
  })

  it('빈 맵 / null → 0', () => {
    expect(failBoundUnfinished(new Map())).toBe(0)
    expect(failBoundUnfinished(null)).toBe(0)
  })
})

describe('routeRpcSend — 후보 선택·바인딩', () => {
  it('단일 후보는 프롬프트가 달라도 바인딩(doc/seq/sentAt) + warn prompt-mismatch-single(내용 없음)', () => {
    const g = gen({ normPrompt: '다른 프롬프트' })
    const map = new Map([['gen-1', g]])
    expect(routeRpcSend(sendEv(), map)).toEqual({ ok: true, bound: 'gen-1' })
    expect(g).toMatchObject({ doc: DOC_A, seq: 1, sentAt: NOW_S, completed: false })
    expect(logged()).toContain('prompt-mismatch-single')
    expect(logged()).not.toContain(PROMPT)
    expect(logged()).not.toContain('다른 프롬프트')
  })

  it('복수 후보는 정규화 프롬프트 일치 중 setAt 최소 — 미일치·바인딩됨·완료·setAt > sentAt 은 제외', () => {
    const other = gen({ normPrompt: 'x', setAt: NOW_S - 10 })
    const older = gen({ setAt: NOW_S - 5 })
    const newer = gen({ setAt: NOW_S - 1 })
    const already = gen({ doc: DOC_B, seq: 3, setAt: NOW_S - 20 })
    const done = gen({ completed: true, setAt: NOW_S - 30 })
    const future = gen({ setAt: NOW_S + 0.5 })
    const map = new Map([['other', other], ['newer', newer], ['older', older], ['already', already], ['done', done], ['future', future]])
    expect(routeRpcSend(sendEv({ prompts: ['  궁정안에\n있는 왕 '] }), map)).toEqual({ ok: true, bound: 'older' })
    expect(older).toMatchObject({ doc: DOC_A, seq: 1 })
    expect(newer.doc).toBeNull()
    expect(other.doc).toBeNull()
    expect(already).toMatchObject({ doc: DOC_B, seq: 3 })
    expect(future.doc).toBeNull()
  })

  it('복수 후보 중 일치가 없으면 unbound(바인딩 없음)', () => {
    const a = gen({ normPrompt: 'a' }); const b = gen({ normPrompt: 'b' })
    const map = new Map([['a', a], ['b', b]])
    expect(routeRpcSend(sendEv(), map)).toEqual({ ok: true, dropped: 'unbound' })
    expect(a.doc).toBeNull(); expect(b.doc).toBeNull()
  })

  it('후보 없음(다른 rpc / setAt > sentAt) → unbound', () => {
    const video = gen({ rpc: 'YhhmEf' })
    const future = gen({ setAt: NOW_S + 1 })
    expect(routeRpcSend(sendEv(), new Map([['v', video], ['f', future]]))).toEqual({ ok: true, dropped: 'unbound' })
    expect(routeRpcSend(sendEv(), new Map())).toEqual({ ok: true, dropped: 'unbound' })
  })

  it('multi:true → 후보 gen 을 flow-rpc-multi-batch 로 닫는다(바인딩 대신)', () => {
    const resolve = vi.fn()
    const g = gen({ waiter: { resolve } })
    expect(routeRpcSend(sendEv({ rpcids: ['DA4VGb', 'ogiZ0b'], multi: true }), new Map([['g', g]]))).toEqual({ ok: true, failed: 'g', error: 'flow-rpc-multi-batch' })
    expect(g).toMatchObject({ completed: true, error: 'flow-rpc-multi-batch', errorKind: 'flow-rpc-multi-batch', doc: null })
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('바인딩은 send 마감을 끄고 loadend 마감(100s) 을 켠다', () => {
    const g = gen()
    armDeadline(g, 'send')
    routeRpcSend(sendEv(), new Map([['g', g]]))
    vi.advanceTimersByTime(SEND_DEADLINE_S * 1000 + 1000)
    expect(g.completed).toBe(false)
    vi.advanceTimersByTime((LOADEND_DEADLINE_S - SEND_DEADLINE_S - 1) * 1000 - 1)
    expect(g.completed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(g).toMatchObject({ completed: true, error: 'flow-submit-lost', errorKind: 'flow-submit-lost' })
  })

  it('로그: [Flow RPC] ogiZ0b send doc=<8> seq=<n> bound=<id 뒤 8자> — 프롬프트 없음 (R1#11: 앞 8자는 항상 gen-1790)', () => {
    routeRpcSend(sendEv(), new Map([['gen-1790240100-abcdef', gen()]]))
    expect(logged()).toMatch(/\[Flow RPC\] ogiZ0b send doc=a{8} seq=1 bound=0-abcdef/)
    expect(logged()).not.toMatch(/bound=gen-1790/)
    expect(logged()).not.toContain(PROMPT)
  })

  it('잘못된 이벤트(doc 32hex 아님 / seq 정수 아님 / sentAt 숫자 아님) → ok:false invalid, 손대지 않음', () => {
    const g = gen()
    const map = new Map([['g', g]])
    expect(routeRpcSend(sendEv({ doc: 'zz' }), map)).toEqual({ ok: false, reason: 'invalid' })
    expect(routeRpcSend(sendEv({ seq: 1.5 }), map)).toEqual({ ok: false, reason: 'invalid' })
    expect(routeRpcSend(sendEv({ sentAt: 'now' }), map)).toEqual({ ok: false, reason: 'invalid' })
    expect(g.doc).toBeNull()
  })
})

describe('routeRpcLoadend — {doc, seq} 매칭·파싱·완료', () => {
  it('일치 gen 완료: results[0] {mediaId, width 1376, height 768, seed, url}, waiter resolve, 마감 정리', () => {
    const resolve = vi.fn()
    const g = gen({ doc: DOC_A, seq: 1, sentAt: NOW_S, waiter: { resolve } })
    armDeadline(g, 'loadend')
    expect(routeRpcLoadend(endEv(), new Map([['g', g]]))).toEqual({ ok: true, completed: 'g' })
    expect(g.completed).toBe(true)
    expect(g.error).toBeNull()
    expect(g.results[0]).toMatchObject({ mediaId: maskedUuid(5), width: 1376, height: 768, seed: 1687588041 })
    expect(g.results[0].url).toMatch(/^https:\/\/flow-content\.google\/image\//)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(g.deadlines).toEqual({})
    expect(logged()).toMatch(/\[Flow RPC\] ogiZ0b loadend seq=1 status=200/)
    expect(logged()).not.toContain('Signature')
  })

  it('결과 개수 ≠ expectedCount → 숫자만 warn, 완료는 정상 (R1#12)', () => {
    const g = gen({ doc: DOC_A, seq: 1, expectedCount: 2 })
    routeRpcLoadend(endEv(), new Map([['g', g]]))
    expect(g).toMatchObject({ completed: true, error: null })
    expect(g.results).toHaveLength(1)
    expect(logged()).toMatch(/ogiZ0b seq=1 count mismatch got=1 want=2/)
    expect(logged()).not.toContain(PROMPT)
  })

  it('치수 ↔ wantRatio 불일치 → flow-aspect-mismatch (wantRatio 없으면 검사 생략)', () => {
    const portrait = gen({ doc: DOC_A, seq: 1, wantRatio: '9:16' })
    routeRpcLoadend(endEv(), new Map([['p', portrait]]))
    expect(portrait).toMatchObject({ completed: true, error: 'flow-aspect-mismatch', errorKind: 'flow-aspect-mismatch' })
    const any = gen({ doc: DOC_A, seq: 1, wantRatio: undefined })
    routeRpcLoadend(endEv(), new Map([['a', any]]))
    expect(any).toMatchObject({ completed: true, error: null })
  })

  it('같은 seq 두 문서: doc A 에 바인딩된 gen 은 doc B 의 loadend seq 1 에 반응하지 않는다', () => {
    const g = gen({ doc: DOC_A, seq: 1 })
    expect(routeRpcLoadend(endEv({ doc: DOC_B }), new Map([['g', g]]))).toEqual({ ok: true, dropped: 'unbound' })
    expect(g.completed).toBe(false)
    expect(g.results).toBeNull()
  })

  it('역순 완료: seq 2 응답이 먼저 와도 각자 자기 gen 으로', () => {
    const g1 = gen({ doc: DOC_A, seq: 1 }); const g2 = gen({ doc: DOC_A, seq: 2 })
    const map = new Map([['g1', g1], ['g2', g2]])
    const p2 = samplePayload('ogiZ0b'); p2[0][0][0] = '<uuid#9>'; p2[0][0][6][0][13] = 'https://flow-content.google/image/<uuid#9>?Signature=S'
    routeRpcLoadend(endEv({ seq: 2, responseText: respBodyWithPayload('ogiZ0b', p2) }), map)
    routeRpcLoadend(endEv({ seq: 1 }), map)
    expect(g2.results[0].mediaId).toBe('<uuid#9>')
    expect(g1.results[0].mediaId).toBe(maskedUuid(5))
  })

  it('만료(마감)된 gen 은 completed+error 라 늦은 loadend 는 duplicate — 에러 유지', () => {
    const g = gen({ doc: DOC_A, seq: 1 })
    markDeadline(g, 'loadend')
    expect(routeRpcLoadend(endEv(), new Map([['g', g]]))).toEqual({ ok: true, duplicate: 'g' })
    expect(g).toMatchObject({ completed: true, error: 'flow-submit-lost', results: null })
  })

  it.each([
    ['실패 프레임 code 8', { responseText: respBodyFailure('ogiZ0b', 8) }, { error: 'RESOURCE_EXHAUSTED', errorKind: 'flow-rpc-error', rpcCode: 8 }, false],
    ['실패 프레임 code 16', { responseText: respBodyFailure('ogiZ0b', 16) }, { error: 'flow-rpc-error', rpcCode: 16, authFailed: true }, true],
    ['실패 프레임 code 7', { responseText: respBodyFailure('ogiZ0b', 7) }, { error: 'flow-rpc-error', rpcCode: 7 }, false],
    ['HTTP 401', { status: 401, responseText: '' }, { error: 'flow-rpc-error', rpcStatus: 401, authFailed: true }, true],
    ['HTTP 403', { status: 403, responseText: 'Forbidden 403' }, { error: 'flow-rpc-error', rpcStatus: 403 }, false],
    ['HTTP 429', { status: 429, responseText: '' }, { error: 'flow-rpc-error', rpcStatus: 429 }, false],
    ['status 0', { status: 0, responseText: '' }, { error: 'flow-rpc-error', rpcStatus: 0 }, false],
  ])('%s → 매핑 문구·코드 필드, authFailed 는 401/16 만', (_l, over, expected, auth) => {
    const g = gen({ doc: DOC_A, seq: 1 })
    routeRpcLoadend(endEv(over), new Map([['g', g]]))
    expect(g.completed).toBe(true)
    expect(g).toMatchObject(expected)
    expect(!!g.authFailed).toBe(auth)
    expect(g.error).not.toMatch(/\d/)
  })

  it('파서 throw(깨진 JSON) → rpc-shape 에러, gen.error·로그에 입력 부분문자열 없음', () => {
    const g = gen({ doc: DOC_A, seq: 1 })
    routeRpcLoadend(endEv({ responseText: ")]}'\n\n12\n[[\"wrb.fr\",\"ogiZ0b\",\"SECRET_PROMPT_TEXT\n" }), new Map([['g', g]]))
    expect(g.completed).toBe(true)
    expect(g.error).toMatch(/^rpc-shape:/)
    expect(g.errorKind).toBe('flow-rpc-error')
    expect(g.error).not.toContain('SECRET_PROMPT_TEXT')
    expect(logged()).not.toContain('SECRET_PROMPT_TEXT')
  })

  it('치수 위치 삭제 사본 → rpc-shape:ogiZ0b@[0][0][6][2]', () => {
    const p = samplePayload('ogiZ0b'); p[0][0][6].splice(2, 1)
    const g = gen({ doc: DOC_A, seq: 1 })
    routeRpcLoadend(endEv({ responseText: respBodyWithPayload('ogiZ0b', p) }), new Map([['g', g]]))
    expect(g.error).toBe('rpc-shape:ogiZ0b@[0][0][6][2]')
  })

  it('메아리 불일치 → warn 만(내용 없음), 완료 정상', () => {
    const g = gen({ doc: DOC_A, seq: 1, normPrompt: '전혀 다른 프롬프트' })
    routeRpcLoadend(endEv(), new Map([['g', g]]))
    expect(g).toMatchObject({ completed: true, error: null })
    expect(logged()).toContain('echo-mismatch')
    expect(logged()).not.toContain(PROMPT)
    expect(logged()).not.toContain('전혀 다른')
  })

  it('잘못된 이벤트 → ok:false invalid', () => {
    expect(routeRpcLoadend(endEv({ doc: 'nope' }), new Map())).toEqual({ ok: false, reason: 'invalid' })
    expect(routeRpcLoadend(endEv({ seq: '1' }), new Map())).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('routeRpcLoadend — YhhmEf(영상 제출)', () => {
  const vgen = (over = {}) => gen({ rpc: 'YhhmEf', normPrompt: '왕이 궁전 내부를 산책하는 영상', wantRatio: undefined, wantModelKey: 'abra_t2v_6s', doc: DOC_A, seq: 1, ...over })
  const vend = (over = {}) => endEv({ rpcid: 'YhhmEf', responseText: sample('YhhmEf').respBody, ...over })

  it('gen 에 {mediaId, creditsLeft, modelKey} 를 싣고 완료', () => {
    const g = vgen()
    routeRpcLoadend(vend(), new Map([['v', g]]))
    expect(g).toMatchObject({ completed: true, error: null, mediaId: maskedUuid(11), creditsLeft: 1040, modelKey: 'abra_t2v_6s' })
  })

  it('[3] 이 2개인 사본 → flow-video-count-mismatch + rejectedMediaIds 2개, mediaId 없음', () => {
    const p = samplePayload('YhhmEf')
    const second = JSON.parse(JSON.stringify(p[3][0])); second[0] = '<uuid#12>'
    p[3].push(second)
    const g = vgen()
    routeRpcLoadend(vend({ responseText: respBodyWithPayload('YhhmEf', p) }), new Map([['v', g]]))
    expect(g).toMatchObject({ completed: true, error: 'flow-video-count-mismatch', errorKind: 'flow-video-count-mismatch', rejectedMediaIds: [maskedUuid(11), '<uuid#12>'] })
    expect(g.mediaId).toBeUndefined()
  })
})

describe('markDeadline / armDeadline — 초 단위 마감', () => {
  it('send 15s → flow-submit-not-sent (completed+error, 맵에 남는다)', () => {
    const g = gen()
    const map = new Map([['g', g]])
    armDeadline(g, 'send')
    vi.advanceTimersByTime(SEND_DEADLINE_S * 1000 - 1)
    expect(g.completed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(g).toMatchObject({ completed: true, error: 'flow-submit-not-sent', errorKind: 'flow-submit-not-sent' })
    expect(map.has('g')).toBe(true)
    expect(SEND_DEADLINE_S).toBe(15)
    expect(LOADEND_DEADLINE_S).toBe(100)
  })

  it('markDeadline 은 완료된 gen 을 덮지 않는다', () => {
    const g = gen({ completed: true, results: [{ mediaId: 'm' }] })
    expect(markDeadline(g, 'loadend')).toBe(false)
    expect(g.error).toBeNull()
  })
})

describe('routeRpcReport — kind 디스패치', () => {
  it('batchexecute-send → routeRpcSend, batchexecute → routeRpcLoadend, 그 외 → ok:false', () => {
    const g = gen()
    const ctx = { pendingGenerations: new Map([['g', g]]) }
    expect(routeRpcReport(sendEv(), ctx)).toEqual({ ok: true, bound: 'g' })
    expect(routeRpcReport(endEv(), ctx)).toEqual({ ok: true, completed: 'g' })
    expect(routeRpcReport({ kind: 'batchexecute-other' }, ctx)).toEqual({ ok: false, reason: 'unknown kind' })
    expect(routeRpcReport(sendEv(), {})).toEqual({ ok: false, reason: 'invalid' })
  })
})

// M2-R7 L1(A1): send 마감 15s 는 영상(YhhmEf)에선 최종이 아니다 — 페이지의 reCAPTCHA execute + batchexecute send 가 15s 를 넘기면(모달로 뷰가 0×0 이라
//   throttle · 느린 네트워크) 전엔 gen 이 not-sent 로 닫혀(핸들러가 맵에서 지워) 그 뒤의 send/loadend 가 unbound 로 버려졌다 — 서버는 과금했는데 행은 id 없이
//   "다시 시도". 이제 15s 엔 sendDeadlinePassed 표시 + onSendDeadline 훅(핸들러의 크레딧 재판독)뿐이고 클릭 뒤 100s(15+85)까지 바인딩 가능한 채로 둔다(grace 마감
//   → not-sent). 이미지(ogiZ0b)는 위 '마감' 블록 그대로 15s 에 not-sent.
describe('M2-R7 L1 — YhhmEf send 마감 유예(grace): 15s 는 표시·훅뿐, 클릭 뒤 100s 까지 바인딩 가능', () => {
  const VPROMPT = '왕이 궁전 내부를 산책하는 영상'
  const vgen = (over = {}) => gen({ rpc: 'YhhmEf', normPrompt: VPROMPT, wantRatio: undefined, ...over })
  const vsend = (over = {}) => sendEv({ rpcid: 'YhhmEf', rpcids: ['YhhmEf'], prompts: [VPROMPT], ...over })
  const vend = (over = {}) => endEv({ rpcid: 'YhhmEf', responseText: sample('YhhmEf').respBody, ...over })
  const GRACE_S = LOADEND_DEADLINE_S - SEND_DEADLINE_S   // 85

  it('(a) 15s: completed 아님 + sendDeadlinePassed + onSendDeadline 1회 + grace 타이머 → 16s 의 send 가 바인딩(grace 해제·loadend 100s·로그 late) → 22s 의 loadend 로 완료', () => {
    const hook = vi.fn()
    const g = vgen({ onSendDeadline: hook })
    const map = new Map([['v', g]])
    armDeadline(g, 'send')
    vi.advanceTimersByTime(SEND_DEADLINE_S * 1000)
    expect(g.completed).toBe(false)
    expect(g).toMatchObject({ sendDeadlinePassed: true, error: null, doc: null })
    expect(hook).toHaveBeenCalledTimes(1)
    expect(g.deadlines.send).toBeUndefined()
    expect(g.deadlines.grace).toBeTruthy()
    expect(logged()).toMatch(new RegExp(`\\[Flow RPC\\] YhhmEf deadline send ${SEND_DEADLINE_S}s passed → grace ${GRACE_S}s`))
    expect(logged()).not.toContain(VPROMPT)
    vi.advanceTimersByTime(1000)
    expect(routeRpcSend(vsend({ sentAt: NOW_S + 16 }), map)).toEqual({ ok: true, bound: 'v' })
    expect(g).toMatchObject({ doc: DOC_A, seq: 1, sentAt: NOW_S + 16, completed: false })
    expect(g.deadlines.grace).toBeUndefined()
    expect(g.deadlines.loadend).toBeTruthy()
    expect(logged()).toMatch(/\[Flow RPC\] YhhmEf send doc=a{8} seq=1 bound=v late/)
    vi.advanceTimersByTime(6000)
    expect(routeRpcLoadend(vend(), map)).toEqual({ ok: true, completed: 'v' })
    expect(g).toMatchObject({ completed: true, error: null, mediaId: maskedUuid(11), creditsLeft: 1040, modelKey: 'abra_t2v_6s' })
    expect(g.deadlines).toEqual({})
    expect(map.has('v')).toBe(true)
    // 유예 안의 바인딩은 loadend 마감(send 뒤 100s)을 정상대로 켠다 — 22s 에 완료됐으므로 더 이상 아무 마감도 울리지 않는다
    vi.advanceTimersByTime(LOADEND_DEADLINE_S * 1000)
    expect(g.error).toBeNull()
  })

  it('(b) send 없음: 100s 직전까지 completed 아님(훅 없이도 rpc 로 유예), 100s 에 flow-submit-not-sent(맵에 남는다), 그 뒤의 send 는 unbound', () => {
    const g = vgen()
    const map = new Map([['v', g]])
    armDeadline(g, 'send')
    vi.advanceTimersByTime(LOADEND_DEADLINE_S * 1000 - 1)
    expect(g).toMatchObject({ completed: false, sendDeadlinePassed: true, error: null })
    vi.advanceTimersByTime(1)
    expect(g).toMatchObject({ completed: true, error: 'flow-submit-not-sent', errorKind: 'flow-submit-not-sent' })
    expect(g.deadlines).toEqual({})
    expect(map.has('v')).toBe(true)
    expect(logged()).toMatch(new RegExp(`\\[Flow RPC\\] YhhmEf deadline grace ${GRACE_S}s → flow-submit-not-sent`))
    expect(routeRpcSend(vsend({ sentAt: NOW_S + 101 }), map)).toEqual({ ok: true, dropped: 'unbound' })
  })

  it('(c) onSendDeadline 이 gen 을 닫으면(크레딧 감소 → flow-submit-lost) grace 타이머가 정리되고 100s 에 덮어쓰지 않는다; 훅이 throw/reject 해도 유예는 산다', () => {
    const g = vgen({ onSendDeadline: (x) => settleGen(x, { error: 'flow-submit-lost', errorKind: 'flow-submit-lost' }) })
    armDeadline(g, 'send')
    vi.advanceTimersByTime(SEND_DEADLINE_S * 1000)
    expect(g).toMatchObject({ completed: true, error: 'flow-submit-lost', sendDeadlinePassed: true })
    expect(g.deadlines).toEqual({})
    vi.advanceTimersByTime(LOADEND_DEADLINE_S * 1000)
    expect(g).toMatchObject({ completed: true, error: 'flow-submit-lost' })
    for (const bad of [() => { throw new Error('x') }, async () => { throw new Error('x') }]) {
      const h = vgen({ onSendDeadline: bad })
      const map = new Map([['h', h]])
      armDeadline(h, 'send')
      vi.advanceTimersByTime(SEND_DEADLINE_S * 1000 + 1000)
      expect(h).toMatchObject({ completed: false, sendDeadlinePassed: true })
      expect(routeRpcSend(vsend({ sentAt: NOW_S + 16 }), map)).toEqual({ ok: true, bound: 'h' })
    }
  })

  it('(d) 바인딩 없는 YhhmEf 200 이 UUID 로 파싱되면 [Flow RPC] YhhmEf unbound loadend media=<8> + reportDomFailure(submit:unbound-loadend, 앞 8자만); 깨진 본문·비 200·이미지 rpc 는 throw 없이 기존 unbound 만', () => {
    settleGen(vgen(), { error: 'flow-submit-lost', errorKind: 'flow-submit-lost' })   // M2-R8 M4: 앱이 loadend 없이 닫은 YhhmEf gen 이 최근에 있다 — 보고 조건
    const report = vi.fn()
    const map = new Map()
    expect(routeRpcLoadend(vend({ seq: 9 }), map, { reportDomFailure: report })).toEqual({ ok: true, dropped: 'unbound' })
    expect(logged()).toMatch(/\[Flow RPC\] YhhmEf unbound loadend media=00000011\b/)
    expect(logged()).not.toContain(maskedUuid(11))
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('submit:unbound-loadend', 'unbound-loadend', { rpc: 'YhhmEf', seq: 9, media: '00000011' })
    expect(JSON.stringify(report.mock.calls)).not.toContain(maskedUuid(11))
    warn.mockClear(); log.mockClear()
    const none = vi.fn()
    expect(() => routeRpcLoadend(vend({ seq: 10, responseText: 'garbage' }), map, { reportDomFailure: none })).not.toThrow()
    expect(routeRpcLoadend(vend({ seq: 11, status: 500, responseText: '' }), map, { reportDomFailure: none })).toEqual({ ok: true, dropped: 'unbound' })
    expect(routeRpcLoadend(endEv({ seq: 12 }), map, { reportDomFailure: none })).toEqual({ ok: true, dropped: 'unbound' })
    expect(routeRpcLoadend(vend({ seq: 13 }), map)).toEqual({ ok: true, dropped: 'unbound' })   // report 없이도 로그는 남는다
    expect(logged()).toMatch(/unbound loadend media=00000011/)
    expect(logged().match(/unbound loadend media=/g)).toHaveLength(1)
    expect(none).not.toHaveBeenCalled()
    // report 가 throw/reject 해도 라우팅은 끝난다; routeRpcReport 는 ctx.reportDomFailure 를 넘긴다
    expect(routeRpcLoadend(vend({ seq: 14 }), map, { reportDomFailure: () => { throw new Error('x') } })).toEqual({ ok: true, dropped: 'unbound' })
    expect(routeRpcLoadend(vend({ seq: 15 }), map, { reportDomFailure: async () => { throw new Error('x') } })).toEqual({ ok: true, dropped: 'unbound' })
    const viaCtx = vi.fn()
    expect(routeRpcReport(vend({ seq: 16 }), { pendingGenerations: map, reportDomFailure: viaCtx })).toEqual({ ok: true, dropped: 'unbound' })
    expect(viaCtx).toHaveBeenCalledWith('submit:unbound-loadend', 'unbound-loadend', { rpc: 'YhhmEf', seq: 16, media: '00000011' })
    // M2-R8 M3(A3): 모델키가 문법을 못 넘는 200(UUID 는 검증됨 — 과금된 미디어) 도 파서의 rejectedMediaId 로 media 줄 + 보고; 레코드 2개(video-count — rejectedMediaIds 는 미검증) 는 media 줄 없음
    warn.mockClear(); log.mockClear()
    const badKey = samplePayload('YhhmEf'); badKey[3][0][7][0][12] = 'Bad Key'
    const reportBad = vi.fn()
    expect(routeRpcLoadend(vend({ seq: 17, responseText: respBodyWithPayload('YhhmEf', badKey) }), map, { reportDomFailure: reportBad })).toEqual({ ok: true, dropped: 'unbound' })
    expect(logged()).toMatch(/\[Flow RPC\] YhhmEf unbound loadend media=00000011\b/)
    expect(reportBad).toHaveBeenCalledWith('submit:unbound-loadend', 'unbound-loadend', { rpc: 'YhhmEf', seq: 17, media: '00000011' })
    expect(logged()).not.toContain('Bad Key')
    warn.mockClear(); log.mockClear()
    const two = samplePayload('YhhmEf'); const second = JSON.parse(JSON.stringify(two[3][0])); second[0] = maskedUuid(12); two[3].push(second)
    const reportTwo = vi.fn()
    expect(routeRpcLoadend(vend({ seq: 18, responseText: respBodyWithPayload('YhhmEf', two) }), map, { reportDomFailure: reportTwo })).toEqual({ ok: true, dropped: 'unbound' })
    expect(logged()).not.toMatch(/unbound loadend media=/)
    expect(reportTwo).not.toHaveBeenCalled()
  })
})

// M2-R8 M4(B2 + A4): 캡처 주입은 문서마다 설치돼 사용자가 Flow 뷰에서 **손으로** 만든 영상의 YhhmEf 도 보고한다 — 거짓 "DOM step failed"(Sentry 경고·바탕화면 진단 파일·
//   세션 슬롯 8개 중 1)이고, 그 dedupe 때문에 나중에 앱이 lost 로 닫은 gen 의 진짜 미바인딩 loadend(과금된 미디어)는 영영 보고되지 않았다. 라우터는 loadend 없이 닫은 YhhmEf gen
//   (not-sent·lost·cleared·multi-batch)의 시각을 짧은 TTL(120s)로 기록하고, 기록이 있을 때만 보고한다 — 없으면 로그만. 싱크는 스텝당 세션 1회만 보내므로 콘솔 줄이 미디어별 기록.
describe('M2-R8 M4 — 바인딩 없는 YhhmEf 200 보고는 최근(≤120s) 앱이 loadend 없이 닫은 YhhmEf gen 이 있을 때만', () => {
  const VPROMPT = '왕이 궁전 내부를 산책하는 영상'
  const vgen = (over = {}) => gen({ rpc: 'YhhmEf', normPrompt: VPROMPT, wantRatio: undefined, ...over })
  const vsend = (over = {}) => sendEv({ rpcid: 'YhhmEf', rpcids: ['YhhmEf'], prompts: [VPROMPT], ...over })
  const vend = (over = {}) => endEv({ rpcid: 'YhhmEf', responseText: sample('YhhmEf').respBody, ...over })

  it('(e) 닫은 gen 없음(사용자의 손 제출) → 로그만 "(no recent app close — not reported)", 보고 없음', () => {
    const report = vi.fn()
    expect(routeRpcLoadend(vend({ seq: 20 }), new Map(), { reportDomFailure: report })).toEqual({ ok: true, dropped: 'unbound' })
    expect(logged()).toMatch(/\[Flow RPC\] YhhmEf unbound loadend media=00000011 \(no recent app close — not reported\)/)
    expect(logged()).not.toContain(maskedUuid(11))
    expect(report).not.toHaveBeenCalled()
  })

  it.each([
    ['flow-submit-not-sent (send/grace 마감)', (g) => markDeadline(g, 'send')],
    ['flow-submit-lost (loadend 마감·failBoundUnfinished·15s 훅)', (g) => settleGen(g, { error: 'flow-submit-lost', errorKind: 'flow-submit-lost' })],
    ['flow-generation-cleared (사용자 clear)', (g) => settleGen(g, { error: 'flow-generation-cleared', errorKind: 'flow-generation-cleared' })],
    ['flow-rpc-multi-batch (send 의 multi)', (g) => routeRpcSend(vsend({ multi: true, rpcids: ['YhhmEf', 'Zzl0ze'] }), new Map([['v', g]]))],
  ])('(f) %s 로 닫힌 YhhmEf gen 뒤의 미바인딩 loadend → media 줄 + 보고', (_l, close) => {
    close(vgen())
    warn.mockClear(); log.mockClear()
    const report = vi.fn()
    expect(routeRpcLoadend(vend({ seq: 21 }), new Map(), { reportDomFailure: report })).toEqual({ ok: true, dropped: 'unbound' })
    expect(logged()).toMatch(/\[Flow RPC\] YhhmEf unbound loadend media=00000011$/m)
    expect(logged()).not.toMatch(/not reported/)
    expect(report).toHaveBeenCalledWith('submit:unbound-loadend', 'unbound-loadend', { rpc: 'YhhmEf', seq: 21, media: '00000011' })
  })

  it('(g) 기록은 TTL(120s) 뒤 만료 — 119s 엔 보고, 121s 엔 로그만; 이미지 gen(ogiZ0b)·generate-button-click-failed·loadend 로 닫힌 gen 은 기록하지 않는다', () => {
    expect(UNBOUND_CLOSE_TTL_S).toBe(120)
    settleGen(vgen(), { error: 'flow-submit-lost', errorKind: 'flow-submit-lost' })
    vi.advanceTimersByTime((UNBOUND_CLOSE_TTL_S - 1) * 1000)
    const r1 = vi.fn()
    routeRpcLoadend(vend({ seq: 22 }), new Map(), { reportDomFailure: r1 })
    expect(r1).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    const r2 = vi.fn()
    routeRpcLoadend(vend({ seq: 23 }), new Map(), { reportDomFailure: r2 })
    expect(r2).not.toHaveBeenCalled()
    // 기록되지 않는 닫힘들: 이미지 not-sent · 미발송 클릭 실패 · loadend(응답)로 닫힌 gen
    markDeadline(gen(), 'send')
    settleGen(vgen(), { error: 'generate-button-click-failed', errorKind: 'generate-button-click-failed' })
    const bound = vgen({ doc: DOC_A, seq: 30 })
    expect(routeRpcLoadend(vend({ seq: 30, status: 500, responseText: '' }), new Map([['b', bound]]))).toEqual({ ok: true, completed: 'b' })
    expect(bound.completed).toBe(true)
    const r3 = vi.fn()
    routeRpcLoadend(vend({ seq: 24 }), new Map(), { reportDomFailure: r3 })
    expect(r3).not.toHaveBeenCalled()
    expect(logged()).toMatch(/media=00000011 \(no recent app close — not reported\)/)
  })
})
