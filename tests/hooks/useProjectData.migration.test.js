/**
 * useProjectData — Phase 7: Existing project migration to schemaVersion=2
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    loadProjectData: vi.fn(),
    saveProjectData: vi.fn(),
    getResourcePath: vi.fn().mockResolvedValue({ success: false }),
    projectExists: vi.fn().mockResolvedValue(true),
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
    ensurePermission: vi.fn().mockResolvedValue({ success: true }),
  },
}))

import { loadProjectWithResources } from '../../src/hooks/useProjectData'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'

describe('loadProjectWithResources — Phase 7 migration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })
    fileSystemAPI.readFileByPath.mockResolvedValue({ success: false })
  })

  it('옛 프로젝트 (no schemaVersion, no srtTrack) → 자동 migration', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValueOnce({
      success: true,
      data: {
        scenes: [
          { id: 's1', subtitle: '자막1', startTime: 0, endTime: 3, prompt: 'P1' },
          { id: 's2', subtitle: '자막2', startTime: 3, endTime: 6, prompt: 'P2' },
        ],
        references: [],
        videoScenes: [],
        framePairs: [],
      },
    })
    const result = await loadProjectWithResources('legacy_p')
    expect(result.schemaVersion).toBe(2)
    expect(result.srtTrack).toHaveLength(2)
    expect(result.srtTrack.map(l => l.text)).toEqual(['자막1', '자막2'])
    expect(result.scenes[0].srtLineIds).toEqual([result.srtTrack[0].id])
    expect(result.scenes[1].srtLineIds).toEqual([result.srtTrack[1].id])
    // 원본 prompt 보존
    expect(result.scenes[0].prompt).toBe('P1')
  })

  it('이미 schemaVersion=2 인 프로젝트 → 그대로 (srtTrack 보존)', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValueOnce({
      success: true,
      data: {
        schemaVersion: 2,
        srtTrack: [
          { id: 'sub_1', startTime: 0, endTime: 3, text: 'A' },
          { id: 'sub_2', startTime: 3, endTime: 6, text: 'B' },
        ],
        scenes: [
          { id: 's1', srtLineIds: ['sub_1', 'sub_2'], prompt: 'PA' },
        ],
        references: [],
        videoScenes: [],
        framePairs: [],
      },
    })
    const result = await loadProjectWithResources('new_p')
    expect(result.schemaVersion).toBe(2)
    expect(result.srtTrack).toHaveLength(2)
    expect(result.srtTrack[0].text).toBe('A')
    expect(result.scenes[0].srtLineIds).toEqual(['sub_1', 'sub_2'])
    expect(result.scenes[0].prompt).toBe('PA')
  })

  it('빈 scenes 옛 프로젝트도 안전하게 migration', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValueOnce({
      success: true,
      data: {
        scenes: [],
        references: [],
        videoScenes: [],
        framePairs: [],
      },
    })
    const result = await loadProjectWithResources('empty_p')
    expect(result.schemaVersion).toBe(2)
    expect(result.srtTrack).toEqual([])
    expect(result.scenes).toEqual([])
  })

  it('빈 subtitle 인 옛 씬 → srtLineIds=[], srtTrack 라인 없음', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValueOnce({
      success: true,
      data: {
        scenes: [
          { id: 's1', subtitle: '자막1', startTime: 0, endTime: 3 },
          { id: 's2', subtitle: '',      startTime: 3, endTime: 6 },
        ],
        references: [],
        videoScenes: [],
        framePairs: [],
      },
    })
    const result = await loadProjectWithResources('mixed_p')
    expect(result.srtTrack).toHaveLength(1)
    expect(result.scenes[0].srtLineIds).toHaveLength(1)
    expect(result.scenes[1].srtLineIds).toEqual([])
  })

  it('loadProjectData 가 실패하면 null 반환', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValueOnce({ success: false })
    const result = await loadProjectWithResources('missing_p')
    expect(result).toBeNull()
  })
})
