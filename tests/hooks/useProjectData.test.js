/**
 * loadProjectWithResources unit tests
 *
 * Covers two related bugs in project image-path loading + the i18n contract.
 *
 *   Bug 1 (cross-project leak): scene.imagePath stored as absolute path that
 *     points to a DIFFERENT project's scenes/ folder. The loader must remap to
 *     the current project; when getResourcePath fails (file not in current
 *     project), the stale path must be cleared and the scene flagged as
 *     missing-image so the UI surfaces a regenerate prompt instead of silently
 *     rendering a broken file:// URL.
 *
 *   Bug 2 (file missing on disk at load time): scene.imagePath looks valid but
 *     the file no longer exists on disk (deleted, moved, etc.). Same remedy as
 *     Bug 1.
 *
 * i18n contract: project.json stores ONLY a stable `errorKind` code (e.g.
 * 'image-missing') for codified errors. The localized message is generated at
 * display time by ErrorSection via t(`errorSection.kind.<kind>`). The loader
 * therefore never sets a localized error string — `error` is null for codified
 * errors and reserved for free-form generation-failure messages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadProjectWithResources } from '../../src/hooks/useProjectData'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    loadProjectData: vi.fn(),
    getResourcePath: vi.fn(),
    readResource: vi.fn(),
    readHistoryMetadata: vi.fn(),
    getHistory: vi.fn(),
  },
}))

// mediaSync.syncVideosIntoScenes is called at the end of loadProjectWithResources;
// it mutates scenes in place. For these unit tests we don't care about its
// behaviour (we test image-path logic), so stub it to a no-op.
vi.mock('../../src/services/mediaSync', () => ({
  syncVideosIntoScenes: vi.fn(),
}))

vi.mock('../../src/services/videoRecovery', () => ({
  recoverInFlightVideos: vi.fn(),
}))

describe('loadProjectWithResources — image path remap on load', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Default: no resource history / no fallback resources unless a test overrides.
    fileSystemAPI.readResource.mockResolvedValue({ success: false })
    fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
    fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
  })

  it('remaps relative imagePath to current project (happy path)', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: { scenes: [{ id: 'scene_1', imagePath: 'scenes/scene_1.jpg', status: 'done' }] },
    })
    fileSystemAPI.getResourcePath.mockResolvedValue({
      success: true,
      path: '/projects/ep6/scenes/scene_1.jpg',
    })

    const result = await loadProjectWithResources('ep6')

    expect(result.scenes[0].imagePath).toBe('/projects/ep6/scenes/scene_1.jpg')
    expect(result.scenes[0].image).toBeNull()
    expect(result.scenes[0].status).toBe('done')
    expect(result.scenes[0].error ?? null).toBeNull()
    expect(result.scenes[0].errorKind ?? null).toBeNull()
  })

  it('remaps absolute imagePath when the file exists in current project', async () => {
    // Simulates: project.json was saved with an absolute path on disk A; user is
    // loading on the same machine, file is in current project's scenes/.
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: { scenes: [{ id: 'scene_1', imagePath: 'C:\\old\\AutoFlowCut\\ep6\\scenes\\scene_1.jpg', status: 'done' }] },
    })
    fileSystemAPI.getResourcePath.mockResolvedValue({
      success: true,
      path: 'C:\\new\\AutoFlowCut\\ep6\\scenes\\scene_1.jpg',
    })

    const result = await loadProjectWithResources('ep6')

    expect(result.scenes[0].imagePath).toBe('C:\\new\\AutoFlowCut\\ep6\\scenes\\scene_1.jpg')
    expect(result.scenes[0].status).toBe('done')
  })

  it('Bug 1 regression: clears stale path + flips to error when absolute path points to a DIFFERENT project', async () => {
    // Real bug observed in ep6_babo_yeonggam: scene_105/124 had imagePath
    // pointing to ../Untitled/scenes/... — file does not exist in ep6 folder,
    // so getResourcePath fails. Loader must clear the path and surface the
    // error rather than silently keep status='done'.
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: {
        scenes: [{
          id: 'scene_105',
          imagePath: 'C:\\Users\\tuxxo\\OneDrive\\문서\\AutoFlowCut\\Untitled\\scenes\\scene_105.jpg',
          status: 'done',
        }],
      },
    })
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })

    const result = await loadProjectWithResources('ep6_babo_yeonggam')

    expect(result.scenes[0].imagePath).toBeNull()
    expect(result.scenes[0].image).toBeNull()
    expect(result.scenes[0].status).toBe('error')
    // i18n contract: loader never sets a localized message — only the stable kind code.
    expect(result.scenes[0].error).toBeNull()
    expect(result.scenes[0].errorKind).toBe('image-missing')
  })

  it('Bug 2 regression (load-time): clears path + flips to error when file is missing on disk', async () => {
    // Same shape as Bug 1 from the loader's perspective — getResourcePath fails
    // either because of cross-project leak OR because the file was deleted from
    // disk. Either way, the user expectation is identical: surface the error.
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: {
        scenes: [{
          id: 'scene_1',
          imagePath: '/projects/ep6/scenes/scene_1.jpg',
          status: 'done',
        }],
      },
    })
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })

    const result = await loadProjectWithResources('ep6')

    expect(result.scenes[0].imagePath).toBeNull()
    expect(result.scenes[0].status).toBe('error')
    expect(result.scenes[0].error).toBeNull()
    expect(result.scenes[0].errorKind).toBe('image-missing')
  })

  it('preserves base64 image (legacy data with no imagePath) when no file is found', async () => {
    // Legacy scenes saved before path-only refactor may have a base64 `image`
    // string but no `imagePath`. Don't downgrade these — base64 still renders.
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: { scenes: [{ id: 'scene_1', image: 'data:image/png;base64,iVBORw0KGgo...' }] },
    })
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })

    const result = await loadProjectWithResources('ep6')

    expect(result.scenes[0].image).toBe('data:image/png;base64,iVBORw0KGgo...')
    expect(result.scenes[0].status).toBe('done')
    expect(result.scenes[0].error ?? null).toBeNull()
  })

  it('keeps pending status for scenes with no imagePath, no image, and no file', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: { scenes: [{ id: 'scene_1', prompt: 'a cat', status: 'pending' }] },
    })
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })

    const result = await loadProjectWithResources('ep6')

    expect(result.scenes[0].status).toBe('pending')
    expect(result.scenes[0].imagePath ?? null).toBeNull()
    expect(result.scenes[0].error ?? null).toBeNull()
  })

  it('clears prior missing-image error when file is found again (recovery)', async () => {
    // User regenerates after a missing-file error. Next load should clear the
    // errorKind so ErrorSection stops showing it.
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: {
        scenes: [{
          id: 'scene_1',
          imagePath: null,
          status: 'error',
          errorKind: 'image-missing',
        }],
      },
    })
    fileSystemAPI.getResourcePath.mockResolvedValue({
      success: true,
      path: '/projects/ep6/scenes/scene_1.jpg',
    })

    const result = await loadProjectWithResources('ep6')

    expect(result.scenes[0].imagePath).toBe('/projects/ep6/scenes/scene_1.jpg')
    expect(result.scenes[0].status).toBe('done')
    expect(result.scenes[0].error).toBeNull()
    expect(result.scenes[0].errorKind).toBeNull()
  })

  it('P1 regression: preserves generation-failure error on reload when file still exists', async () => {
    // Scenario: scene was generated successfully (file exists), then user
    // re-generated and that re-generation failed (e.g. quota / moderation /
    // network). updateScene merge keeps the old imagePath while setting
    // status='error' + a generation-error message. The loader must NOT silently
    // clear that error just because the (stale) image file is still on disk —
    // otherwise the user loses the regenerate prompt and we get a false-Done
    // recurrence of this very bug.
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: {
        scenes: [{
          id: 'scene_1',
          imagePath: '/projects/ep6/scenes/scene_1.jpg',
          status: 'error',
          error: 'Generation failed: content moderation rejected the prompt',
          // No errorKind — this is a free-form generation error, not a missing-image one.
        }],
      },
    })
    fileSystemAPI.getResourcePath.mockResolvedValue({
      success: true,
      path: '/projects/ep6/scenes/scene_1.jpg',
    })

    const result = await loadProjectWithResources('ep6')

    expect(result.scenes[0].imagePath).toBe('/projects/ep6/scenes/scene_1.jpg')
    expect(result.scenes[0].status).toBe('error')
    expect(result.scenes[0].error).toBe('Generation failed: content moderation rejected the prompt')
  })

  it('P2 regression: status="done" with no imagePath and no image is downgraded to error', async () => {
    // Data-corruption case: project.json saved status='done' but imagePath was
    // never stored and there's no base64 image either. Pre-fix this would slip
    // through as status='done' (false Done). Now treated as missing-image.
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: {
        scenes: [{
          id: 'scene_1',
          status: 'done',
          // imagePath: undefined, image: undefined
        }],
      },
    })
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })

    const result = await loadProjectWithResources('ep6')

    expect(result.scenes[0].status).toBe('error')
    expect(result.scenes[0].errorKind).toBe('image-missing')
    expect(result.scenes[0].error).toBeNull()
    expect(result.scenes[0].imagePath ?? null).toBeNull()
    expect(result.scenes[0].image ?? null).toBeNull()
  })

  // ── Project aspect ratio (longform/shortform) ──
  // project.json stores the per-project aspect ratio under settings.aspectRatio;
  // the loader surfaces it so handleProjectChange can restore it on switch.
  it('returns aspectRatio from project.json settings', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: { scenes: [], references: [], settings: { aspectRatio: '9:16' } },
    })

    const result = await loadProjectWithResources('ep_short')

    expect(result.aspectRatio).toBe('9:16')
  })

  it('returns null aspectRatio when project.json has no settings block', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: { scenes: [], references: [] },
    })

    const result = await loadProjectWithResources('ep_legacy')

    expect(result.aspectRatio).toBeNull()
  })

  it('strips stale localized error string from prior missing-image flagging (i18n hygiene)', async () => {
    // A prior load (under a different locale) may have stored a localized error
    // string in scene.error along with errorKind='image-missing'. On reload we
    // must drop that stale string so the display layer always shows a freshly
    // translated message via t(`errorSection.kind.image-missing`).
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: {
        scenes: [{
          id: 'scene_1',
          imagePath: null,
          status: 'error',
          error: '이미지 파일을 찾을 수 없습니다 — 재생성이 필요합니다', // Korean leftover
          errorKind: 'image-missing',
        }],
      },
    })
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })

    const result = await loadProjectWithResources('ep6')

    expect(result.scenes[0].status).toBe('error')
    expect(result.scenes[0].errorKind).toBe('image-missing')
    expect(result.scenes[0].error).toBeNull()
  })
})
