/**
 * useSceneGeneration — 단일 씬 재생성(상세 모달) 경로가 settings.imageModel 을
 * generateImage 까지 전달하는지 검증.
 *
 * 회귀 방지: 배치 경로(useAutomation)만 모델을 전달하고 모달 개별 재생성이 빠지면,
 * SceneDetailModal 재생성 / MCP 단일 생성이 선택 모델을 무시하고 기본 모델로 생성된다.
 * (spec P1-b)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkAuthToken: vi.fn().mockResolvedValue(true),
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

import { useSceneGeneration } from '../../src/hooks/useSceneGeneration'

describe('useSceneGeneration — 모델 전달', () => {
  beforeEach(() => vi.clearAllMocks())

  it('settings.imageModel 을 generateImage 옵션의 model 로 전달', async () => {
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }], model: 'gemini-3-pro-image' })
    const scenes = [{ id: 'scene_1', prompt: 'a hero' }]
    const scenesHook = {
      references: [],
      updateScene: vi.fn(),
      getMatchingReferences: vi.fn(() => []),
    }
    const settings = { imageModel: 'gemini-3-pro-image', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory' }

    const { result } = renderHook(() =>
      useSceneGeneration({
        settings, scenes, scenesHook,
        genAPI: { generateImage },
        openSettings: vi.fn(), setSelectedScene: vi.fn(),
        t: (k) => k, generationQueue: null,
      })
    )

    await act(async () => { await result.current.handleGenerateScene('scene_1') })

    expect(generateImage).toHaveBeenCalledTimes(1)
    const opts = generateImage.mock.calls[0][2]
    expect(opts.model).toBe('gemini-3-pro-image')
  })
})
