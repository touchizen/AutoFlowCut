// @vitest-environment node
//
// R17-P2: flow:report-response 의 라우팅을 routing-level 로 검증. 특히 video upscale(UpsampleVideo)
//   /status 응답이 pending T2V/I2V capture 를 resolve 하지 않아야 한다(이전 substring 버그 회귀 가드).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { routeReportResponse, isFlowFrameOrigin } from '../../electron/reportResponseRouter.js'

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

  it('rejects other origins (navigated/compromised page)', () => {
    expect(isFlowFrameOrigin('https://evil.example/fx/tools/flow')).toBe(false)
    expect(isFlowFrameOrigin('https://labs.google.evil.com/x')).toBe(false)
    expect(isFlowFrameOrigin('http://labs.google/fx')).toBe(false)  // wrong scheme
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
