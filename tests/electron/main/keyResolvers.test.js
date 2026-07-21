import { describe, it, expect, vi } from 'vitest'
import { buildKeyResolvers } from '../../../electron/main/keyResolvers.js'
import { API_KEY_REGISTRY } from '../../../src/config/apiKeyRegistry.js'

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

  it('automatically resolves a provider added only to API_KEY_REGISTRY', () => {
    const provider = 'registry-drift-provider'
    const keyId = 'registry-drift-key'
    const hadProvider = Object.prototype.hasOwnProperty.call(API_KEY_REGISTRY, provider)
    const previous = API_KEY_REGISTRY[provider]
    API_KEY_REGISTRY[provider] = { keyId, store: 'multi', validate: false, label: 'Drift Guard', url: '' }

    // 전역 registry를 쓰는 실제 경로를 검증하되 실패해도 다른 테스트/import cache를 오염시키지 않는다.
    try {
      const { ttsKeyFor, resolveKeyWithSource } = buildKeyResolvers({
        multiKeyStore: store({ [keyId]: 'registry-key' }), genaiKeyStore: store({}),
        getTypecastKey: () => null, readCredentialsKey: () => null, disableFallback: false,
      })

      expect(ttsKeyFor[provider]).toBeTypeOf('function')
      expect(ttsKeyFor[provider]()).toBe('registry-key')
      expect(resolveKeyWithSource(keyId)).toEqual({ key: 'registry-key', source: 'store' })
    } finally {
      if (hadProvider) API_KEY_REGISTRY[provider] = previous
      else delete API_KEY_REGISTRY[provider]
    }
  })

  it('routes a registry provider with store:genai through the genai key store (not just keyId===genai)', () => {
    // store 분류는 keyId 이름이 아니라 registry의 store로 파생돼야 한다 — genai store 를 쓰는
    // 다른 keyId provider(예: 미래의 vertex)가 추가돼도 genaiKeyStore 로 라우팅돼야 한다.
    const provider = 'drift-genai-provider'
    const keyId = 'drift-genai-key'   // 일부러 'genai' 가 아니다
    const hadProvider = Object.prototype.hasOwnProperty.call(API_KEY_REGISTRY, provider)
    const previous = API_KEY_REGISTRY[provider]
    API_KEY_REGISTRY[provider] = { keyId, store: 'genai', validate: true, label: 'Drift Genai', url: '' }

    try {
      const { ttsKeyFor, resolveKeyWithSource } = buildKeyResolvers({
        multiKeyStore: store({}), genaiKeyStore: { getKey: () => 'genai-secret' },
        getTypecastKey: () => null, readCredentialsKey: () => null, disableFallback: false,
      })

      expect(ttsKeyFor[provider]()).toBe('genai-secret')
      expect(resolveKeyWithSource(keyId)).toEqual({ key: 'genai-secret', source: 'store' })
    } finally {
      if (hadProvider) API_KEY_REGISTRY[provider] = previous
      else delete API_KEY_REGISTRY[provider]
    }
  })
})
