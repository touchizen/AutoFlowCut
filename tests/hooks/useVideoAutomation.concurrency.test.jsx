/**
 * useVideoAutomation — concurrency
 *
 * 7-15초 랜덤 딜레이 제거 검증 + concurrency 파라미터 수용 확인.
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
vi.mock('../../src/services/videoRecovery', () => ({
  retryVideoDownload: vi.fn(),
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
})
