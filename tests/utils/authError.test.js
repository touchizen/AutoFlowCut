import { describe, it, expect } from 'vitest'
import { isAuthError } from '../../src/utils/authError'

describe('isAuthError', () => {
  it('returns false for successful results', () => {
    expect(isAuthError({ success: true })).toBe(false)
    expect(isAuthError({ success: true, statuses: [] })).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError(undefined)).toBe(false)
  })

  it('returns false for non-auth errors', () => {
    expect(isAuthError({ success: false, error: 'RESOURCE_EXHAUSTED' })).toBe(false)
    expect(isAuthError({ success: false, error: 'HTTP 500: server error' })).toBe(false)
    expect(isAuthError({ success: false, error: 'Network error' })).toBe(false)
  })

  it('detects HTTP 401 errors', () => {
    expect(isAuthError({ success: false, error: 'HTTP 401: bad token' })).toBe(true)
  })

  it('detects UNAUTHENTICATED status (case-insensitive)', () => {
    expect(isAuthError({ success: false, error: 'UNAUTHENTICATED' })).toBe(true)
    expect(isAuthError({ success: false, error: 'unauthenticated' })).toBe(true)
    expect(isAuthError({ success: false, error: 'Request had invalid authentication credentials. status: UNAUTHENTICATED' })).toBe(true)
  })

  it('detects "invalid authentication" phrase', () => {
    expect(isAuthError({ success: false, error: 'Request had invalid authentication credentials' })).toBe(true)
  })

  it('detects BYOK Gemini key rejection (400 invalid / API_KEY_INVALID / 403 PERMISSION_DENIED)', () => {
    expect(isAuthError({ success: false, error: 'HTTP 400 :: API key not valid. Please pass a valid API key. :: INVALID_ARGUMENT' })).toBe(true)
    expect(isAuthError({ success: false, error: 'API_KEY_INVALID' })).toBe(true)
    expect(isAuthError({ success: false, error: 'HTTP 403 :: Permission denied :: PERMISSION_DENIED' })).toBe(true)
  })

  it('does not false-positive on the digits "401" in other contexts', () => {
    // We require either "HTTP 401" or auth keywords — bare "401" alone is ambiguous
    expect(isAuthError({ success: false, error: 'Generated 401 frames in batch' })).toBe(false)
  })

  it('handles non-string and missing error fields safely', () => {
    expect(() => isAuthError({ success: false, error: 401 })).not.toThrow()
    expect(isAuthError({ success: false, error: 401 })).toBe(false)
    expect(isAuthError({ success: false })).toBe(false)
  })

  // §5.11 errorKind 우선 진리표: provider 분류가 authoritative, 없으면 문자열 폴백
  describe('errorKind priority (§5.11)', () => {
    it('errorKind 정의됨 → errorKind 만 판정, 문자열 매칭 안 함', () => {
      // provider 가 auth 로 분류 → 문자열에 auth 신호 없어도 true
      expect(isAuthError({ success: false, errorKind: 'auth', error: 'some opaque failure' })).toBe(true)
      // provider 가 other 로 분류 → error 문자열에 'http 401' 있어도 false (collision)
      expect(isAuthError({ success: false, errorKind: 'other', error: 'HTTP 401: bad token' })).toBe(false)
      // forbidden 은 auth 아님
      expect(isAuthError({ success: false, errorKind: 'forbidden', error: 'API key not valid' })).toBe(false)
      // quota 는 auth 아님
      expect(isAuthError({ success: false, errorKind: 'quota' })).toBe(false)
    })

    it('errorKind 없음 → 기존 문자열 폴백 (회귀 0)', () => {
      expect(isAuthError({ success: false, error: 'HTTP 401: bad token' })).toBe(true)
      expect(isAuthError({ success: false, error: 'RESOURCE_EXHAUSTED' })).toBe(false)
    })

    it('errorKind:undefined 명시도 폴백 취급', () => {
      expect(isAuthError({ success: false, errorKind: undefined, error: 'HTTP 401' })).toBe(true)
    })

    it('errorKind:null 은 "미분류" 관용구 → 폴백 (F1: hooks 의 `errorKind ?? null`)', () => {
      // stored item state 가 forward 될 때 errorKind:null 이 authoritative false 로
      // 문자열 폴백을 억누르면 dead-key 배치가 폭주한다. null 은 undefined 처럼 폴백.
      expect(isAuthError({ success: false, errorKind: null, error: 'HTTP 401: bad token' })).toBe(true)
      expect(isAuthError({ success: false, errorKind: null, error: 'Network error' })).toBe(false)
    })

    it('success guard 가 errorKind 보다 우선 (F4: success:true 면 errorKind 무시)', () => {
      expect(isAuthError({ success: true, errorKind: 'auth' })).toBe(false)
    })
  })
})
