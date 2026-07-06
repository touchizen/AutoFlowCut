import { describe, it, expect, vi } from 'vitest'
import { isPreviewUrlAllowed, ssrfSafeFetch } from '../../../../electron/api/net/ssrfSafeFetch.js'

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

  it('allows ElevenLabs regional API subdomains (BUG 2: api.us.elevenlabs.io preview_urls were rejected)', () => {
    expect(isPreviewUrlAllowed('https://api.us.elevenlabs.io/v1/voices/x/preview')).toBe(true)
    expect(isPreviewUrlAllowed('https://elevenlabs.io/x')).toBe(true)
  })

  it('rejects a lookalike host that merely has elevenlabs.io as a prefix', () => {
    expect(isPreviewUrlAllowed('https://elevenlabs.io.attacker.com/x')).toBe(false)
  })

  it('rejects http even for an otherwise-allowed elevenlabs regional host', () => {
    expect(isPreviewUrlAllowed('http://api.us.elevenlabs.io/x')).toBe(false)
  })
})

describe('ssrfSafeFetch — byte cap', () => {
  it('rejects up-front via content-length before reading the body', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0))
    const fetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: {
        get: (k) => (k === 'content-type' ? 'audio/mpeg' : k === 'content-length' ? String(6 * 1024 * 1024) : null),
      },
      arrayBuffer,
    }))
    await expect(ssrfSafeFetch('https://api.elevenlabs.io/v1/voices/x/preview', { fetch }))
      .rejects.toThrow('preview too large')
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('still rejects oversized body when content-length is missing/lying (backstop)', async () => {
    const bigBuf = new ArrayBuffer(6 * 1024 * 1024)
    const fetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: { get: (k) => (k === 'content-type' ? 'audio/mpeg' : null) },
      arrayBuffer: async () => bigBuf,
    }))
    await expect(ssrfSafeFetch('https://api.elevenlabs.io/v1/voices/x/preview', { fetch }))
      .rejects.toThrow('preview too large')
  })

  it('does not reject up-front on a malformed content-length header (falls to backstop)', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0))
    const fetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: {
        get: (k) => (k === 'content-type' ? 'audio/mpeg' : k === 'content-length' ? 'abc' : null),
      },
      arrayBuffer,
    }))
    const result = await ssrfSafeFetch('https://api.elevenlabs.io/v1/voices/x/preview', { fetch })
    expect(result.mimeType).toBe('audio/mpeg')
    expect(arrayBuffer).toHaveBeenCalled()
  })

  it('rejects up-front on a strictly-parsed oversized content-length', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0))
    const fetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: {
        get: (k) => (k === 'content-type' ? 'audio/mpeg' : k === 'content-length' ? '99999999' : null),
      },
      arrayBuffer,
    }))
    await expect(ssrfSafeFetch('https://api.elevenlabs.io/v1/voices/x/preview', { fetch }))
      .rejects.toThrow('preview too large')
    expect(arrayBuffer).not.toHaveBeenCalled()
  })
})

describe('ssrfSafeFetch — MIME canonicalization', () => {
  it('accepts case-variant content-type with charset param and returns canonical mimeType', async () => {
    const fetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: {
        get: (k) => (k === 'content-type' ? 'Audio/Mpeg; charset=binary' : null),
      },
      arrayBuffer: async () => new ArrayBuffer(0),
    }))
    const result = await ssrfSafeFetch('https://api.elevenlabs.io/v1/voices/x/preview', { fetch })
    expect(result.mimeType).toBe('audio/mpeg')
  })
})

describe('ssrfSafeFetch — redirect bound', () => {
  it('throws too many redirects instead of looping forever', async () => {
    const fetch = vi.fn(async () => ({
      status: 302,
      ok: false,
      headers: { get: (k) => (k === 'location' ? 'https://api.elevenlabs.io/v1/voices/x/preview' : null) },
      arrayBuffer: async () => new ArrayBuffer(0),
    }))
    await expect(ssrfSafeFetch('https://api.elevenlabs.io/v1/voices/x/preview', { fetch }))
      .rejects.toThrow('too many redirects')
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(6)
  })
})
