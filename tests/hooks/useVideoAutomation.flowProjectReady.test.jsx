/**
 * useVideoAutomation — flowProjectReady guard
 *
 * Contracts verified:
 *  - start() early-returns (no generateVideoT2V) when mode='flow' && flowProjectReady=false
 *  - start() proceeds normally when mode='flow' && flowProjectReady=true
 *  - start() proceeds normally when mode='api' && flowProjectReady=false (guard is no-op)
 */

import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'
import { toast } from '../../src/components/Toast'

// ─── Module mocks ──────────────────────────────────────────────────────────────

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

// ─── Timer setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.clearAllMocks()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeGenAPI(overrides = {}) {
  return {
    generateVideoT2V: vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' }),
    generateVideoI2V: vi.fn(),
    // Return authFailed so the batch stops quickly in "proceed" tests
    checkVideoStatus: vi.fn().mockResolvedValue({ success: false, authFailed: true, error: 'Auth expired' }),
    upscaleVideo: vi.fn(),
    fetchMedia: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    ...overrides,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useVideoAutomation.start — flowProjectReady guard', () => {
  it('early-returns (no generateVideoT2V) when mode=flow && flowProjectReady=false', async () => {
    const genAPI = makeGenAPI()
    const t = (k, opts) => opts?.defaultValue ?? k

    const hook = renderHook(() =>
      useVideoAutomation(genAPI, t, null, null, 'flow', false)
    )

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'vscene_1', prompt: 'test' }],
        projectName: 'p',
        saveMode: 'folder',
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => { await startPromise })

    // Generation must not have been invoked
    expect(genAPI.generateVideoT2V).not.toHaveBeenCalled()
    // Toast warning must have been shown
    expect(toast.warning).toHaveBeenCalled()
  }, 10000)

  it('flow mode no-token preflight shows Flow login guidance, not API-key guidance', async () => {
    const genAPI = makeGenAPI({ getAccessToken: vi.fn().mockResolvedValue(null) })
    const t = (k) => ({
      'toast.flowLoginRequired': 'Flow 창에서 로그인해주세요.',
      'status.loginRequired': 'API 키가 필요합니다.',
    }[k] || k)

    const hook = renderHook(() =>
      useVideoAutomation(genAPI, t, null, null, 'flow', true)
    )

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'vscene_1', prompt: 'test' }],
        projectName: 'p',
        saveMode: 'folder',
      })
    })
    await act(async () => { await startPromise })

    expect(genAPI.generateVideoT2V).not.toHaveBeenCalled()
    expect(hook.result.current.status).toBe('error')
    expect(hook.result.current.statusMessage).toContain('Flow 창에서 로그인해주세요.')
    expect(hook.result.current.statusMessage).not.toContain('API 키')
  })

  it('proceeds normally when mode=flow && flowProjectReady=true', async () => {
    const genAPI = makeGenAPI()
    const t = (k) => k

    const hook = renderHook(() =>
      useVideoAutomation(genAPI, t, null, null, 'flow', true)
    )

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'vscene_1', prompt: 'test' }],
        projectName: 'p',
        saveMode: 'folder',
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => { await startPromise })

    // Generation must have been invoked — batch proceeded
    expect(genAPI.generateVideoT2V).toHaveBeenCalled()
  }, 15000)

  it('proceeds normally when mode=api && flowProjectReady=false (guard is no-op in API mode)', async () => {
    const genAPI = makeGenAPI()
    const t = (k) => k

    const hook = renderHook(() =>
      useVideoAutomation(genAPI, t, null, null, 'api', false)
    )

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'vscene_1', prompt: 'test' }],
        projectName: 'p',
        saveMode: 'folder',
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => { await startPromise })

    // API mode: guard must not block generation even if flowProjectReady=false
    expect(genAPI.generateVideoT2V).toHaveBeenCalled()
  }, 15000)
})
