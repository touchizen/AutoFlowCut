// @vitest-environment node

/**
 * createGenerationTimeout — 동기 이미지 생성의 응답 대기 타임아웃.
 *
 * 회귀 가드(R8-P1): 타이머는 pendingGeneration 을 arm 한 직후에 만들어야 하고,
 *   만료 콜백은 "자기 pending(ownPending)"만 identity 로 정리해야 한다.
 *   (제출 게이트가 최대 180s 폴링 → arm 전에 만들면 hang + 다른 pending 오삭제.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGenerationTimeout, createOwnedCollectionTimer, isStaleResponse, isVideoSubmitEndpoint } from '../../electron/flow-generation-timeout.js'

describe('createGenerationTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('만료 시 자기 pending 을 비우고 timeout 에러로 resolve 한다', () => {
    const own = { id: 'mine' }
    let pending = own
    const resolve = vi.fn()
    createGenerationTimeout({
      ownPending: own,
      getPending: () => pending,
      setPending: (v) => { pending = v },
      resolve,
    })
    expect(resolve).not.toHaveBeenCalled()
    vi.advanceTimersByTime(120000)
    expect(pending).toBeNull()
    expect(resolve).toHaveBeenCalledWith({ error: true, message: 'Response timeout (120s)' })
  })

  it('만료 전 다른 생성이 pending 을 교체하면 건드리지 않는다 (identity 가드)', () => {
    const own = { id: 'mine' }
    const other = { id: 'other' }
    let pending = other  // 자기 만료 전에 다른 생성이 pending 을 arm
    const resolve = vi.fn()
    createGenerationTimeout({
      ownPending: own,
      getPending: () => pending,
      setPending: (v) => { pending = v },
      resolve,
    })
    vi.advanceTimersByTime(120000)
    expect(pending).toBe(other)            // 다른 pending 보존
    expect(resolve).not.toHaveBeenCalled() // 남의 대기를 깨지 않음
  })

  it('pending 이 이미 null(응답 처리 완료)이면 아무것도 안 한다', () => {
    const own = { id: 'mine' }
    let pending = null
    const resolve = vi.fn()
    createGenerationTimeout({
      ownPending: own,
      getPending: () => pending,
      setPending: (v) => { pending = v },
      resolve,
    })
    vi.advanceTimersByTime(120000)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('clearTimeout 으로 취소하면 콜백이 돌지 않는다', () => {
    const own = {}
    let pending = own
    const resolve = vi.fn()
    const t = createGenerationTimeout({
      ownPending: own,
      getPending: () => pending,
      setPending: (v) => { pending = v },
      resolve,
    })
    clearTimeout(t)
    vi.advanceTimersByTime(120000)
    expect(resolve).not.toHaveBeenCalled()
    expect(pending).toBe(own)
  })

  it('timeoutMs 를 받아 메시지에 초를 반영한다', () => {
    const own = {}
    let pending = own
    const resolve = vi.fn()
    createGenerationTimeout({
      ownPending: own,
      getPending: () => pending,
      setPending: (v) => { pending = v },
      resolve,
      timeoutMs: 90000,
    })
    vi.advanceTimersByTime(90000)
    expect(resolve).toHaveBeenCalledWith({ error: true, message: 'Response timeout (90s)' })
  })

  it('만료 시 owner 의 collectionTimer 도 정리한다 (multi-image partial 후 stale timer 방지)', () => {
    const collectionHandle = setTimeout(() => {}, 999999)
    const own = { collectionTimer: collectionHandle }
    let pending = own
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    createGenerationTimeout({
      ownPending: own,
      getPending: () => pending,
      setPending: (v) => { pending = v },
      resolve: vi.fn(),
    })
    vi.advanceTimersByTime(120000)
    expect(clearSpy).toHaveBeenCalledWith(collectionHandle)
    clearSpy.mockRestore()
  })
})

describe('createOwnedCollectionTimer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('만료 시 owner 가 아직 현재 pending 이면 모은 responses 로 resolve 하고 비운다', () => {
    const own = { responses: [{ body: 'a' }, { body: 'b' }], resolve: vi.fn() }
    let pending = own
    createOwnedCollectionTimer({
      owner: own,
      getPending: () => pending,
      setPending: (v) => { pending = v },
    })
    vi.advanceTimersByTime(30000)
    expect(pending).toBeNull()
    expect(own.resolve).toHaveBeenCalledWith({ error: false, responses: own.responses })
  })

  it('만료 전 다른 생성이 pending 을 교체하면 새 pending 을 건드리지 않는다 (identity 가드)', () => {
    const own = { responses: [{ body: 'a' }], resolve: vi.fn() }
    const other = { responses: [], resolve: vi.fn() }
    let pending = other  // 다른 생성이 arm
    createOwnedCollectionTimer({
      owner: own,
      getPending: () => pending,
      setPending: (v) => { pending = v },
    })
    vi.advanceTimersByTime(30000)
    expect(pending).toBe(other)         // 새 pending 보존
    expect(own.resolve).not.toHaveBeenCalled()
    expect(other.resolve).not.toHaveBeenCalled()
  })

  it('clearTimeout 으로 취소하면 콜백이 돌지 않는다', () => {
    const own = { responses: [], resolve: vi.fn() }
    let pending = own
    const t = createOwnedCollectionTimer({
      owner: own,
      getPending: () => pending,
      setPending: (v) => { pending = v },
    })
    clearTimeout(t)
    vi.advanceTimersByTime(30000)
    expect(own.resolve).not.toHaveBeenCalled()
    expect(pending).toBe(own)
  })
})

describe('isStaleResponse', () => {
  it('reqStartedAt < setAt 면 stale(true) — 이전 생성의 늦은 응답', () => {
    expect(isStaleResponse(100, 200)).toBe(true)
  })
  it('reqStartedAt >= setAt 면 stale 아님(false)', () => {
    expect(isStaleResponse(200, 200)).toBe(false)
    expect(isStaleResponse(300, 200)).toBe(false)
  })
  it('reqStartedAt 가 숫자가 아니면(미전달) stale 판정 안 함(false)', () => {
    expect(isStaleResponse(undefined, 200)).toBe(false)
    expect(isStaleResponse(null, 200)).toBe(false)
    expect(isStaleResponse('x', 200)).toBe(false)
  })
  it('setAt 가 falsy 면 비교 불가 → false', () => {
    expect(isStaleResponse(100, 0)).toBe(false)
    expect(isStaleResponse(100, undefined)).toBe(false)
  })
})

describe('isVideoSubmitEndpoint', () => {
  const T2V = 'https://x/video:batchAsyncGenerateVideoText'
  const I2V = 'https://x/video:batchAsyncGenerateVideoStartImage'
  const I2V_END = 'https://x/video:batchAsyncGenerateVideoStartAndEndImage'
  const REF = 'https://x/video:batchAsyncGenerateVideoReferenceImages'
  const UPSCALE = 'https://x/video:batchAsyncGenerateVideoUpsampleVideo'

  it('T2V/I2V/I2V_END submit endpoint 는 true', () => {
    expect(isVideoSubmitEndpoint(T2V)).toBe(true)
    expect(isVideoSubmitEndpoint(I2V)).toBe(true)
    expect(isVideoSubmitEndpoint(I2V_END)).toBe(true)
  })
  it('#R36-ref: @멘션 reference-to-video 제출(ReferenceImages) 도 submit endpoint 로 잡아 완료감지→다운로드로 넘어가게 한다', () => {
    expect(isVideoSubmitEndpoint(REF)).toBe(true)
  })
  it('upscale(UpsampleVideo)·status 는 false (pending T2V/I2V 를 resolve 하면 안 됨)', () => {
    expect(isVideoSubmitEndpoint(UPSCALE)).toBe(false)
    expect(isVideoSubmitEndpoint('https://x/video:batchCheckAsyncVideoGenerationStatus')).toBe(false)
  })
  it('비문자열은 false', () => {
    expect(isVideoSubmitEndpoint(null)).toBe(false)
    expect(isVideoSubmitEndpoint(undefined)).toBe(false)
  })
  it('R17-P3: query/suffix 에 method 문자열이 섞여도 false (path RPC method 정확 비교)', () => {
    // query 에 method 이름이 들어간 다른 RPC
    expect(isVideoSubmitEndpoint('https://x/video:somethingElse?rpc=batchAsyncGenerateVideoText')).toBe(false)
    // method 가 prefix 로만 일치(Extra suffix) — substring 이면 false positive
    expect(isVideoSubmitEndpoint('https://x/video:batchAsyncGenerateVideoTextExtra')).toBe(false)
    // 정상 endpoint 에 query 가 붙어도 true
    expect(isVideoSubmitEndpoint(T2V + '?alt=proto')).toBe(true)
  })
  it('R18-P3: resource 가 video 가 아닌 bare segment 는 false (정확히 video:<method>만)', () => {
    expect(isVideoSubmitEndpoint('https://x/anything/batchAsyncGenerateVideoText')).toBe(false)
    expect(isVideoSubmitEndpoint('https://x/notvideo:batchAsyncGenerateVideoText')).toBe(false)
  })
})
