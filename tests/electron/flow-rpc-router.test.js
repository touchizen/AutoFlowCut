// @vitest-environment node
//
// M1-3/M1-4 — batchexecute 캡처 이벤트 ↔ pendingGenerations 상관 라우터(순수).
// 시각은 초(Date.now()/1000), 테스트는 가짜 시계 + 실제 epoch(1790240102.5).
//   send    : 후보(rpc 동일·미바인딩·미완료·setAt <= sentAt) 1개면 바인딩(프롬프트 달라도 + warn), 2개 이상이면
//             정규화 프롬프트 일치 중 최고령, 없으면 unbound. multi → flow-rpc-multi-batch.
//   loadend : {doc, seq} 로 gen 을 찾아 파싱·완료. 같은 seq 라도 doc 이 다르면 남. 완료된 gen 은 duplicate.
//   마감    : send 15s → flow-submit-not-sent, loadend 100s → flow-submit-lost. completed+error, 맵에 남는다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  failBoundUnfinished, routeRpcSend, routeRpcLoadend, routeRpcReport, markDeadline, armDeadline,
  SEND_DEADLINE_S, LOADEND_DEADLINE_S,
} from '../../electron/flow-rpc-router.js'
import { sample, samplePayload, respBodyWithPayload, respBodyFailure } from '../fixtures/flow-batchexecute-samples.js'

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
    expect(g.results[0]).toMatchObject({ mediaId: '<uuid#5>', width: 1376, height: 768, seed: 1687588041 })
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
    expect(g1.results[0].mediaId).toBe('<uuid#5>')
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
    expect(g).toMatchObject({ completed: true, error: null, mediaId: '<uuid#11>', creditsLeft: 1040, modelKey: 'abra_t2v_6s' })
  })

  it('[3] 이 2개인 사본 → flow-video-count-mismatch + rejectedMediaIds 2개, mediaId 없음', () => {
    const p = samplePayload('YhhmEf')
    const second = JSON.parse(JSON.stringify(p[3][0])); second[0] = '<uuid#12>'
    p[3].push(second)
    const g = vgen()
    routeRpcLoadend(vend({ responseText: respBodyWithPayload('YhhmEf', p) }), new Map([['v', g]]))
    expect(g).toMatchObject({ completed: true, error: 'flow-video-count-mismatch', errorKind: 'flow-video-count-mismatch', rejectedMediaIds: ['<uuid#11>', '<uuid#12>'] })
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
