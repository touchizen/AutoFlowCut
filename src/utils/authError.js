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
  const err = String(result.error || '').toLowerCase()
  // 레거시 Flow OAuth
  if (err.includes('http 401')) return true
  if (err.includes('unauthenticated')) return true
  if (err.includes('invalid authentication')) return true
  // BYOK Gemini 키 거부
  if (err.includes('api key not valid')) return true
  if (err.includes('api_key_invalid')) return true
  if (err.includes('permission_denied')) return true
  return false
}
