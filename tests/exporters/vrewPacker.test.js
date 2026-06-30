// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

const prepareSpy = vi.fn()
vi.mock('../../src/exporters/prepareCloudRequest', () => ({
  prepareCloudRequest: (...args) => prepareSpy(...args),
}))

import { packAndWriteVrew } from '../../src/exporters/vrewPacker'

// generator(클라 vs GCF)는 packAndWriteVrew 에 주입된다. 여기선 GCF generateVrewJson
// 의 반환 shape({projectJson, mediaRefs, ...})를 흉내내는 페이크를 주입해 패킹/쓰기만 검증.
// (실제 generator 로직은 GCF 소유 — 클라엔 더 이상 없음.)
function fakeGenerate(cloudRequest) {
  const scenes = cloudRequest.scenes || []
  const mediaRefs = scenes.map((scene, i) => ({
    mediaId: `scene_${i}`,
    archivePath: `media/scene_${i}.png`,
    filename: scene.filename,
    role: 'scene',
    type: 'Image',
    sceneId: scene.id,
  }))
  return {
    projectJson: {
      version: 16,
      files: scenes.map((_, i) => ({ id: `scene_${i}` })),
    },
    mediaRefs,
    totalDurationMs: 1000,
    totalDuration: 1000,
    sceneCount: scenes.length,
    warnings: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  global.window = {
    electronAPI: {
      readFileAbsolute: vi.fn(async () => ({ success: true, data: 'data:image/png;base64,AQID' })),
      writeBinaryFileAbsolute: vi.fn(async () => ({ success: true, targetPath: '/out/Project/Project.vrew' })),
      writeVrewProject: vi.fn(async () => ({ success: true, targetPath: '/out/Project/Project.vrew' })),
      writeFileAbsolute: vi.fn(async () => ({ success: true })),
    },
  }
})

describe('packAndWriteVrew', () => {
  it('packs media from generator output and delegates the .vrew write to main', async () => {
    prepareSpy.mockResolvedValue({
      cloudRequest: {
        projectName: 'Project',
        format: 'portrait',
        mediaPathBase: 'media',
        scenes: [
          { id: 's1', type: 'image', filename: 'scene.png', duration: 1, subtitleKo: 'hello' },
        ],
        videoOverlays: null,
        sfxItems: [],
        audioTracks: null,
      },
      mediaFiles: [{ sceneId: 's1', type: 'image', filename: 'scene.png', path: '/abs/scene.png' }],
      sfxFiles: [],
      audioFiles: [],
    })

    const result = await packAndWriteVrew({ name: 'Project' }, { capcutProjectNumber: '/out/Project' }, fakeGenerate)

    expect(result.success).toBe(true)
    expect(result.targetPath).toBe('/out/Project/Project.vrew')
    expect(prepareSpy).toHaveBeenCalledTimes(1)
    // 미디어 바이트는 renderer 가 직접 읽지 않고 main 의 writeVrewProject 로 위임.
    expect(window.electronAPI.readFileAbsolute).not.toHaveBeenCalled()
    expect(window.electronAPI.writeBinaryFileAbsolute).not.toHaveBeenCalled()
    expect(window.electronAPI.writeVrewProject).toHaveBeenCalledTimes(1)
    const writeArg = window.electronAPI.writeVrewProject.mock.calls[0][0]
    expect(writeArg.targetPath).toBe('/out/Project/Project.vrew')
    expect(writeArg.projectJson.files).toHaveLength(1)
    expect(writeArg.projectJson.version).toBe(16)
    expect(writeArg.mediaRefs).toHaveLength(1)
    expect(writeArg.mediaSources[0]).toMatchObject({
      mediaId: 'scene_0',
      archivePath: 'media/scene_0.png',
      filePath: '/abs/scene.png',
    })
    expect(writeArg.mediaSources[0].data).toBeUndefined()
    expect(window.electronAPI.writeFileAbsolute).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/out/Project/vrew-export-debug.log',
      content: expect.stringContaining('Delegated Vrew package write to main process'),
    }))
    expect(window.electronAPI.writeFileAbsolute).not.toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/tmp/autoflowcut-vrew-project.json',
    }))
    expect(window.electronAPI.writeFileAbsolute).not.toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/tmp/autoflowcut-vrew-mediaRefs.json',
    }))
  })

  it('writes detailed Vrew debug artifacts only when explicitly enabled', async () => {
    prepareSpy.mockResolvedValue({
      cloudRequest: {
        projectName: 'Project',
        mediaPathBase: 'media',
        scenes: [
          { id: 's1', type: 'image', filename: 'scene.png', duration: 1 },
        ],
      },
      mediaFiles: [{ sceneId: 's1', type: 'image', filename: 'scene.png', path: '/abs/scene.png' }],
      sfxFiles: [],
      audioFiles: [],
    })

    await packAndWriteVrew(
      { name: 'Project' },
      { capcutProjectNumber: '/out/Project', debugVrewArtifacts: true },
      fakeGenerate
    )

    expect(window.electronAPI.writeFileAbsolute).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/tmp/autoflowcut-vrew-project.json',
      content: expect.stringContaining('"version": 16'),
    }))
    expect(window.electronAPI.writeFileAbsolute).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/tmp/autoflowcut-vrew-mediaRefs.json',
      content: expect.stringContaining('"archivePath": "media/scene_0.png"'),
    }))
  })

  it('honors the localStorage debug artifact flag unless options disable it', async () => {
    prepareSpy.mockResolvedValue({
      cloudRequest: {
        projectName: 'Project',
        mediaPathBase: 'media',
        scenes: [
          { id: 's1', type: 'image', filename: 'scene.png', duration: 1 },
        ],
      },
      mediaFiles: [{ sceneId: 's1', type: 'image', filename: 'scene.png', path: '/abs/scene.png' }],
      sfxFiles: [],
      audioFiles: [],
    })
    window.localStorage = {
      getItem: vi.fn((key) => key === 'autoflowcut.vrewDebugArtifacts' ? '1' : null),
    }

    await packAndWriteVrew({ name: 'Project' }, { capcutProjectNumber: '/out/Project' }, fakeGenerate)

    expect(window.electronAPI.writeFileAbsolute).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/tmp/autoflowcut-vrew-project.json',
    }))

    vi.clearAllMocks()
    prepareSpy.mockResolvedValue({
      cloudRequest: {
        projectName: 'Project',
        mediaPathBase: 'media',
        scenes: [
          { id: 's1', type: 'image', filename: 'scene.png', duration: 1 },
        ],
      },
      mediaFiles: [{ sceneId: 's1', type: 'image', filename: 'scene.png', path: '/abs/scene.png' }],
      sfxFiles: [],
      audioFiles: [],
    })

    await packAndWriteVrew(
      { name: 'Project' },
      { capcutProjectNumber: '/out/Project', debugVrewArtifacts: false },
      fakeGenerate
    )

    expect(window.electronAPI.writeFileAbsolute).not.toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/tmp/autoflowcut-vrew-project.json',
    }))
    expect(window.electronAPI.writeFileAbsolute).not.toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/tmp/autoflowcut-vrew-mediaRefs.json',
    }))
  })

  it('requires an output folder before invoking the generator', async () => {
    const gen = vi.fn(fakeGenerate)
    await expect(packAndWriteVrew({ name: 'P' }, {}, gen)).rejects.toThrow(/folder path is required/)
    expect(gen).not.toHaveBeenCalled()
  })

  it('matches duplicate filenames by sceneId before packing', async () => {
    window.electronAPI.writeVrewProject = vi.fn(async () => ({ success: true, targetPath: '/out/Project/Project.vrew' }))

    prepareSpy.mockResolvedValue({
      cloudRequest: {
        projectName: 'Project',
        mediaPathBase: 'media',
        scenes: [
          { id: 's1', type: 'image', filename: 'scene.png', duration: 1 },
          { id: 's2', type: 'image', filename: 'scene.png', duration: 1 },
        ],
      },
      mediaFiles: [
        { sceneId: 's1', type: 'image', filename: 'scene.png', path: '/abs/a/scene.png' },
        { sceneId: 's2', type: 'image', filename: 'scene.png', path: '/abs/b/scene.png' },
      ],
      sfxFiles: [],
      audioFiles: [],
    })

    await expect(
      packAndWriteVrew({ name: 'Project' }, { capcutProjectNumber: '/out/Project' }, fakeGenerate)
    ).resolves.toMatchObject({ success: true })
    expect(window.electronAPI.readFileAbsolute).not.toHaveBeenCalled()
    expect(window.electronAPI.writeVrewProject.mock.calls[0][0].mediaSources).toEqual([
      expect.objectContaining({ filePath: '/abs/a/scene.png', mediaId: 'scene_0', archivePath: 'media/scene_0.png' }),
      expect.objectContaining({ filePath: '/abs/b/scene.png', mediaId: 'scene_1', archivePath: 'media/scene_1.png' }),
    ])
  })

  it('throws (no silent wrong bind) when a scene ref sceneId matches none of the duplicate filenames', async () => {
    prepareSpy.mockResolvedValue({
      cloudRequest: {
        projectName: 'Project',
        mediaPathBase: 'media',
        scenes: [
          { id: 's1', type: 'image', filename: 'scene.png', duration: 1 },
          { id: 's2', type: 'image', filename: 'scene.png', duration: 1 },
        ],
      },
      mediaFiles: [
        { sceneId: 's1', type: 'image', filename: 'scene.png', path: '/abs/a/scene.png' },
        { sceneId: 's2', type: 'image', filename: 'scene.png', path: '/abs/b/scene.png' },
      ],
      sfxFiles: [],
      audioFiles: [],
    })
    // GCF 가 잘못된 sceneId 를 단 ref 를 돌려준 경우 (2개 후보 중 어느 것도 안 맞음).
    const badGenerate = () => ({
      projectJson: { files: [], version: 16 },
      mediaRefs: [
        { mediaId: 'scene_0', archivePath: 'media/scene_0.png', filename: 'scene.png', role: 'scene', type: 'Image', sceneId: 'NOPE' },
      ],
      warnings: [],
    })

    await expect(
      packAndWriteVrew({ name: 'Project' }, { capcutProjectNumber: '/out/Project' }, badGenerate)
    ).rejects.toThrow(/cannot disambiguate/)
    expect(window.electronAPI.writeVrewProject).not.toHaveBeenCalled()
  })
})
