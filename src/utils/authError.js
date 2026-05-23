/**
 * Detects whether an IPC result represents an OAuth 401 / unauthenticated error.
 *
 * Conservative — requires explicit auth signals, not bare "401" digits.
 * Used by `withAuthRetry` and long-polling loops to decide on refresh/break.
 *
 * @param {{ success?: boolean, error?: string } | null | undefined} result
 * @returns {boolean}
 */
export function isAuthError(result) {
  if (!result || result.success) return false
  const err = String(result.error || '').toLowerCase()
  if (err.includes('http 401')) return true
  if (err.includes('unauthenticated')) return true
  if (err.includes('invalid authentication')) return true
  return false
}
