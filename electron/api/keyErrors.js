/**
 * 표준 키 에러 — 어댑터/SFX가 missing/auth 실패를 raw 문자열 대신 errorKind 있는 타입으로 던진다.
 * errorKind 는 stepMachine 집계·resolveDisplayError 가 로케일 안내로 변환한다(spec §4.8).
 */
export class MissingProviderKeyError extends Error {
  constructor(provider) {
    super(`No ${provider} API key`)
    this.name = 'MissingProviderKeyError'
    this.provider = provider
    this.errorKind = 'story-audio-no-tts-key'
  }
}

export class ProviderAuthError extends Error {
  constructor(provider, { status, detail } = {}) {
    super(`${provider} auth failed: ${status}`)
    this.name = 'ProviderAuthError'
    this.provider = provider
    this.status = status
    this.detail = detail
    this.errorKind = 'story-audio-tts-auth'
  }
}

/**
 * HTTP 응답이 인증 실패인가. Typecast/ElevenLabs 는 401/403; Google 계열(Gemini/GoogleTTS)은
 * 무효 키에 400 + reason 'API_KEY_INVALID' 를 준다 — 모든 400 이 아니라 이 reason 만 auth.
 */
export function isAuthResponse(status, detail = '') {
  if (status === 401 || status === 403) return true
  if (status === 400 && /API_KEY_INVALID/i.test(String(detail))) return true
  return false
}
