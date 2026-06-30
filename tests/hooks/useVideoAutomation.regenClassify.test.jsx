/**
 * useVideoAutomation — a completed item reset to status:'pending' regenerates (freshGen), #R29-6.
 *
 * VideoDetailModal "Regenerate" resets the item to 'pending' (keeping generationId/mediaId/videoPath
 * as fallback). Classification must treat it as freshGen (NOT download-only, which requires
 * status==='error'; NOT in-flight, which requires status==='generating') so the next Start submits a
 * NEW generation rather than re-downloading the existing result.
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
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({})),
  buildVideoMetaPatch: vi.fn(() => ({})),
}))
vi.mock('../../src/utils/framePairImages', () => ({
  resolveFrameImageBase64: vi.fn().mockResolvedValue(null),  // i2v: flow mediaId 경로라 호출 안 되지만 안전망
}))

import { retryVideoDownload } from '../../src/services/videoRecovery'

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('useVideoAutomation — reset-to-pending regenerates (#R29-6)', () => {
  it('a completed item set to status:pending (ids kept) is submitted fresh, not re-downloaded', async () => {
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-NEW' })
    const checkVideoStatus = vi.fn().mockResolvedValue({ success: true, statuses: [{ generationId: 'gen-NEW', status: 'pending' }] })
    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      downloadVideo: vi.fn(),
      upscaleVideo: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))

    let p
    await act(async () => {
      p = hook.result.current.start({
        mode: 't2v',
        // a "completed" item that was reset to pending by Regenerate (ids + videoPath still present)
        scenes: [{ id: 'vscene_1', prompt: 'p', status: 'pending', generationId: 'gen-OLD', mediaId: 'm-OLD', videoPath: '/old.mp4', targetDuration: 8 }],
        projectName: 'test', saveMode: 'memory',
        videoModel: 'veo-3.1-fast-generate-preview', aspectRatio: '16:9', duration: 8, seed: null, videoResolution: '720p',
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 1000) })
    await act(async () => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 1000) })
    await p

    expect(generateVideoT2V).toHaveBeenCalledTimes(1)   // fresh generation submitted
    expect(retryVideoDownload).not.toHaveBeenCalled()    // NOT the download-only path
  })

  it('i2v: a completed framePair is regenerated on full Start (not excluded by status filter)', async () => {
    // 이슈1: t2v(scenes.filter(s=>s.prompt))는 complete 여도 전체 Start 에서 재생성되는데,
    //   i2v 만 `status !== 'complete'` 로 완성된 쌍을 제외해 noItems(="이미 완료") 가 떴다. 통일.
    const generateVideoI2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-NEW' })
    const checkVideoStatus = vi.fn().mockResolvedValue({ success: true, statuses: [{ generationId: 'gen-NEW', status: 'pending' }] })
    const genAPI = {
      generateVideoT2V: vi.fn(),
      generateVideoI2V,
      checkVideoStatus,
      downloadVideo: vi.fn(),
      upscaleVideo: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    // appMode='flow' + Flow mediaId 라 startImage 가 resolveFrameImageBase64 없이 바로 해결된다.
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow'))

    let p
    await act(async () => {
      p = hook.result.current.start({
        mode: 'i2v',
        framePairs: [{ id: 'fp_1', startSceneId: 'scene_1', _startMediaId: 'm-START', status: 'complete', generationId: 'g-OLD', mediaId: 'm-OLD', videoPath: '/old.mp4', prompt: 'p' }],
        projectName: 'test', saveMode: 'memory',
        videoModel: 'veo_3_1_i2v_s_fast_fl', aspectRatio: '16:9', duration: 8, seed: null, videoResolution: '720p',
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(40 * 1000) })
    await act(async () => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 1000) })
    await p

    expect(generateVideoI2V).toHaveBeenCalledTimes(1)   // complete 여도 재생성 (제외 안 함)
  })
})
