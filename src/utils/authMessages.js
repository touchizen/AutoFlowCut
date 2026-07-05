export function translateOrFallback(t, key, fallback) {
  const translated = typeof t === 'function' ? t(key) : null
  return translated && translated !== key ? translated : fallback
}

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

export function getAuthRequiredMessage(mode, t) {
  if (mode === 'flow') {
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
