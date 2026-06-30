/**
 * useVideoAutomation — Phase 0 download-only batch honors authFailed (#R25-3).
 *
 * retryVideoDownload returns { authFailed:true } when Flow auth is dead. If the whole
 * batch is download-only, Phase 0 must stop and end as 'error' (not silently 'done'),
 * and must not call onComplete (which would credit a completed run).
 *
 * Uses the REAL retryVideoDownload (not mocked) — with authFailed it returns before any
 * download/save, so only checkVideoStatus needs stubbing.
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
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({})),
  buildVideoMetaPatch: vi.fn(() => ({})),
}))

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => { vi.restoreAllMocks() })

describe('useVideoAutomation — download-only authFailed (#R25-3)', () => {
  it('ends as error (not done) and skips onComplete when retry authFailed', async () => {
    // dead-token sentinel from checkVideoStatus → retryVideoDownload returns authFailed
    const checkVideoStatus = vi.fn().mockResolvedValue({ success: true, statuses: [], authFailed: true, error: '401' })
    const onComplete = vi.fn().mockResolvedValue(undefined)
    const genAPI = {
      generateVideoT2V: vi.fn(),
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      downloadVideo: vi.fn(),
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, onComplete))

    await act(async () => {
      await hook.result.current.start({
        mode: 't2v',
        // download-only: error + generationId + mediaId + no videoPath
        scenes: [{ id: 'vscene_1', prompt: 'p', status: 'error', generationId: 'g1', mediaId: 'm1', videoPath: null }],
        projectName: 'test', saveMode: 'folder',
        videoModel: 'veo-3.1-fast-generate-preview', aspectRatio: '16:9',
        duration: 8, seed: null, videoResolution: '720p',
      })
    })

    expect(checkVideoStatus).toHaveBeenCalledTimes(1)
    expect(hook.result.current.status).toBe('error')
    expect(genAPI.downloadVideo).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
  })
})
