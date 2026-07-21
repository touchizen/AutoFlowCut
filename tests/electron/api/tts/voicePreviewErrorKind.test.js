import { describe, it, expect } from 'vitest'
import { createVoicePreviewService } from '../../../../electron/api/tts/voicePreviewService.js'
import { MissingProviderKeyError, ProviderAuthError } from '../../../../electron/api/keyErrors.js'

function makeService(throwErr) {
  return createVoicePreviewService({
    cacheDir: '/tmp/nope-cache',
    ttsFor: () => ({ synthesize: async () => { throw throwErr } }),
    voiceMeta: () => ({}),
    ssrfSafeFetch: async () => ({ audio: Buffer.alloc(0), mimeType: 'audio/mpeg' }),
    fetch: async () => ({}),
    fs: { existsSync: () => false, readFileSync: () => Buffer.alloc(0), mkdirSync: () => {}, writeFileSync: () => {}, renameSync: () => {} },
  })
}

describe('voicePreviewService getPreview — errorKind classification', () => {
  it('MissingProviderKeyError → {error:"no-key", provider}', async () => {
    const svc = makeService(new MissingProviderKeyError('typecast'))
    const res = await svc.getPreview({ provider: 'typecast', voiceId: 'v1', language: 'ko' })
    expect(res).toEqual({ error: 'no-key', provider: 'typecast' })
  })
  it('ProviderAuthError → {error:"unauthorized", provider}', async () => {
    const svc = makeService(new ProviderAuthError('gemini', { status: 400 }))
    const res = await svc.getPreview({ provider: 'gemini', voiceId: 'Kore', language: 'ko' })
    expect(res).toEqual({ error: 'unauthorized', provider: 'gemini' })
  })
  it('generic error → {error:"failed", provider}', async () => {
    const svc = makeService(new Error('network boom'))
    const res = await svc.getPreview({ provider: 'elevenlabs', voiceId: 'x', language: 'ko' })
    expect(res).toEqual({ error: 'failed', provider: 'elevenlabs' })
  })
})
