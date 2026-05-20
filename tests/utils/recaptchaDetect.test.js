import { describe, it, expect } from 'vitest'
import { isRecaptchaError } from '../../src/utils/recaptchaDetect'

describe('isRecaptchaError', () => {
  it('detects "reCAPTCHA evaluation failed"', () => {
    expect(isRecaptchaError('reCAPTCHA evaluation failed')).toBe(true)
  })
  it('detects "unusual activity" message', () => {
    expect(isRecaptchaError('We noticed some unusual activity.')).toBe(true)
  })
  it('is case-insensitive', () => {
    expect(isRecaptchaError('RECAPTCHA Evaluation Failed')).toBe(true)
  })
  it('returns false for unrelated errors', () => {
    expect(isRecaptchaError('Generation timeout')).toBe(false)
    expect(isRecaptchaError('No images')).toBe(false)
  })
  it('returns false for non-string / empty input', () => {
    expect(isRecaptchaError(null)).toBe(false)
    expect(isRecaptchaError(undefined)).toBe(false)
    expect(isRecaptchaError('')).toBe(false)
    expect(isRecaptchaError(42)).toBe(false)
  })
})
