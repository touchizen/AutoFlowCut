import { describe, it, expect } from 'vitest'
import { isRecaptchaError } from '../../src/utils/recaptchaDetect'
import { planRecaptchaWait } from '../../src/services/recaptchaPolicy'

// useAutomation 의 reCAPTCHA 경로는 Flow IPC 의존이 커서 풀 렌더 대신
// "감지 → escalation 계획" 결합을 검증한다 (핸들러가 쓰는 두 모듈의 계약).
describe('reCAPTCHA detection → escalation integration', () => {
  it('collect 실패 메시지가 reCAPTCHA면 incident 1회 → 5분 자동대기', () => {
    const result = { success: false, error: 'reCAPTCHA evaluation failed' }
    const detected = !result.success && isRecaptchaError(result.error)
    expect(detected).toBe(true)
    expect(planRecaptchaWait(1)).toEqual({ waitMs: 300000, autoResume: true })
  })

  it('일반 timeout 은 reCAPTCHA로 처리하지 않음', () => {
    const result = { success: false, error: 'Generation timeout' }
    expect(!result.success && isRecaptchaError(result.error)).toBe(false)
  })

  it('연속 4회차는 수동 모드(autoResume=false)', () => {
    expect(planRecaptchaWait(4).autoResume).toBe(false)
  })
})

// Gap fix verification: confirm the policy-level invariant (manual branch is "fire once, user resumes")
describe('manual mode + user resume invariant', () => {
  it('4회차 진입 후에도 planRecaptchaWait(5) 는 여전히 manual', () => {
    expect(planRecaptchaWait(5)).toEqual({ waitMs: 0, autoResume: false })
  })
})
