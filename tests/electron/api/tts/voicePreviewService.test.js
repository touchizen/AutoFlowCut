import { describe, it, expect, vi } from 'vitest'
import { createVoicePreviewService } from '../../../../electron/api/tts/voicePreviewService.js'

function deps(over = {}) {
  const files = {}
  const fs = {
    existsSync: (p) => p in files,
    readFileSync: (p) => files[p],
    writeFileSync: (p, d) => { files[p] = d },
    renameSync: (a, b) => { files[b] = files[a]; delete files[a] },
    mkdirSync: () => {},
  }
  return {
    cacheDir: '/cache',
    fs,
    files,
    ttsFor: () => ({ synthesize: vi.fn(async () => ({ audio: Buffer.from('WAVDATA'), format: 'wav' })) }),
    voiceMeta: () => ({ previewUrl: null, language: 'ko' }),
    ssrfSafeFetch: vi.fn(async () => ({ audio: Buffer.from('MP3'), mimeType: 'audio/mpeg' })),
    ...over,
  }
}

describe('voicePreviewService', () => {
  it('synthesizes Typecast preview and caches to disk', async () => {
    const d = deps()
    const svc = createVoicePreviewService(d)
    const r = await svc.getPreview({ provider: 'typecast', voiceId: 'v1', language: 'ko' })
    expect(r.mimeType).toBe('audio/wav')
    expect(Buffer.from(r.audioBase64, 'base64').toString()).toBe('WAVDATA')
    // second call hits disk cache (synthesize not called again)
    const spy = d.ttsFor().synthesize
    await svc.getPreview({ provider: 'typecast', voiceId: 'v1', language: 'ko' })
    // cached file exists
    expect(Object.keys(d.files).length).toBeGreaterThan(0)
  })
  it('uses ssrfSafeFetch when previewUrl present (elevenlabs)', async () => {
    const d = deps({ voiceMeta: () => ({ previewUrl: 'https://api.elevenlabs.io/x', language: 'en' }) })
    const svc = createVoicePreviewService(d)
    const r = await svc.getPreview({ provider: 'elevenlabs', voiceId: 'e1', language: 'en' })
    expect(d.ssrfSafeFetch).toHaveBeenCalled()
    expect(r.mimeType).toBe('audio/mpeg')
  })
  it('returns error object when no key (synthesize throws no-key)', async () => {
    const d = deps({ ttsFor: () => ({ synthesize: async () => { throw new Error('No Typecast API key') } }) })
    const svc = createVoicePreviewService(d)
    const r = await svc.getPreview({ provider: 'typecast', voiceId: 'v1', language: 'ko' })
    expect(r.error).toBeTruthy()
  })

  it('caches audio/mpeg preview_url response as .mp3 and returns audio/mpeg on cache-hit (not audio/wav)', async () => {
    const d = deps({
      voiceMeta: () => ({ previewUrl: 'https://api.elevenlabs.io/x', language: 'en' }),
      ssrfSafeFetch: vi.fn(async () => ({ audio: Buffer.from('MP3DATA'), mimeType: 'audio/mpeg' })),
    })
    const svc = createVoicePreviewService(d)
    const r = await svc.getPreview({ provider: 'elevenlabs', voiceId: 'e1', language: 'en' })
    expect(r.mimeType).toBe('audio/mpeg')
    const cachedPath = Object.keys(d.files).find((p) => p.endsWith('.mp3'))
    expect(cachedPath).toBeTruthy()
    expect(Object.keys(d.files).some((p) => p.endsWith('.wav'))).toBe(false)

    // cache-hit path: ssrfSafeFetch must not be called again, and mimeType must still be audio/mpeg.
    const r2 = await svc.getPreview({ provider: 'elevenlabs', voiceId: 'e1', language: 'en' })
    expect(r2.mimeType).toBe('audio/mpeg')
    expect(d.ssrfSafeFetch).toHaveBeenCalledTimes(1)
  })

  it('treats an unknown/unsupported content-type from preview_url as an error, not a .wav mislabel', async () => {
    const d = deps({
      voiceMeta: () => ({ previewUrl: 'https://api.elevenlabs.io/x', language: 'en' }),
      ssrfSafeFetch: vi.fn(async () => ({ audio: Buffer.from('???'), mimeType: 'application/octet-stream' })),
    })
    const svc = createVoicePreviewService(d)
    const r = await svc.getPreview({ provider: 'elevenlabs', voiceId: 'e2', language: 'en' })
    expect(r).toEqual({ error: 'failed', provider: 'elevenlabs' })
    expect(Object.keys(d.files).length).toBe(0)
  })

  it('canonicalizes content-type params/case before matching (e.g. "Audio/Mpeg; charset=utf-8")', async () => {
    const d = deps({
      voiceMeta: () => ({ previewUrl: 'https://api.elevenlabs.io/x', language: 'en' }),
      ssrfSafeFetch: vi.fn(async () => ({ audio: Buffer.from('MP3DATA'), mimeType: 'Audio/Mpeg; charset=utf-8' })),
    })
    const svc = createVoicePreviewService(d)
    const r = await svc.getPreview({ provider: 'elevenlabs', voiceId: 'e3', language: 'en' })
    expect(r.mimeType).toBe('audio/mpeg')
    expect(Object.keys(d.files).some((p) => p.endsWith('.mp3'))).toBe(true)
  })
})
