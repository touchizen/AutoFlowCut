import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { isFlowOpenConfirmed, shouldClearFlowMapping, useProjectData } from '../../src/hooks/useProjectData'

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

import { fileSystemAPI } from '../../src/hooks/useFileSystem'

describe('isFlowOpenConfirmed', () => {
  it('returns true when result.already is set', () => {
    expect(isFlowOpenConfirmed({ success: true, already: true }, 'proj-123')).toBe(true)
  })
  it('returns true when url contains flowProjectId', () => {
    expect(isFlowOpenConfirmed({ success: true, url: 'https://labs.google/fx/tools/flow/project/proj-123' }, 'proj-123')).toBe(true)
  })
  it('returns false when url does not contain flowProjectId', () => {
    expect(isFlowOpenConfirmed({ success: true, url: 'https://labs.google/fx/tools/flow/project/other-id' }, 'proj-123')).toBe(false)
  })
  it('returns false when result is null', () => {
    expect(isFlowOpenConfirmed(null, 'proj-123')).toBe(false)
  })
  it('returns false when result.success is false', () => {
    expect(isFlowOpenConfirmed({ success: false, url: 'https://labs.google/fx/tools/flow/project/proj-123' }, 'proj-123')).toBe(false)
  })
  it('returns false when flowProjectId is null', () => {
    expect(isFlowOpenConfirmed({ success: true, already: true }, null)).toBe(false)
  })
  it('returns false when flowProjectId is empty string', () => {
    expect(isFlowOpenConfirmed({ success: true, already: true }, '')).toBe(false)
  })
})

describe('shouldClearFlowMapping', () => {
  it('returns true when errorPage is set', () => {
    expect(shouldClearFlowMapping({ success: false, errorPage: true })).toBe(true)
  })
  it('returns false for transient failure (no errorPage)', () => {
    expect(shouldClearFlowMapping({ success: false })).toBe(false)
    expect(shouldClearFlowMapping({ success: false, errorPage: false })).toBe(false)
  })
  it('returns false for null', () => {
    expect(shouldClearFlowMapping(null)).toBe(false)
  })
  it('returns false for successful open', () => {
    expect(shouldClearFlowMapping({ success: true, url: 'https://...' })).toBe(false)
  })
})

/**
 * Cross-mode API-invariance regression tests for handleProjectChange + tryAutoRestore.
 *
 * Bug: handleProjectChange unconditionally called setFlowProjectReady(false) +
 * openFlowProject whenever a loaded project had a saved flowProjectId — regardless
 * of mode. In API mode, openFlowProject returns {success:false}, so
 * isFlowOpenConfirmed → false and flowProjectReady got stuck false, blocking
 * generation.
 *
 * Fix: the flowProjectReady=false / openFlowProject path is flow-mode-only.
 * In API mode, flowProjectReady stays true after project switch.
 */
describe('handleProjectChange — flowProjectReady mode-gating', () => {
  function makeProjectData(data = {}) {
    return {
      success: true,
      data: { scenes: [], references: [], settings: { aspectRatio: '16:9' }, ...data },
    }
  }

  function setupHook({ mode = 'api' } = {}) {
    const setSettings = vi.fn()
    const { result } = renderHook(() =>
      useProjectData({
        settings: { projectName: 'old', saveMode: 'folder', aspectRatio: '16:9' },
        setSettings,
        scenes: [], references: [], setScenes: vi.fn(), setReferences: vi.fn(),
        videoScenes: [], setVideoScenes: vi.fn(),
        framePairs: [], setFramePairs: vi.fn(),
        selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
        openSettings: vi.fn(), onAudioSwitch: vi.fn(), genAPI: null,
        mode, // NEW param being added by the fix
      }),
    )
    return result
  }

  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
    fileSystemAPI.readResource.mockResolvedValue({ success: false })
    fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
    fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
    // No openFlowProject on window in API mode tests — absence causes the bug path to fail
    if (typeof window !== 'undefined') {
      delete window.electronAPI
    }
  })

  it('[API mode] flowProjectReady stays true after switching to a project WITH a saved flowProjectId', async () => {
    // In API mode, openFlowProject returning null/undefined (no electronAPI) must NOT
    // leave flowProjectReady stuck at false — generation would be permanently blocked.
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.loadProjectData.mockResolvedValue(
      makeProjectData({ flowProjectId: 'flow-proj-xyz' }),
    )
    // getResourcePath is called for each scene (0 scenes here) — no-op

    const result = setupHook({ mode: 'api' })

    await act(async () => {
      await result.current.handleProjectChange('next-project')
    })

    // After switching to a project that has a saved flowProjectId, in API mode
    // flowProjectReady must remain true (not blocked).
    expect(result.current.flowProjectReady).toBe(true)
  })

  it('[API mode] openFlowProject is NOT called during project switch', async () => {
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.loadProjectData.mockResolvedValue(
      makeProjectData({ flowProjectId: 'flow-proj-xyz' }),
    )
    const openFlowProject = vi.fn().mockResolvedValue({ success: false })
    window.electronAPI = { openFlowProject }

    const result = setupHook({ mode: 'api' })

    await act(async () => {
      await result.current.handleProjectChange('next-project')
    })

    expect(openFlowProject).not.toHaveBeenCalled()
  })

  it('[flow mode] flowProjectReady is set false then confirmed when openFlowProject succeeds', async () => {
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.loadProjectData.mockResolvedValue(
      makeProjectData({ flowProjectId: 'flow-proj-xyz' }),
    )
    const openFlowProject = vi.fn().mockResolvedValue({
      success: true,
      url: 'https://labs.google/fx/tools/flow/project/flow-proj-xyz',
    })
    window.electronAPI = { openFlowProject }

    const result = setupHook({ mode: 'flow' })

    await act(async () => {
      await result.current.handleProjectChange('next-project')
    })

    // flow mode: openFlowProject is called and confirmed → ready = true
    expect(openFlowProject).toHaveBeenCalledWith({ flowProjectId: 'flow-proj-xyz' })
    expect(result.current.flowProjectReady).toBe(true)
  })

  it('[flow mode] flowProjectReady stays false when openFlowProject returns success:false (transient)', async () => {
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.loadProjectData.mockResolvedValue(
      makeProjectData({ flowProjectId: 'flow-proj-xyz' }),
    )
    // openFlowProject fails (e.g. view not ready yet)
    const openFlowProject = vi.fn().mockResolvedValue({ success: false })
    window.electronAPI = { openFlowProject }

    const result = setupHook({ mode: 'flow' })

    await act(async () => {
      await result.current.handleProjectChange('next-project')
    })

    expect(result.current.flowProjectReady).toBe(false)
  })
})
