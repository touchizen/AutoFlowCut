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
    expect(Object.hasOwn(opts, 'cancelScope')).toBe(false)
  })

  // M1 F2: 단일 씬 재생성도 전역 image provider 를 전달해야 openai 로 라우팅된다(안 그러면 google 오라우팅).
  it('settings.generation.image.provider 를 generateImage provider 로 전달', async () => {
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }] })
    const scenes = [{ id: 'scene_1', prompt: 'a hero' }]
    const scenesHook = { references: [], updateScene: vi.fn(), getMatchingReferences: vi.fn(() => []) }
    const settings = {
      imageModel: 'gpt-image-1', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory',
      generation: { image: { provider: 'openai' } },
    }
    const { result } = renderHook(() =>
      useSceneGeneration({
        settings, scenes, scenesHook,
        genAPI: { generateImage },
        openSettings: vi.fn(), setSelectedScene: vi.fn(),
        t: (k) => k, generationQueue: null,
      })
    )
    await act(async () => { await result.current.handleGenerateScene('scene_1') })
    expect(generateImage.mock.calls[0][2].provider).toBe('openai')
  })

  it('scene image override를 전역보다 우선해 auth와 generateImage에 전달', async () => {
    const { checkAuthToken } = await import('../../src/utils/guards')
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }] })
    const scenes = [{
      id: 'scene_1', prompt: 'a hero',
      generation: { image: { provider: 'openai', model: 'gpt-image-scene' } },
    }]
    const scenesHook = { references: [], updateScene: vi.fn(), getMatchingReferences: vi.fn(() => []) }
    const settings = {
      imageModel: 'gemini-global', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory',
      generation: { image: { provider: 'google' } },
      modelsByProvider: { google: 'gemini-global', openai: 'gpt-image-global' },
    }
    const genAPI = { generateImage }
    const { result } = renderHook(() => useSceneGeneration({
      settings, scenes, scenesHook, genAPI,
      openSettings: vi.fn(), setSelectedScene: vi.fn(), t: (k) => k, generationQueue: null,
    }))

    await act(async () => { await result.current.handleGenerateScene('scene_1') })

    expect(checkAuthToken).toHaveBeenCalledWith(genAPI, expect.any(Function), 'openai')
    expect(generateImage.mock.calls[0][2]).toMatchObject({
      provider: 'openai', model: 'gpt-image-scene',
    })
  })

  it('finalizeGeneratedImage 에도 선택 모델을 넘긴다 (ResultsTable 모델명이 flow 로 기록되는 회귀 방지)', async () => {
    const { finalizeGeneratedImage } = await import('../../src/services/imageFinalize')
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }] })
    const scenes = [{ id: 'scene_1', prompt: 'a hero' }]
    const scenesHook = { references: [], updateScene: vi.fn(), getMatchingReferences: vi.fn(() => []) }
    const settings = { imageModel: 'Nano Banana Pro', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory' }

    const { result } = renderHook(() =>
      useSceneGeneration({
        settings, scenes, scenesHook,
        genAPI: { generateImage },
        openSettings: vi.fn(), setSelectedScene: vi.fn(),
        t: (k) => k, generationQueue: null,
      })
    )
    await act(async () => { await result.current.handleGenerateScene('scene_1') })

    expect(finalizeGeneratedImage).toHaveBeenCalled()
    expect(finalizeGeneratedImage.mock.calls[0][0].model).toBe('Nano Banana Pro')
  })

  it('생성 시작 시 generatingStartedAt 을 새 시각으로 세팅 — stale 값 덮어쓰기(경과시간 버그 방지)', async () => {
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }] })
    // 이전 생성에서 남은 오래된 시작시각(이게 안 덮이면 "1분인데 1시간 25분"으로 표시됨)
    const scenes = [{ id: 'scene_1', prompt: 'a hero', generatingStartedAt: 1 }]
    const updateScene = vi.fn()
    const scenesHook = { references: [], updateScene, getMatchingReferences: vi.fn(() => []) }
    const settings = { imageModel: 'm', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory' }
    const before = Date.now()

    const { result } = renderHook(() =>
      useSceneGeneration({
        settings, scenes, scenesHook,
        genAPI: { generateImage },
        openSettings: vi.fn(), setSelectedScene: vi.fn(),
        t: (k) => k, generationQueue: null,
      })
    )
    await act(async () => { await result.current.handleGenerateScene('scene_1') })

    const genCall = updateScene.mock.calls.find((c) => c[1] && c[1].status === 'generating')
    expect(genCall).toBeTruthy()
    expect(typeof genCall[1].generatingStartedAt).toBe('number')
    expect(genCall[1].generatingStartedAt).toBeGreaterThanOrEqual(before)
    expect(genCall[1].generatingEndedAt).toBeNull()
  })
})
