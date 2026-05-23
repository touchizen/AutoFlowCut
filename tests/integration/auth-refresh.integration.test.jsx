/**
 * End-to-end: a video batch survives a mid-polling token expiry.
 *
 * Setup:
 *  - Submit succeeds with token 'old'.
 *  - First poll returns 401 (token expired server-side).
 *  - Wrapper silently refreshes to 'new' (via getAccessToken(true) mock).
 *  - Second poll (with 'new') returns complete + mediaId.
 *  - Download succeeds.
 *  - User sees the video as completed, no toast, no UI error.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { createAuthRetryWrapper } from '../../src/utils/withAuthRetry'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    saveVideo: vi.fn().mockResolvedValue({ success: true, path: '/tmp/out.mp4' }),
  },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({ model: 'veo', seed: 1 })),
  buildVideoMetaPatch: vi.fn(() => ({})),
}))

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  // Mock window.electronAPI for download path
  global.window.electronAPI = {
    domDownloadVideo: vi.fn().mockResolvedValue({
      success: true, base64: 'BASE64_DATA', resolution: '1080p',
    }),
  }
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete global.window.electronAPI
})

describe('Integration — token expires mid-batch, refresh recovers', () => {
  it('completes the batch without surfacing an auth error', async () => {
    // Simulate getAccessToken: first call returns 'old', forceRefresh returns 'new'
    const getAccessToken = vi.fn()
      .mockResolvedValueOnce('old')   // initial fetch (start() token check)
      .mockResolvedValueOnce('old')   // withAuthRetry getAccessToken() before first poll
      .mockResolvedValueOnce('new')   // refreshOnce() → getAccessToken(true)
      .mockResolvedValueOnce('new')   // any further reads
      .mockResolvedValue('new')

    const onAuthError = vi.fn()

    // Wrap checkVideoStatus exactly like useFlowAPI does
    const wrapper = createAuthRetryWrapper({ getAccessToken, onAuthError })
    const rawCheckVideoStatus = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'HTTP 401: bad token' })
      .mockResolvedValueOnce({
        success: true,
        statuses: [{ status: 'complete', mediaId: 'media-1', videoUrl: 'https://x/y' }],
      })
    const checkVideoStatus = (genIds) => wrapper('checkVideoStatus', (token) => rawCheckVideoStatus(token, genIds))

    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })

    const flowAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken,
    }

    const t = (k) => k
    const onItemUpdate = vi.fn()
    const hook = renderHook(() => useVideoAutomation(flowAPI, t, onAuthError, null))

    const items = [{ id: 'vscene_1', prompt: 'p', videoSaveId: 't2v_1' }]
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v', scenes: items, projectName: 'proj', saveMode: 'folder',
        onItemUpdate,
      })
    })

    // Advance through submit + poll cycles
    await act(async () => { await vi.advanceTimersByTimeAsync(10500) })
    await act(async () => { await startPromise })

    // Behavior assertions
    expect(rawCheckVideoStatus).toHaveBeenCalledTimes(2)        // first 401 + retry succeeded
    expect(rawCheckVideoStatus).toHaveBeenNthCalledWith(1, 'old', expect.any(Array))
    expect(rawCheckVideoStatus).toHaveBeenNthCalledWith(2, 'new', expect.any(Array))
    expect(onAuthError).not.toHaveBeenCalled()                  // recovered cleanly, no user-facing error
    // Item updated to complete
    const completeCall = onItemUpdate.mock.calls.find(([, status]) => status === 'complete')
    expect(completeCall).toBeDefined()
  })
})
