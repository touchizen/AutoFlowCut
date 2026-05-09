/**
 * finalizeGeneratedImage — 단위 테스트
 *
 * 핵심 회귀 검증:
 *   - 성공/실패 모든 sceneUpdate 가 errorKind 를 명시적으로 set 하거나 null 로
 *     비운다 (merge update 에서 prior 'image-missing' kind 가 새 메시지를 가리지
 *     않도록 — i18n 컨트랙트 + 재생성 후 stale state 방지).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { finalizeGeneratedImage, processAsyncSceneResult } from '../../src/services/imageFinalize'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    saveImage: vi.fn(),
    saveExtraToHistory: vi.fn().mockResolvedValue({ success: true }),
  },
}))

vi.mock('../../src/utils/imageProcessing', () => ({
  tryUpscaleImage: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../src/utils/formatters', () => ({
  getImageSizeFromBase64: vi.fn().mockResolvedValue({ width: 1024, height: 1024 }),
}))

const TINY_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='

describe('finalizeGeneratedImage — errorKind cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileSystemAPI.saveImage.mockResolvedValue({ success: true, path: '/tmp/scene_1.png' })
  })

  it('success path: sceneUpdate explicitly sets errorKind: null (clears stale image-missing)', async () => {
    const res = await finalizeGeneratedImage({
      result: { success: true, images: [{ base64: TINY_BASE64, mediaId: 'm1' }] },
      flowAPI: {},
      saveMode: 'folder',
      projectName: 'ep6',
      sceneId: 'scene_1',
      prompt: 'a cat',
    })

    expect(res.success).toBe(true)
    expect(res.sceneUpdate).toMatchObject({
      status: 'done',
      error: null,
      errorKind: null,    // ← critical: prior 'image-missing' 마커가 merge 후 남으면 안 됨
    })
  })

  it('failure path (no images): sceneUpdate sets errorKind: null', async () => {
    const res = await finalizeGeneratedImage({
      result: { success: false, error: 'Quota exceeded', images: [] },
      flowAPI: {},
      saveMode: 'folder',
      projectName: 'ep6',
      sceneId: 'scene_1',
      prompt: 'a cat',
    })

    expect(res.success).toBe(false)
    expect(res.sceneUpdate).toMatchObject({
      status: 'error',
      error: 'Quota exceeded',
      errorKind: null,    // ← stale 'image-missing' 가 'Quota exceeded' 메시지를 가리면 안 됨
    })
  })

  it('failure path (save error): sceneUpdate sets errorKind: null', async () => {
    fileSystemAPI.saveImage.mockResolvedValue({ success: false, error: 'Disk full' })

    const res = await finalizeGeneratedImage({
      result: { success: true, images: [{ base64: TINY_BASE64, mediaId: 'm1' }] },
      flowAPI: {},
      saveMode: 'folder',
      projectName: 'ep6',
      sceneId: 'scene_1',
      prompt: 'a cat',
    })

    expect(res.success).toBe(false)
    expect(res.sceneUpdate.status).toBe('error')
    expect(res.sceneUpdate.error).toMatch(/Image save failed.*Disk full/)
    expect(res.sceneUpdate.errorKind).toBeNull()
  })
})

describe('processAsyncSceneResult — useAutomation batch error counting contract', () => {
  // useAutomation 의 collect 루프는 이 함수의 boolean 반환값으로 errorCountRef 를 증감한다.
  // result.success 만 보고 카운트하면 "이미지는 받았는데 디스크 저장 실패" 케이스가
  // 성공으로 잘못 집계되는 회귀 — 이 테스트가 그 contract 의 가드.

  beforeEach(() => {
    vi.clearAllMocks()
    fileSystemAPI.saveImage.mockResolvedValue({ success: true, path: '/tmp/scene_1.png' })
  })

  const baseArgs = (overrides = {}) => ({
    scene: { id: 'scene_1', prompt: 'a cat' },
    result: { success: true, images: [{ base64: TINY_BASE64, mediaId: 'm1' }] },
    flowAPI: {},
    imageUpscale: 'off',
    saveMode: 'folder',
    projectName: 'ep6',
    seed: null,
    updateScene: vi.fn(),
    logPrefix: '[Test]',
    ...overrides,
  })

  it('happy path: returns true and calls updateScene with done', async () => {
    const updateScene = vi.fn()
    const ok = await processAsyncSceneResult(baseArgs({ updateScene }))

    expect(ok).toBe(true)
    expect(updateScene).toHaveBeenCalledWith('scene_1', expect.objectContaining({ status: 'done' }))
  })

  it('returns false when API returned no images (caller increments errorCount)', async () => {
    const updateScene = vi.fn()
    const ok = await processAsyncSceneResult(baseArgs({
      updateScene,
      result: { success: false, error: 'Quota exceeded', images: [] },
    }))

    expect(ok).toBe(false)
    expect(updateScene).toHaveBeenCalledWith('scene_1', expect.objectContaining({ status: 'error' }))
  })

  it('returns false when image was generated but saveImage failed (regression)', async () => {
    // The exact scenario that pre-fix slipped through useAutomation as a "success":
    //   - generation API returned an image
    //   - disk save failed (full disk / permission error)
    //   - finalize correctly returns success: false
    //   - processAsyncSceneResult must propagate that to its caller
    fileSystemAPI.saveImage.mockResolvedValue({ success: false, error: 'EACCES' })

    const updateScene = vi.fn()
    const ok = await processAsyncSceneResult(baseArgs({ updateScene }))

    expect(ok).toBe(false)
    expect(updateScene).toHaveBeenCalledWith('scene_1', expect.objectContaining({
      status: 'error',
      errorKind: null, // stale missing-image marker is cleared
    }))
  })
})
