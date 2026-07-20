import { describe, it, expect } from 'vitest'
import { createTtsAdapter } from '../../../../electron/api/tts/index.js'
import { MissingProviderKeyError, ProviderAuthError } from '../../../../electron/api/keyErrors.js'

const okAudioFetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4), json: async () => ({}) })

describe('adapter 2-tier key contract', () => {
  for (const provider of ['typecast', 'elevenlabs', 'googletts']) {
    it(`${provider}: synthesize throws MissingProviderKeyError when key is null`, async () => {
      const a = createTtsAdapter(provider, { getKey: () => null, fetch: okAudioFetch, provider })
      await expect(a.synthesize({ text: 'hi', voiceId: 'v1' })).rejects.toBeInstanceOf(MissingProviderKeyError)
    })

    it(`${provider}: listVoices does NOT throw without key (seed fallback)`, async () => {
      const a = createTtsAdapter(provider, { getKey: () => null, fetch: okAudioFetch, provider })
      const voices = await a.listVoices({})
      expect(Array.isArray(voices)).toBe(true)
    })

    it(`${provider}: 401 maps to ProviderAuthError`, async () => {
      const authFetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })
      const a = createTtsAdapter(provider, { getKey: () => 'k', fetch: authFetch, provider })
      await expect(a.synthesize({ text: 'hi', voiceId: 'v1' })).rejects.toBeInstanceOf(ProviderAuthError)
    })
  }

  it('googletts: 400 API_KEY_INVALID maps to ProviderAuthError', async () => {
    const g400 = async () => ({ ok: false, status: 400, text: async () => '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}' })
    const a = createTtsAdapter('googletts', { getKey: () => 'bad', fetch: g400, provider: 'googletts' })
    await expect(a.synthesize({ text: 'hi', voiceId: 'ko-KR-A' })).rejects.toBeInstanceOf(ProviderAuthError)
  })
})
