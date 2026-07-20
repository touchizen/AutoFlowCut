import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))

vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn(() => ({ styledPrompt: 'styled prompt' })),
}))

const mocks = vi.hoisted(() => ({
  finalizeGeneratedImage: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))
vi.mock('../../src/services/imageFinalize', () => ({
  finalizeGeneratedImage: (...args) => mocks.finalizeGeneratedImage(...args),
}))

vi.mock('../../src/components/Toast', () => ({ toast: mocks.toast }))

import {
  __resetQuotaStopForTests,
  subscribeQuotaStop,
} from '../../src/utils/quotaStop'
import { useSceneGeneration } from '../../src/hooks/useSceneGeneration'

function setupHook(generationResult) {
  const scenes = [{ id: 'scene-1', prompt: 'a fal scene' }]
  const scenesHook = {
    references: [],
    updateScene: vi.fn(),
    getMatchingReferences: vi.fn(() => []),
  }
  const genAPI = {
    generateImage: vi.fn().mockResolvedValue(generationResult),
  }
  mocks.finalizeGeneratedImage.mockResolvedValue({
    success: false,
    sceneUpdate: {
      status: 'error',
      error: generationResult.error,
      errorKind: generationResult.errorKind,
    },
  })

  const hook = renderHook(() => useSceneGeneration({
    settings: {
      generation: { image: { provider: 'fal' } },
      imageModel: 'fal-ai/flux-pro/v1.1',
      imageBatchCount: 1,
      saveMode: 'memory',
    },
    scenes,
    scenesHook,
    genAPI,
    openSettings: vi.fn(),
    setSelectedScene: vi.fn(),
    t: key => key,
    generationQueue: null,
  }))

  return { hook, scenesHook }
}

describe('useSceneGeneration — provider quota classification', () => {
  const quotaListener = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    __resetQuotaStopForTests()
    subscribeQuotaStop(quotaListener)
  })

  afterEach(() => {
    __resetQuotaStopForTests()
  })

  it('L1: opaque fal error with errorKind quota triggers the global quota stop', async () => {
    const { hook } = setupHook({
      success: false,
      error: 'Too Many Requests',
      errorKind: 'quota',
    })

    await act(async () => {
      await hook.result.current.handleGenerateScene('scene-1')
    })

    expect(quotaListener).toHaveBeenCalledTimes(1)
    expect(quotaListener).toHaveBeenCalledWith(expect.objectContaining({ scope: 'SceneGen' }))
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('L1: errorKind other overrides quota-looking scene error text', async () => {
    const { hook } = setupHook({
      success: false,
      error: 'RESOURCE_EXHAUSTED',
      errorKind: 'other',
    })

    await act(async () => {
      await hook.result.current.handleGenerateScene('scene-1')
    })

    expect(quotaListener).not.toHaveBeenCalled()
    expect(mocks.toast.error).toHaveBeenCalledTimes(1)
  })
})
