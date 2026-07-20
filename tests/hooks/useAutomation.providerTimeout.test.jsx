import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('not used')),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn(prompt => ({ styledPrompt: prompt, appliedStyle: null })),
  presetTagForStyleId: vi.fn(() => null),
}))

const mocks = vi.hoisted(() => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: (...args) => mocks.processAsyncSceneResult(...args),
}))

vi.mock('../../src/utils/sceneFilters', () => ({
  filterPendingScenes: vi.fn(scenes => scenes),
}))

import { useAutomation } from '../../src/hooks/useAutomation'

function setupHook(provider, completionAtMs = null, { globalProvider = provider } = {}) {
  const submittedAt = { value: null }
  const submitGeneration = vi.fn().mockImplementation(async () => {
    submittedAt.value = Date.now()
    return { success: true, generationId: 'generation-1' }
  })
  const checkGeneration = vi.fn().mockImplementation(async () => ({
    success: true,
    completed: completionAtMs != null
      && Date.now() - submittedAt.value >= completionAtMs,
  }))
  const collectGeneration = vi.fn().mockResolvedValue({
    success: true,
    images: [{ base64: 'generated-image' }],
  })
  const updateScene = vi.fn()
  const genAPI = {
    submitGeneration,
    checkGeneration,
    collectGeneration,
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('token'),
  }
  const scenesHook = {
    scenes: [{
      id: 'scene-1',
      prompt: 'a scene',
      status: 'pending',
      ...(provider === globalProvider
        ? {}
        : { generation: { image: { provider } } }),
    }],
    references: [],
    updateScene,
    getMatchingReferences: vi.fn(() => []),
  }
  const hook = renderHook(() => useAutomation(
    genAPI,
    scenesHook,
    null,
    null,
    null,
    key => key,
    null,
    null,
    null,
  ))

  const start = () => hook.result.current.start({
    projectName: 'timeout-test',
    saveMode: 'memory',
    concurrency: 1,
    imageProvider: globalProvider,
    generationSettings: {
      generation: { image: { provider: globalProvider } },
      imageModel: globalProvider === 'fal' ? 'fal-ai/flux-pro/v1.1' : 'gemini-2.5-flash-image',
      modelsByProvider: { fal: 'fal-ai/flux-pro/v1.1' },
    },
  })

  return { hook, start, updateScene, submitGeneration, checkGeneration, collectGeneration }
}

describe('useAutomation — provider-aware item timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('L2: fal result completing after 150 seconds is collected instead of discarded', async () => {
    const { start, updateScene, submitGeneration, collectGeneration } = setupHook(
      'fal',
      150000,
      { globalProvider: 'google' },
    )
    let startPromise
    await act(async () => { startPromise = start() })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(160000)
    })
    await act(async () => { await startPromise })

    expect(collectGeneration).toHaveBeenCalledTimes(1)
    expect(submitGeneration).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ provider: 'fal' }),
    )
    expect(mocks.processAsyncSceneResult).toHaveBeenCalledTimes(1)
    expect(updateScene).not.toHaveBeenCalledWith(
      'scene-1',
      expect.objectContaining({ error: 'Generation timeout' }),
    )
  })

  it('L2: fal collection remains open past the legacy 180-second phase-2 drain', async () => {
    const { start, updateScene, collectGeneration } = setupHook('fal', 200000)
    let startPromise
    await act(async () => { startPromise = start() })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(210000)
    })
    await act(async () => { await startPromise })

    expect(collectGeneration).toHaveBeenCalledTimes(1)
    expect(updateScene).not.toHaveBeenCalledWith(
      'scene-1',
      expect.objectContaining({ error: 'Generation timeout' }),
    )
  })

  it('L2: google item still times out on the legacy 120-second budget', async () => {
    const { start, updateScene, collectGeneration } = setupHook('google')
    let startPromise
    await act(async () => { startPromise = start() })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(125000)
    })
    await act(async () => { await startPromise })

    expect(collectGeneration).not.toHaveBeenCalled()
    expect(updateScene).toHaveBeenCalledWith('scene-1', {
      status: 'error',
      error: 'Generation timeout',
      errorKind: null,
    })
  })
})
