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
