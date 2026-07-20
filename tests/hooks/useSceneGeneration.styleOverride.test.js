/**
 * useSceneGeneration — 모달 재생성 스냅샷 전달 (Issue #4/#5 + review MAJOR)
 *
 * 상세 모달에서 프롬프트/캐릭터/스타일을 바꾼 뒤 재생성하면, 그 편집 내용이 생성에 반영돼야 한다.
 * 모달은 stale scenes 클로저를 피하려고 편집 스냅샷(editData)을 sceneOverride 로 명시 전달한다.
 * sceneOverride 가 있으면 closure scene 위에 병합해 prompt/characters/style_tag 를 모두 fresh 하게 쓴다.
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
import { resolveSceneStyle } from '../../src/services/styleService'
import { finalizeGeneratedImage } from '../../src/services/imageFinalize'

function setup(scene) {
  const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }] })
  const getMatchingReferences = vi.fn(() => [])
  const scenesHook = { references: [], updateScene: vi.fn(), getMatchingReferences }
  const settings = { imageModel: 'm', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory' }
  const { result } = renderHook(() =>
    useSceneGeneration({
      settings, scenes: [scene], scenesHook,
      genAPI: { generateImage },
      openSettings: vi.fn(), setSelectedScene: vi.fn(),
      t: (k) => k, generationQueue: null,
    })
  )
  return { result, generateImage, getMatchingReferences }
}

// resolveSceneStyle(prompt, allMatched, selectedStyleRefId, references, matchedRefs, styleTag)
const PROMPT_ARG = 0
const STYLE_TAG_ARG = 5

describe('useSceneGeneration — queue 거부 시 침묵 금지', () => {
  it('generationQueue.enqueue 가 reject 하면 toast.warning 으로 사용자에게 알린다', async () => {
    const { toast } = await import('../../src/components/Toast')
    const scene = { id: 'scene_1', prompt: 'p' }
    const scenesHook = { references: [], updateScene: vi.fn(), getMatchingReferences: vi.fn(() => []) }
    const rejectingQueue = { enqueue: vi.fn().mockRejectedValue(new Error('Flow quota exhausted — dismiss the alert before retrying')) }
    const { result } = renderHook(() =>
      useSceneGeneration({
        settings: { saveMode: 'memory' }, scenes: [scene], scenesHook,
        genAPI: {}, openSettings: vi.fn(), setSelectedScene: vi.fn(),
        t: (k) => k, generationQueue: rejectingQueue,
      })
    )
    await act(() => result.current.handleGenerateScene('scene_1'))
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('quota'))
  })

  it('이미 전역으로 알린 거부(alreadySurfaced — quota-stop 일괄 clear 등)는 toast 를 또 띄우지 않는다', async () => {
    const { toast } = await import('../../src/components/Toast')
    const scene = { id: 'scene_1', prompt: 'p' }
    const scenesHook = { references: [], updateScene: vi.fn(), getMatchingReferences: vi.fn(() => []) }
    const err = Object.assign(new Error('Flow quota exhausted — pending work cleared'), { alreadySurfaced: true })
    const rejectingQueue = { enqueue: vi.fn().mockRejectedValue(err) }
    const { result } = renderHook(() =>
      useSceneGeneration({
        settings: { saveMode: 'memory' }, scenes: [scene], scenesHook,
        genAPI: {}, openSettings: vi.fn(), setSelectedScene: vi.fn(),
        t: (k) => k, generationQueue: rejectingQueue,
      })
    )
    await act(() => result.current.handleGenerateScene('scene_1'))
    expect(toast.warning).not.toHaveBeenCalled()
  })
})

describe('useSceneGeneration — sceneOverride(모달 편집 스냅샷)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sceneOverride.style_tag 를 resolveSceneStyle 의 styleTag 로 쓴다', async () => {
    const { result } = setup({ id: 'scene_1', prompt: 'a hero', style_tag: 'OLD' })
    await act(async () => { await result.current.handleGenerateScene('scene_1', undefined, { style_tag: 'Korean Anime' }) })
    expect(resolveSceneStyle.mock.calls[0][STYLE_TAG_ARG]).toBe('Korean Anime')
  })

  it('sceneOverride.prompt(편집한 프롬프트)를 생성에 쓴다 — stale closure 프롬프트 아님', async () => {
    const { result, generateImage } = setup({ id: 'scene_1', prompt: 'OLD cat', style_tag: '' })
    await act(async () => { await result.current.handleGenerateScene('scene_1', undefined, { prompt: 'NEW dog', style_tag: '' }) })
    // resolveSceneStyle 의 prompt 인자가 편집본이어야 한다
    expect(resolveSceneStyle.mock.calls[0][PROMPT_ARG]).toBe('NEW dog')
    expect(generateImage.mock.calls[0][0]).toBe('styled prompt')
    // donePrompt 기준은 엔진에 보낸 스타일 합성본이 아니라 사용자가 편집하는 원문이다.
    expect(finalizeGeneratedImage.mock.calls[0][0].prompt).toBe('NEW dog')
  })

  it('sceneOverride.characters(편집한 태그)로 레퍼런스를 매칭한다', async () => {
    const { result, getMatchingReferences } = setup({ id: 'scene_1', prompt: 'a hero', characters: 'OLD', style_tag: '' })
    await act(async () => { await result.current.handleGenerateScene('scene_1', undefined, { characters: 'Hero', style_tag: '' }) })
    // getMatchingReferences 는 병합된 scene(characters='Hero')으로 호출돼야 한다
    expect(getMatchingReferences.mock.calls[0][0]).toEqual(expect.objectContaining({ characters: 'Hero' }))
  })

  it('sceneOverride 미지정이면 closure scene 을 그대로 쓴다(MCP/기존 동작 보존)', async () => {
    const { result } = setup({ id: 'scene_1', prompt: 'a hero', style_tag: 'noir' })
    await act(async () => { await result.current.handleGenerateScene('scene_1') })
    expect(resolveSceneStyle.mock.calls[0][STYLE_TAG_ARG]).toBe('noir')
    expect(resolveSceneStyle.mock.calls[0][PROMPT_ARG]).toBe('a hero')
  })

  it('빈 문자열 style_tag override(스타일 제거)도 존중', async () => {
    const { result } = setup({ id: 'scene_1', prompt: 'a hero', style_tag: 'noir' })
    await act(async () => { await result.current.handleGenerateScene('scene_1', undefined, { style_tag: '' }) })
    expect(resolveSceneStyle.mock.calls[0][STYLE_TAG_ARG]).toBe('')
  })
})
