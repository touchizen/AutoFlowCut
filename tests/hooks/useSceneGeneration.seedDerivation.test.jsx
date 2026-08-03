/**
 * useSceneGeneration — seed 파생은 단일 공유 함수(startOptions.effectiveSeedFrom)를 쓴다.
 *
 * 앱의 기본 settings 는 seedLocked:true + 숫자 seedNo — "기본값이 곧 숫자 seed"다. 이 파생이
 * 훅마다 인라인 복제돼 있으면 오늘은 우연히 일치해도 한쪽만 갱신돼 조용히 어긋난다
 * (aspectRatio/seed 사건과 같은 클래스). 이 테스트는 씬 생성 경로가 실제 제출 payload 에
 * 그 파생 결과를 싣는지 고정한다 — effectiveSeedFrom 이 변하면 여기가 즉시 죽어야 한다.
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
vi.mock('../../src/components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('../../src/utils/quotaStop', () => ({ isQuotaExhaustedError: vi.fn(() => false), emitQuotaStop: vi.fn() }))
vi.mock('../../src/utils/mentionParser', () => ({ resolveMentions: vi.fn(() => ({ missing: [] })) }))

import { useSceneGeneration } from '../../src/hooks/useSceneGeneration'

function setup(settingsOverrides) {
  const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }] })
  const scenesHook = { references: [], updateScene: vi.fn(), getMatchingReferences: vi.fn(() => []) }
  const settings = {
    imageModel: 'm', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory',
    ...settingsOverrides,
  }
  const { result } = renderHook(() =>
    useSceneGeneration({
      settings, scenes: [{ id: 'scene_1', prompt: 'a hero', style_tag: '' }], scenesHook,
      genAPI: { generateImage },
      openSettings: vi.fn(), setSelectedScene: vi.fn(),
      t: (k) => k, generationQueue: null,
    })
  )
  return { result, generateImage }
}

describe('useSceneGeneration — 씬 제출 seed 는 공유 파생을 따른다', () => {
  beforeEach(() => vi.clearAllMocks())

  it('앱 기본형(seedLocked:true + 숫자 seedNo)이면 그 숫자가 제출 옵션에 실린다', async () => {
    const { result, generateImage } = setup({ seedLocked: true, seedNo: 7777 })
    await act(async () => { await result.current.handleGenerateScene('scene_1') })
    expect(generateImage).toHaveBeenCalledOnce()
    expect(generateImage.mock.calls[0][2].seed).toBe(7777)
  })

  it('seedLocked:false 또는 비숫자 seedNo 면 null(엔진 랜덤)로 제출한다', async () => {
    const unlocked = setup({ seedLocked: false, seedNo: 7777 })
    await act(async () => { await unlocked.result.current.handleGenerateScene('scene_1') })
    expect(unlocked.generateImage.mock.calls[0][2].seed).toBeNull()

    const nonNumeric = setup({ seedLocked: true, seedNo: '7777' })
    await act(async () => { await nonNumeric.result.current.handleGenerateScene('scene_1') })
    expect(nonNumeric.generateImage.mock.calls[0][2].seed).toBeNull()
  })
})
