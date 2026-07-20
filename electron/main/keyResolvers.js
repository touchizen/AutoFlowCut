/**
 * 키 resolver 빌더(순수·주입) — 모든 provider 를 nullable 로 통일한다(어댑터의 requireKey 가
 * missing throw 를 담당, spec §4.1/4.8). typecast 의 throwing loader 만 try/catch 로 감싼다.
 * disableFallback(AUTOFLOWCUT_DISABLE_KEY_FALLBACK) 이면 env/credentials 폴백을 건너뛴다(§4.9).
 */
export function buildKeyResolvers({ multiKeyStore, genaiKeyStore, getTypecastKey, readCredentialsKey, disableFallback }) {
  const typecastFallback = () => {
    if (disableFallback) return null
    try { return getTypecastKey() ?? null } catch { return null }
  }
  const credFallback = (svc, envVar) => (disableFallback ? null : (readCredentialsKey(svc, envVar) ?? null))

  const STORE_KEY = { typecast: 'typecast', elevenlabs: 'elevenlabs', googletts: 'googletts' }
  const FALLBACK = {
    typecast: typecastFallback,
    elevenlabs: () => credFallback('elevenlabs', 'ELEVENLABS_API_KEY'),
    googletts: () => credFallback('googletts', 'GOOGLE_TTS_API_KEY'),
  }
  function resolveKeyWithSource(keyId) {
    if (keyId === 'genai') {
      const k = genaiKeyStore.getKey() ?? null
      return k ? { key: k, source: 'store' } : { key: null, source: null }
    }
    const storeId = STORE_KEY[keyId]
    const stored = storeId ? (multiKeyStore.getKey(storeId) || null) : null
    if (stored) return { key: stored, source: 'store' }
    const fb = FALLBACK[keyId] ? FALLBACK[keyId]() : null
    return fb ? { key: fb, source: 'fallback' } : { key: null, source: null }
  }

  // ttsKeyFor/sfxKeyFor는 resolveKeyWithSource에서 key만 뽑아 쓴다(Finding2) — store→fallback
  // 체인을 두 곳에서 독립적으로 정의하면 드리프트 위험이다: preflight 예측(resolveKeyWithSource)과
  // 실제 합성(ttsKeyFor)이 갈라질 수 있는 유일한 축이라 resolveKeyWithSource를 단일 정의로 삼는다.
  const ttsKeyFor = {
    typecast: () => resolveKeyWithSource('typecast').key,
    elevenlabs: () => resolveKeyWithSource('elevenlabs').key,
    googletts: () => resolveKeyWithSource('googletts').key,
    gemini: () => resolveKeyWithSource('genai').key,
  }
  const sfxKeyFor = {
    elevenlabs: ttsKeyFor.elevenlabs,
  }

  return { ttsKeyFor, sfxKeyFor, resolveKeyWithSource }
}
