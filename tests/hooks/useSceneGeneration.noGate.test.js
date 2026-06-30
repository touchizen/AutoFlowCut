/**
 * useSceneGeneration — 단일 씬 재생성 경로가 consumeBatchDownload 를 호출하지 않음을 검증.
 *
 * useSceneGeneration 은 finalizeGeneratedImage 를 직접 호출하므로 processAsyncSceneResult 의
 * gate 경로를 타지 않는다. 따라서 배치 consume 게이트(consumeBatchDownload)는 절대 호출되면 안 된다.
 * 이 테스트가 그 계약의 회귀 가드다 — 미래에 실수로 gate 를 단일-씬 경로에 추가하면 여기서 잡힌다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// consumeBatchDownload 를 spy — 단일 씬 경로에서 절대 호출되면 안 됨.
vi.mock('../../src/firebase/functions', () => ({
  consumeBatchDownload: vi.fn().mockResolvedValue({ charged: true }),
}))

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
import { consumeBatchDownload } from '../../src/firebase/functions'

describe('useSceneGeneration — 단일 씬 경로는 consumeBatchDownload 미호출 (ungated)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('handleGenerateScene 은 consumeBatchDownload 를 호출하지 않는다', async () => {
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'abc123' }] })
    const scenes = [{ id: 'scene_1', prompt: 'a hero' }]
    const scenesHook = {
      references: [],
      updateScene: vi.fn(),
      getMatchingReferences: vi.fn(() => []),
    }
    const settings = {
      imageModel: 'gemini-2.5-flash-image',
      aspectRatio: '16:9',
      imageBatchCount: 1,
      saveMode: 'memory',
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

    // 핵심 계약: 단일 씬 경로에서 consumeBatchDownload 는 절대 호출되면 안 된다.
    expect(consumeBatchDownload).not.toHaveBeenCalled()
  })
})
