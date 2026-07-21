import { describe, it, expect } from 'vitest'
import { API_KEY_REGISTRY, keyIdForProvider, storeForProvider } from '../../src/config/apiKeyRegistry.js'

describe('apiKeyRegistry', () => {
  it('maps gemini story-provider to genai keyId', () => {
    expect(keyIdForProvider('gemini')).toBe('genai')
    expect(storeForProvider('gemini')).toBe('genai')
    expect(API_KEY_REGISTRY.gemini.validate).toBe(true)
  })

  it('tts providers keep their id and use multi store, no validation', () => {
    for (const p of ['typecast', 'elevenlabs', 'googletts']) {
      expect(keyIdForProvider(p)).toBe(p)
      expect(storeForProvider(p)).toBe('multi')
      expect(API_KEY_REGISTRY[p].validate).toBe(false)
    }
  })

  it('unknown provider falls through to itself', () => {
    expect(keyIdForProvider('mystery')).toBe('mystery')
  })

  it('each provider carries a get-key url (single source of truth for AudioKeyGateCard/ApiKeyTab)', () => {
    expect(API_KEY_REGISTRY.typecast.url).toBe('https://app.typecast.ai')
    expect(API_KEY_REGISTRY.elevenlabs.url).toBe('https://elevenlabs.io/app/settings/api-keys')
    expect(API_KEY_REGISTRY.googletts.url).toBe('https://console.cloud.google.com/apis/credentials')
    expect(API_KEY_REGISTRY.gemini.url).toBe('https://aistudio.google.com/apikey')
  })
})
