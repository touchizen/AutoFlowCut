import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/utils/guards', () => ({
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn(() => ({ styledPrompt: 'styled prompt' })),
}))
vi.mock('../../src/services/imageFinalize', () => ({
  finalizeGeneratedImage: vi.fn().mockResolvedValue({ success: true, sceneUpdate: { status: 'done' } }),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/utils/quotaStop', () => ({
  isQuotaExhaustedError: vi.fn(() => false),
  emitQuotaStop: vi.fn(),
}))
vi.mock('../../src/utils/mentionParser', () => ({
  resolveMentions: vi.fn(() => ({ missing: [] })),
}))

import { useSceneGeneration } from '../../src/hooks/useSceneGeneration'
import { checkFolderPermission } from '../../src/utils/guards'

function makeProps(extra = {}) {
  return {
    settings: { imageModel: 'model', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory' },
    scenes: [{ id: 'scene_1', prompt: 'a hero' }],
    scenesHook: { references: [], updateScene: vi.fn(), getMatchingReferences: vi.fn(() => []) },
    genAPI: { generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }] }) },
    openSettings: vi.fn(),
    setSelectedScene: vi.fn(),
    t: (key) => key,
    generationQueue: null,
    flowProjectReady: true,
    upscaylRunning: false,
    ...extra,
  }
}

describe('useSceneGeneration Upscayl busy guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Upscayl 배치 실행 중에는 단일 씬 생성을 시작하지 않는다', async () => {
    const props = makeProps({ upscaylRunning: true })
    const { result } = renderHook(() => useSceneGeneration(props))

    await act(async () => { await result.current.handleGenerateScene('scene_1') })

    expect(checkFolderPermission).not.toHaveBeenCalled()
    expect(props.genAPI.generateImage).not.toHaveBeenCalled()
    expect(props.scenesHook.updateScene).not.toHaveBeenCalled()
    expect(result.current.generatingSceneId).toBeNull()
  })

  it('큐 대기 중 Upscayl이 시작되면 실제 실행 시점에도 생성을 거부한다', async () => {
    let queuedTask
    const generationQueue = {
      enqueue: vi.fn(async (task) => { queuedTask = task }),
    }
    const { result, rerender } = renderHook(
      ({ upscaylRunning }) => useSceneGeneration(makeProps({ generationQueue, upscaylRunning })),
      { initialProps: { upscaylRunning: false } },
    )

    await act(async () => { await result.current.handleGenerateScene('scene_1') })
    expect(generationQueue.enqueue).toHaveBeenCalledTimes(1)

    rerender({ upscaylRunning: true })
    await act(async () => { await queuedTask.execute() })

    expect(checkFolderPermission).not.toHaveBeenCalled()
  })
})
