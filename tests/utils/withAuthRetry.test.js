import { describe, it, expect, vi } from 'vitest'
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

    // Each wrapper branch needs two microtask yields (getAccessToken + fn) before
    // reaching refreshOnce(). setTimeout(r, 0) is a macrotask, which fires after
    // ALL pending microtasks — i.e., both branches are guaranteed to be blocked
    // on the refresh promise by the time we assert.
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
      .mockResolvedValueOnce('t2')         // initial call B — mock returns t2 (simulating externally-cached token)
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
