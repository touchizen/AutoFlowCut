export function translateOrFallback(t, key, fallback, params) {
  const translated = typeof t === 'function' ? t(key, params) : null
  return translated && translated !== key ? translated : fallback
}

// M1-9: flow:session-status 의 reason 중 "로그인이 답"인 것들. 그 외(서버 오류·네트워크·시간 초과)는 세션 확인
//   실패 안내에 이유를 넣어 보여준다 — 로그인하라고만 하면 사용자가 멀쩡한 세션을 다시 로그인한다.
const FLOW_LOGIN_REASONS = new Set(['wiz-missing', 'not-on-flow', 'flow-inactive', 'rpc:er:16', 'rpc:http:401'])

export function getAuthErrorMessage(mode, t) {
  if (mode === 'flow') {
    return translateOrFallback(
      t,
      'status.flowAuthErrorStopped',
      'Auth error. Please login to Flow and try again.',
    )
  }
  return translateOrFallback(
    t,
    'status.authErrorStopped',
    'API key was rejected. Check your API key in Settings and try again.',
  )
}

export function getAuthRequiredMessage(mode, t, reason) {
  if (mode === 'flow') {
    if (reason && !FLOW_LOGIN_REASONS.has(reason)) {
      return translateOrFallback(
        t,
        'toast.flowSessionCheckFailed',
        `Could not verify the Flow session (${reason}). Check the Flow window and try again.`,
        { reason },
      )
    }
    return translateOrFallback(
      t,
      'toast.flowLoginRequired',
      'Flow login required. Sign in with your Google account in the Flow window.',
    )
  }
  return translateOrFallback(
    t,
    'status.loginRequired',
    'API key required — add it in Settings',
  )
}

/**
 * 인증 실패 결과의 error 가 기계 토큰인가 — 그러면 저장·표시 문구를 사람 안내(getAuthErrorMessage)로 바꾼다.
 *   Flow(main)의 authFailed 결과는 flow-* kind 와 이유 토큰(not-on-flow · wiz-missing · flow-rpc-error)을 싣는다 → true.
 *   multi-provider API 결과의 errorKind:'auth'(§5.11 provider 분류)는 provider 의 사람 메시지(어느 provider 키인지)를 싣는다 → false.
 *   kind 없는 옛 결과("Auth expired …")도 false — error 그대로.
 * useAutomation · useVideoAutomation · useReferenceGeneration 의 authFailureText, imageFinalize, videoRecovery 가 같은 규칙을 쓴다.
 */
export function authErrorIsMachineToken(result) {
  return !!result?.errorKind && result.errorKind !== 'auth'
}
