/**
 * useVideoAutomation — 401 auth failure during polling and submit
 *
 * The wrapper's `authFailed: true` sentinel must break the poll loop
 * immediately. Without this break, the loop would run for 20 min until
 * VIDEO_MAX_POLL_COUNT timeout, with no user-visible error.
 *
 * Additional contracts verified here:
 *  - onItemUpdate called with errorKind:'auth' for the failing item
 *  - Remaining un-submitted items also get errorKind:'auth' (not left pending)
 *  - status is set to 'error', not 'done', after auth break
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
    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const t = (k) => k
    const hook = renderHook(() => useVideoAutomation(genAPI, t, null))

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

  it('calls onItemUpdate with errorKind:"auth" when poll authFailed fires', async () => {
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: false,
      authFailed: true,
      error: 'Auth expired — please re-login to Flow',
    })
    const onItemUpdate = vi.fn()
    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const t = (k) => k
    const hook = renderHook(() => useVideoAutomation(genAPI, t, null))

    const items = [{ id: 'vscene_1', prompt: 'test' }]
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: items,
        projectName: 'p',
        saveMode: 'folder',
        onItemUpdate,
      })
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    await act(async () => { await startPromise })

    // The polling item must be marked with errorKind:'auth'
    const authErrorCalls = onItemUpdate.mock.calls.filter(
      ([_id, status, patch]) => status === 'error' && patch?.errorKind === 'auth'
    )
    expect(authErrorCalls.length).toBeGreaterThanOrEqual(1)
    expect(authErrorCalls[0][0]).toBe('vscene_1')
  })

  it('poll authFailed 시 pending 항목도 progress.errorCount 에 집계', async () => {
    // 회귀: poll-path auth 핸들러가 pending 을 errorKind:'auth' 로 마킹하지만 videoErrorCount 를
    // 안 올려서, 단일 pending auth 실패 시 UI 는 에러 항목인데 progress.errorCount === 0.
    // (fillWindow auth 경로와 freshGen 루프는 이미 count++ 함 — poll-path 만 비대칭.)
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: false, authFailed: true, error: 'Auth expired',
    })
    const genAPI = {
      generateVideoT2V, generateVideoI2V: vi.fn(), checkVideoStatus,
      upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v', scenes: [{ id: 'vscene_1', prompt: 'test' }],
        projectName: 'p', saveMode: 'folder',
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    await act(async () => { await startPromise })

    // pending 항목이 auth error 로 마감됐으니 errorCount 에도 1 반영 (RED: 0)
    expect(hook.result.current.progress.errorCount).toBe(1)
  })

  it('sets status to "error" (not "done") after auth-failed poll break', async () => {
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: false,
      authFailed: true,
      error: 'Auth expired',
    })
    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const t = (k) => k
    const hook = renderHook(() => useVideoAutomation(genAPI, t, null))

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

    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    await act(async () => { await startPromise })

    expect(hook.result.current.status).toBe('error')
  })

  it('shows the resolved locale string in statusMessage (not the raw key)', async () => {
    // Regression guard: previously t('videoAutomation.authErrorStop') resolved
    // to the raw key string (key doesn't exist) — users saw the literal
    // 'videoAutomation.authErrorStop' in the status bar instead of the translated message.
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: false, authFailed: true, error: 'Auth expired',
    })
    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    // Realistic translator: returns a translated string for known keys, the key for unknown.
    const t = (k) => k === 'status.authErrorStopped' ? 'API auth failed.' : k
    const hook = renderHook(() => useVideoAutomation(genAPI, t, null))

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'vscene_1', prompt: 'test' }],
        projectName: 'p',
        saveMode: 'folder',
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    await act(async () => { await startPromise })

    // Must contain the translated string, NOT contain the bare key
    expect(hook.result.current.statusMessage).toContain('API auth failed.')
    expect(hook.result.current.statusMessage).not.toContain('status.authErrorStopped')
  })
})

describe('useVideoAutomation — auth failure during submit', () => {
  it('marks all items (submitted, failing, remaining) with errorKind:"auth" and skips polling', async () => {
    // Item 1 submits successfully, item 2 gets authFailed, item 3 is yet to submit.
    // Hook must: (a) mark item 2 (failed) and item 3 (remaining) with errorKind:'auth',
    // (b) also mark item 1 (already submitted) with errorKind:'auth' instead of leaving it
    // for a doomed poll, and (c) NOT enter the polling loop at all — token is dead.
    let callCount = 0
    const generateVideoT2V = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) return { success: true, generationId: 'gen-1' }
      return { success: false, authFailed: true, error: 'Auth expired' }
    })
    // checkVideoStatus is provided but MUST NOT be called — we assert that below.
    const checkVideoStatus = vi.fn()

    const onItemUpdate = vi.fn()
    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const t = (k) => k
    const hook = renderHook(() => useVideoAutomation(genAPI, t, null))

    const items = [
      { id: 'vscene_1', prompt: 'item 1' },
      { id: 'vscene_2', prompt: 'item 2' },
      { id: 'vscene_3', prompt: 'item 3' },
    ]

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: items,
        projectName: 'p',
        saveMode: 'folder',
        onItemUpdate,
      })
    })

    // Advance past inter-item submit delay (20_000ms with Math.random mocked to 0)
    // so item 2 gets submitted and authFails.
    await act(async () => { await vi.advanceTimersByTimeAsync(21000) })
    await act(async () => { await startPromise })

    // All three items end in error state with errorKind:'auth' — no silent abandonment.
    const authErrorCalls = onItemUpdate.mock.calls.filter(
      ([_id, status, patch]) => status === 'error' && patch?.errorKind === 'auth'
    )
    const authErrorIds = authErrorCalls.map(([id]) => id)
    expect(authErrorIds).toContain('vscene_1')  // already submitted, but token dead
    expect(authErrorIds).toContain('vscene_2')  // failed at submit
    expect(authErrorIds).toContain('vscene_3')  // not yet submitted

    // Polling must NOT be invoked when auth is dead — no point asking a stale token.
    expect(checkVideoStatus).not.toHaveBeenCalled()
  }, 15000)

  it('sets status to "error" (not "done") after submit authFailed break', async () => {
    const generateVideoT2V = vi.fn().mockResolvedValue({
      success: false,
      authFailed: true,
      error: 'Auth expired',
    })
    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus: vi.fn(),
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const t = (k) => k
    const hook = renderHook(() => useVideoAutomation(genAPI, t, null))

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

    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    await act(async () => { await startPromise })

    expect(hook.result.current.status).toBe('error')
  })
})

describe('useVideoAutomation — auth failure on i2v (F→V) mode', () => {
  // Regression guard for the original F→V bug: the auth-retry plumbing must work
  // for framePairs (i2v) just as for scenes (t2v). The i2v path uses framePairs
  // and generateVideoI2V — easy to leave un-tested if the suite only covers t2v.
  it('marks current and remaining framePairs with errorKind:"auth" on submit authFailed', async () => {
    let callCount = 0
    const generateVideoI2V = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) return { success: true, generationId: 'gen-1' }
      return { success: false, authFailed: true, error: 'Auth expired' }
    })
    // checkVideoStatus is provided but must NOT be called — submit-phase auth death
    // abandons the batch entirely instead of polling already-submitted items with a
    // known-bad token.
    const checkVideoStatus = vi.fn()

    const onItemUpdate = vi.fn()
    const genAPI = {
      generateVideoT2V: vi.fn(),
      generateVideoI2V,
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const t = (k) => k
    const hook = renderHook(() => useVideoAutomation(genAPI, t, null))

    // Shape mirrors what useVideoAutomation expects after framePairs filtering (line 260)
    // cloud(Veo) I2V: 시작 프레임을 inline base64(_startImage)로 제공 (mediaId 대체)
    const IMG = 'data:image/png;base64,AAAA'
    const framePairs = [
      { id: 'fp_1', prompt: 'pair 1', startSceneId: 'scene_1', _startImage: IMG, status: 'pending' },
      { id: 'fp_2', prompt: 'pair 2', startSceneId: 'scene_2', _startImage: IMG, status: 'pending' },
      { id: 'fp_3', prompt: 'pair 3', startSceneId: 'scene_3', _startImage: IMG, status: 'pending' },
    ]

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 'i2v',
        framePairs,
        projectName: 'p',
        saveMode: 'folder',
        onItemUpdate,
      })
    })

    // Advance past inter-item submit delay so fp_2 gets submitted and authFails.
    await act(async () => { await vi.advanceTimersByTimeAsync(21000) })
    await act(async () => { await startPromise })

    // All 3 framePairs must end with errorKind:'auth' — fp_1 (submitted), fp_2 (failed),
    // fp_3 (not yet submitted).
    const authErrorCalls = onItemUpdate.mock.calls.filter(
      ([_id, status, patch]) => status === 'error' && patch?.errorKind === 'auth'
    )
    const authErrorIds = authErrorCalls.map(([id]) => id)
    expect(authErrorIds).toContain('fp_1')
    expect(authErrorIds).toContain('fp_2')
    expect(authErrorIds).toContain('fp_3')
    // i2v path was actually invoked (not the t2v path)
    expect(generateVideoI2V).toHaveBeenCalled()
    // No polling on a dead token
    expect(checkVideoStatus).not.toHaveBeenCalled()
  }, 15000)

  it('breaks i2v poll loop immediately when checkVideoStatus returns authFailed', async () => {
    const generateVideoI2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: false, authFailed: true, error: 'Auth expired',
    })
    const onItemUpdate = vi.fn()
    const genAPI = {
      generateVideoT2V: vi.fn(),
      generateVideoI2V,
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const t = (k) => k
    const hook = renderHook(() => useVideoAutomation(genAPI, t, null))

    const framePairs = [
      { id: 'fp_1', prompt: 'pair 1', startSceneId: 'scene_1', _startImage: 'data:image/png;base64,AAAA', status: 'pending' },
    ]

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 'i2v',
        framePairs,
        projectName: 'p',
        saveMode: 'folder',
        onItemUpdate,
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    await act(async () => { await startPromise })

    expect(checkVideoStatus).toHaveBeenCalledTimes(1)
    const authErrorCall = onItemUpdate.mock.calls.find(
      ([_id, status, patch]) => status === 'error' && patch?.errorKind === 'auth'
    )
    expect(authErrorCall?.[0]).toBe('fp_1')
  })
})
