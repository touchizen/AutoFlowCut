/**
 * useSceneGeneration — ChatGPT 타깃 단일 씬 재생성의 model 스탬프.
 *
 * ChatGPT 경로는 페이지가 모델명을 노출하지 않으므로 API 해석 모델
 * (예: gemini-3.1-flash-image = "Nano Banana 2") 대신 엔진 식별자 'chatgpt' 를
 * finalizeGeneratedImage 에 기록한다. Flow/API 경로는 기존 그대로(positive control).
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
import { finalizeGeneratedImage } from '../../src/services/imageFinalize'

const API_MODEL = 'gemini-3.1-flash-image' // "Nano Banana 2"

function setupHook(route) {
  const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }] })
  const scenes = [{ id: 'scene_1', prompt: 'a hero' }]
  const scenesHook = { references: [], updateScene: vi.fn(), getMatchingReferences: vi.fn(() => []) }
  const settings = { imageModel: API_MODEL, aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory' }
  const { result } = renderHook(() =>
    useSceneGeneration({
      settings, scenes, scenesHook,
      genAPI: { generateImage },
      openSettings: vi.fn(), setSelectedScene: vi.fn(),
      t: (k) => k, generationQueue: null,
      route,
    })
  )
  return { result, generateImage }
}

describe('useSceneGeneration — ChatGPT 타깃 model 스탬프', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ChatGPT 경로: finalize 에 API 모델이 아니라 엔진 식별자 "chatgpt" 기록', async () => {
    const { result, generateImage } = setupHook({ mode: 'flow', sessionTarget: 'chatgpt' })
    await act(async () => { await result.current.handleGenerateScene('scene_1') })

    expect(finalizeGeneratedImage).toHaveBeenCalledTimes(1)
    expect(finalizeGeneratedImage.mock.calls[0][0].model).toBe('chatgpt')
    expect(finalizeGeneratedImage.mock.calls[0][0].model).not.toBe(API_MODEL)
    expect(generateImage.mock.calls[0][2].model).toBe('chatgpt')
  })

  it('POSITIVE CONTROL — Flow 경로: 해석된 모델 그대로 (chatgpt 오염 금지)', async () => {
    const { result, generateImage } = setupHook({ mode: 'flow', sessionTarget: 'flow' })
    await act(async () => { await result.current.handleGenerateScene('scene_1') })

    expect(finalizeGeneratedImage.mock.calls[0][0].model).toBe(API_MODEL)
    expect(generateImage.mock.calls[0][2].model).toBe(API_MODEL)
  })

  it('POSITIVE CONTROL — API 경로: 해석된 API 모델 그대로', async () => {
    const { result, generateImage } = setupHook({ mode: 'api', sessionTarget: 'flow' })
    await act(async () => { await result.current.handleGenerateScene('scene_1') })

    expect(finalizeGeneratedImage.mock.calls[0][0].model).toBe(API_MODEL)
    expect(generateImage.mock.calls[0][2].model).toBe(API_MODEL)
  })
})
