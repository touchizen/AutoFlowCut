import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  normalizeErrorText,
  isQuotaExhaustedError,
  emitQuotaStop,
  subscribeQuotaStop,
  isQuotaBlocked,
  notifyQuotaModalDismissed,
  __resetQuotaStopForTests,
} from '../../src/utils/quotaStop'

beforeEach(() => {
  __resetQuotaStopForTests()
})

describe('normalizeErrorText', () => {
  it('passes strings through', () => {
    expect(normalizeErrorText('boom')).toBe('boom')
  })
  it('returns empty for null/undefined', () => {
    expect(normalizeErrorText(null)).toBe('')
    expect(normalizeErrorText(undefined)).toBe('')
  })
  it('extracts Error.message', () => {
    expect(normalizeErrorText(new Error('hi'))).toBe('hi')
  })
  it('extracts { message }', () => {
    expect(normalizeErrorText({ message: 'm' })).toBe('m')
  })
  it('extracts nested { error: { message } } + status (combined)', () => {
    const text = normalizeErrorText({ error: { message: 'quota', status: 'RESOURCE_EXHAUSTED' } })
    expect(text).toContain('quota')
    expect(text).toContain('RESOURCE_EXHAUSTED')
  })

  it('extracts nested { error: { message } } only when status missing', () => {
    expect(normalizeErrorText({ error: { message: 'just message' } })).toBe('just message')
  })
  it('extracts string { error }', () => {
    expect(normalizeErrorText({ error: 'plain text err' })).toBe('plain text err')
  })
  it('falls back to status:statusText combo when message missing', () => {
    expect(normalizeErrorText({ status: 429, statusText: 'Too Many Requests' })).toBe('429: Too Many Requests')
  })
  it('JSON-stringifies unknown shapes', () => {
    expect(normalizeErrorText({ foo: 'bar' })).toContain('foo')
  })

  it('회귀: { error: { message, status } } 둘 다 있으면 합쳐서 반환 (status 도 quota 매칭 후보)', () => {
    const text = normalizeErrorText({
      error: { message: 'Request failed', status: 'RESOURCE_EXHAUSTED' },
    })
    expect(text).toContain('Request failed')
    expect(text).toContain('RESOURCE_EXHAUSTED')
  })

  it('회귀: top-level { message, status } 도 둘 다 합침', () => {
    const text = normalizeErrorText({ message: 'Request failed', status: 429, statusText: 'Too Many Requests' })
    expect(text).toContain('Request failed')
    expect(text).toContain('429')
  })
})

describe('isQuotaExhaustedError — status-only quota signal (회귀)', () => {
  it('message 는 generic 인데 status 만 RESOURCE_EXHAUSTED 인 응답도 매치', () => {
    expect(isQuotaExhaustedError({
      error: { message: 'Request failed', status: 'RESOURCE_EXHAUSTED' },
    })).toBe(true)
  })

  it('Error.cause 같은 wrapper 안에 message+status 분리돼 있어도 합쳐서 매치', () => {
    expect(isQuotaExhaustedError({
      message: 'API failed',
      status: 'RESOURCE_EXHAUSTED',
    })).toBe(true)
  })
})

describe('isQuotaExhaustedError (object inputs)', () => {
  it('matches { error: { message: "Resource has been exhausted" } }', () => {
    expect(isQuotaExhaustedError({ error: { message: 'Resource has been exhausted (e.g. check quota).' } })).toBe(true)
  })
  it('matches Error("RESOURCE_EXHAUSTED")', () => {
    expect(isQuotaExhaustedError(new Error('RESOURCE_EXHAUSTED'))).toBe(true)
  })
  it('does not match non-quota object', () => {
    expect(isQuotaExhaustedError({ message: 'Network down' })).toBe(false)
  })
})

describe('emitQuotaStop', () => {
  it('마킹: stopRequestedRef.current=true 로 만들고 quota-blocked 상태로 진입', () => {
    const stopRef = { current: false }
    expect(isQuotaBlocked()).toBe(false)
    const fired = emitQuotaStop({ stopRequestedRef: stopRef, scope: 'Test' })
    expect(stopRef.current).toBe(true)
    expect(isQuotaBlocked()).toBe(true)
    expect(fired).toBe(true)
  })

  it('listener 는 매번 호출 (idempotency 는 listener 책임 — queue clear 회귀 방지)', () => {
    const stopRef = { current: false }
    const listener = vi.fn()
    subscribeQuotaStop(listener)

    emitQuotaStop({ stopRequestedRef: stopRef, scope: 'Test' })
    emitQuotaStop({ stopRequestedRef: stopRef, scope: 'Test' })
    emitQuotaStop({ stopRequestedRef: stopRef, scope: 'Test' })

    // 매번 호출 — caller A 가 clearQueue 없이 emit 한 뒤 caller B 가 clearQueue 가진 채
    // emit 해도 두 번째 emit 의 listener 가 무시되면 큐가 안 비는 회귀가 있었음.
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('두 번째 호출은 firstTrigger=false 반환', () => {
    const stopRef = { current: false }
    expect(emitQuotaStop({ stopRequestedRef: stopRef, scope: 'Test' })).toBe(true)
    expect(emitQuotaStop({ stopRequestedRef: stopRef, scope: 'Test' })).toBe(false)
  })

  it('두 번째 emit 도 listener 에 firstTrigger=false 신호 전달', () => {
    const stopRef = { current: false }
    const listener = vi.fn()
    subscribeQuotaStop(listener)

    emitQuotaStop({ stopRequestedRef: stopRef, scope: 'A' })
    emitQuotaStop({ stopRequestedRef: stopRef, scope: 'B' })

    expect(listener).toHaveBeenNthCalledWith(1, expect.objectContaining({ firstTrigger: true }))
    expect(listener).toHaveBeenNthCalledWith(2, expect.objectContaining({ firstTrigger: false }))
  })

  it('listener throw 가 다른 listener 를 막지 않는다', () => {
    const stopRef = { current: false }
    const badListener = vi.fn(() => { throw new Error('boom') })
    const goodListener = vi.fn()
    subscribeQuotaStop(badListener)
    subscribeQuotaStop(goodListener)

    emitQuotaStop({ stopRequestedRef: stopRef, scope: 'Test' })

    expect(badListener).toHaveBeenCalledTimes(1)
    expect(goodListener).toHaveBeenCalledTimes(1)
  })

  it('stopRequestedRef 없이도 안전하게 동작', () => {
    expect(() => emitQuotaStop({ scope: 'NoRef' })).not.toThrow()
    expect(isQuotaBlocked()).toBe(true)
  })
})

describe('quota-block lifecycle', () => {
  it('notifyQuotaModalDismissed → unblock, 다음 emit 은 다시 첫 트리거', () => {
    const stopRef1 = { current: false }
    const stopRef2 = { current: false }
    const listener = vi.fn()
    subscribeQuotaStop(listener)

    emitQuotaStop({ stopRequestedRef: stopRef1, scope: 'Batch1' })
    expect(isQuotaBlocked()).toBe(true)
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ firstTrigger: true }))

    notifyQuotaModalDismissed()
    expect(isQuotaBlocked()).toBe(false)

    emitQuotaStop({ stopRequestedRef: stopRef2, scope: 'Batch2' })
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ firstTrigger: true }))
  })
})

describe('subscribeQuotaStop', () => {
  it('unsubscribe 함수 호출 시 더 이상 알림 안 받음', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeQuotaStop(listener)

    emitQuotaStop({ stopRequestedRef: { current: false }, scope: 'A' })
    expect(listener).toHaveBeenCalledTimes(1)

    notifyQuotaModalDismissed()
    unsubscribe()

    emitQuotaStop({ stopRequestedRef: { current: false }, scope: 'B' })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
