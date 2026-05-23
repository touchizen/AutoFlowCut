import { describe, it, expect } from 'vitest'
import { isQuotaExhaustedError } from '../../src/utils/quotaExhaustedDetect'

/**
 * 회귀 가드: object/Error 입력도 normalize 후 매칭돼야 한다.
 * 기존 string-only 가드가 IPC 에서 올라오는 { error: { message } } 같은 quota 응답을
 * 영영 매치하지 못해 video batch 가 안 멈추는 회귀의 원인이었다. 이제 string-only 시절
 * 의 `{ message } → false` 가드는 명시적으로 폐기.
 */
describe('isQuotaExhaustedError', () => {
  it('matches the canonical Flow quota error string', () => {
    expect(isQuotaExhaustedError('Resource has been exhausted (e.g. check quota).')).toBe(true)
  })

  it('matches RESOURCE_EXHAUSTED gRPC status code', () => {
    expect(isQuotaExhaustedError('status: RESOURCE_EXHAUSTED')).toBe(true)
  })

  it('matches "quota exceeded" variant', () => {
    expect(isQuotaExhaustedError('Daily quota exceeded for this project')).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(isQuotaExhaustedError('resource HAS been exhausted')).toBe(true)
  })

  it('does not match unrelated errors', () => {
    expect(isQuotaExhaustedError('reCAPTCHA blocked')).toBe(false)
    expect(isQuotaExhaustedError('429 Too Many Requests')).toBe(false)
    expect(isQuotaExhaustedError('Generation timeout')).toBe(false)
  })

  it('returns false for null / undefined / empty', () => {
    expect(isQuotaExhaustedError(null)).toBe(false)
    expect(isQuotaExhaustedError(undefined)).toBe(false)
    expect(isQuotaExhaustedError('')).toBe(false)
  })

  it('extracts message from Error instance', () => {
    expect(isQuotaExhaustedError(new Error('Resource has been exhausted'))).toBe(true)
    expect(isQuotaExhaustedError(new Error('Network error'))).toBe(false)
  })

  it('extracts message from { message } shape', () => {
    expect(isQuotaExhaustedError({ message: 'Resource has been exhausted' })).toBe(true)
    expect(isQuotaExhaustedError({ message: 'ok' })).toBe(false)
  })

  it('extracts message from gRPC-style { error: { message } } shape (IPC path)', () => {
    expect(isQuotaExhaustedError({
      error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' },
    })).toBe(true)
  })

  it('extracts from { error: "...quota..." } string shape', () => {
    expect(isQuotaExhaustedError({ error: 'quota exceeded' })).toBe(true)
  })
})
