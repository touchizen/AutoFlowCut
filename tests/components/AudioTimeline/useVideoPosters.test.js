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

// jsdom의 requestAnimationFrame은 vitest 환경에서 불안정/타이밍 비결정적.
// 결정적 flush를 위해 RAF/cancelAF를 동기 큐로 stub — flushRaf()로 명시적으로 진행.
let rafQueue
let nextRafId
const flushRaf = () => {
  const q = rafQueue
  rafQueue = []
  q.forEach(({ fn }) => fn(0))
}

const makeClip = (id, src) => ({ id, videoSrc: src })

describe('useVideoPosters', () => {
  beforeEach(() => {
    mockResolvers = new Map()
    rafQueue = []
    nextRafId = 1
    vi.stubGlobal('requestAnimationFrame', (fn) => {
      const id = nextRafId++
      rafQueue.push({ id, fn })
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id) => {
      rafQueue = rafQueue.filter(e => e.id !== id)
    })
  })

  afterEach(() => {
    mockResolvers = null
    rafQueue = []
    vi.unstubAllGlobals()
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

    // 3개 poster를 같은 마이크로태스크에 해상 — 모두 같은 프레임의 pendingRef에 들어감.
    // flushRaf()로 batched setState 1회 commit.
    await act(async () => {
      mockResolvers.get('file:///1.mp4')('data:image/jpeg;base64,A')
      mockResolvers.get('file:///2.mp4')('data:image/jpeg;base64,B')
      mockResolvers.get('file:///3.mp4')('data:image/jpeg;base64,C')
      await Promise.resolve() // .then 콜백 비우기
      flushRaf()
    })

    expect(Object.keys(result.current)).toHaveLength(3)

    // 3 poster → 단 1번의 batched render (baseline 이후)
    const flushedRenders = renderCount - baselineRenders
    expect(flushedRenders).toBeLessThanOrEqual(2) // RAF flush 1 + React strict-mode 여유분
    expect(result.current['vid-1']).toEqual({ url: 'data:image/jpeg;base64,A', src: 'file:///1.mp4' })
    expect(result.current['vid-2']).toEqual({ url: 'data:image/jpeg;base64,B', src: 'file:///2.mp4' })
    expect(result.current['vid-3']).toEqual({ url: 'data:image/jpeg;base64,C', src: 'file:///3.mp4' })
  })

  it('일시적 추출 실패(null) → 백오프 재시도로 자동 복구 (스크롤 없이)', async () => {
    // setTimeout/clearTimeout 만 fake — RAF 는 beforeEach 의 수동 stub(flushRaf) 유지.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const clips = [makeClip('vid-1', 'file:///1.mp4')]
      const { result } = renderHook(() => useVideoPosters(clips))

      // 1차 추출 실패(null) — getVideoPoster 가 6s 타임아웃/에러로 null 반환한 상황
      await act(async () => {
        mockResolvers.get('file:///1.mp4')(null)
        await Promise.resolve()
      })
      expect(result.current['vid-1']).toBeUndefined() // 아직 포스터 없음

      // 재시도 타이머 경과 → getVideoPoster 재호출(새 resolver 저장)
      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
      })

      // 재시도 성공 → 포스터 주입
      await act(async () => {
        mockResolvers.get('file:///1.mp4')('data:image/jpeg;base64,RETRY')
        await Promise.resolve()
        flushRaf()
      })
      expect(result.current['vid-1']).toEqual({ url: 'data:image/jpeg;base64,RETRY', src: 'file:///1.mp4' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears pending updates on cleanup so stale resolves are dropped', async () => {
    const clips = [makeClip('vid-1', 'file:///1.mp4')]
    const { result, unmount } = renderHook(() => useVideoPosters(clips))

    // Unmount 후 poster 해상 — pending 큐가 비워지고 RAF도 취소돼야 함
    unmount()
    await act(async () => {
      mockResolvers.get('file:///1.mp4')('data:image/jpeg;base64,LATE')
      await Promise.resolve()
      flushRaf()
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
      await Promise.resolve()
      flushRaf()
    })
    expect(result.current['vid-1']).toEqual({ url: 'data:image/jpeg;base64,OLD', src: 'file:///old.mp4' })

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
      await Promise.resolve()
      flushRaf()
    })
    expect(result.current['vid-1']).toEqual({ url: 'data:image/jpeg;base64,NEW', src: 'file:///new.mp4' })
  })
})
