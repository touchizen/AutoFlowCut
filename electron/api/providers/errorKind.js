import { isAuthError } from '../../../src/utils/authError.js'
import { isQuotaExhaustedError } from '../../../src/utils/quotaStop.js'

export const ERROR_KINDS = [
  'auth',
  'forbidden',
  'quota',
  'transient',
  'safety',
  'invalid-config',
  'invalid-input',
  'other',
]

const TRANSIENT_ERROR = /\bHTTP\s+503\b|overloaded|temporarily unavailable|try again later|\bunavailable\b/i
const SAFETY_ERROR = /blocked by (?:the )?safety filter/i

export function classifyGoogleErrorKind(errorText) {
  if (isAuthError({ success: false, error: errorText })) return 'auth'
  if (isQuotaExhaustedError(errorText)) return 'quota'

  const text = String(errorText ?? '')
  if (TRANSIENT_ERROR.test(text)) return 'transient'
  if (SAFETY_ERROR.test(text)) return 'safety'
  return 'other'
}
