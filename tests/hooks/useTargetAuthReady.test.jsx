import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTargetAuthReady } from '../../src/hooks/useTargetAuthReady.js'

describe('useTargetAuthReady', () => {
  it('keeps readiness keyed by session target across route changes', () => {
    const { result, rerender } = renderHook(
      ({ target }) => useTargetAuthReady(target, null),
      { initialProps: { target: 'flow' } },
    )

    expect(result.current.authReady).toBe(false)
    act(() => result.current.setTargetReady('flow', true))
    expect(result.current.authReady).toBe(true)

    // An unregistered target reads as not-ready and never inherits Flow's readiness.
    rerender({ target: 'other-target' })
    expect(result.current.authReady).toBe(false)
    expect(result.current.authReadyByTarget).toEqual({ flow: true })

    rerender({ target: 'flow' })
    expect(result.current.authReady).toBe(true)
  })

  it.each(['unknown', 'chatgpt', 'toString', '__proto__'])(
    'preserves the map for a setter call without an own known target: %s',
    (target) => {
      const { result } = renderHook(() => useTargetAuthReady('flow', null))
      act(() => result.current.setTargetReady('flow', true))
      expect(result.current.authReadyByTarget).toEqual({ flow: true })

      act(() => result.current.setTargetReady(target, false))

      expect(result.current.authReadyByTarget).toEqual({ flow: true })
    },
  )

  it('applies only monotonic target-tagged status events and fails closed for non-ready status', async () => {
    let listener
    const electronAPI = {
      getSessionTargetStatus: vi.fn(async () => ({
        target: 'flow', status: 'ready', ready: true, revision: 5,
      })),
      onSessionTargetStatus: vi.fn((callback) => {
        listener = callback
        return vi.fn()
      }),
    }
    const { result } = renderHook(() => useTargetAuthReady('flow', electronAPI))

    await waitFor(() => expect(result.current.authReady).toBe(true))

    act(() => listener({ target: 'flow', status: 'session-blocked', ready: false, revision: 4 }))
    expect(result.current.authReadyByTarget).toEqual({ flow: true })

    act(() => listener({ target: 'flow', status: 'challenge', ready: true, revision: 6 }))
    expect(result.current.authReadyByTarget).toEqual({ flow: false })

    act(() => listener({ target: '__proto__', status: 'ready', ready: true, revision: 7 }))
    expect(result.current.authReadyByTarget).toEqual({ flow: false })
  })
})
