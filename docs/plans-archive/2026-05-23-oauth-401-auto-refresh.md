# OAuth 401 Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All Flow API calls that fail with HTTP 401 silently refresh the token once (re-extract from Flow webview's session cookie) and retry. If the second attempt also fails, fire `onAuthError` to surface a "please re-login" toast and break out of any polling loops — eliminating the current 20-minute silent-spin behavior.

**Architecture:** A renderer-side `withAuthRetry` wrapper centralizes the retry logic in `useFlowAPI.js`. Each token-dependent API method is wrapped at definition time. A single-flight guard prevents N concurrent refresh attempts when multiple in-flight calls 401 simultaneously. Long-running polling loops (`useVideoAutomation`, `useAutomation`) detect the `authFailed: true` sentinel and break instead of looping until timeout.

**Tech Stack:** React 18 (JS only — no TS), vitest, existing IPC handlers in `electron/ipc/flow-api.js` and `electron/ipc/video.js` unchanged.

**Companion: none.** This plan is self-contained; no separate spec doc.

---

## ⚠️ Codebase Compatibility Notes

- **JavaScript only** — all new files are `.js`. No TS, no `tsconfig.json`.
- **Module type:** `"type": "module"` (ESM)
- **Test runner:** vitest. Tests mirror `src/` under `tests/` (per [CLAUDE.md](../../CLAUDE.md)).
- **Hook pattern:** `useFlowAPI` returns an object of named methods. Wrapping is done at the `useCallback` definition site.
- **Existing 401 surface:** [electron/ipc/video.js:589-591](../../electron/ipc/video.js#L589) returns `{ success: false, error: 'HTTP 401: ...' }`. Other IPC handlers follow the same shape.

---

## Existing Auth Infrastructure (this plan only *wires* it)

**This plan does NOT build new auth/refresh mechanisms.** Everything needed for OAuth refresh already exists in the codebase — it just isn't triggered on 401. The wrapper added by this plan is the **missing trigger** between "401 detected" and "existing refresh function called".

| Existing piece | Location | What it does |
|---|---|---|
| `getAccessToken(forceRefresh, quickCheck)` | [src/hooks/useFlowAPI.js:32](../../src/hooks/useFlowAPI.js#L32) | **The refresh function.** `forceRefresh=true` bypasses cache and re-extracts a fresh token from the Flow webview's SESSION_URL. We will call this on 401. |
| `clearTokenCache()` | [src/hooks/useFlowAPI.js:288](../../src/hooks/useFlowAPI.js#L288) | Wipes cached `accessToken` state + localStorage. We rely on `forceRefresh=true` (which bypasses the cache) — explicit `clearTokenCache` may still be useful from `onAuthError`. |
| `validateToken({ token })` IPC | [electron/ipc/flow-api.js:1553](../../electron/ipc/flow-api.js#L1553) | Hits Google's `tokeninfo` endpoint to get real expiry (`exp` claim). Already called inside `getAccessToken` to set `tokenExpiry`. Not changed by this plan. |
| `SESSION_URL` fetch inside webview | [electron/ipc/flow-api.js:44](../../electron/ipc/flow-api.js#L44) | Flow's session endpoint. Google's webview-internal JS silently refreshes tokens via session cookies, so each call returns a fresh `access_token`. This is what `getAccessToken(true)` ultimately invokes. |
| `onAuthError` callback registered for video automation | [src/App.jsx:146-150](../../src/App.jsx#L146) | Already wired — calls `clearTokenCache()` + toast. **Bug: never invoked.** The poll loop's `_maybeTriggerQuotaStop` only catches quota, not 401. This plan routes 401s through the wrapper, which will call the existing callback. |
| `onAuthError` for image automation | [src/App.jsx:137-141](../../src/App.jsx#L137) | Same — wired but never invoked. Same fix applies. |
| `authReady` UI state | [src/App.jsx:111](../../src/App.jsx#L111), used by Header/WelcomeScreen | Top-level "are we logged in?" state. Set to `false` by the existing `onAuthError` callbacks. This plan does not change the state itself, only ensures the callbacks actually fire. |

**Why doesn't the Flow webview push fresh tokens to us automatically?**
The webview and our renderer are separate processes (Electron `WebContentsView` vs main renderer). The webview can't push events into our renderer; we have to *pull* fresh tokens via `executeJavaScript` from the main process, which is exactly what `extractToken` IPC ([flow-api.js:37](../../electron/ipc/flow-api.js#L37)) does. Inside the webview, Google's JS *does* auto-refresh — so every pull returns a fresh token as long as the webview's session cookies are still alive.

**What this plan adds:** a renderer-side wrapper that detects 401 on any token-using API call, calls the existing `getAccessToken(true)` to pull a fresh token from the webview, retries once, and fires the existing `onAuthError` callback if recovery fails. No new IPC, no new token storage, no new refresh logic — just the missing trigger.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/utils/authError.js` | `isAuthError(result)` — single source of truth for "this IPC result looks like a 401". |
| `src/utils/withAuthRetry.js` | `createAuthRetryWrapper({ getAccessToken, onAuthError })` — factory that returns `withAuthRetry(label, fn)`. Single-flight refresh inside. |
| `tests/utils/authError.test.js` | Unit tests for `isAuthError`. |
| `tests/utils/withAuthRetry.test.js` | Unit tests for the wrapper (refresh, single-flight, second-401 path). |
| `tests/hooks/useVideoAutomation.authFail.test.jsx` | Integration: polling loop breaks on `authFailed` sentinel. |
| `tests/hooks/useAutomation.authFail.test.jsx` | Integration: image-gen polling loop breaks on `authFailed`. |

### Modified files

| Path | Change |
|---|---|
| `src/hooks/useFlowAPI.js` | Accept `onAuthError` arg. Build wrapper via factory. Wrap every token-using `useCallback` (12 methods). Move single-flight refresh state to a `useRef`. |
| `src/hooks/useVideoAutomation.js` | After `checkVideoStatus` returns, if `result.authFailed`, break poll loop with the standard error message (mirror quota-stop break). Same after submit (`generateVideoT2V`/`I2V`). |
| `src/hooks/useAutomation.js` | After `checkGeneration`/`collectGeneration`/`uploadReference`/`submitGenerationDOM` calls, treat `authFailed` as a stop signal. |
| `src/App.jsx` | Pass `onAuthError` callback to `useFlowAPI` (already exists for the hooks; lift it up one level so the wrapper has access). |

### Unchanged

- `electron/ipc/*` — no main-process changes. The wrapper lives entirely in renderer.
- IPC return shapes — wrapper relies on existing `{ success, error }` convention.

---

## Phase 1 — Core Utilities (No Behavior Change Yet)

### Task 1: `isAuthError` utility

**Files:**
- Create: `src/utils/authError.js`
- Test: `tests/utils/authError.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/utils/authError.test.js
import { describe, it, expect } from 'vitest'
import { isAuthError } from '../../src/utils/authError'

describe('isAuthError', () => {
  it('returns false for successful results', () => {
    expect(isAuthError({ success: true })).toBe(false)
    expect(isAuthError({ success: true, statuses: [] })).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError(undefined)).toBe(false)
  })

  it('returns false for non-auth errors', () => {
    expect(isAuthError({ success: false, error: 'RESOURCE_EXHAUSTED' })).toBe(false)
    expect(isAuthError({ success: false, error: 'HTTP 500: server error' })).toBe(false)
    expect(isAuthError({ success: false, error: 'Network error' })).toBe(false)
  })

  it('detects HTTP 401 errors', () => {
    expect(isAuthError({ success: false, error: 'HTTP 401: bad token' })).toBe(true)
  })

  it('detects UNAUTHENTICATED status (case-insensitive)', () => {
    expect(isAuthError({ success: false, error: 'UNAUTHENTICATED' })).toBe(true)
    expect(isAuthError({ success: false, error: 'unauthenticated' })).toBe(true)
    expect(isAuthError({ success: false, error: 'Request had invalid authentication credentials. status: UNAUTHENTICATED' })).toBe(true)
  })

  it('detects "invalid authentication" phrase', () => {
    expect(isAuthError({ success: false, error: 'Request had invalid authentication credentials' })).toBe(true)
  })

  it('does not false-positive on the digits "401" in other contexts', () => {
    // We require either "HTTP 401" or auth keywords — bare "401" alone is ambiguous
    expect(isAuthError({ success: false, error: 'Generated 401 frames in batch' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/authError.test.js`
Expected: FAIL with "Cannot find module 'authError'"

- [ ] **Step 3: Implement**

```js
// src/utils/authError.js
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
  const err = (result.error || '').toLowerCase()
  if (err.includes('http 401')) return true
  if (err.includes('unauthenticated')) return true
  if (err.includes('invalid authentication')) return true
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/utils/authError.test.js`
Expected: PASS — all 7 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/authError.js tests/utils/authError.test.js
git commit -m "feat(auth): add isAuthError detector for OAuth 401 responses"
```

---

### Task 2: `withAuthRetry` wrapper — happy path + 1st 401 refresh

**Files:**
- Create: `src/utils/withAuthRetry.js`
- Test: `tests/utils/withAuthRetry.test.js`

- [ ] **Step 1: Write failing test (happy path + 1-time refresh)**

```js
// tests/utils/withAuthRetry.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAuthRetryWrapper } from '../../src/utils/withAuthRetry'

function setup(overrides = {}) {
  const getAccessToken = vi.fn().mockResolvedValue('token-1')
  const onAuthError = vi.fn()
  const wrapper = createAuthRetryWrapper({
    getAccessToken,
    onAuthError,
    ...overrides,
  })
  return { getAccessToken, onAuthError, wrapper }
}

describe('createAuthRetryWrapper — basic flow', () => {
  it('returns fn result unchanged on success (no refresh)', async () => {
    const { wrapper, getAccessToken } = setup()
    const fn = vi.fn().mockResolvedValue({ success: true, data: 'ok' })

    const out = await wrapper('label', fn)

    expect(out).toEqual({ success: true, data: 'ok' })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('token-1')
    expect(getAccessToken).toHaveBeenCalledTimes(1)
    expect(getAccessToken).toHaveBeenCalledWith()  // no forceRefresh
  })

  it('returns fn result unchanged on non-auth error (no refresh)', async () => {
    const { wrapper, getAccessToken, onAuthError } = setup()
    const fn = vi.fn().mockResolvedValue({ success: false, error: 'RESOURCE_EXHAUSTED' })

    const out = await wrapper('label', fn)

    expect(out).toEqual({ success: false, error: 'RESOURCE_EXHAUSTED' })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(getAccessToken).toHaveBeenCalledTimes(1)
    expect(onAuthError).not.toHaveBeenCalled()
  })

  it('on 401: refreshes once and retries with new token', async () => {
    const getAccessToken = vi.fn()
      .mockResolvedValueOnce('token-1')   // initial
      .mockResolvedValueOnce('token-2')   // forceRefresh
    const onAuthError = vi.fn()
    const wrapper = createAuthRetryWrapper({ getAccessToken, onAuthError })
    const fn = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'HTTP 401: bad token' })
      .mockResolvedValueOnce({ success: true, data: 'recovered' })

    const out = await wrapper('label', fn)

    expect(out).toEqual({ success: true, data: 'recovered' })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(1, 'token-1')
    expect(fn).toHaveBeenNthCalledWith(2, 'token-2')
    expect(getAccessToken).toHaveBeenCalledTimes(2)
    expect(getAccessToken).toHaveBeenNthCalledWith(2, true)  // forceRefresh
    expect(onAuthError).not.toHaveBeenCalled()  // recovered cleanly
  })

  it('on 2nd 401 after refresh: fires onAuthError and returns sentinel', async () => {
    const getAccessToken = vi.fn()
      .mockResolvedValueOnce('token-1')
      .mockResolvedValueOnce('token-2')
    const onAuthError = vi.fn()
    const wrapper = createAuthRetryWrapper({ getAccessToken, onAuthError })
    const fn = vi.fn().mockResolvedValue({ success: false, error: 'HTTP 401: still bad' })

    const out = await wrapper('label', fn)

    expect(out.success).toBe(false)
    expect(out.authFailed).toBe(true)
    expect(out.error).toMatch(/re-?login|auth/i)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(onAuthError).toHaveBeenCalledTimes(1)
  })

  it('on refresh returning null token (session dead): fires onAuthError without 2nd call', async () => {
    const getAccessToken = vi.fn()
      .mockResolvedValueOnce('token-1')
      .mockResolvedValueOnce(null)  // refresh failed
    const onAuthError = vi.fn()
    const wrapper = createAuthRetryWrapper({ getAccessToken, onAuthError })
    const fn = vi.fn().mockResolvedValueOnce({ success: false, error: 'HTTP 401: bad' })

    const out = await wrapper('label', fn)

    expect(out.success).toBe(false)
    expect(out.authFailed).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)  // no retry attempted
    expect(onAuthError).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/withAuthRetry.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (without single-flight yet — that's Task 3)**

```js
// src/utils/withAuthRetry.js
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
  return async function withAuthRetry(label, fn) {
    const token = await getAccessToken()
    const result = await fn(token)

    if (!isAuthError(result)) return result

    // First 401 → try silent refresh once
    console.warn(`[FlowAPI] ${label}: 401 — refreshing token (1-time retry)`)
    const newToken = await getAccessToken(true)
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/utils/withAuthRetry.test.js`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/withAuthRetry.js tests/utils/withAuthRetry.test.js
git commit -m "feat(auth): add withAuthRetry wrapper with 1-time silent refresh"
```

---

### Task 3: Single-flight refresh inside the wrapper

**Files:**
- Modify: `src/utils/withAuthRetry.js`
- Modify: `tests/utils/withAuthRetry.test.js` (append concurrency cases)

- [ ] **Step 1: Add failing test for single-flight**

Append to `tests/utils/withAuthRetry.test.js`:

```js
describe('createAuthRetryWrapper — single-flight refresh', () => {
  it('concurrent 401s trigger only ONE force-refresh, all callers see new token', async () => {
    let refreshResolve
    const refreshPromise = new Promise((resolve) => { refreshResolve = resolve })

    const getAccessToken = vi.fn((force) => {
      if (force) return refreshPromise   // first force-refresh is suspended
      return Promise.resolve('token-1')
    })
    const onAuthError = vi.fn()
    const wrapper = createAuthRetryWrapper({ getAccessToken, onAuthError })

    const callA = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'HTTP 401: A' })
      .mockResolvedValueOnce({ success: true, who: 'A' })
    const callB = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'HTTP 401: B' })
      .mockResolvedValueOnce({ success: true, who: 'B' })

    const pA = wrapper('A', callA)
    const pB = wrapper('B', callB)

    // Both hit 401, both should be waiting on the single refresh.
    // Let microtasks settle.
    await new Promise((r) => setTimeout(r, 0))

    // The refresh must have been requested exactly once (force=true)
    const forceCalls = getAccessToken.mock.calls.filter(args => args[0] === true)
    expect(forceCalls.length).toBe(1)

    // Now resolve the refresh
    refreshResolve('token-2')

    const [resA, resB] = await Promise.all([pA, pB])
    expect(resA).toEqual({ success: true, who: 'A' })
    expect(resB).toEqual({ success: true, who: 'B' })

    // Both retries used the same refreshed token
    expect(callA).toHaveBeenNthCalledWith(2, 'token-2')
    expect(callB).toHaveBeenNthCalledWith(2, 'token-2')

    // onAuthError never fired — recovery succeeded
    expect(onAuthError).not.toHaveBeenCalled()
  })

  it('after refresh resolves, a fresh 401 in a later call triggers a NEW refresh', async () => {
    const getAccessToken = vi.fn()
      .mockResolvedValueOnce('t1')         // initial call A
      .mockResolvedValueOnce('t2')         // refresh #1 (for A)
      .mockResolvedValueOnce('t2')         // initial call B (uses cache, returns t2)
      .mockResolvedValueOnce('t3')         // refresh #2 (for B)
    const onAuthError = vi.fn()
    const wrapper = createAuthRetryWrapper({ getAccessToken, onAuthError })

    const callA = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'HTTP 401' })
      .mockResolvedValueOnce({ success: true })
    const resA = await wrapper('A', callA)
    expect(resA.success).toBe(true)

    const callB = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'HTTP 401' })
      .mockResolvedValueOnce({ success: true })
    const resB = await wrapper('B', callB)
    expect(resB.success).toBe(true)

    // Two distinct refreshes
    const forceCalls = getAccessToken.mock.calls.filter(args => args[0] === true)
    expect(forceCalls.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests — single-flight test should fail**

Run: `npx vitest run tests/utils/withAuthRetry.test.js`
Expected: FAIL on `forceCalls.length === 1` — currently the wrapper would call refresh twice (once per concurrent caller).

- [ ] **Step 3: Add single-flight guard in the factory**

Replace `src/utils/withAuthRetry.js` body:

```js
// src/utils/withAuthRetry.js
import { isAuthError } from './authError'

const AUTH_FAILED_MESSAGE = 'Auth expired — please re-login to Flow'

export function createAuthRetryWrapper({ getAccessToken, onAuthError }) {
  // Single-flight: if a refresh is in flight, concurrent callers await the same promise.
  let inFlightRefresh = null

  async function refreshOnce() {
    if (inFlightRefresh) return inFlightRefresh
    inFlightRefresh = (async () => {
      try {
        return await getAccessToken(true)
      } finally {
        // Allow a fresh refresh next time a 401 happens later in the session
        inFlightRefresh = null
      }
    })()
    return inFlightRefresh
  }

  return async function withAuthRetry(label, fn) {
    const token = await getAccessToken()
    const result = await fn(token)

    if (!isAuthError(result)) return result

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
```

- [ ] **Step 4: Run all wrapper tests — should pass**

Run: `npx vitest run tests/utils/withAuthRetry.test.js`
Expected: PASS — all 7 cases (5 original + 2 single-flight).

- [ ] **Step 5: Commit**

```bash
git add src/utils/withAuthRetry.js tests/utils/withAuthRetry.test.js
git commit -m "feat(auth): single-flight guard around silent refresh"
```

---

## Phase 2 — Wire Wrapper Into `useFlowAPI`

### Task 4: Accept `onAuthError` in `useFlowAPI`, wrap one method as proof of concept

**Note:** The `onAuthError` callbacks are already registered in App.jsx for both `useAutomation` ([App.jsx:137-141](../../src/App.jsx#L137)) and `useVideoAutomation` ([App.jsx:146-150](../../src/App.jsx#L146)) — they call `clearTokenCache()` + toast. They've just never been invoked because the poll loops only check for quota errors. This task lifts that callback up one level so the wrapper can fire it from any token-using call site.

**Files:**
- Modify: `src/hooks/useFlowAPI.js`
- Modify: `src/App.jsx`
- Test: existing tests should still pass; add a wrapper integration sanity test below.

- [ ] **Step 1: Modify `useFlowAPI` signature**

In [src/hooks/useFlowAPI.js](../../src/hooks/useFlowAPI.js), change the hook signature (search for `export function useFlowAPI`) to accept an `onAuthError` option, and build the wrapper inside the hook.

Locate the top of the hook (around line 20-30). After the existing state declarations and BEFORE `getAccessToken` is defined, add:

```js
// (top-level imports)
import { createAuthRetryWrapper } from '../utils/withAuthRetry'

// inside useFlowAPI(...)
export function useFlowAPI({ onAuthError } = {}) {
  // ... existing state (accessToken, tokenExpiry, projectId, etc.) ...

  // getAccessToken stays defined first (wrapper depends on it).
  const getAccessToken = useCallback(/* ...existing impl... */)

  // Build the wrapper once per hook instance. useRef holds the in-flight state
  // (single-flight is inside the factory closure).
  const withAuthRetryRef = useRef(null)
  if (!withAuthRetryRef.current) {
    withAuthRetryRef.current = createAuthRetryWrapper({
      getAccessToken,
      onAuthError,
    })
  }
  const withAuthRetry = withAuthRetryRef.current
```

**Note:** The wrapper closes over `getAccessToken` and `onAuthError` at first render. That's fine because:
- `getAccessToken` reads `accessToken`/`tokenExpiry` from refs/state inside its own `useCallback` — its identity is stable enough that re-binding the wrapper would be churn.
- `onAuthError` is a stable callback from App.jsx (you'll wrap it in `useCallback` in Step 2).

- [ ] **Step 2: Pass `onAuthError` from App.jsx**

In [src/App.jsx](../../src/App.jsx), find the `useFlowAPI()` call (search for `useFlowAPI`). Before it, lift the existing auth-error logic from inside the `useVideoAutomation`/`useAutomation` callbacks into one `useCallback`:

```js
const handleAuthError = useCallback(() => {
  setAuthReady(false)
  // Note: clearTokenCache lives on flowAPI, which we're constructing — pull it
  // via a ref or accept that it's called from the wrapper itself via getAccessToken(true).
  // Simpler: do the side effects we control here (UI state + toast), and let the
  // wrapper's refresh attempt handle the token cache via getAccessToken(forceRefresh=true).
  toast.error(t('status.authErrorStopped') || 'Auth expired — please re-login to Flow', TIMING.AUTH_ERROR_TOAST)
}, [t])

const flowAPI = useFlowAPI({ onAuthError: handleAuthError })
```

Then update the `useVideoAutomation` and `useAutomation` callback args to use the same `handleAuthError` (or leave the existing inline callbacks — they're still valid as a defense layer for direct hook-level decisions, but the wrapper is now the primary path).

- [ ] **Step 3: Wrap `checkVideoStatus` as the POC**

Find the existing `checkVideoStatus` definition in `useFlowAPI.js` (around line 200):

```js
// BEFORE
const checkVideoStatus = useCallback(async (generationIds) => {
  const token = await getAccessToken()
  if (!token) return { success: false, error: 'No access token' }
  try {
    return await window.electronAPI.checkVideoStatus({ token, generationIds, projectId })
  } catch (error) {
    return { success: false, error: error.message }
  }
}, [getAccessToken, projectId])
```

Replace with:

```js
// AFTER
const checkVideoStatus = useCallback(async (generationIds) => {
  return withAuthRetry('checkVideoStatus', async (token) => {
    if (!token) return { success: false, error: 'No access token' }
    try {
      return await window.electronAPI.checkVideoStatus({ token, generationIds, projectId })
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}, [projectId, withAuthRetry])
```

- [ ] **Step 4: Run existing video automation tests**

Run: `npx vitest run tests/hooks/useVideoAutomation.quotaStop.test.jsx tests/hooks/useVideoAutomation.pollFail.test.jsx`
Expected: PASS — no behavior change for non-401 paths.

If a test mocks `flowAPI.checkVideoStatus` directly (returning auth errors), the wrapper isn't in the path — those tests still work because they bypass `useFlowAPI`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFlowAPI.js src/App.jsx
git commit -m "feat(auth): wire withAuthRetry into useFlowAPI; wrap checkVideoStatus"
```

---

### Task 5: Wrap remaining token-using methods

**Files:**
- Modify: `src/hooks/useFlowAPI.js`

For each method, apply the same wrap-and-replace pattern as Task 4 Step 3. The list (all of them currently take a `token` param to IPC):

| Method | IPC name | Approx line |
|---|---|---|
| `uploadReference` | `flow:upload-reference` | ~124 |
| `fetchMedia` | `flow:fetch-media` | ~145 |
| `generateVideoT2V` | `flow:generate-video-t2v` | ~160 |
| `generateVideoI2V` | `flow:generate-video-i2v` | ~180 |
| `upscaleVideo` | `flow:upscale-video` | ~219 |
| `upscaleImage` | `flow:upscale-image` | ~239 |
| `fetchGallery` | `flow:fetch-gallery` | ~256 |
| `listFlowProjects` | `flow:list-projects` | ~274 |
| `collectGeneration` | `flow:collect-generation` | ~111 |

**Not wrapped** (use webview session, not token):
- `generateImageDOM`, `submitGenerationDOM`, `checkGeneration`, `clearGenerations` — DOM automation paths; auth lives in the webview itself. If those break on session expiry they surface different errors (no element found, etc.) — out of scope for this plan.
- `getAccessToken`, `clearTokenCache`, `validateToken` — internal auth machinery.

- [ ] **Step 1: Wrap one method at a time, run tests, commit**

For each method in the table:

1. Replace the body following the Task 4 Step 3 pattern.
2. Run: `npx vitest run tests/` (full suite — wrapping shouldn't change happy path).
3. Commit with message: `feat(auth): wrap <methodName> with withAuthRetry`

Doing this one-method-per-commit keeps the diff reviewable.

- [ ] **Step 2: After all 9 are wrapped, run the full test suite**

Run: `npm run test:run`
Expected: All existing tests pass.

- [ ] **Step 3: Run the app manually for smoke check**

```bash
npm run dev
```

In the running app, do **one** of each:
- Generate one image (uses `submitGenerationDOM` — unaffected, sanity check)
- Upload a reference image (uses wrapped `uploadReference`)
- Generate one video (uses wrapped `generateVideoT2V` + `checkVideoStatus`)

All should work normally — no visible difference, no extra refresh calls. Check terminal: `[FlowAPI] ... : 401 — refreshing token` should NOT appear.

- [ ] **Step 4: Commit final wrap if anything was bundled**

Already committed per Step 1; otherwise:
```bash
git status   # should be clean
```

---

## Phase 3 — Make Loops Break on `authFailed`

### Task 6: `useVideoAutomation` breaks polling loop on `authFailed`

**Files:**
- Modify: `src/hooks/useVideoAutomation.js`
- Create: `tests/hooks/useVideoAutomation.authFail.test.jsx`

- [ ] **Step 1: Write failing integration test**

```jsx
// tests/hooks/useVideoAutomation.authFail.test.jsx
/**
 * useVideoAutomation — 401 auth failure during polling
 *
 * The wrapper's `authFailed: true` sentinel must break the poll loop
 * immediately. Without this break, the loop would run for 20 min until
 * VIDEO_MAX_POLL_COUNT timeout, with no user-visible error.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }) },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({})),
  buildVideoMetaPatch: vi.fn(() => ({})),
}))

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useVideoAutomation — auth failure during polling', () => {
  it('breaks poll loop immediately when checkVideoStatus returns authFailed', async () => {
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
    // Simulating the wrapper's output after 2 failed 401s
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: false,
      authFailed: true,
      error: 'Auth expired — please re-login to Flow',
    })
    const onAuthError = vi.fn()
    const flowAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const t = (k) => k
    const hook = renderHook(() => useVideoAutomation(flowAPI, t, onAuthError, null))

    const items = [{ id: 'vscene_1', prompt: 'test' }]
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: items,
        projectName: 'p',
        saveMode: 'folder',
      })
    })

    // Let microtasks settle so submit + first poll happen
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })

    await act(async () => { await startPromise })

    // checkVideoStatus called once (broke immediately on authFailed)
    expect(checkVideoStatus).toHaveBeenCalledTimes(1)
    // The item ends in error state, NOT timeout
    // (we'd need to inspect onItemUpdate calls — pass it in via overrides if needed)
  })
})
```

- [ ] **Step 2: Run — expected to fail**

Run: `npx vitest run tests/hooks/useVideoAutomation.authFail.test.jsx`
Expected: FAIL — currently `checkVideoStatus` would be called ~120 times (until max polls).

- [ ] **Step 3: Add the break in the polling loop**

In [src/hooks/useVideoAutomation.js](../../src/hooks/useVideoAutomation.js), find the polling loop (around line 459):

```js
// BEFORE
const result = await checkVideoStatus(genIds)

// Top-level fail ... quota detection ... break.
if (!result.success && _maybeTriggerQuotaStop(result.error)) break
```

Replace with:

```js
// AFTER
const result = await checkVideoStatus(genIds)

// Top-level fail handling: auth-failed takes precedence over quota detection.
// The wrapper already fired onAuthError + cleared cache. Mark all pending items
// as auth-error and break immediately — no point polling on a dead token.
if (result?.authFailed) {
  for (const [itemId] of pending) {
    onItemUpdate?.(itemId, 'error', {
      error: result.error || 'Auth expired — please re-login to Flow',
      errorKind: 'auth',
    })
  }
  pending.clear()
  break
}
if (!result.success && _maybeTriggerQuotaStop(result.error)) break
```

Also add the same check after the submit calls. Find `generateVideoT2V` / `generateVideoI2V` calls in the submit phase (around line 380-410):

```js
const submitResult = await generateFn(...)
if (submitResult?.authFailed) {
  onItemUpdate?.(item.id, 'error', {
    error: submitResult.error,
    errorKind: 'auth',
  })
  // Don't continue submitting the rest of the batch — token is dead
  break
}
```

- [ ] **Step 4: Run test — should pass**

Run: `npx vitest run tests/hooks/useVideoAutomation.authFail.test.jsx`
Expected: PASS — `checkVideoStatus` called exactly once.

- [ ] **Step 5: Run all video tests to verify no regression**

Run: `npx vitest run tests/hooks/useVideoAutomation`
Expected: All pass (quotaStop, pollFail, authFail).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useVideoAutomation.js tests/hooks/useVideoAutomation.authFail.test.jsx
git commit -m "feat(auth): break video poll loop on authFailed sentinel"
```

---

### Task 7: `useAutomation` (image generation) breaks on `authFailed`

**Files:**
- Modify: `src/hooks/useAutomation.js`
- Create: `tests/hooks/useAutomation.authFail.test.jsx`

- [ ] **Step 1: Write failing test (mirror Task 6 structure for image automation)**

```jsx
// tests/hooks/useAutomation.authFail.test.jsx
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'

vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useAutomation — auth failure during image generation', () => {
  it('stops batch immediately when uploadReference returns authFailed', async () => {
    const uploadReference = vi.fn().mockResolvedValue({
      success: false,
      authFailed: true,
      error: 'Auth expired — please re-login to Flow',
    })
    const submitGenerationDOM = vi.fn().mockResolvedValue({ success: true, generationId: 'g1' })
    const onAuthError = vi.fn()

    const flowAPI = {
      submitGenerationDOM,
      checkGeneration: vi.fn(),
      collectGeneration: vi.fn(),
      clearGenerations: vi.fn(),
      uploadReference,
      getAccessToken: vi.fn().mockResolvedValue('t'),
    }

    // Construct minimal scenes/references that require an upload step
    const scenes = [{ id: 'scene_1', prompt: 'test', status: 'pending' }]
    const references = [{ id: 1, type: 'style', filePath: '/tmp/x.jpg', status: 'pending', category: 'STYLE' }]
    const scenesHook = {
      updateScene: vi.fn(),
      setScenes: vi.fn(),
    }

    const t = (k) => k
    const hook = renderHook(() =>
      useAutomation(
        flowAPI,
        scenesHook,
        null,
        vi.fn(),       // onOpenSettings
        vi.fn(),       // addPendingSave
        t,
        onAuthError,
        null,
        vi.fn(),
      )
    )

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        scenes,
        references,
        projectName: 'p',
        saveMode: 'folder',
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(100); await startPromise })

    // uploadReference called once (broke immediately on authFailed)
    expect(uploadReference).toHaveBeenCalledTimes(1)
    // submitGenerationDOM never reached
    expect(submitGenerationDOM).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expected to fail**

Run: `npx vitest run tests/hooks/useAutomation.authFail.test.jsx`
Expected: FAIL — `submitGenerationDOM` may be called, or the loop may continue.

- [ ] **Step 3: Add `authFailed` breaks in `useAutomation`**

In [src/hooks/useAutomation.js](../../src/hooks/useAutomation.js):

1. After each `uploadReference(...)` call (search for the call site around line 436):
   ```js
   const result = await uploadReference(base64Data, ref.category)
   if (result?.authFailed) {
     setStatusMessage(result.error)
     stopRequestedRef.current = true
     return  // break the for-loop / function
   }
   ```

2. After each `submitGenerationDOM(...)` / `checkGeneration(...)` / `collectGeneration(...)` call, add the same pattern: if `result?.authFailed`, mark the item as error with `errorKind: 'auth'`, set stop, break.

The exact insertions depend on each call's place in the control flow — keep the pattern: check `authFailed` first, surface the error message, signal stop, exit the loop/function early.

- [ ] **Step 4: Run test — should pass**

Run: `npx vitest run tests/hooks/useAutomation.authFail.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run all automation tests for regression**

Run: `npx vitest run tests/hooks/useAutomation`
Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAutomation.js tests/hooks/useAutomation.authFail.test.jsx
git commit -m "feat(auth): break image automation on authFailed sentinel"
```

---

## Phase 4 — Integration Test + Cleanup

### Task 8: End-to-end integration — token expires mid-batch, auto-recovers

**Files:**
- Create: `tests/integration/auth-refresh.integration.test.jsx`

This test simulates the realistic scenario: a video batch is submitted with a valid token, then mid-polling the token expires, refresh succeeds, and the batch completes normally.

- [ ] **Step 1: Write the integration test**

```jsx
// tests/integration/auth-refresh.integration.test.jsx
/**
 * End-to-end: a video batch survives a mid-polling token expiry.
 *
 * Setup:
 *  - Submit succeeds with token 'old'.
 *  - First poll returns 401 (token expired server-side).
 *  - Wrapper silently refreshes to 'new'.
 *  - Second poll (with 'new') returns complete + mediaId.
 *  - Download succeeds.
 *  - User sees the video as completed, no toast, no UI error.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { createAuthRetryWrapper } from '../../src/utils/withAuthRetry'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    saveVideo: vi.fn().mockResolvedValue({ success: true, path: '/tmp/out.mp4' }),
  },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({ model: 'veo', seed: 1 })),
  buildVideoMetaPatch: vi.fn(() => ({})),
}))

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  // Mock window.electronAPI for download path
  global.window.electronAPI = {
    domDownloadVideo: vi.fn().mockResolvedValue({
      success: true, base64: 'BASE64_DATA', resolution: '1080p',
    }),
  }
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete global.window.electronAPI
})

describe('Integration — token expires mid-batch, refresh recovers', () => {
  it('completes the batch without surfacing an auth error', async () => {
    // Simulate getAccessToken: first call returns 'old', forceRefresh returns 'new'
    const getAccessToken = vi.fn()
      .mockResolvedValueOnce('old')   // initial fetch
      .mockResolvedValueOnce('old')   // checkVideoStatus pre-401
      .mockResolvedValueOnce('new')   // refresh
      .mockResolvedValueOnce('new')   // any further reads
      .mockResolvedValue('new')

    const onAuthError = vi.fn()

    // Wrap checkVideoStatus exactly like useFlowAPI does
    const wrapper = createAuthRetryWrapper({ getAccessToken, onAuthError })
    const rawCheckVideoStatus = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'HTTP 401: bad token' })
      .mockResolvedValueOnce({
        success: true,
        statuses: [{ status: 'complete', mediaId: 'media-1', videoUrl: 'https://x/y' }],
      })
    const checkVideoStatus = (genIds) => wrapper('checkVideoStatus', (token) => rawCheckVideoStatus(token, genIds))

    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })

    const flowAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken,
    }

    const t = (k) => k
    const onItemUpdate = vi.fn()
    const hook = renderHook(() => useVideoAutomation(flowAPI, t, onAuthError, null))

    const items = [{ id: 'vscene_1', prompt: 'p', videoSaveId: 't2v_1' }]
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v', scenes: items, projectName: 'proj', saveMode: 'folder',
        onItemUpdate,
      })
    })

    // Advance through submit + poll cycles
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    await act(async () => { await startPromise })

    // Behavior assertions
    expect(rawCheckVideoStatus).toHaveBeenCalledTimes(2)        // first 401 + retry succeeded
    expect(rawCheckVideoStatus).toHaveBeenNthCalledWith(1, 'old', expect.any(Array))
    expect(rawCheckVideoStatus).toHaveBeenNthCalledWith(2, 'new', expect.any(Array))
    expect(onAuthError).not.toHaveBeenCalled()                  // recovered cleanly, no user-facing error
    // Item updated to complete
    const completeCall = onItemUpdate.mock.calls.find(([, status]) => status === 'complete')
    expect(completeCall).toBeDefined()
  })
})
```

- [ ] **Step 2: Run — should pass with all prior work**

Run: `npx vitest run tests/integration/auth-refresh.integration.test.jsx`
Expected: PASS.

If the test struggles with timer interactions (Phase 2 polling loop uses real intervals), use `vi.advanceTimersByTimeAsync` with the `VIDEO_POLL_INTERVAL` value (10000ms) explicitly:

```js
await act(async () => { await vi.advanceTimersByTimeAsync(10500) })
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/auth-refresh.integration.test.jsx
git commit -m "test(auth): integration — token expiry mid-batch auto-recovers"
```

---

### Task 9: Manual verification

- [ ] **Step 1: Re-trigger the original bug to confirm fix**

```bash
npm run dev
```

In a separate terminal, watch logs:
```bash
# Already streaming from `npm run dev` — keep that terminal visible.
```

In the app:
1. Open a project with a valid Flow login.
2. Generate a video (1 framePair, single video — minimal repro).
3. **Mid-polling, simulate token expiry**: open DevTools (renderer) and run in console:
   ```js
   localStorage.removeItem('flowAccessToken')
   localStorage.removeItem('flowTokenExp')
   ```
   Combined with: in the Flow webview's DevTools (if accessible) clear the session cookie, OR wait ~1 hour for natural expiry. Easiest: kill the Flow login state manually by signing out in the Flow webview tab.

Expected behavior:
- Terminal shows: `[FlowAPI] checkVideoStatus: 401 — refreshing token (1-time retry)`
- If silent refresh succeeds (webview session still alive): polling continues, video downloads normally
- If silent refresh fails (webview session also dead): toast appears: "Auth expired — please re-login to Flow", batch stops with `errorKind: 'auth'`, polling does NOT spin for 20 minutes

- [ ] **Step 2: Verify normal flow still works**

Generate one image, one video, upload one reference. All complete normally with no `401` log entries.

---

### Task 10: Archive the plan after merge

- [ ] **Step 1: After PR is merged to main, move plan to archive**

```bash
git mv docs/superpowers/plans/2026-05-23-oauth-401-auto-refresh.md docs/plans-archive/
git commit -m "docs: archive completed oauth-401-auto-refresh plan"
```

Per project [CLAUDE.md](../../CLAUDE.md):
> 작업이 완료된 plan/spec 문서는 `docs/plans-archive/`으로 이동하고 commit한다.

---

## Self-Review

**Spec coverage:**
- ✅ Detect 401 across all token-using paths → Tasks 1, 4, 5
- ✅ Silent refresh once → Task 2
- ✅ Single-flight refresh (no thundering herd) → Task 3
- ✅ Fire `onAuthError` on second 401 → Task 2 (sentinel), Task 4 (wiring), Tasks 6/7 (loops)
- ✅ Break polling loops on `authFailed` → Tasks 6, 7
- ✅ Cover video gen, image gen, uploads → Tasks 5, 6, 7
- ✅ End-to-end test → Task 8
- ✅ Manual verification → Task 9
- ✅ Plan archival per project convention → Task 10

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to" placeholders. Every code step has full code.

**Type consistency:**
- `isAuthError(result)` — single signature, same shape consumed by `withAuthRetry` and loops.
- `createAuthRetryWrapper({ getAccessToken, onAuthError })` — same in Tasks 2, 3, 4, 8.
- `withAuthRetry(label, fn)` — same `(label, fn)` signature, `fn` receives `token`, returns `{success, ...}`.
- `authFailed: true` sentinel — same property name in Tasks 2, 6, 7, 8.
- `errorKind: 'auth'` — used consistently in Tasks 6 and 7 for item-level error tagging.

---

## Execution Notes

- **TDD discipline:** Each task starts with a failing test. Do not proceed to implementation until the test fails for the *right* reason (module not found / wrong call count / etc., not a typo).
- **One commit per Task step group** (per "Step 5: Commit" in each task). Frequent commits per project policy.
- **No `git push` without user confirmation** per [auto memory: feedback_review_before_push](../../../.claude/projects/-Users-tuxxon-workspace-AutoFlowCut/memory/feedback_review_before_push.md).
- **If a test fails for a reason not covered in this plan,** stop and investigate root cause. Do not patch over the symptom.
