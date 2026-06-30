/**
 * useVideoAutomation — concurrency (sliding window)
 *
 * 7-15초 랜덤 딜레이 제거 + concurrency 슬라이딩 윈도우 검증.
 * 동시 in-flight Veo job 을 concurrency 개로 제한하고, 완료될 때마다 다음 항목 제출.
 */

import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    saveVideo: vi.fn().mockResolvedValue({ success: true, path: '/x.mp4' }),
  },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/services/videoRecovery', () => ({
  retryVideoDownload: vi.fn(),
}))
vi.mock('../../src/services/videoDownload', () => ({
  downloadVideoBase64: vi.fn().mockResolvedValue({ success: true, base64: 'vid_b64' }),
}))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({})),
  buildVideoMetaPatch: vi.fn((item) => ({
    seed: item?.seed ?? null,
    model: item?.model ?? null,
  })),
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

function makeScenes(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `vscene_${i + 1}`, prompt: `p${i + 1}`, seed: i, model: 'veo-3'
  }))
}

// 매 폴링마다 genIds 중 아직 미완료 1개를 complete 로 바꾸는 mock 헬퍼.
// firstPollSubmitCount: 첫 checkVideoStatus 시점의 제출 수를 캡처(윈도우 캡 검증용).
function makeProgressivePoll(getSubmitCount, captureFirst) {
  const completed = new Set()
  let firstCaptured = false
  return vi.fn().mockImplementation(async (genIds) => {
    if (!firstCaptured) { firstCaptured = true; captureFirst(getSubmitCount()) }
    const next = genIds.find(id => !completed.has(id))
    if (next) completed.add(next)
    return {
      success: true,
      statuses: genIds.map(id => completed.has(id)
        ? { status: 'complete', mediaId: `mid_${id}`, videoUrl: `http://v/${id}` }
        : { status: 'processing' }),
    }
  })
}

describe('useVideoAutomation — concurrency', () => {
  it('배치 제출 시 7000ms 이상 setTimeout 호출 없음 (랜덤 딜레이 제거)', { timeout: 20000 }, async () => {
    let submitCount = 0
    const generateVideoT2V = vi.fn().mockImplementation(async () => ({
      success: true, generationId: `gen_${++submitCount}`
    }))
    // checkVideoStatus: 호출될 때마다 모든 pending 항목을 complete 로 반환
    const checkVideoStatus = vi.fn().mockImplementation(async (genIds) => ({
      success: true,
      statuses: genIds.map(id => ({ status: 'complete', mediaId: `mid_${id}`, videoUrl: 'http://video' })),
    }))
    const fetchMedia = vi.fn().mockResolvedValue({ success: true, base64: 'vid_b64', mediaId: 'mid' })

    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia,
      downloadVideo: vi.fn().mockResolvedValue({ success: true, base64: 'b64' }),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }

    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: makeScenes(3),
        projectName: 'test', saveMode: 'folder',
        videoModel: 'veo-3', aspectRatio: '16:9', duration: 8,
        videoResolution: '720p', videoBatchCount: 1, seed: null,
        concurrency: 5,
        onItemUpdate: vi.fn(),
      })
    })

    // Phase 1: 각 항목 제출 사이 딜레이(최대 15000ms) + Phase 2 poll(10000ms) 포함
    for (let i = 0; i < 10; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    }
    await act(async () => { await startPromise })

    const largeSleeps = setTimeoutSpy.mock.calls.filter(([, delay]) => delay >= 7000)
    expect(largeSleeps).toHaveLength(0)
    expect(generateVideoT2V).toHaveBeenCalledTimes(3)
  })

  it('concurrency=2 면 첫 폴링 전까지 2개만 제출하고, 완료되며 슬라이딩으로 4개 전부 제출', { timeout: 20000 }, async () => {
    let submitCount = 0
    const generateVideoT2V = vi.fn().mockImplementation(async () => ({
      success: true, generationId: `gen_${++submitCount}`
    }))

    let firstPollSubmitCount = null
    const checkVideoStatus = makeProgressivePoll(
      () => submitCount,
      (n) => { firstPollSubmitCount = n }
    )

    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      downloadVideo: vi.fn().mockResolvedValue({ success: true, base64: 'b64' }),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }

    const onItemUpdate = vi.fn()
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: makeScenes(4),
        projectName: 'test', saveMode: 'folder',
        videoModel: 'veo-3', aspectRatio: '16:9', duration: 8,
        videoResolution: '720p', videoBatchCount: 1, seed: null,
        concurrency: 2,
        onItemUpdate,
      })
    })

    for (let i = 0; i < 40; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    }
    await act(async () => { await startPromise })

    // 윈도우 캡: 첫 폴링 시점에 정확히 2개만 in-flight (4개 전부 제출 X)
    expect(firstPollSubmitCount).toBe(2)
    // 슬라이딩: 완료되며 결국 4개 전부 제출
    expect(generateVideoT2V).toHaveBeenCalledTimes(4)
    // 4개 전부 complete 콜백
    const completes = onItemUpdate.mock.calls.filter(([, s]) => s === 'complete')
    expect(completes).toHaveLength(4)
  })

  it('concurrency≥항목수 면 첫 폴링 전 전부 제출 (기존 동작 유지)', { timeout: 20000 }, async () => {
    let submitCount = 0
    const generateVideoT2V = vi.fn().mockImplementation(async () => ({
      success: true, generationId: `gen_${++submitCount}`
    }))

    let firstPollSubmitCount = null
    const checkVideoStatus = makeProgressivePoll(
      () => submitCount,
      (n) => { firstPollSubmitCount = n }
    )

    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      downloadVideo: vi.fn().mockResolvedValue({ success: true, base64: 'b64' }),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }

    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: makeScenes(3),
        projectName: 'test', saveMode: 'folder',
        videoModel: 'veo-3', aspectRatio: '16:9', duration: 8,
        videoResolution: '720p', videoBatchCount: 1, seed: null,
        concurrency: 5,
        onItemUpdate: vi.fn(),
      })
    })

    for (let i = 0; i < 30; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    }
    await act(async () => { await startPromise })

    // 윈도우(5) ≥ 항목(3) → 첫 폴링 전 3개 전부 제출
    expect(firstPollSubmitCount).toBe(3)
    expect(generateVideoT2V).toHaveBeenCalledTimes(3)
  })

  it('concurrency 가 비정상 문자열이어도 기본값(clampInt)으로 제출', { timeout: 20000 }, async () => {
    // 손상된 설정값("x") → Math.min/max 면 NaN → pending.size < NaN 항상 false → 0건 제출(no-op).
    // clampInt 로 NaN→기본 4 폴백되어야 정상 제출.
    let submitCount = 0
    const generateVideoT2V = vi.fn().mockImplementation(async () => ({
      success: true, generationId: `gen_${++submitCount}`
    }))
    const checkVideoStatus = makeProgressivePoll(() => submitCount, () => {})

    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      downloadVideo: vi.fn().mockResolvedValue({ success: true, base64: 'b64' }),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }

    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: makeScenes(3),
        projectName: 'test', saveMode: 'folder',
        videoModel: 'veo-3', aspectRatio: '16:9', duration: 8,
        videoResolution: '720p', videoBatchCount: 1, seed: null,
        concurrency: 'x',  // 손상된 값
        onItemUpdate: vi.fn(),
      })
    })

    for (let i = 0; i < 30; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    }
    await act(async () => { await startPromise })

    // clampInt('x',1,10,4)=4 ≥ 3 → 3개 전부 제출 (NaN 이면 0건이라 RED)
    expect(generateVideoT2V).toHaveBeenCalledTimes(3)
  })
})
