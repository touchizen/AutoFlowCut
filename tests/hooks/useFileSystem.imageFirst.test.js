import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fileSystemAPI,
  normalizeSceneImageToPng,
} from '../../src/hooks/useFileSystem.js'
import { RESOURCE } from '../../src/config/defaults.js'

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w=='
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'

describe('renderer scene PNG normalization and image-first IPC wrappers', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('workFolderPath', '/work')
    window.electronAPI = {
      saveResource: vi.fn(async (payload) => ({ success: true, payload })),
      stageImageFirstImage: vi.fn(async (payload) => ({ success: true, payload })),
      abortImageFirstImport: vi.fn(async (payload) => ({ success: true, payload })),
      commitImageFirstImport: vi.fn(async (payload) => ({ success: true, payload })),
    }
  })

  it('normalizes through the explicit encoder seam and rejects a non-PNG encoder result', async () => {
    const encoder = vi.fn(async () => PNG)
    await expect(normalizeSceneImageToPng(JPEG, encoder)).resolves.toBe(PNG)
    expect(encoder).toHaveBeenCalledWith(JPEG)

    await expect(normalizeSceneImageToPng(JPEG, async () => JPEG))
      .rejects.toThrow('scene-image-not-png')
  })

  it('normalizes a current scene at the shared saveResource boundary before IPC', async () => {
    const encoder = vi.fn(async () => PNG)

    await fileSystemAPI.saveResource('P', RESOURCE.SCENES, 'scene_1', JPEG, 'imported', null, {
      pngEncoder: encoder,
    })

    expect(encoder).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.saveResource).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: RESOURCE.SCENES,
      data: PNG,
      historyOnly: false,
    }))
  })

  it('normalizes a historyOnly scene at the same saveResource boundary before IPC', async () => {
    const encoder = vi.fn(async () => PNG)

    await fileSystemAPI.saveResource('P', RESOURCE.SCENES, 'scene_1', JPEG, 'imported', null, {
      historyOnly: true,
      pngEncoder: encoder,
    })

    expect(encoder).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.saveResource).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: RESOURCE.SCENES,
      data: PNG,
      historyOnly: true,
    }))
  })

  it('does not run the scene encoder for a non-scene resource', async () => {
    const encoder = vi.fn(async () => PNG)

    await fileSystemAPI.saveResource('P', RESOURCE.REFERENCES, 'ref_1', JPEG, 'imported', null, {
      pngEncoder: encoder,
    })

    expect(encoder).not.toHaveBeenCalled()
    expect(window.electronAPI.saveResource).toHaveBeenCalledWith(expect.objectContaining({ data: JPEG }))
  })

  it('wraps fs:stage-image-first-image with the active work folder and project', async () => {
    await fileSystemAPI.stageImageFirstImage('P', {
      fixedSceneRevision: 'revision-1',
      rendererSceneId: 'scene_1',
      data: PNG,
    })

    expect(window.electronAPI.stageImageFirstImage).toHaveBeenCalledWith({
      workFolder: '/work',
      project: 'P',
      fixedSceneRevision: 'revision-1',
      rendererSceneId: 'scene_1',
      data: PNG,
    })
  })

  it('wraps fs:abort-image-first-import without changing an idempotent result', async () => {
    await fileSystemAPI.abortImageFirstImport('P', 'revision-1')

    expect(window.electronAPI.abortImageFirstImport).toHaveBeenCalledWith({
      workFolder: '/work',
      project: 'P',
      fixedSceneRevision: 'revision-1',
    })
  })

  it('wraps fs:commit-image-first-import with the full project payload', async () => {
    const data = {
      scenes: [{ id: 'scene_1' }],
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: 'revision-1',
      fixedScenes: [{ storyId: 'story-1', rendererSceneId: 'scene_1', ordinal: 1 }],
    }

    await fileSystemAPI.commitImageFirstImport('P', data)

    expect(window.electronAPI.commitImageFirstImport).toHaveBeenCalledWith({
      workFolder: '/work',
      project: 'P',
      data,
    })
  })
})
