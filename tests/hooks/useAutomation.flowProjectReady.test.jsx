/**
 * useAutomation — flowProjectReady guard
 *
 * Contracts verified:
 *  - start() early-returns (no submitGeneration) when mode='flow' && flowProjectReady=false
 *  - start() proceeds normally when mode='flow' && flowProjectReady=true
 *  - start() proceeds normally when mode='api' && flowProjectReady=false (API: guard is no-op)
 *  - retryErrors() early-returns when mode='flow' && flowProjectReady=false
 *  - retryErrors() proceeds normally when ready
 */

import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'
import { toast } from '../../src/components/Toast'

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('should not be called')),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn((prompt) => ({ styledPrompt: prompt || 'p', appliedStyle: null })),
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/utils/sceneFilters', () => ({
  filterPendingScenes: vi.fn((scenes) => scenes),
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

// ─── Helper: minimal genAPI + scenesHook ─────────────────────────────────────

function makeGenAPI(overrides = {}) {
  return {
    submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' }),
    // Return completed: true immediately so batches finish quickly in "proceed" tests
    checkGeneration: vi.fn().mockResolvedValue({ completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ id: 'img-1', mediaId: 'm-1' }] }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'ref-media-1' }),
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    ...overrides,
  }
}

function makeScenesHook(overrides = {}) {
  return {
    scenes: [{ id: 's1', prompt: 'a', status: 'pending', image: 'data:image/png;base64,abc' }],
    references: [],
    updateScene: vi.fn(),
    getMatchingReferences: vi.fn(() => []),
    ...overrides,
  }
}

// ─── Tests: start() with flowProjectReady ────────────────────────────────────

describe('useAutomation.start — flowProjectReady guard', () => {
  it('early-returns (no submitGeneration) when mode=flow && flowProjectReady=false', async () => {
    const genAPI = makeGenAPI()
    const scenesHook = makeScenesHook()
    const t = (k, opts) => opts?.defaultValue ?? k

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null, 'flow', false)
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => { await startPromise })

    // Generation must not have been invoked
    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    // Toast warning must have been shown
    expect(toast.warning).toHaveBeenCalled()
  }, 10000)

  it('proceeds normally when mode=flow && flowProjectReady=true', async () => {
    const genAPI = makeGenAPI()
    const scenesHook = makeScenesHook()
    const t = (k) => k

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null, 'flow', true)
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await act(async () => { await startPromise })

    // submitGeneration must have been called — batch proceeded
    expect(genAPI.submitGeneration).toHaveBeenCalled()
    // Toast warning must NOT have been called for the guard
    expect(toast.warning).not.toHaveBeenCalledWith(
      expect.stringContaining('Flow')
    )
  }, 15000)

  it('proceeds normally when mode=api && flowProjectReady=false (guard is no-op in API mode)', async () => {
    const genAPI = makeGenAPI()
    const scenesHook = makeScenesHook()
    const t = (k) => k

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null, 'api', false)
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await act(async () => { await startPromise })

    // API mode: guard should not block generation even if flowProjectReady=false
    expect(genAPI.submitGeneration).toHaveBeenCalled()
  }, 15000)
})

// ─── Tests: retryErrors() with flowProjectReady ───────────────────────────────

describe('useAutomation.retryErrors — flowProjectReady guard', () => {
  it('early-returns when mode=flow && flowProjectReady=false', async () => {
    const genAPI = makeGenAPI()
    const scenesHook = makeScenesHook({
      scenes: [
        { id: 's1', prompt: 'a', status: 'error', image: 'data:image/png;base64,abc' },
      ],
    })
    const t = (k, opts) => opts?.defaultValue ?? k

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null, 'flow', false)
    )

    await act(async () => {
      await result.current.retryErrors({ projectName: 'p', saveMode: 'folder' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    // submitGeneration must not have been called
    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    // Toast warning must have been shown
    expect(toast.warning).toHaveBeenCalled()
  }, 10000)

  it('proceeds normally when mode=flow && flowProjectReady=true', async () => {
    const genAPI = makeGenAPI()
    const scenesHook = makeScenesHook({
      scenes: [
        { id: 's1', prompt: 'a', status: 'error', image: 'data:image/png;base64,abc' },
      ],
    })
    const t = (k) => k

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null, 'flow', true)
    )

    let retryPromise
    await act(async () => {
      retryPromise = result.current.retryErrors({ projectName: 'p', saveMode: 'folder' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await act(async () => { await retryPromise })

    // submitGeneration must have been called — batch proceeded
    expect(genAPI.submitGeneration).toHaveBeenCalled()
  }, 15000)
})
