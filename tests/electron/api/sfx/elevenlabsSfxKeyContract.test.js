import { describe, it, expect } from 'vitest'
import { createElevenLabsSfxAdapter } from '../../../../electron/api/sfx/elevenlabs.js'
import { MissingProviderKeyError, ProviderAuthError } from '../../../../electron/api/keyErrors.js'

describe('sfx elevenlabs key contract', () => {
  it('generate throws MissingProviderKeyError without key', async () => {
    const a = createElevenLabsSfxAdapter({ getKey: () => null, fetch: async () => ({ ok: true }), provider: 'elevenlabs' })
    await expect(a.generate({ description: 'boom' })).rejects.toBeInstanceOf(MissingProviderKeyError)
  })

  it('generate maps 401 to ProviderAuthError', async () => {
    const a = createElevenLabsSfxAdapter({ getKey: () => 'k', fetch: async () => ({ ok: false, status: 401, text: async () => 'no' }), provider: 'elevenlabs' })
    await expect(a.generate({ description: 'boom' })).rejects.toBeInstanceOf(ProviderAuthError)
  })
})
