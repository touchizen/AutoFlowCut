/**
 * E2E: @mention 이 포함된 prompt 가 실제 production code path 를 거쳐 inlineData
 * base64 로 Gemini IPC 까지 전달되는지 검증.
 *
 * 이전 버전은 `generateImage` 를 직접 호출해 matchedRefs 빌더를 건너뛰었고,
 * 그래서 P1 회귀(useSceneGeneration / useAutomation 에서 data/filePath 떨굼) 를
 * 막지 못했다.
 *
 * 이 테스트는 useSceneGeneration → matchedRefs 빌더 → genAPI.generateImage →
 * resolveReferenceImages → window.electronAPI.genaiGenerateImage 까지 관통한다.
 *
 * 검증 포인트:
 *  - getMatchingReferences 가 ref (data 포함) 를 반환했을 때
 *  - matchedRefs 빌더가 data 를 보존해야 (P1 회귀 가드)
 *  - genAPI.generateImage 가 받은 matchedRefs 를 resolveReferenceImages 로 base64
 *    로 풀어 IPC payload referenceImages 에 실어 보낸다
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn((prompt) => ({ styledPrompt: prompt, appliedStyle: 'none' })),
}))
vi.mock('../../src/services/imageFinalize', () => ({
  finalizeGeneratedImage: vi.fn().mockResolvedValue({
    success: true,
    sceneUpdate: { status: 'done' },
  }),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/utils/quotaStop', () => ({
  isQuotaExhaustedError: vi.fn(() => false),
  emitQuotaStop: vi.fn(),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    // E2E 는 memory-only path 를 검증 — disk fallback 은 실패시켜도 됨.
    readReference: vi.fn().mockResolvedValue({ success: false }),
  },
}))

import { useGenAPI } from '../../src/hooks/useGenAPI'
import { createEngineApi } from '../../src/engine/engineApi'
import { useSceneGeneration } from '../../src/hooks/useSceneGeneration'

describe('E2E: @mention prompt → useSceneGeneration → IPC referenceImages', () => {
  let genaiGenerateImage
  let genaiGetKeyStatus

  beforeEach(() => {
    genaiGenerateImage = vi.fn().mockResolvedValue({
      success: true,
      images: [{ base64: 'gen', mimeType: 'image/png', dataUrl: 'data:image/png;base64,gen' }],
    })
    genaiGetKeyStatus = vi.fn().mockResolvedValue({ hasKey: true })
    window.electronAPI = {
      genaiGetKeyStatus,
      genaiGenerateImage,
      genaiListModels: vi.fn(),
    }
  })

  afterEach(() => {
    delete window.electronAPI
  })

  function setupHook({ scenes, references, matched }) {
    const settings = {
      imageModel: 'gemini-2.5-flash-image',
      aspectRatio: '16:9',
      imageBatchCount: 1,
      saveMode: 'memory',
      projectName: 'demo',
    }
    const updateScene = vi.fn()
    const getMatchingReferences = vi.fn(() => matched)
    const scenesHook = { references, updateScene, getMatchingReferences }
    const { result: genHook } = renderHook(() =>
      useGenAPI({ getProjectName: () => settings.projectName })
    )
    const { result: sceneGen } = renderHook(() =>
      useSceneGeneration({
        settings,
        scenes,
        scenesHook,
        genAPI: createEngineApi(genHook.current),
        openSettings: vi.fn(),
        setSelectedScene: vi.fn(),
        t: (k) => k,
        generationQueue: null,
      })
    )
    return { sceneGen, genHook, scenesHook }
  }

  it('memory-only ref (data set, disk fallback fails) flows to IPC referenceImages base64', async () => {
    // 핵심 회귀 시나리오: ref 가 메모리에만 살아 있고 디스크에는 없다.
    // 이전 P1 버그 — matchedRefs 빌더가 data 를 떨궈 resolveReferenceImages 가
    // 디스크 fallback 만 시도 → 실패 → 조용히 빈 referenceImages 로 호출 → 일관성 깨짐.
    const heroBase64Body = 'B'.repeat(120)
    const memoryRef = {
      id: 1,
      name: 'hero',
      type: 'character',
      category: 'character',
      mediaId: null,
      caption: '',
      data: `data:image/jpeg;base64,${heroBase64Body}`,
      filePath: null,
    }
    const scenes = [{ id: 'scene_1', prompt: 'A wizard @hero walks' }]
    const { sceneGen } = setupHook({
      scenes,
      references: [memoryRef],
      matched: [memoryRef],
    })

    await act(async () => {
      await sceneGen.current.handleGenerateScene('scene_1')
    })

    expect(genaiGenerateImage).toHaveBeenCalledTimes(1)
    const payload = genaiGenerateImage.mock.calls[0][0]
    // stripMentionPrefixes 가 `@` 를 떼서 'hero' 만 본문에 남고, ref 자체는 binary part 로.
    // 이 정책 덕분에 Gemini 가 본문에서 'hero' 를 일반 명사로 읽으면서 동시에 image 1 의
    // 정체를 inferring 한다 (Google 의 positional reference 가이드).
    expect(payload.prompt).toBe('A wizard hero walks')
    expect(payload.referenceImages).toHaveLength(1)
    expect(payload.referenceImages[0].data).toBe(heroBase64Body)
    // mimeType 은 base64 header 를 sniff 해서 결정 — 우리 fake bytes 는 인식 안 되니
    // image/* 정도만 검증 (실제 production 에선 jpeg/png/gif/webp 헤더가 정확히 잡힘).
    expect(payload.referenceImages[0].mimeType).toMatch(/^image\//)
  })

  it('known mention with attached Hangul particle still cleans prompt for GenAI', async () => {
    const heroBase64Body = 'C'.repeat(120)
    const memoryRef = {
      id: 1,
      name: 'Hero',
      type: 'character',
      category: 'character',
      mediaId: null,
      caption: '',
      data: `data:image/jpeg;base64,${heroBase64Body}`,
      filePath: null,
    }
    const scenes = [{ id: 'scene_1', prompt: 'A wizard @Hero가 walks' }]
    const { sceneGen } = setupHook({
      scenes,
      references: [memoryRef],
      matched: [memoryRef],
    })

    await act(async () => {
      await sceneGen.current.handleGenerateScene('scene_1')
    })

    expect(genaiGenerateImage).toHaveBeenCalledTimes(1)
    const payload = genaiGenerateImage.mock.calls[0][0]
    expect(payload.prompt).toBe('A wizard Hero가 walks')
    expect(payload.referenceImages).toHaveLength(1)
    expect(payload.referenceImages[0].data).toBe(heroBase64Body)
  })

  it('Hangul mention name with attached particle flows to IPC referenceImages', async () => {
    const heroBase64Body = 'D'.repeat(120)
    const memoryRef = {
      id: 1,
      name: '철수',
      type: 'character',
      category: 'character',
      mediaId: null,
      caption: '',
      data: `data:image/jpeg;base64,${heroBase64Body}`,
      filePath: null,
    }
    const scenes = [{ id: 'scene_1', prompt: '@철수가 walks' }]
    const { sceneGen } = setupHook({
      scenes,
      references: [memoryRef],
      matched: [memoryRef],
    })

    await act(async () => {
      await sceneGen.current.handleGenerateScene('scene_1')
    })

    expect(genaiGenerateImage).toHaveBeenCalledTimes(1)
    const payload = genaiGenerateImage.mock.calls[0][0]
    expect(payload.prompt).toBe('철수가 walks')
    expect(payload.referenceImages).toHaveLength(1)
    expect(payload.referenceImages[0].data).toBe(heroBase64Body)
  })

  it('regression guard — if matchedRefs builder strips data and disk also empty, refs become empty (not error)', async () => {
    // 회귀 시그널 — data/filePath 모두 떨궈진 매칭은 referenceImages 빈 배열로 흘러 들어간다.
    // 이 케이스가 production 에 도달하지 않게 위 fix (data 보존) 가 필요함을 시각화.
    const strippedRef = {
      id: 1,
      name: 'hero',
      type: 'character',
      category: 'character',
      mediaId: null,
      caption: '',
      data: null,
      filePath: null,
    }
    const scenes = [{ id: 'scene_1', prompt: 'A wizard @hero walks' }]
    const { sceneGen } = setupHook({
      scenes,
      references: [strippedRef],
      matched: [strippedRef],
    })

    await act(async () => {
      await sceneGen.current.handleGenerateScene('scene_1')
    })

    expect(genaiGenerateImage).toHaveBeenCalledTimes(1)
    const payload = genaiGenerateImage.mock.calls[0][0]
    expect(payload.referenceImages).toHaveLength(0)
  })
})
