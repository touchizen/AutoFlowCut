/**
 * useAutomation — 401 auth failure during uploadReference and collectGeneration
 *
 * The wrapper's `authFailed: true` sentinel must break the batch immediately.
 *
 * Contracts verified:
 *  - uploadReference authFailed → submitGeneration NOT called (batch stops before generation)
 *  - uploadReference authFailed → status set to 'error', not 'done'
 *  - collectGeneration authFailed → scene marked with errorKind:'auth'
 *  - collectGeneration authFailed → status set to 'error', not 'done'
 *
 * NOTE: useAutomation does not expose a per-reference update callback (references
 * are mutated objects in scenesHook.references). The authFailed sentinel from
 * uploadReference stops the batch via stopRequestedRef + sets status/statusMessage.
 */

import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

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
  presetTagForStyleId: vi.fn(() => null),
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
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── Helper to build a minimal genAPI + scenesHook ────────────────────────────

function makeFlowAPI(overrides = {}) {
  return {
    submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' }),
    checkGeneration: vi.fn().mockResolvedValue({ completed: false }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ id: 'img-1', mediaId: 'm-1' }] }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'ref-media-1' }),
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    cancelGeneration: vi.fn().mockResolvedValue({ success: true, aborted: 0 }),
    ...overrides,
  }
}

function makeScenesHook(overrides = {}) {
  const references = overrides.references || []
  return {
    scenes: [{ id: 's1', prompt: 'a', status: 'pending' }],
    references,
    updateScene: vi.fn(),
    // 업로드는 "씬이 쓰는 ref"로 스코프되므로, 이 테스트들은 씬이 모든 ref 를 쓴다고 가정.
    getMatchingReferences: vi.fn(() => references),
    ...overrides,
  }
}

// ─── Tests: uploadReference authFailed ─────────────────────────────────────────

describe('useAutomation — auth failure during uploadReference', () => {
  it('stops batch immediately — submitGeneration not called when uploadReference authFailed', async () => {
    const genAPI = makeFlowAPI({
      uploadReference: vi.fn().mockResolvedValue({
        success: false,
        authFailed: true,
        error: 'Auth expired — please re-login to Flow',
      }),
    })
    // Reference with data triggers the upload path
    const scenesHook = makeScenesHook({
      references: [{ id: 'ref1', name: 'ref1.png', data: 'base64data==', category: 'style', mediaId: null }],
    })

    const t = (k) => k
    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null)
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await act(async () => { await startPromise })

    // The batch must not proceed to scene generation
    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(genAPI.cancelGeneration).toHaveBeenCalledTimes(1)
  }, 15000)

  it('sets status to "error" when uploadReference authFailed fires', async () => {
    const genAPI = makeFlowAPI({
      uploadReference: vi.fn().mockResolvedValue({
        success: false,
        authFailed: true,
        error: 'Auth expired — please re-login to Flow',
      }),
    })
    // Give the scene an image so the reset-on-empty useEffect does NOT fire
    const scenesHook = makeScenesHook({
      scenes: [{ id: 's1', prompt: 'a', status: 'pending', image: 'data:image/png;base64,abc' }],
      references: [{ id: 'ref1', name: 'ref1.png', data: 'base64data==', category: 'style', mediaId: null }],
    })

    const t = (k) => k
    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null)
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await act(async () => { await startPromise })

    expect(result.current.status).toBe('error')
  }, 15000)

  it('calls uploadReference exactly once — not retried after authFailed', async () => {
    const uploadReference = vi.fn().mockResolvedValue({
      success: false,
      authFailed: true,
      error: 'Auth expired — please re-login to Flow',
    })
    const genAPI = makeFlowAPI({ uploadReference })
    const scenesHook = makeScenesHook({
      references: [{ id: 'ref1', name: 'ref1.png', data: 'base64data==', category: 'style', mediaId: null }],
    })

    const t = (k) => k
    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null)
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await act(async () => { await startPromise })

    // uploadReference called exactly once for the one reference (no retry loop on authFailed)
    expect(uploadReference).toHaveBeenCalledTimes(1)
  }, 15000)
})

// ─── Tests: submitGeneration authFailed (#R10-6) ───────────────────────────────

describe('useAutomation — auth failure during submitGeneration (#R10-6)', () => {
  it('stops the batch + marks errorKind:auth when submitGeneration returns authFailed', async () => {
    const updateScene = vi.fn()
    const submitGeneration = vi.fn().mockResolvedValue({
      success: false, authFailed: true, error: 'Auth expired — please re-login to Flow',
    })
    const genAPI = makeFlowAPI({ submitGeneration })
    // two scenes — the 2nd must NOT be submitted after the 1st auth-stops
    const scenesHook = makeScenesHook({
      scenes: [
        { id: 's1', prompt: 'a', status: 'pending', image: 'data:image/png;base64,abc' },
        { id: 's2', prompt: 'b', status: 'pending', image: 'data:image/png;base64,def' },
      ],
      updateScene,
    })

    const t = (k) => k
    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null)
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    await act(async () => { await startPromise })

    // submitGeneration called once (s1) — batch broke before s2
    expect(submitGeneration).toHaveBeenCalledTimes(1)
    expect(genAPI.cancelGeneration).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('error')
    const authCalls = updateScene.mock.calls.filter(([id, patch]) => id === 's1' && patch?.errorKind === 'auth')
    expect(authCalls.length).toBeGreaterThanOrEqual(1)
  }, 15000)
})

// ─── Tests: checkGeneration authFailed (#R23-4) ────────────────────────────────

describe('useAutomation — auth failure during checkGeneration (#R23-4)', () => {
  it('stops batch + marks errorKind:auth when checkGeneration returns authFailed (not completed)', async () => {
    const updateScene = vi.fn()
    const collectGeneration = vi.fn()
    const genAPI = makeFlowAPI({
      submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' }),
      // check returns authFailed WITHOUT completed — must not hang until timeout
      checkGeneration: vi.fn().mockResolvedValue({
        success: false, authFailed: true, error: 'Auth expired — please re-login to Flow',
      }),
      collectGeneration,
    })
    const scenesHook = makeScenesHook({
      scenes: [{ id: 's1', prompt: 'a', status: 'pending', image: 'data:image/png;base64,abc' }],
      updateScene,
    })

    const t = (k) => k
    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null)
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    await act(async () => { await startPromise })

    // collect must NOT be attempted on an auth-failed check
    expect(collectGeneration).not.toHaveBeenCalled()
    expect(result.current.status).toBe('error')
    const authCalls = updateScene.mock.calls.filter(([id, patch]) => id === 's1' && patch?.errorKind === 'auth')
    expect(authCalls.length).toBeGreaterThanOrEqual(1)
  }, 15000)
})

// ─── Tests: collectGeneration authFailed ───────────────────────────────────────

describe('useAutomation — auth failure during collectGeneration', () => {
  it('marks the scene with errorKind:"auth" when collectGeneration returns authFailed', async () => {
    const updateScene = vi.fn()
    // No references → skip upload phase, go straight to generation
    const genAPI = makeFlowAPI({
      submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' }),
      checkGeneration: vi.fn().mockResolvedValue({ completed: true }),
      collectGeneration: vi.fn().mockResolvedValue({
        success: false,
        authFailed: true,
        error: 'Auth expired — please re-login to Flow',
      }),
    })
    const scenesHook = makeScenesHook({ updateScene })

    const t = (k) => k
    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null)
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    // Advance past: submit (immediate) + collect cycle polling
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    await act(async () => { await startPromise })

    // The scene must be marked with errorKind:'auth'
    const authCalls = updateScene.mock.calls.filter(
      ([id, patch]) => id === 's1' && patch?.errorKind === 'auth'
    )
    expect(authCalls.length).toBeGreaterThanOrEqual(1)
  }, 15000)

  it('sets status to "error" when collectGeneration authFailed fires', async () => {
    const genAPI = makeFlowAPI({
      submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' }),
      checkGeneration: vi.fn().mockResolvedValue({ completed: true }),
      collectGeneration: vi.fn().mockResolvedValue({
        success: false,
        authFailed: true,
        error: 'Auth expired — please re-login to Flow',
      }),
    })
    // Give the scene an image so the reset-on-empty useEffect does NOT fire
    const scenesHook = makeScenesHook({
      scenes: [{ id: 's1', prompt: 'a', status: 'pending', image: 'data:image/png;base64,abc' }],
    })

    const t = (k) => k
    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null)
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    await act(async () => { await startPromise })

    expect(result.current.status).toBe('error')
  }, 15000)
})
