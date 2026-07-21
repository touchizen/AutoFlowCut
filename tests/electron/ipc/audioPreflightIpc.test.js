import { describe, it, expect } from 'vitest'
import { buildAudioPreflightResult } from '../../../electron/ipc/story-api.js'

describe('buildAudioPreflightResult', () => {
  it('maps providers to keyId + status via resolveKeyWithSource', () => {
    const resolveKeyWithSource = (keyId) => ({
      genai: { key: 'g', source: 'store' },
      typecast: { key: 'e', source: 'fallback' },
      elevenlabs: { key: null, source: null },
    }[keyId])
    const res = buildAudioPreflightResult(['gemini', 'typecast', 'elevenlabs'], {
      resolveKeyWithSource, encryptionAvailable: true,
    })
    expect(res.providers).toEqual([
      { provider: 'gemini', keyId: 'genai', status: 'resolved-store', encryptionAvailable: true },
      { provider: 'typecast', keyId: 'typecast', status: 'resolved-fallback', encryptionAvailable: true },
      { provider: 'elevenlabs', keyId: 'elevenlabs', status: 'missing', encryptionAvailable: true },
    ])
    expect(res.encryptionAvailable).toBe(true)
  })
})
