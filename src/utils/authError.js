/**
 * Detects whether an IPC result represents an auth / API-key failure.
 *
 * Conservative — requires explicit auth signals, not bare "401" digits.
 * Covers both the legacy Flow OAuth 401/unauthenticated case and the BYOK
 * Gemini key-rejection case (HTTP 400 "API key not valid" / API_KEY_INVALID,
 * HTTP 403 PERMISSION_DENIED). All of these mean "the user must fix their key
 * in Settings" → the batch should stop rather than hammer every scene.
 *
 * @param {{ success?: boolean, error?: string } | null | undefined} result
 * @returns {boolean}
 */
export function isAuthError(result) {
  if (!result || result.success) return false
  // §5.11 진리표: provider 가 errorKind 를 달았으면 그것만 판정(문자열 매칭 안 함).
  // provider 분류가 authoritative — errorKind:'other' 면 문자열에 'http 401' 있어도 auth 아님.
  // null 은 이 코드베이스에서 "미분류" 관용구(hooks 의 `errorKind ?? null`) → undefined 와 동일 취급, 문자열 폴백.
  // (Error 가드는 불필요: 폴백이 .message 가 아닌 .error 만 읽어 Error 는 어차피 무의미 — quotaStop 과 비대칭이나 의도적.)
  if (result.errorKind != null) return result.errorKind === 'auth'
  const err = String(result.error || '').toLowerCase()
  // 레거시 Flow OAuth
  if (err.includes('http 401')) return true
  if (err.includes('unauthenticated')) return true
  if (err.includes('invalid authentication')) return true
  // BYOK Gemini 키 거부
  if (err === 'no api key') return true
  if (err.includes('api key not valid')) return true
  if (err.includes('api_key_invalid')) return true
  if (err.includes('permission_denied')) return true
  return false
}
