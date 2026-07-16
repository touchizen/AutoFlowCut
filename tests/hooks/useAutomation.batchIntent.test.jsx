import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'

const {
  batchStartGateSpy,
  resolveProjectBatchIdSpy,
} = vi.hoisted(() => ({
  batchStartGateSpy: vi.fn(),
  resolveProjectBatchIdSpy: vi.fn(),
}))

vi.mock('../../src/hooks/batchStartGate', async () => {
  const actual = await vi.importActual('../../src/hooks/batchStartGate')
  batchStartGateSpy.mockImplementation(actual.batchStartGate)
  return {
    ...actual,
    batchStartGate: batchStartGateSpy,
  }
})

vi.mock('../../src/utils/batchId', async () => {
  const actual = await vi.importActual('../../src/utils/batchId')
  resolveProjectBatchIdSpy.mockImplementation(actual.resolveProjectBatchId)
  return {
    ...actual,
    resolveProjectBatchId: resolveProjectBatchIdSpy,
  }
})

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('should not be called')),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn((prompt) => ({
    styledPrompt: prompt,
    appliedStyle: null,
  })),
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/utils/sceneFilters', () => ({
  filterPendingScenes: vi.fn((scenes) => scenes),
}))

const ACTIVE_SUBSCRIPTION = {
  batchRemaining: 1,
  batchUnlimited: false,
}

const EXHAUSTED_SUBSCRIPTION = {
  batchRemaining: 0,
  batchUnlimited: false,
}

function setupHook({
  scenes = [{ id: 's1', prompt: 'first scene', status: 'pending' }],
  subscriptionBatch = ACTIVE_SUBSCRIPTION,
} = {}) {
  let imageNumber = 0
  const submitGeneration = vi.fn().mockImplementation(async () => ({
    success: true,
    images: [{ id: `image-${++imageNumber}`, mediaId: `media-${imageNumber}` }],
  }))
  const genAPI = {
    submitGeneration,
    checkGeneration: vi.fn(),
    collectGeneration: vi.fn(),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('token'),
  }
  const updateScene = vi.fn()
  const scenesHook = {
    scenes,
    references: [],
    updateScene,
    updateReferences: vi.fn(),
    getMatchingReferences: vi.fn(() => []),
  }
  const onPaywall = vi.fn()
  const onLoginRequired = vi.fn()
  const t = key => key

  const hook = renderHook(
    ({ currentSubscription }) => useAutomation(
      genAPI,
      scenesHook,
      null,
      null,
      null,
      t,
      null,
      null,
      null,
      'api',
      true,
      false,
      currentSubscription,
      onPaywall,
      true,
      onLoginRequired,
      'active'
    ),
    { initialProps: { currentSubscription: subscriptionBatch } }
  )

  return {
    hook,
    onPaywall,
    submitGeneration,
    updateScene,
  }
}

async function start(hook, options = {}) {
  await act(async () => {
    await hook.result.current.start({
      projectName: 'Project',
      saveMode: 'memory',
      ...options,
    })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAutomation batchIntent', () => {
  it("batchIntent:'full' + sceneIds는 기존 batchId가 있어도 subscription gate에서 재사용으로 보지 않는다", async () => {
    const { hook, onPaywall, submitGeneration } = setupHook()

    await start(hook)
    batchStartGateSpy.mockClear()
    resolveProjectBatchIdSpy.mockClear()
    onPaywall.mockClear()
    submitGeneration.mockClear()

    hook.rerender({ currentSubscription: EXHAUSTED_SUBSCRIPTION })
    await start(hook, { batchIntent: 'full', sceneIds: ['s1'] })

    expect(batchStartGateSpy).toHaveBeenCalledWith({
      subscriptionBatch: EXHAUSTED_SUBSCRIPTION,
      isAuthenticated: true,
      subscriptionStatus: 'active',
      isReusingBatch: false,
    })
    expect(onPaywall).toHaveBeenCalledTimes(1)
    expect(resolveProjectBatchIdSpy).not.toHaveBeenCalled()
    expect(submitGeneration).not.toHaveBeenCalled()
  })

  it("batchIntent:'full' + sceneIds는 resolveProjectBatchId에 full로 전달해 새 batchId를 만든다", async () => {
    const { hook } = setupHook({
      scenes: [
        { id: 's1', prompt: 'first scene', status: 'pending' },
        { id: 's2', prompt: 'second scene', status: 'pending' },
      ],
    })

    await start(hook)
    const priorBatchId = resolveProjectBatchIdSpy.mock.results[0].value.batchId
    batchStartGateSpy.mockClear()
    resolveProjectBatchIdSpy.mockClear()

    await start(hook, { batchIntent: 'full', sceneIds: ['s2'] })

    expect(resolveProjectBatchIdSpy).toHaveBeenCalledWith(
      expect.any(Map),
      'Project',
      false
    )
    const nextBatchId = resolveProjectBatchIdSpy.mock.results[0].value.batchId
    expect(nextBatchId).not.toBe(priorBatchId)
  })

  it('batchIntent 미전달 + sceneIds는 기존 partial retry 동작을 보존한다', async () => {
    const { hook, onPaywall, submitGeneration } = setupHook({
      scenes: [
        { id: 's1', prompt: 'first scene', status: 'pending' },
        { id: 's2', prompt: 'second scene', status: 'pending' },
      ],
    })

    await start(hook)
    const priorBatchId = resolveProjectBatchIdSpy.mock.results[0].value.batchId
    batchStartGateSpy.mockClear()
    resolveProjectBatchIdSpy.mockClear()
    onPaywall.mockClear()
    submitGeneration.mockClear()

    hook.rerender({ currentSubscription: EXHAUSTED_SUBSCRIPTION })
    await start(hook, { sceneIds: ['s2'] })

    expect(batchStartGateSpy).toHaveBeenCalledWith({
      subscriptionBatch: EXHAUSTED_SUBSCRIPTION,
      isAuthenticated: true,
      subscriptionStatus: 'active',
      isReusingBatch: true,
    })
    expect(resolveProjectBatchIdSpy).toHaveBeenCalledWith(
      expect.any(Map),
      'Project',
      true
    )
    expect(resolveProjectBatchIdSpy.mock.results[0].value.batchId).toBe(priorBatchId)
    expect(onPaywall).not.toHaveBeenCalled()
    expect(submitGeneration).toHaveBeenCalledTimes(1)
    expect(submitGeneration.mock.calls[0][0]).toBe('second scene')
  })

  it("batchIntent:'retry'는 sceneIds/sceneIndices 없이도 partial retry로 취급한다", async () => {
    const { hook, onPaywall, submitGeneration } = setupHook()

    await start(hook)
    const priorBatchId = resolveProjectBatchIdSpy.mock.results[0].value.batchId
    batchStartGateSpy.mockClear()
    resolveProjectBatchIdSpy.mockClear()
    onPaywall.mockClear()
    submitGeneration.mockClear()

    hook.rerender({ currentSubscription: EXHAUSTED_SUBSCRIPTION })
    await start(hook, { batchIntent: 'retry' })

    expect(batchStartGateSpy).toHaveBeenCalledWith({
      subscriptionBatch: EXHAUSTED_SUBSCRIPTION,
      isAuthenticated: true,
      subscriptionStatus: 'active',
      isReusingBatch: true,
    })
    expect(resolveProjectBatchIdSpy).toHaveBeenCalledWith(
      expect.any(Map),
      'Project',
      true
    )
    expect(resolveProjectBatchIdSpy.mock.results[0].value.batchId).toBe(priorBatchId)
    expect(onPaywall).not.toHaveBeenCalled()
    expect(submitGeneration).toHaveBeenCalledTimes(1)
  })

  it("batchIntent:'full'이어도 sceneIds가 targetScenes membership을 결정한다", async () => {
    const { hook, submitGeneration, updateScene } = setupHook({
      scenes: [
        { id: 's1', prompt: 'first scene', status: 'pending' },
        { id: 's2', prompt: 'second scene', status: 'pending' },
        { id: 's3', prompt: 'third scene', status: 'pending' },
      ],
      subscriptionBatch: null,
    })

    await start(hook, { batchIntent: 'full', sceneIds: ['s2'] })

    expect(submitGeneration).toHaveBeenCalledTimes(1)
    expect(submitGeneration.mock.calls[0][0]).toBe('second scene')
    expect(updateScene.mock.calls.every(([sceneId]) => sceneId === 's2')).toBe(true)
  })
})
