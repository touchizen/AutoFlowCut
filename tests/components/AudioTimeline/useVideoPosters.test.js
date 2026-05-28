/**
 * useVideoPosters — RAF-batched poster setState behavior
 *
 * 핵심 동작:
 * - 여러 poster가 같은 프레임에 해상되면 setState 1회로 묶임
 * - 다음 RAF가 flush 트리거
 * - cleanup 시 scheduled RAF/pending 모두 비움
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useVideoPosters } from '../../../src/components/AudioTimeline/useVideoPosters'

// getVideoPoster를 mock — 각 호출별로 직접 control 가능한 promise 반환
let mockResolvers // Map<src, (dataUrl: string|null) => void>
vi.mock('../../../src/utils/videoPoster', () => ({
  getVideoPoster: vi.fn((src) => {
    return new Promise((resolve) => {
      mockResolvers.set(src, resolve)
    })
  }),
}))

const makeClip = (id, src) => ({ id, videoSrc: src })

describe('useVideoPosters', () => {
  beforeEach(() => {
    mockResolvers = new Map()
  })

  afterEach(() => {
    mockResolvers = null
  })

  it('returns empty map on mount when no clips', () => {
    const { result } = renderHook(() => useVideoPosters([]))
    expect(result.current).toEqual({})
  })

  it('batches multiple poster resolutions into a single render via RAF', async () => {
    const clips = [
      makeClip('vid-1', 'file:///1.mp4'),
      makeClip('vid-2', 'file:///2.mp4'),
      makeClip('vid-3', 'file:///3.mp4'),
    ]

    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount += 1
      return useVideoPosters(clips)
    })

    // mount render(1) + obsolete-cleanup setPosterMap render(2)
    const baselineRenders = renderCount
    expect(baselineRenders).toBeGreaterThanOrEqual(1)

    // 3개 poster를 같은 마이크로태스크에 해상 — 모두 같은 프레임의 pendingRef에 들어감
    await act(async () => {
      mockResolvers.get('file:///1.mp4')('data:image/jpeg;base64,A')
      mockResolvers.get('file:///2.mp4')('data:image/jpeg;base64,B')
      mockResolvers.get('file:///3.mp4')('data:image/jpeg;base64,C')
      // RAF flush 대기
      await new Promise(r => requestAnimationFrame(r))
      // React가 batched setState를 commit 할 시간
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(Object.keys(result.current)).toHaveLength(3)
    })

    // 3 poster → 단 1번의 batched render (baseline 이후)
    const flushedRenders = renderCount - baselineRenders
    expect(flushedRenders).toBeLessThanOrEqual(2) // RAF flush 1 + React strict-mode 여유분
    expect(result.current['vid-1']).toEqual({ url: 'data:image/jpeg;base64,A', src: 'file:///1.mp4' })
    expect(result.current['vid-2']).toEqual({ url: 'data:image/jpeg;base64,B', src: 'file:///2.mp4' })
    expect(result.current['vid-3']).toEqual({ url: 'data:image/jpeg;base64,C', src: 'file:///3.mp4' })
  })

  it('clears pending updates on cleanup so stale resolves are dropped', async () => {
    const clips = [makeClip('vid-1', 'file:///1.mp4')]
    const { result, unmount } = renderHook(() => useVideoPosters(clips))

    // Unmount 후 poster 해상 — pending 큐가 비워지고 RAF도 취소돼야 함
    unmount()
    await act(async () => {
      mockResolvers.get('file:///1.mp4')('data:image/jpeg;base64,LATE')
      await new Promise(r => setTimeout(r, 32))
    })

    // result.current는 unmount 시점에 고정 — 빈 맵 그대로
    expect(result.current).toEqual({})
  })

  it('drops stale posters when a clip swaps videoSrc (same clip id)', async () => {
    let clips = [makeClip('vid-1', 'file:///old.mp4')]
    const { result, rerender } = renderHook(({ c }) => useVideoPosters(c), {
      initialProps: { c: clips },
    })

    // 첫 poster 도착
    await act(async () => {
      mockResolvers.get('file:///old.mp4')('data:image/jpeg;base64,OLD')
      await new Promise(r => requestAnimationFrame(r))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(result.current['vid-1']).toEqual({ url: 'data:image/jpeg;base64,OLD', src: 'file:///old.mp4' })
    })

    // 같은 id, 새 src로 clips 갱신 (i2v↔t2v swap 시나리오)
    mockResolvers.clear()
    clips = [makeClip('vid-1', 'file:///new.mp4')]
    rerender({ c: clips })

    // 이전 src 의 entry는 즉시 정리됨 (cleanup-driven setPosterMap)
    await waitFor(() => {
      expect(result.current['vid-1']).toBeUndefined()
    })

    // 새 poster 도착
    await act(async () => {
      mockResolvers.get('file:///new.mp4')('data:image/jpeg;base64,NEW')
      await new Promise(r => requestAnimationFrame(r))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(result.current['vid-1']).toEqual({ url: 'data:image/jpeg;base64,NEW', src: 'file:///new.mp4' })
    })
  })
})
