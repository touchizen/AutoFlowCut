/**
 * formatGoogleApiError — Google API 에러 객체 → renderer 친화 string.
 *
 * 회귀 컨텍스트: 기존 코드 (flow-api.js, video.js, etc.) 가 `err.message || JSON.stringify(err)`
 * 만 추출해서 status 를 통째로 버렸다. 결과적으로 renderer 의 isQuotaExhaustedError 가
 * "RESOURCE_EXHAUSTED" 같은 status-only quota 신호를 못 잡아 quota 도달 후에도 batch 가
 * 멈추지 못하는 회귀가 video / image / thumbnails 곳곳에서 반복.
 */
import { describe, it, expect } from 'vitest'
import { formatGoogleApiError } from '../../electron/ipc/googleApiError.js'

describe('formatGoogleApiError', () => {
  it('null/undefined → null', () => {
    expect(formatGoogleApiError(null)).toBe(null)
    expect(formatGoogleApiError(undefined)).toBe(null)
  })

  it('string → 그대로', () => {
    expect(formatGoogleApiError('plain')).toBe('plain')
  })

  it('회귀 핵심: message + status 둘 다 노출', () => {
    const text = formatGoogleApiError({ message: 'Request failed', status: 'RESOURCE_EXHAUSTED' })
    expect(text).toContain('Request failed')
    expect(text).toContain('RESOURCE_EXHAUSTED')
  })

  it('message 만 있으면 message', () => {
    expect(formatGoogleApiError({ message: 'oh no' })).toBe('oh no')
  })

  it('status 만 있으면 status', () => {
    expect(formatGoogleApiError({ status: 'RESOURCE_EXHAUSTED' })).toBe('RESOURCE_EXHAUSTED')
  })

  it('빈 object → JSON.stringify fallback', () => {
    expect(formatGoogleApiError({})).toBe('{}')
  })

  it('알 수 없는 shape → JSON.stringify', () => {
    expect(formatGoogleApiError({ foo: 'bar' })).toContain('foo')
  })
})
