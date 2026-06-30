/**
 * useVideoAutomation — i2v download-only recovery preserves the ORIGINAL model (review-2 r1).
 *
 * The i2v item-build phase used to stamp every framePair with effectiveVideoModel (current
 * selection) before Phase 0 classifies download-only / in-flight / fresh work. That collapsed
 * two responsibilities: current settings for NEW submissions vs. preserved metadata for
 * already-submitted jobs. A download-only item (status:'error' + generationId + mediaId +
 * !videoPath) carries the model that ACTUALLY generated the server video; overwriting it with
 * the now-selected model makes the recovery save record the wrong model (pickVideoMetadata uses
 * item.model first). Fresh submissions still get effectiveVideoModel stamped at submit time, so
 * preserving p.model here loses nothing.
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
  retryVideoDownload: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({})),
  buildVideoMetaPatch: vi.fn(() => ({})),
}))
vi.mock('../../src/utils/framePairImages', () => ({
  resolveFrameImageBase64: vi.fn().mockResolvedValue(null),
}))

import { retryVideoDownload } from '../../src/services/videoRecovery'

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('useVideoAutomation — i2v recovery preserves original model (review-2 r1)', () => {
  it('download-only framePair keeps its stored model, not the currently selected one', async () => {
    const genAPI = {
      generateVideoT2V: vi.fn(),
      generateVideoI2V: vi.fn(),
      checkVideoStatus: vi.fn(),
      downloadVideo: vi.fn(),
      upscaleVideo: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow'))

    let p
    await act(async () => {
      p = hook.result.current.start({
        mode: 'i2v',
        // download-only: server already generated with the ORIGINAL model, only local save failed.
        framePairs: [{
          id: 'fp_1', startSceneId: 'scene_1', _startMediaId: 'm-START',
          status: 'error', generationId: 'g-OLD', mediaId: 'm-OLD', videoPath: null,
          prompt: 'p', model: 'veo_3_1_i2v_s_quality_fl',
        }],
        projectName: 'test', saveMode: 'memory',
        // user has since switched the dropdown to a DIFFERENT model
        videoModel: 'veo_3_1_i2v_s_fast_fl', aspectRatio: '16:9', duration: 8, seed: null, videoResolution: '720p',
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(40 * 1000) })
    await act(async () => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 1000) })
    await p

    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
    const passedItem = retryVideoDownload.mock.calls[0][0].item
    expect(passedItem.model).toBe('veo_3_1_i2v_s_quality_fl')
  })
})
