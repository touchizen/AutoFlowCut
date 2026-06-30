// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

// firebase/functions — getFunctions/httpsCallable 모킹. httpsCallable 은 호출된
// 함수 이름을 기록하고, 반환된 callable 은 GCF 응답을 흉내낸다.
const callableSpy = vi.fn(async (payload) => ({
  data: {
    projectJson: { files: [{ id: 'scene_0' }], version: 16 },
    mediaRefs: [{ mediaId: 'scene_0', archivePath: 'media/scene_0.png', filename: 'scene.png', role: 'scene', type: 'Image', sceneId: 's1' }],
    warnings: [],
    totalDurationMs: 1000,
    sceneCount: 1,
  },
}))
const httpsCallableSpy = vi.fn(() => callableSpy)
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: (...args) => httpsCallableSpy(...args),
}))

const prepareSpy = vi.fn()
vi.mock('../../src/exporters/prepareCloudRequest', () => ({
  prepareCloudRequest: (...args) => prepareSpy(...args),
}))

import { exportVrew } from '../../src/exporters/vrew'

beforeEach(() => {
  vi.clearAllMocks()
  global.window = {
    electronAPI: {
      writeVrewProject: vi.fn(async () => ({ success: true, targetPath: '/out/Project/Project.vrew' })),
      writeFileAbsolute: vi.fn(async () => ({ success: true })),
    },
  }
  prepareSpy.mockResolvedValue({
    cloudRequest: {
      projectName: 'Project',
      format: 'portrait',
      mediaPathBase: 'media',
      scenes: [{ id: 's1', type: 'image', filename: 'scene.png', duration: 1 }],
    },
    mediaFiles: [{ sceneId: 's1', type: 'image', filename: 'scene.png', path: '/abs/scene.png' }],
    sfxFiles: [],
    audioFiles: [],
  })
})

describe('exportVrew (cloud routing)', () => {
  it('routes through Cloud Functions generateVrewJson_test (dev default)', async () => {
    const result = await exportVrew({ name: 'Project' }, { capcutProjectNumber: '/out/Project' })

    expect(result.success).toBe(true)
    // 배선 회귀 가드: vrew.js 가 로컬 generator 로 빠지면 httpsCallable 자체가 안 불림.
    expect(httpsCallableSpy).toHaveBeenCalledTimes(1)
    expect(httpsCallableSpy).toHaveBeenCalledWith(expect.anything(), 'generateVrewJson_test')
    expect(callableSpy).toHaveBeenCalledTimes(1)
    // appId 가 GCF 요청에 포함되어야 함 (quota 게이트가 appId 로 appDoc 조회).
    expect(callableSpy.mock.calls[0][0]).toMatchObject({ appId: 'autoflowcut' })
    // GCF 가 만든 projectJson 이 로컬 패커로 그대로 전달돼 .vrew 로 쓰임.
    expect(window.electronAPI.writeVrewProject).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.writeVrewProject.mock.calls[0][0].projectJson.version).toBe(16)
  })

  it('rejects with a clear error when GCF returns malformed mediaRefs (no silent TypeError)', async () => {
    callableSpy.mockResolvedValueOnce({
      data: { projectJson: { files: [], version: 16 }, mediaRefs: null, warnings: [] },
    })

    await expect(
      exportVrew({ name: 'Project' }, { capcutProjectNumber: '/out/Project' })
    ).rejects.toThrow('generateVrewJson returned invalid mediaRefs')
    // 깨진 응답이면 패킹/디스크 쓰기까지 가지 않아야 함.
    expect(window.electronAPI.writeVrewProject).not.toHaveBeenCalled()
  })

  it('rejects when GCF returns a media ref missing required fields', async () => {
    callableSpy.mockResolvedValueOnce({
      data: { projectJson: { files: [], version: 16 }, mediaRefs: [{ mediaId: 'scene_0' }], warnings: [] },
    })

    await expect(
      exportVrew({ name: 'Project' }, { capcutProjectNumber: '/out/Project' })
    ).rejects.toThrow(/media ref missing/)
  })

  it('rejects a scene media ref missing sceneId (duplicate-filename disambiguation guard)', async () => {
    callableSpy.mockResolvedValueOnce({
      data: {
        projectJson: { files: [], version: 16 },
        mediaRefs: [{ mediaId: 'scene_0', archivePath: 'media/scene_0.png', filename: 'scene.png', role: 'scene' }],
        warnings: [],
      },
    })

    await expect(
      exportVrew({ name: 'Project' }, { capcutProjectNumber: '/out/Project' })
    ).rejects.toThrow(/sceneId/)
    expect(window.electronAPI.writeVrewProject).not.toHaveBeenCalled()
  })
})
