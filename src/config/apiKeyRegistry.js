/**
 * storyProvider ↔ keyId ↔ store 매핑(순수). Story 화자 provider 이름('gemini')과 키 store
 * 식별자('genai')가 다르다 — 이 테이블만이 별칭의 단일 진실이다(spec §4.3). main·renderer 공용.
 *   store 'genai': 단일 keyStore(genai-key.enc), useApiKey, 저장 전 검증.
 *   store 'multi': keyStoreMulti, useTtsKeys, 검증 없음.
 */
export const API_KEY_REGISTRY = {
  typecast:   { keyId: 'typecast',   store: 'multi', validate: false, label: 'Typecast' },
  elevenlabs: { keyId: 'elevenlabs', store: 'multi', validate: false, label: 'ElevenLabs' },
  gemini:     { keyId: 'genai',      store: 'genai', validate: true,  label: 'Google Gemini' },
  googletts:  { keyId: 'googletts',  store: 'multi', validate: false, label: 'Google Cloud TTS' },
}

export function keyIdForProvider(storyProvider) {
  return API_KEY_REGISTRY[storyProvider]?.keyId ?? storyProvider
}

export function storeForProvider(storyProvider) {
  return API_KEY_REGISTRY[storyProvider]?.store ?? 'multi'
}
