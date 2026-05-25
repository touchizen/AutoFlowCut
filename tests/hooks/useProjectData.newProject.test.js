/**
 * useProjectData — Review fix C4
 *
 * Brand-new project creation 시 setSrtTrack([]) 호출되어 직전 프로젝트의 srtTrack 누수 방지.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    loadProjectData: vi.fn(),
    saveProjectData: vi.fn().mockResolvedValue({ success: true }),
    getResourcePath: vi.fn().mockResolvedValue({ success: false }),
    projectExists: vi.fn(),
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
    ensurePermission: vi.fn().mockResolvedValue({ success: true }),
  },
}))

import { useProjectData } from '../../src/hooks/useProjectData'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'

describe('useProjectData — C4 fix: new project clears srtTrack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileSystemAPI.projectExists.mockResolvedValue(false) // 새 프로젝트
  })

  it('handleProjectChange(새 프로젝트) → setSrtTrack([]) 호출', async () => {
    const setSrtTrack = vi.fn()
    const setScenes = vi.fn()

    const { result } = renderHook(() =>
      useProjectData({
        settings: { projectName: 'old', saveMode: 'folder', aspectRatio: '16:9' },
        setSettings: vi.fn(),
        scenes: [{ id: 's1' }],
        references: [],
        setScenes,
        setReferences: vi.fn(),
        videoScenes: [],
        setVideoScenes: vi.fn(),
        framePairs: [],
        setFramePairs: vi.fn(),
        selectedStyleRefId: null,
        setSelectedStyleRefId: vi.fn(),
        // srtTrack 50 라인 가지고 있는 직전 프로젝트
        srtTrack: new Array(50).fill(0).map((_, i) => ({
          id: `sub_${i + 1}`, startTime: i, endTime: i + 1, text: `line${i}`,
        })),
        setSrtTrack,
        openSettings: vi.fn(),
        onAudioSwitch: null,
        flowAPI: null,
      })
    )

    await act(async () => {
      await result.current.handleProjectChange('new-project', { isNewProject: true })
    })

    // setSrtTrack([]) 호출되어야 함 (옛 srtTrack 50 라인 누수 방지)
    expect(setSrtTrack).toHaveBeenCalledWith([])
  })
})
