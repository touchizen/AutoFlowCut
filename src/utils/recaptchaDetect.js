/**
 * Flow 생성 실패 메시지가 reCAPTCHA 차단(봇 감지)인지 판정한다.
 * Flow는 차단 시 Generate 버튼을 disable하지 않고 서버 응답으로만 거부하므로,
 * 결과 에러 문자열 매칭이 유일한 감지 수단이다.
 */
const RECAPTCHA_PATTERNS = [/recaptcha/i, /unusual activity/i]

export function isRecaptchaError(text) {
  if (typeof text !== 'string' || text.length === 0) return false
  return RECAPTCHA_PATTERNS.some((re) => re.test(text))
}
