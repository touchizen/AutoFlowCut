import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTargetAuthReady } from '../../src/hooks/useTargetAuthReady.js'

describe('useTargetAuthReady', () => {
  it('keeps readiness isolated by session target across route changes', () => {
    const { result, rerender } = renderHook(
      ({ target }) => useTargetAuthReady(target, null),
      { initialProps: { target: 'chatgpt' } },
    )

    act(() => result.current.setTargetReady('chatgpt', true))
    rerender({ target: 'flow' })
    expect(result.current.authReady).toBe(false)

    act(() => result.current.setTargetReady('flow', true))
    rerender({ target: 'chatgpt' })
    expect(result.current.authReady).toBe(true)
    expect(result.current.authReadyByTarget).toEqual({ flow: true, chatgpt: true })
  })

  it.each(['unknown', 'toString', '__proto__'])(
    'preserves a non-default map for a setter call without an own known target: %s',
    (target) => {
      const { result } = renderHook(() => useTargetAuthReady('flow', null))
      act(() => result.current.setTargetReady('flow', true))
      act(() => result.current.setTargetReady('chatgpt', true))
      expect(result.current.authReadyByTarget).toEqual({ flow: true, chatgpt: true })

      act(() => result.current.setTargetReady(target, false))

      expect(result.current.authReadyByTarget).toEqual({ flow: true, chatgpt: true })
    },
  )

  it('applies only monotonic target-tagged status events and fails closed for non-ready status', async () => {
    let listener
    const electronAPI = {
      getSessionTargetStatus: vi.fn(async () => ({
        target: 'chatgpt', status: 'ready', ready: true, revision: 5,
      })),
      onSessionTargetStatus: vi.fn((callback) => {
        listener = callback
        return vi.fn()
      }),
    }
    const { result } = renderHook(() => useTargetAuthReady('chatgpt', electronAPI))

    await waitFor(() => expect(result.current.authReady).toBe(true))
    act(() => result.current.setTargetReady('flow', true))
    expect(result.current.authReadyByTarget).toEqual({ flow: true, chatgpt: true })

    act(() => listener({ target: 'chatgpt', status: 'session-blocked', ready: false, revision: 4 }))
    expect(result.current.authReadyByTarget).toEqual({ flow: true, chatgpt: true })

    act(() => listener({ target: 'chatgpt', status: 'challenge', ready: true, revision: 6 }))
    expect(result.current.authReadyByTarget).toEqual({ flow: true, chatgpt: false })

    act(() => listener({ target: '__proto__', status: 'ready', ready: true, revision: 7 }))
    expect(result.current.authReadyByTarget).toEqual({ flow: true, chatgpt: false })
  })
})
