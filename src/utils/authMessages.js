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
