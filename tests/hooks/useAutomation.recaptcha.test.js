import { describe, it, expect } from 'vitest'
import { isRecaptchaError } from '../../src/utils/recaptchaDetect'
import { planRecaptchaWait } from '../../src/services/recaptchaPolicy'

/**
 * useAutomation 의 reCAPTCHA 경로 cross-module 계약 검증.
 * 풀 hook 통합 테스트는 useRecaptchaBackoff.test.js + Flow IPC 의존성 때문에 불가.
 */
describe('useAutomation reCAPTCHA detection contract', () => {
  it('submit/collect 실패 메시지가 reCAPTCHA면 incident 등록', () => {
    const submitResult = { success: false, error: 'reCAPTCHA evaluation failed' }
    expect(!submitResult.success && isRecaptchaError(submitResult.error)).toBe(true)
    expect(planRecaptchaWait(1).waitMs).toBe(300000)
  })

  it('일반 timeout 은 reCAPTCHA 로 분류되지 않음', () => {
    expect(isRecaptchaError('Generation timeout')).toBe(false)
  })

  it('연속 4회차 진입 시 자동 재개 중단', () => {
    expect(planRecaptchaWait(4)).toEqual({ waitMs: 0, autoResume: false })
  })
})
