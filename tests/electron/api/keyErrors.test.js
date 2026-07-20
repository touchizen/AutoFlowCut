import { describe, it, expect } from 'vitest'
import { MissingProviderKeyError, ProviderAuthError, isAuthResponse } from '../../../electron/api/keyErrors.js'

describe('keyErrors', () => {
  it('MissingProviderKeyError carries provider + errorKind', () => {
    const e = new MissingProviderKeyError('typecast')
    expect(e).toBeInstanceOf(Error)
    expect(e.provider).toBe('typecast')
    expect(e.errorKind).toBe('story-audio-no-tts-key')
    expect(e.message).toMatch(/typecast/i)
  })

  it('ProviderAuthError carries status/detail + errorKind', () => {
    const e = new ProviderAuthError('gemini', { status: 400, detail: 'API_KEY_INVALID' })
    expect(e.provider).toBe('gemini')
    expect(e.status).toBe(400)
    expect(e.errorKind).toBe('story-audio-tts-auth')
  })

  it('isAuthResponse: 401/403 are auth', () => {
    expect(isAuthResponse(401)).toBe(true)
    expect(isAuthResponse(403)).toBe(true)
  })

  it('isAuthResponse: Google 400 API_KEY_INVALID is auth, other 400 is not', () => {
    expect(isAuthResponse(400, '{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}')).toBe(true)
    expect(isAuthResponse(400, 'quota exceeded')).toBe(false)
  })

  it('isAuthResponse: 5xx / 429 are not auth', () => {
    expect(isAuthResponse(500)).toBe(false)
    expect(isAuthResponse(429)).toBe(false)
  })
})
