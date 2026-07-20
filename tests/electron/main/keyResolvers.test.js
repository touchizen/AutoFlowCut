import { describe, it, expect, vi } from 'vitest'
import { buildKeyResolvers } from '../../../electron/main/keyResolvers.js'

const store = (map) => ({ getKey: (p) => map[p] ?? null })

describe('buildKeyResolvers (nullable, dev switch)', () => {
  it('typecast: store hit wins, never throws', () => {
    const { ttsKeyFor } = buildKeyResolvers({
      multiKeyStore: store({ typecast: 'store-key' }), genaiKeyStore: store({}),
      getTypecastKey: () => { throw new Error('should not be called') },
      readCredentialsKey: () => null, disableFallback: false,
    })
    expect(ttsKeyFor.typecast()).toBe('store-key')
  })

  it('typecast: falls back to loader, returns null instead of throwing when absent', () => {
    const { ttsKeyFor } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({}),
      getTypecastKey: () => { throw new Error('not found') },
      readCredentialsKey: () => null, disableFallback: false,
    })
    expect(ttsKeyFor.typecast()).toBe(null)
  })

  it('disableFallback: ignores env/credentials, store-only', () => {
    const { ttsKeyFor } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({}),
      getTypecastKey: () => 'env-key', readCredentialsKey: () => 'cred-key', disableFallback: true,
    })
    expect(ttsKeyFor.typecast()).toBe(null)
    expect(ttsKeyFor.elevenlabs()).toBe(null)
  })

  it('gemini resolves from genaiKeyStore only, calling getKey() with no arguments (real keyStore.getKey() contract)', () => {
    const getKey = vi.fn(() => 'g')
    const { ttsKeyFor } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: { getKey },
      getTypecastKey: () => null, readCredentialsKey: () => null, disableFallback: false,
    })
    expect(ttsKeyFor.gemini()).toBe('g')
    expect(getKey).toHaveBeenCalledWith()
  })

  it('sfx elevenlabs mirrors tts elevenlabs resolution', () => {
    const { sfxKeyFor } = buildKeyResolvers({
      multiKeyStore: store({ elevenlabs: 'e' }), genaiKeyStore: store({}),
      getTypecastKey: () => null, readCredentialsKey: () => null, disableFallback: false,
    })
    expect(sfxKeyFor.elevenlabs()).toBe('e')
  })
})
