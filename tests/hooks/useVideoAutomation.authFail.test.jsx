/**
 * useVideoAutomation — 401 auth failure during polling
 *
 * The wrapper's `authFailed: true` sentinel must break the poll loop
 * immediately. Without this break, the loop would run for 20 min until
 * VIDEO_MAX_POLL_COUNT timeout, with no user-visible error.
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

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useVideoAutomation — auth failure during polling', () => {
  it('breaks poll loop immediately when checkVideoStatus returns authFailed', async () => {
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
    // Simulating the wrapper's output after 2 failed 401s
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: false,
      authFailed: true,
      error: 'Auth expired — please re-login to Flow',
    })
    const onAuthError = vi.fn()
    const flowAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const t = (k) => k
    const hook = renderHook(() => useVideoAutomation(flowAPI, t, onAuthError, null))

    const items = [{ id: 'vscene_1', prompt: 'test' }]
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: items,
        projectName: 'p',
        saveMode: 'folder',
      })
    })

    // Let microtasks settle so submit + first poll happen
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })

    await act(async () => { await startPromise })

    // checkVideoStatus called once (broke immediately on authFailed)
    expect(checkVideoStatus).toHaveBeenCalledTimes(1)
  })
})
