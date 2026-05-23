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

  it('does not false-positive on the digits "401" in other contexts', () => {
    // We require either "HTTP 401" or auth keywords — bare "401" alone is ambiguous
    expect(isAuthError({ success: false, error: 'Generated 401 frames in batch' })).toBe(false)
  })

  it('handles non-string and missing error fields safely', () => {
    expect(() => isAuthError({ success: false, error: 401 })).not.toThrow()
    expect(isAuthError({ success: false, error: 401 })).toBe(false)
    expect(isAuthError({ success: false })).toBe(false)
  })
})
