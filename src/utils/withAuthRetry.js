import { isAuthError } from './authError'

const AUTH_FAILED_MESSAGE = 'Auth expired — please re-login to Flow'

/**
 * Build a `withAuthRetry(label, fn)` wrapper bound to a specific
 * `getAccessToken` and `onAuthError` callback.
 *
 * This wrapper is the missing trigger between "401 detected" and the
 * existing refresh function (`getAccessToken(forceRefresh=true)`) that
 * lives in useFlowAPI. It does NOT implement refresh itself — Google's
 * webview-internal silent refresh + the existing SESSION_URL fetch in
 * `extractToken` IPC handle the actual token rotation.
 *
 * Behavior on each call to the returned wrapper:
 *   1. Fetch token (cached path) via getAccessToken().
 *   2. Call fn(token).
 *   3. If result is NOT an auth error → return it.
 *   4. If it IS an auth error → call existing getAccessToken(true) to
 *      pull a fresh token from the webview. If refresh returns no token,
 *      the Flow session itself is dead → fire onAuthError + return
 *      authFailed sentinel.
 *   5. Otherwise call fn(newToken) once more. If still auth error → fire
 *      onAuthError + return authFailed sentinel.
 *
 * The wrapper retries at most ONCE per call. Callers must NOT loop on
 * authFailed results — they should break out (polling loops do exactly this).
 *
 * @param {{
 *   getAccessToken: (forceRefresh?: boolean) => Promise<string | null>,
 *   onAuthError?: () => void,
 * }} deps
 * @returns {(label: string, fn: (token: string) => Promise<any>) => Promise<any>}
 */
export function createAuthRetryWrapper({ getAccessToken, onAuthError }) {
  // Single-flight: if a refresh is already in flight, concurrent callers
  // await the same promise instead of each triggering their own refresh.
  let inFlightRefresh = null

  async function refreshOnce() {
    // inFlightRefresh is set synchronously below before any await, so concurrent
    // callers arriving during the in-flight refresh see it non-null and share the promise.
    if (inFlightRefresh) return inFlightRefresh
    inFlightRefresh = (async () => {
      try {
        return await getAccessToken(true)
      } finally {
        // Clear so a future 401 (after this refresh resolves) can trigger a new refresh.
        inFlightRefresh = null
      }
    })()
    return inFlightRefresh
  }

  return async function withAuthRetry(label, fn) {
    const token = await getAccessToken()
    const result = await fn(token)

    if (!isAuthError(result)) return result

    // First 401 → try silent refresh once (single-flight across concurrent callers)
    console.warn(`[FlowAPI] ${label}: 401 — refreshing token (1-time retry)`)
    const newToken = await refreshOnce()
    if (!newToken) {
      onAuthError?.()
      return { success: false, authFailed: true, error: AUTH_FAILED_MESSAGE }
    }

    const retried = await fn(newToken)
    if (isAuthError(retried)) {
      console.warn(`[FlowAPI] ${label}: 401 after refresh — giving up`)
      onAuthError?.()
      return { success: false, authFailed: true, error: AUTH_FAILED_MESSAGE }
    }
    return retried
  }
}
