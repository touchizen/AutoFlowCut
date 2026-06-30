import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildProjectSavePayload, pickFlowProjectId } from '../../src/hooks/useProjectData'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    loadProjectData: vi.fn(),
    getResourcePath: vi.fn(),
    readResource: vi.fn(),
    readHistoryMetadata: vi.fn(),
    getHistory: vi.fn(),
    projectExists: vi.fn(),
    saveProjectData: vi.fn(),
    ensurePermission: vi.fn(),
  },
}))

vi.mock('../../src/services/mediaSync', () => ({
  syncVideosIntoScenes: vi.fn(),
}))

vi.mock('../../src/services/videoRecovery', () => ({
  recoverInFlightVideos: vi.fn(),
}))

import { renderHook, act } from '@testing-library/react'
import { useProjectData } from '../../src/hooks/useProjectData'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'

const base = {
  srtTrack: [], scenes: [], references: [], videoScenes: [], framePairs: [],
  settings: { aspectRatio: '16:9', defaultDuration: 5 },
  audioFolderPath: null, selectedStyleRefId: null,
}

describe('buildProjectSavePayload — flowProjectId inclusion', () => {
  it('includes flowProjectId only when truthy', () => {
    const p = buildProjectSavePayload({ ...base, flowProjectId: 'flow-xyz' })
    expect(p.flowProjectId).toBe('flow-xyz')
  })
  it('omits flowProjectId when falsy (preserve existing saved value)', () => {
    expect('flowProjectId' in buildProjectSavePayload({ ...base, flowProjectId: null })).toBe(false)
    expect('flowProjectId' in buildProjectSavePayload({ ...base, flowProjectId: '' })).toBe(false)
    expect('flowProjectId' in buildProjectSavePayload({ ...base })).toBe(false)
  })
  it('carries the canonical fields (schemaVersion 2 etc.)', () => {
    const p = buildProjectSavePayload({ ...base })
    expect(p.schemaVersion).toBe(2)
    expect(p.settings).toEqual({ aspectRatio: '16:9', defaultDuration: 5 })
    expect(p.selectedStyleRefId).toBe(null)
  })
})

describe('pickFlowProjectId — restore', () => {
  it('returns the saved id', () => {
    expect(pickFlowProjectId({ flowProjectId: 'flow-xyz' })).toBe('flow-xyz')
  })
  it('returns null when absent/empty/nullish data', () => {
    expect(pickFlowProjectId({})).toBe(null)
    expect(pickFlowProjectId({ flowProjectId: '' })).toBe(null)
    expect(pickFlowProjectId(null)).toBe(null)
    expect(pickFlowProjectId(undefined)).toBe(null)
  })
  it('round-trips with buildProjectSavePayload', () => {
    const saved = buildProjectSavePayload({ ...base, flowProjectId: 'rt-1' })
    expect(pickFlowProjectId(saved)).toBe('rt-1')
  })
})

// ---------------------------------------------------------------------------
// #R4-2 regression: handleProjectChange must pass flowProjectId as 9th arg
// when saving the OLD project before switching.
// ---------------------------------------------------------------------------
describe('#R4-2: handleProjectChange — flowProjectId preserved on save during switch', () => {
  afterEach(() => {
    delete window.electronAPI
  })

  it('includes flowProjectId in the save payload when switching away from a flow-bound project', async () => {
    vi.resetAllMocks()
    localStorage.clear()

    fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
    fileSystemAPI.readResource.mockResolvedValue({ success: false })
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })
    fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
    fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
    fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
    fileSystemAPI.projectExists.mockResolvedValue(true)

    // auto-restore will load 'old-project' which has flowProjectId: 'my-flow-id'
    const OLD_PROJECT_DATA = {
      success: true,
      data: {
        flowProjectId: 'my-flow-id',
        scenes: [],
        references: [],
        settings: { aspectRatio: '16:9' },
        videoScenes: [],
        framePairs: [],
        srtTrack: [],
        schemaVersion: 2,
      },
    }
    fileSystemAPI.loadProjectData.mockResolvedValue(OLD_PROJECT_DATA)
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'old-project', saveMode: 'folder' }))

    window.electronAPI = {
      setStartupProject: vi.fn(),
      openFlowProject: vi.fn().mockResolvedValue({ success: true, already: true }),
    }

    const { result } = renderHook(() =>
      useProjectData({
        settings: { projectName: 'old-project', saveMode: 'folder', aspectRatio: '16:9' },
        setSettings: vi.fn(),
        scenes: [], references: [], setScenes: vi.fn(), setReferences: vi.fn(),
        videoScenes: [], setVideoScenes: vi.fn(),
        framePairs: [], setFramePairs: vi.fn(),
        selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
        srtTrack: [], setSrtTrack: vi.fn(),
        openSettings: vi.fn(), onAudioSwitch: vi.fn(),
        genAPI: null,
        mode: 'flow',
      })
    )

    // Wait for auto-restore to complete — flowProjectId state gets set to 'my-flow-id'
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    // Confirm flowProjectId was restored
    expect(result.current.flowProjectId).toBe('my-flow-id')

    // Now mock the NEXT project being loaded after switch (no flowProjectId)
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: {
        scenes: [],
        references: [],
        settings: { aspectRatio: '16:9' },
        videoScenes: [],
        framePairs: [],
        srtTrack: [],
        schemaVersion: 2,
      },
    })

    // Clear save mock AFTER restore (restore may have triggered a save)
    fileSystemAPI.saveProjectData.mockClear()

    // Switch to next-project — this triggers saveCurrentProject(... flowProjectId) first
    await act(async () => {
      await result.current.handleProjectChange('next-project')
    })

    // The first saveProjectData call (saving OLD project before switch) must include flowProjectId
    expect(fileSystemAPI.saveProjectData).toHaveBeenCalled()
    const firstCallPayload = fileSystemAPI.saveProjectData.mock.calls[0][1]
    expect(firstCallPayload).toMatchObject({ flowProjectId: 'my-flow-id' })
  })
})
