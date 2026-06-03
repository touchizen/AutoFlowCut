/**
 * useAutomation — Flow quota-exhausted stop integration tests
 *
 * Verifies that when the Flow API returns "Resource has been exhausted (e.g. check quota)"
 * the batch stops immediately and the global quotaModal is invoked exactly once.
 *
 * Two scenarios:
 *   1. Submit-path quota → batch breaks, no further submitGenerationDOM calls
 *   2. Collect-path quota → scene marked error, modal shown, no more submits
 */

import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('should not be called')),
  },
}))


vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

// quotaStop event bus — subscribe 한 listener 가 호출되는지 확인 (모달 발사 가드).
import { subscribeQuotaStop, __resetQuotaStopForTests } from '../../src/utils/quotaStop'
const showMock = vi.fn()

vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn((prompt) => ({ styledPrompt: prompt || 'p', appliedStyle: null })),
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/utils/sceneFilters', () => ({
  filterPendingScenes: vi.fn((scenes) => scenes),
}))

// Setup helper — mirrors useAutomation.integration.test.jsx
function setupHook(overrides = {}) {
  const submitGenerationDOM = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
  const checkGeneration = vi.fn().mockResolvedValue({ completed: false })
  const collectGeneration = vi.fn().mockResolvedValue({ success: true, images: [{ mediaId: 'm-1' }] })
  const clearGenerations = vi.fn().mockResolvedValue(undefined)
  const uploadReference = vi.fn()
  const getAccessToken = vi.fn().mockResolvedValue('fake-token')
  const updateScene = vi.fn()
  const getMatchingReferences = vi.fn(() => [])

  const flowAPI = {
    submitGenerationDOM, checkGeneration, collectGeneration,
    clearGenerations, uploadReference, getAccessToken,
    ...(overrides.flowAPI || {}),
  }

  const scenes = overrides.scenes || [
    { id: 's1', prompt: 'a', status: 'pending' },
    { id: 's2', prompt: 'b', status: 'pending' },
    { id: 's3', prompt: 'c', status: 'pending' },
  ]

  const scenesHook = {
    scenes, references: [],
    updateScene, getMatchingReferences,
    ...(overrides.scenesHook || {}),
  }

  const t = (k) => k
  const hook = renderHook(() => useAutomation(flowAPI, scenesHook, null, null, null, t, null, null, null))

  return { hook, flowAPI, updateScene, submitGenerationDOM, checkGeneration, collectGeneration }
}

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  showMock.mockClear()
  subscribeQuotaStop(showMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useAutomation quota-exhausted stop', () => {
  it('submit-path quota error → batch stops, no further submits, modal shown once', async () => {
    const { hook, submitGenerationDOM, updateScene } = setupHook()

    // First submit returns Flow quota error — should stop batch immediately.
    submitGenerationDOM.mockResolvedValueOnce({
      success: false,
      error: 'Resource has been exhausted (e.g. check quota).',
    })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'folder' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await startPromise

    // Only 1 submit attempted before stop — s2/s3 never reached.
    expect(submitGenerationDOM).toHaveBeenCalledTimes(1)
    // Modal triggered exactly once.
    expect(showMock).toHaveBeenCalledTimes(1)
    // s1 marked as error with the quota error string.
    const s1Error = updateScene.mock.calls.find(
      ([id, upd]) => id === 's1' && upd?.status === 'error' && /exhausted/i.test(upd?.error || '')
    )
    expect(s1Error).toBeTruthy()
    expect(hook.result.current.isRunning).toBe(false)
  })

  it('collect-path quota error → scene marked error, modal shown, no further submits', async () => {
    const { hook, submitGenerationDOM, checkGeneration, collectGeneration, updateScene } = setupHook({
      scenes: [
        { id: 's1', prompt: 'a', status: 'pending' },
        { id: 's2', prompt: 'b', status: 'pending' },
        { id: 's3', prompt: 'c', status: 'pending' },
      ],
    })

    let gid = 0
    submitGenerationDOM.mockImplementation(async () => ({ success: true, generationId: `gen-${++gid}` }))
    checkGeneration.mockResolvedValue({ completed: true })
    collectGeneration.mockResolvedValue({
      success: false,
      error: 'Resource has been exhausted (e.g. check quota).',
    })

    let startPromise
    await act(async () => {
      // concurrency=1 → 게이트가 s1 제출 후 다음 제출 전에 collectCompleted 실행 →
      // collect-path quota 감지 → stop. (동시성>1 이면 window 만큼 먼저 제출되는 게 정상)
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'folder', concurrency: 1 })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 1000) })
    await startPromise

    // s1 제출 후 게이트의 collectCompleted 가 quota 감지 → stopRequestedRef=true,
    // 남은 s2/s3 는 제출 안 됨.
    expect(submitGenerationDOM).toHaveBeenCalledTimes(1)
    expect(showMock).toHaveBeenCalledTimes(1)
    // s1 marked error with quota error string (via collect path, not finalize).
    const quotaMark = updateScene.mock.calls.find(
      ([id, upd]) => id === 's1' && upd?.status === 'error' && /exhausted/i.test(upd?.error || '')
    )
    expect(quotaMark).toBeTruthy()
    expect(hook.result.current.isRunning).toBe(false)
  })
})
