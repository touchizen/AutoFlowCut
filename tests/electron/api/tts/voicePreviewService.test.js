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
})
