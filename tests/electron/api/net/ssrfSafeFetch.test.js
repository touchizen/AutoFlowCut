import { describe, it, expect } from 'vitest'
import { isPreviewUrlAllowed } from '../../../../electron/api/net/ssrfSafeFetch.js'

describe('isPreviewUrlAllowed', () => {
  it('allows elevenlabs cdn https', () => {
    expect(isPreviewUrlAllowed('https://storage.googleapis.com/eleven-public-prod/x.mp3')).toBe(true)
    expect(isPreviewUrlAllowed('https://api.elevenlabs.io/v1/voices/x/preview')).toBe(true)
  })
  it('rejects http, non-allowlisted host, and ip literals', () => {
    expect(isPreviewUrlAllowed('http://api.elevenlabs.io/x')).toBe(false)
    expect(isPreviewUrlAllowed('https://evil.example.com/x.mp3')).toBe(false)
    expect(isPreviewUrlAllowed('https://127.0.0.1/x')).toBe(false)
    expect(isPreviewUrlAllowed('https://169.254.169.254/latest')).toBe(false)
  })
})
