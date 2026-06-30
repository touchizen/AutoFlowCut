/**
 * useVideoAutomation — fresh I2V regeneration saves the CURRENT model, not the stale one (review-2 r2).
 *
 * The i2v item-build preserves p.model for download-only/in-flight recovery (review-2 r1). But a
 * freshGen item (e.g. regenerating an already-complete pair after switching the F2V model) is
 * submitted with effectiveVideoModel (the NEW selection). At completion the hook looks up the
 * local `item` object and passes it to downloadAndSaveVideo → pickVideoMetadata(item, options),
 * which prefers item.model. If the local item still carries the OLD p.model, the save/history
 * records the stale model even though the new request used the current one.
 *
 * The fix stamps the submitted model onto the local fresh item so completion metadata matches the
 * model that actually generated the video.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }), saveVideo: vi.fn() },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
vi.mock('../../src/utils/framePairImages', () => ({
  resolveFrameImageBase64: vi.fn().mockResolvedValue('data:image/png;base64,REF'),
}))
vi.mock('../../src/services/videoDownload', () => ({
  downloadVideoBase64: vi.fn().mockResolvedValue({ success: true, base64: 'data:video/mp4;base64,VID', resolution: '720p' }),
}))

// Capture the item passed into pickVideoMetadata at completion/download time.
const pickCalls = []
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn((item, options) => {
    pickCalls.push({ item, options })
    return { model: item?.model || options?.videoModel || 'flow-video', seed: null }
  }),
  buildVideoMetaPatch: vi.fn(() => ({})),
}))

beforeEach(() => {
  __resetQuotaStopForTests()
  pickCalls.length = 0
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('useVideoAutomation — fresh regen model metadata (review-2 r2)', () => {
  it('regenerating a completed pair saves the NEW model, not the stored stale one', async () => {
    const genAPI = {
      generateVideoT2V: vi.fn(),
      generateVideoI2V: vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' }),
      // First poll: complete with a mediaId → triggers downloadAndSaveVideo (the metadata path).
      checkVideoStatus: vi.fn().mockResolvedValue({
        success: true,
        statuses: [{ generationId: 'gen-1', status: 'complete', mediaId: 'm-NEW', videoUrl: 'http://v' }],
      }),
      downloadVideo: vi.fn().mockResolvedValue({ success: true }),
      upscaleVideo: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow'))

    let p
    await act(async () => {
      p = hook.result.current.start({
        mode: 'i2v',
        // A previously-completed pair carrying the OLD model in its stored state.
        framePairs: [{
          id: 'fp_1', startSceneId: 'scene_1', _startImage: 'data:image/png;base64,REF',
          status: 'complete', videoPath: '/old/video.mp4', mediaId: 'm-OLD',
          prompt: 'p', model: 'veo_3_1_i2v_s_quality_fl',
        }],
        projectName: 'test', saveMode: 'memory',
        // user switched the dropdown to a DIFFERENT model before pressing Start (regenerate)
        videoModel: 'veo_3_1_i2v_s_fast_fl', aspectRatio: '16:9', duration: 8, seed: null, videoResolution: '720p',
        onItemUpdate: vi.fn(),
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(40 * 1000) })
    await act(async () => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 1000) })
    await p

    // downloadAndSaveVideo must have been reached for the completed media.
    expect(pickCalls.length).toBeGreaterThan(0)
    const last = pickCalls[pickCalls.length - 1]
    expect(last.item.model).toBe('veo_3_1_i2v_s_fast_fl')
  })
})
