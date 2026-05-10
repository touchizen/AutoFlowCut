/**
 * useFlowArchiveBrowser — race-handling for fast project switches.
 *
 * Pins: when user picks project A then project B, a slow A response
 * must NOT overwrite B's media state.
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useFlowArchiveBrowser from '../../src/hooks/useFlowArchiveBrowser'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useFlowArchiveBrowser', () => {
  it('ignores a stale pickProject response when a newer one is in flight', async () => {
    const dA = deferred()
    const dB = deferred()
    const onFetchProjectGallery = vi.fn((projectId) => {
      if (projectId === 'A') return dA.promise
      if (projectId === 'B') return dB.promise
      return Promise.resolve({ success: true, items: [] })
    })

    const { result } = renderHook(() =>
      useFlowArchiveBrowser({
        onListFlowProjects: vi.fn().mockResolvedValue({ success: true, items: [] }),
        onFetchProjectGallery,
      })
    )

    // Pick A then immediately B without awaiting A's response
    await act(async () => {
      result.current.pickProject({ projectId: 'A', title: 'Mar 11 - 14:53' })
    })
    await act(async () => {
      result.current.pickProject({ projectId: 'B', title: 'Mar 11 - 14:39' })
    })

    // Resolve A LATE with its media
    await act(async () => {
      dA.resolve({ success: true, items: [{ mediaId: 'A-img', url: 'a.jpg' }] })
      await Promise.resolve()
    })

    // Then resolve B with its media
    await act(async () => {
      dB.resolve({ success: true, items: [{ mediaId: 'B-img', url: 'b.jpg' }] })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current.media.map(m => m.mediaId)).toEqual(['B-img'])
    })
    expect(result.current.selectedProject?.projectId).toBe('B')
  })

  it('reset/back invalidates outstanding media request so it cannot land', async () => {
    const dA = deferred()
    const onFetchProjectGallery = vi.fn(() => dA.promise)
    const { result } = renderHook(() =>
      useFlowArchiveBrowser({
        onListFlowProjects: vi.fn().mockResolvedValue({ success: true, items: [] }),
        onFetchProjectGallery,
      })
    )

    await act(async () => {
      result.current.pickProject({ projectId: 'A', title: 'A' })
    })
    // user backs out before response
    await act(async () => {
      result.current.backToDates()
    })
    // A's response arrives late
    await act(async () => {
      dA.resolve({ success: true, items: [{ mediaId: 'A-img', url: 'a.jpg' }] })
      await Promise.resolve()
    })

    expect(result.current.media).toEqual([])
    expect(result.current.view).toBe('dates')
  })
})
