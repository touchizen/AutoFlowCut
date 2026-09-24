/**
 * useSceneGeneration — flow.google.com 렌더러 통합 (b) (M1-13)
 *
 * 실제 useFlowEngine + 실제 finalizeGeneratedImage 위에서 단일 씬 생성: 세션 판정(checkAuthToken 실제) → generateImage
 * (token:null, asyncMode:false) → 저장 → updateScene(done). 미준비 이유별 안내, 레퍼런스/업스케일 게이트, errorParams 보존.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', async (orig) => ({
  ...(await orig()),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    saveImage: vi.fn(async () => ({ success: true, path: '/proj/scenes/scene_1.png' })),
    saveExtraToHistory: vi.fn(async () => ({ success: true })),
  },
}))
vi.mock('../../src/utils/formatters', async (orig) => ({ ...(await orig()), getImageSizeFromBase64: vi.fn(async () => ({ width: 1376, height: 768 })) }))
vi.mock('../../src/services/styleService', () => ({ resolveSceneStyle: vi.fn((prompt) => ({ styledPrompt: prompt })) }))
vi.mock('../../src/components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('../../src/utils/mentionParser', () => ({ resolveMentions: vi.fn(() => ({ missing: [] })) }))

import { useSceneGeneration } from '../../src/hooks/useSceneGeneration'
import { useFlowEngine } from '../../src/engine/engineFlow'
import { toast } from '../../src/components/Toast'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'

const IMAGE = { base64: 'data:image/png;base64,AQID', mediaId: '<uuid#5>', width: 1376, height: 768, seed: 1687588041 }
const api = {}
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(api, {
    flowSessionStatus: vi.fn(async () => ({ ready: true, credits: 1050 })),
    flowExtractProjectId: vi.fn(async () => ({ projectId: 'proj-1' })),
    flowGenerateImage: vi.fn(async () => ({ success: true, images: [IMAGE] })),
  })
  Object.assign(window.electronAPI, api)
})
afterEach(() => { vi.restoreAllMocks() })

function setup({ scene = { id: 'scene_1', prompt: '궁정안에 있는 왕' }, references = [], settings = {}, t = (k) => k } = {}) {
  const updateScene = vi.fn()
  const scenesHook = { references, updateScene, getMatchingReferences: vi.fn(() => references) }
  const hook = renderHook(() => {
    const engine = useFlowEngine({})
    const gen = useSceneGeneration({
      settings: { imageModel: 'Nano Banana 2', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'folder', projectName: 'proj', imageUpscale: 'off', ...settings },
      scenes: [scene], scenesHook, genAPI: { ...engine, mode: 'flow' },
      openSettings: vi.fn(), setSelectedScene: vi.fn(), t, generationQueue: null,
    })
    return { engine, gen }
  })
  return { hook, updateScene }
}
const lastPatch = (updateScene) => updateScene.mock.calls.at(-1)?.[1]

describe('useSceneGeneration × useFlowEngine', () => {
  it('ready → generateImage(token:null, asyncMode:false, referenceImages:[]) → 저장 → updateScene(done, imagePath, image_size)', async () => {
    const { hook, updateScene } = setup()
    await act(async () => { await hook.result.current.gen.handleGenerateScene('scene_1') })
    expect(api.flowGenerateImage).toHaveBeenCalledTimes(1)
    expect(api.flowGenerateImage.mock.calls[0][0]).toMatchObject({ token: null, asyncMode: false, referenceImages: [], prompt: '궁정안에 있는 왕', projectId: 'proj-1' })
    expect(fileSystemAPI.saveImage).toHaveBeenCalled()
    expect(lastPatch(updateScene)).toMatchObject({ status: 'done', imagePath: '/proj/scenes/scene_1.png', image_size: { width: 1376, height: 768 }, mediaId: '<uuid#5>', errorParams: {} })
    expect(toast.success).toHaveBeenCalled()
  })

  it('세션 미준비(wiz-missing) → 로그인 안내 토스트 + 씬 errorKind auth, 제출 없음', async () => {
    api.flowSessionStatus.mockResolvedValue({ ready: false, reason: 'wiz-missing' })
    const { hook, updateScene } = setup()
    await act(async () => { await hook.result.current.gen.handleGenerateScene('scene_1') })
    expect(api.flowGenerateImage).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('Flow login required'))
    expect(lastPatch(updateScene)).toMatchObject({ status: 'error', errorKind: 'auth' })
  })

  it('세션 확인 실패(rpc:http:500) → 이유가 든 안내(로그인 안내 아님)', async () => {
    api.flowSessionStatus.mockResolvedValue({ ready: false, reason: 'rpc:http:500' })
    const { hook } = setup()
    await act(async () => { await hook.result.current.gen.handleGenerateScene('scene_1') })
    expect(api.flowGenerateImage).not.toHaveBeenCalled()
    const msg = toast.warning.mock.calls[0][0]
    expect(msg).toContain('rpc:http:500')
    expect(msg).not.toContain('Flow login required')
  })

  it('filePath 만 있는 태그 ref → 씬 error flow-references-unsupported, 제출 없음', async () => {
    const { hook, updateScene } = setup({ references: [{ name: 'hero', filePath: '/refs/hero.png' }] })
    await act(async () => { await hook.result.current.gen.handleGenerateScene('scene_1') })
    expect(api.flowGenerateImage).not.toHaveBeenCalled()
    expect(lastPatch(updateScene)).toMatchObject({ status: 'error', errorKind: 'flow-references-unsupported' })
  })

  it('imageUpscale:2k → 씬 error flow-upscale-unsupported, 제출 없음', async () => {
    const { hook, updateScene } = setup({ settings: { imageUpscale: '2k' } })
    await act(async () => { await hook.result.current.gen.handleGenerateScene('scene_1') })
    expect(api.flowGenerateImage).not.toHaveBeenCalled()
    expect(lastPatch(updateScene)).toMatchObject({ status: 'error', errorKind: 'flow-upscale-unsupported' })
  })

  it('핸들러의 authFailed(flow-session-missing / not-on-flow) → 씬 error 는 인증 안내 문구, 토스트도 그 문구 (R1#6/R2#5)', async () => {
    api.flowGenerateImage.mockResolvedValue({ success: false, errorKind: 'flow-session-missing', error: 'not-on-flow', authFailed: true })
    const t = vi.fn((k) => k)
    const { hook, updateScene } = setup({ t })
    await act(async () => { await hook.result.current.gen.handleGenerateScene('scene_1') })
    const patch = lastPatch(updateScene)
    expect(patch).toMatchObject({ status: 'error', errorKind: 'auth' })
    expect(patch.error).not.toBe('not-on-flow')
    expect(patch.error).toMatch(/Auth error|status\.flowAuthErrorStopped/)
    const toastCall = t.mock.calls.find((c) => c[0] === 'toast.sceneGenerateFailed')
    expect(toastCall).toBeTruthy()
    expect(toastCall[1].error).toBe(patch.error)
  })

  it('kind 실패의 토스트는 kind 문구(resolveDisplayError) — 기계 토큰을 그대로 띄우지 않는다', async () => {
    api.flowGenerateImage.mockResolvedValue({ success: false, errorKind: 'flow-capture-not-installed', error: 'flow-capture-not-installed' })
    const t = vi.fn((k, params) => (k === 'errorSection.kind.flow-capture-not-installed' ? 'MONITOR MISSING' : k))
    const { hook } = setup({ t })
    await act(async () => { await hook.result.current.gen.handleGenerateScene('scene_1') })
    const toastCall = t.mock.calls.find((c) => c[0] === 'toast.sceneGenerateFailed')
    expect(toastCall[1].error).toBe('MONITOR MISSING')
  })

  it('핸들러 실패의 errorParams(flow-image-model-mismatch) 가 씬 패치에 실린다', async () => {
    api.flowGenerateImage.mockResolvedValue({ success: false, errorKind: 'flow-image-model-mismatch', error: 'flow-image-model-mismatch', errorParams: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' } })
    const { hook, updateScene } = setup({ settings: { imageModel: 'Nano Banana Pro' } })
    await act(async () => { await hook.result.current.gen.handleGenerateScene('scene_1') })
    expect(lastPatch(updateScene)).toMatchObject({ status: 'error', errorKind: 'flow-image-model-mismatch', errorParams: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' } })
  })
})
