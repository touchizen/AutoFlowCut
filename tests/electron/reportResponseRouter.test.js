// @vitest-environment node
//
// R17-P2: flow:report-response 의 라우팅을 routing-level 로 검증. 특히 video upscale(UpsampleVideo)
//   /status 응답이 pending T2V/I2V capture 를 resolve 하지 않아야 한다(이전 substring 버그 회귀 가드).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { routeReportResponse, isFlowFrameOrigin, buildReportCtx } from '../../electron/reportResponseRouter.js'
import { sample as rpcSample } from '../fixtures/flow-batchexecute-samples.js'

const T2V = 'https://x/video:batchAsyncGenerateVideoText'
const UPSCALE = 'https://x/video:batchAsyncGenerateVideoUpsampleVideo'
const STATUS = 'https://x/video:batchCheckAsyncVideoGenerationStatus'

function makeCtx({ pendingVideo = null, pendingGeneration = null } = {}) {
  let pv = pendingVideo
  let pg = pendingGeneration
  return {
    getPendingGeneration: () => pg,
    setPendingGeneration: (v) => { pg = v },
    pendingGenerations: new Map(),
    getPendingVideoGeneration: () => pv,
    setPendingVideoGeneration: (v) => { pv = v },
    _getPv: () => pv,
  }
}

beforeEach(() => { vi.clearAllMocks() })

describe('routeReportResponse — video routing', () => {
  it('T2V 제출 응답 + pending video(fresh) → resolve, pending 비움', () => {
    const resolve = vi.fn()
    const ctx = makeCtx({ pendingVideo: { setAt: 100, resolve } })
    const r = routeReportResponse({ url: T2V, body: '{}', status: 200, reqStartedAt: 200 }, ctx)
    expect(r).toEqual({ ok: true })
    expect(resolve).toHaveBeenCalledWith({ error: false, body: '{}', status: 200 })
    expect(ctx._getPv()).toBeNull()
  })

  it('upscale(UpsampleVideo) 응답은 pending T2V/I2V 를 resolve 하지 않는다', () => {
    const resolve = vi.fn()
    const ctx = makeCtx({ pendingVideo: { setAt: 100, resolve } })
    const r = routeReportResponse({ url: UPSCALE, body: '{}', status: 200, reqStartedAt: 200 }, ctx)
    expect(resolve).not.toHaveBeenCalled()
    expect(ctx._getPv()).not.toBeNull()       // pending 유지
    expect(r).toMatchObject({ ok: false })     // 캡처 안 함
  })

  it('status 응답도 pending video 를 resolve 하지 않는다', () => {
    const resolve = vi.fn()
    const ctx = makeCtx({ pendingVideo: { setAt: 100, resolve } })
    routeReportResponse({ url: STATUS, body: '{}', status: 200, reqStartedAt: 200 }, ctx)
    expect(resolve).not.toHaveBeenCalled()
    expect(ctx._getPv()).not.toBeNull()
  })

  it('T2V 이지만 stale(요청이 arm 이전 시작)이면 drop, pending 유지', () => {
    const resolve = vi.fn()
    const ctx = makeCtx({ pendingVideo: { setAt: 200, resolve } })
    const r = routeReportResponse({ url: T2V, body: '{}', status: 200, reqStartedAt: 100 }, ctx)
    expect(r).toMatchObject({ ok: true, stale: true })
    expect(resolve).not.toHaveBeenCalled()
    expect(ctx._getPv()).not.toBeNull()
  })

  it('status>=400 이면 error:true 로 resolve', () => {
    const resolve = vi.fn()
    const ctx = makeCtx({ pendingVideo: { setAt: 100, resolve } })
    routeReportResponse({ url: T2V, body: 'err', status: 500, reqStartedAt: 200 }, ctx)
    expect(resolve).toHaveBeenCalledWith({ error: true, body: 'err', status: 500 })
  })

  it('#R31-4: 본문이 비어도 에러 status 면 pending 을 resolve (timeout 방지)', () => {
    const resolve = vi.fn()
    const ctx = makeCtx({ pendingVideo: { setAt: 100, resolve } })
    const r = routeReportResponse({ url: T2V, body: '', status: 429, reqStartedAt: 200 }, ctx)
    expect(r).toEqual({ ok: true })
    expect(resolve).toHaveBeenCalledWith({ error: true, body: '', status: 429 })
  })

  it('#R31-4: 본문이 비고 status 도 성공이면 기존대로 무시', () => {
    const resolve = vi.fn()
    const ctx = makeCtx({ pendingVideo: { setAt: 100, resolve } })
    const r = routeReportResponse({ url: T2V, body: '', status: 200, reqStartedAt: 200 }, ctx)
    expect(r).toMatchObject({ ok: false })
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('routeReportResponse — image sync routing (추출 충실성)', () => {
  it('batchGenerateImages + sync pending(단일) → 즉시 resolve', () => {
    const resolve = vi.fn()
    const pending = { setAt: 100, expectedCount: 1, responses: [], collectionTimer: null, resolve }
    const ctx = makeCtx({ pendingGeneration: pending })
    const r = routeReportResponse({ url: 'https://x/images:batchGenerateImages', body: '{}', status: 200, reqStartedAt: 200 }, ctx)
    expect(r).toEqual({ ok: true })
    expect(resolve).toHaveBeenCalledWith({ error: false, responses: [{ error: false, body: '{}', status: 200 }] })
    expect(ctx.getPendingGeneration()).toBeNull()
  })

  it('관련 pending 없으면 no pending capture', () => {
    const ctx = makeCtx({})
    const r = routeReportResponse({ url: 'https://x/foo', body: '{}', status: 200 }, ctx)
    expect(r).toMatchObject({ ok: false })
  })
})

describe('isFlowFrameOrigin (#R23-2)', () => {
  it('accepts the legit Flow app origin', () => {
    expect(isFlowFrameOrigin('https://labs.google/fx/tools/flow')).toBe(true)
    expect(isFlowFrameOrigin('https://labs.google/fx/api/auth/session')).toBe(true)
  })

  // Google 이 Flow 를 flow.google.com 으로 옮겼다. 이 origin 을 안 받으면 페이지가 보고한
  // 생성 응답이 전부 'unauthorized origin' 으로 버려져 pending capture 가 타임아웃까지 매달린다
  // (증상이 "열기 무한 반복"에서 "생성이 영영 안 끝남"으로 바뀔 뿐이다).
  it('accepts the new Flow domain origin', () => {
    expect(isFlowFrameOrigin('https://flow.google.com/')).toBe(true)
    expect(isFlowFrameOrigin('https://flow.google.com/project/134cf5b5-6a64-47b8-8709-6de4c6b0e44c')).toBe(true)
  })

  it('rejects other origins (navigated/compromised page)', () => {
    expect(isFlowFrameOrigin('https://evil.example/fx/tools/flow')).toBe(false)
    expect(isFlowFrameOrigin('https://labs.google.evil.com/x')).toBe(false)
    expect(isFlowFrameOrigin('http://labs.google/fx')).toBe(false)  // wrong scheme
    expect(isFlowFrameOrigin('https://flow.google.com.evil.com/x')).toBe(false)
    expect(isFlowFrameOrigin('http://flow.google.com/')).toBe(false)  // wrong scheme
    expect(isFlowFrameOrigin('https://flow.google.com:444/')).toBe(false)  // wrong port
    // 로그인 리다이렉트가 실제로 착지하는 곳 — "https 이고 *.google.com 이면 통과" 로
    //   느슨해진 구현을 이 리터럴이 잡는다.
    expect(isFlowFrameOrigin('https://accounts.google.com/signin')).toBe(false)
  })

  it('rejects empty/invalid/non-string urls', () => {
    expect(isFlowFrameOrigin('')).toBe(false)
    expect(isFlowFrameOrigin(undefined)).toBe(false)
    expect(isFlowFrameOrigin(null)).toBe(false)
    expect(isFlowFrameOrigin('not a url')).toBe(false)
  })
})

// #R35: genTag 우선 매칭 — async 멘션 씬은 응답 보고에 실린 genTag 로 seed/promptKey 무관하게 확정 매칭.
const BATCH_IMG = 'https://x/flowMedia:batchGenerateImages'
function ctxWithAsync(entries = {}) {
  const pendingGenerations = new Map(Object.entries(entries))
  let pg = null
  return {
    getPendingGeneration: () => pg,
    setPendingGeneration: (v) => { pg = v },
    pendingGenerations,
    getPendingVideoGeneration: () => null,
    setPendingVideoGeneration: () => {},
  }
}

describe('routeReportResponse — #R35 genTag correlation', () => {
  it('genTag 가 pending 에 있으면 그 gen 에 응답 저장 + 완료 처리(seed/prompt 무관)', () => {
    const g = { setAt: 100, expectedCount: 1, responses: [], completed: false }
    const ctx = ctxWithAsync({ 'scene-async-1': g })
    const r = routeReportResponse(
      { url: BATCH_IMG, body: '{"img":1}', status: 200, requestBody: '{"unrelated":true}', reqStartedAt: 200, genTag: 'scene-async-1' },
      ctx,
    )
    expect(r).toMatchObject({ ok: true, matchedByGenTag: true })
    expect(g.responses).toHaveLength(1)
    expect(g.completed).toBe(true)
  })

  it('genTag 요청이 arm(setAt) 이전 시작이면 stale drop', () => {
    const g = { setAt: 300, expectedCount: 1, responses: [], completed: false }
    const ctx = ctxWithAsync({ 'scene-async-2': g })
    const r = routeReportResponse(
      { url: BATCH_IMG, body: '{}', status: 200, reqStartedAt: 100, genTag: 'scene-async-2' },
      ctx,
    )
    expect(r).toMatchObject({ ok: true, stale: true })
    expect(g.responses).toHaveLength(0)
    expect(g.completed).toBe(false)
  })

  it('#R35-fix(R7[1]): genTag 가 "있는데" pending 에 없으면 drop(폴백 금지 — sync 가로채기 방지)', () => {
    const g = { setAt: 100, expectedCount: 1, responses: [], completed: false, promptKey: 'a knight' }
    const ctx = ctxWithAsync({ 'gen-x': g })
    ctx.setPendingGeneration({ setAt: 50, expectedCount: 1, responses: [], resolve: () => {} })  // sync 동시 활성
    const r = routeReportResponse(
      { url: BATCH_IMG, body: '{}', status: 200, requestBody: JSON.stringify({ requests: [{ prompt: 'a knight' }] }), reqStartedAt: 200, genTag: 'already-collected-tag' },
      ctx,
    )
    expect(r).toMatchObject({ ok: true, stale: true })
    expect(g.responses).toHaveLength(0)
    expect(ctx.getPendingGeneration()).not.toBeNull()  // sync 그대로 유지
  })

  it('#R35-fix(R7[4]): 이미 완료된 gen 의 genTag 중복 응답은 append 안 함', () => {
    const g = { setAt: 100, expectedCount: 1, responses: [{ error: false, body: 'first', status: 200 }], completed: true }
    const ctx = ctxWithAsync({ 'scene-async-3': g })
    const r = routeReportResponse(
      { url: BATCH_IMG, body: 'dup', status: 200, reqStartedAt: 200, genTag: 'scene-async-3' },
      ctx,
    )
    expect(r).toMatchObject({ ok: true, duplicate: true })
    expect(g.responses).toHaveLength(1)
  })

  it('genTag 가 아예 없는 응답만 promptKey 라우팅으로 폴백', () => {
    const g = { setAt: 100, expectedCount: 1, responses: [], completed: false, promptKey: 'a knight' }
    const ctx = ctxWithAsync({ 'gen-x': g })
    const r = routeReportResponse(
      { url: BATCH_IMG, body: '{}', status: 200, requestBody: JSON.stringify({ requests: [{ prompt: 'a knight' }] }), reqStartedAt: 200 },  // genTag 없음
      ctx,
    )
    expect(r).toMatchObject({ ok: true })
    expect(g.responses).toHaveLength(1)
  })
})

// M1-4: flow.google.com batchexecute 캡처 이벤트는 첫 줄에서 rpc 라우터로 위임된다(url 없음). 옛 URL 페이로드는 불변.
describe('routeReportResponse — batchexecute 위임 (M1-4)', () => {
  const DOC = 'c'.repeat(32)
  const rpcGen = () => ({ rpc: 'ogiZ0b', doc: null, seq: null, sentAt: null, normPrompt: '궁정안에 있는 왕', wantRatio: '16:9', results: null, error: null, errorKind: null, completed: false, allowDomFallback: false, waiter: null, deadlines: {}, setAt: 1790240100 })

  it('kind:batchexecute-send → gen 바인딩, kind:batchexecute → gen 완료 (url 필드 없이)', () => {
    const g = rpcGen()
    const ctx = makeCtx({})
    ctx.pendingGenerations.set('gen-1', g)
    expect(routeReportResponse({ kind: 'batchexecute-send', doc: DOC, rpcid: 'ogiZ0b', rpcids: ['ogiZ0b'], seq: 1, prompts: ['궁정안에 있는 왕'], sentAt: 1790240102.5 }, ctx))
      .toEqual({ ok: true, bound: 'gen-1' })
    expect(g).toMatchObject({ doc: DOC, seq: 1 })
    expect(routeReportResponse({ kind: 'batchexecute', doc: DOC, rpcid: 'ogiZ0b', seq: 1, status: 200, responseText: rpcSample('ogiZ0b').respBody, endedAt: 1790240123 }, ctx))
      .toEqual({ ok: true, completed: 'gen-1' })
    expect(g.completed).toBe(true)
    expect(g.results[0]).toMatchObject({ mediaId: '<uuid#5>', width: 1376, height: 768 })
  })

  it('옛 URL 페이로드는 rpc gen 이 맵에 있어도 불변 경로로 간다(rpc gen 은 손대지 않는다)', () => {
    const g = rpcGen()
    const resolve = vi.fn()
    const ctx = makeCtx({ pendingVideo: { setAt: 100, resolve } })
    ctx.pendingGenerations.set('gen-1', g)
    expect(routeReportResponse({ url: T2V, body: '{}', status: 200, reqStartedAt: 200 }, ctx)).toEqual({ ok: true })
    expect(resolve).toHaveBeenCalledWith({ error: false, body: '{}', status: 200 })
    expect(routeReportResponse({ url: BATCH_IMG, body: '{"x":1}', status: 200, reqStartedAt: 200, requestBody: '{"prompt":"other"}' }, ctx)).toMatchObject({ ok: false })
    expect(g).toMatchObject({ doc: null, completed: false, results: null })
  })

  it('buildReportCtx(state) 는 main 의 상태 접근자를 그대로 ctx 로 (다른 필드는 만들지 않는다)', () => {
    let pg = null; let pv = null
    const pendingGenerations = new Map()
    const ctx = buildReportCtx({
      getPendingGeneration: () => pg, setPendingGeneration: (v) => { pg = v }, pendingGenerations,
      getPendingVideoGeneration: () => pv, setPendingVideoGeneration: (v) => { pv = v },
    })
    ctx.setPendingGeneration({ setAt: 1 }); expect(ctx.getPendingGeneration()).toEqual({ setAt: 1 })
    ctx.setPendingVideoGeneration({ setAt: 2 }); expect(ctx.getPendingVideoGeneration()).toEqual({ setAt: 2 })
    expect(ctx.pendingGenerations).toBe(pendingGenerations)
    expect(Object.keys(ctx).sort()).toEqual(['getPendingGeneration', 'getPendingVideoGeneration', 'pendingGenerations', 'setPendingGeneration', 'setPendingVideoGeneration'])
  })
})
