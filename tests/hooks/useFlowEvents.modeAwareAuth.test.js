/**
 * Tests for Codex finding #6: auth state not mode-aware.
 *
 * onLoginExpired fired in flow mode must NOT trigger the BYOK api-key modal.
 * onLoginExpired fired in api mode MUST trigger the BYOK api-key modal.
 *
 * This tests the callback contract — what action is taken when the event fires
 * depends on the mode at call time.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFlowEvents } from '../../src/hooks/useFlowEvents'

describe('useFlowEvents — mode-aware onLoginExpired (#6)', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      // Clean up any lingering listeners
    }
  })

  it('fires onLoginExpired when flow-login-expired event dispatched', () => {
    const onLoginExpired = vi.fn()
    renderHook(() => useFlowEvents({ onLoginExpired, mode: 'api' }))

    act(() => {
      window.dispatchEvent(new CustomEvent('flow-login-expired'))
    })

    expect(onLoginExpired).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire onLoginExpired when mode is flow (flow login is handled by Flow view)', () => {
    // The fix: when mode==='flow', onLoginExpired is NOT called (the Flow view handles login)
    const onLoginExpired = vi.fn()
    renderHook(() => useFlowEvents({ onLoginExpired, mode: 'flow' }))

    act(() => {
      window.dispatchEvent(new CustomEvent('flow-login-expired'))
    })

    // In flow mode, onLoginExpired should NOT be triggered (api-key modal won't open)
    expect(onLoginExpired).not.toHaveBeenCalled()
  })

  it('fires onLoginExpired in api mode only', () => {
    const onLoginExpiredApi = vi.fn()
    const onLoginExpiredFlow = vi.fn()

    renderHook(() => useFlowEvents({ onLoginExpired: onLoginExpiredApi, mode: 'api' }))
    renderHook(() => useFlowEvents({ onLoginExpired: onLoginExpiredFlow, mode: 'flow' }))

    act(() => {
      window.dispatchEvent(new CustomEvent('flow-login-expired'))
    })

    expect(onLoginExpiredApi).toHaveBeenCalledTimes(1)
    expect(onLoginExpiredFlow).not.toHaveBeenCalled()
  })
})
