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
