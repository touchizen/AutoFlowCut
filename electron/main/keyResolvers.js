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

  const ttsKeyFor = {
    typecast: () => multiKeyStore.getKey('typecast') || typecastFallback(),
    elevenlabs: () => multiKeyStore.getKey('elevenlabs') || credFallback('elevenlabs', 'ELEVENLABS_API_KEY'),
    googletts: () => multiKeyStore.getKey('googletts') || credFallback('googletts', 'GOOGLE_TTS_API_KEY'),
    gemini: () => genaiKeyStore.getKey() ?? null,
  }
  const sfxKeyFor = {
    elevenlabs: ttsKeyFor.elevenlabs,
  }
  return { ttsKeyFor, sfxKeyFor }
}
