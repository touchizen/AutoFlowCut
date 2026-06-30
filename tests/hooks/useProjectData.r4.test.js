/**
 * useProjectData.r4.test.js — regression tests for Codex R4 batch H fixes.
 *
 * #R4-1: recovery NOT called in flow mode when openFlowProject fails /
 *        recovery IS called when it succeeds (tryAutoRestore & handleProjectChange).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProjectData } from '../../src/hooks/useProjectData'

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
import { recoverInFlightVideos } from '../../src/services/videoRecovery'

// In-flight video scene fixture — status 'generating' gets reset to 'pending' on load,
// but 'pending' also triggers recovery (the check is: status === 'generating' || 'pending').
// We use 'pending' directly to avoid the reset complication.
const IN_FLIGHT_VIDEO = { id: 'v1', generationId: 'g1', status: 'pending' }

const FLOW_PROJECT_DATA = {
  success: true,
  data: {
    flowProjectId: 'fp-1',
    scenes: [],
    references: [],
    settings: { aspectRatio: '16:9' },
    videoScenes: [IN_FLIGHT_VIDEO],
    framePairs: [],
    srtTrack: [],
    schemaVersion: 2,
  },
}

const PLAIN_PROJECT_DATA = {
  success: true,
  data: {
    scenes: [],
    references: [],
    settings: { aspectRatio: '16:9' },
    videoScenes: [IN_FLIGHT_VIDEO],
    framePairs: [],
    srtTrack: [],
    schemaVersion: 2,
  },
}

function makeGenAPI() {
  return {
    checkVideoStatus: vi.fn().mockResolvedValue({ success: true, statuses: [] }),
    downloadVideo: vi.fn().mockResolvedValue({ success: true }),
    fetchMedia: vi.fn().mockResolvedValue({ success: true }),
    getAccessToken: vi.fn().mockResolvedValue('tok'),
  }
}

function makeHookProps(overrides = {}) {
  return {
    settings: { projectName: 'old', saveMode: 'folder', aspectRatio: '16:9' },
    setSettings: vi.fn(),
    scenes: [], references: [], setScenes: vi.fn(), setReferences: vi.fn(),
    videoScenes: [], setVideoScenes: vi.fn(),
    framePairs: [], setFramePairs: vi.fn(),
    selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
    srtTrack: [], setSrtTrack: vi.fn(),
    openSettings: vi.fn(), onAudioSwitch: vi.fn(),
    genAPI: null,
    mode: 'flow',
    ...overrides,
  }
}

function commonBeforeEach() {
  vi.resetAllMocks()
  localStorage.clear()
  fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
  fileSystemAPI.readResource.mockResolvedValue({ success: false })
  fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })
  fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
  fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
  fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
  fileSystemAPI.projectExists.mockResolvedValue(true)
}

async function waitForEffect(ms = 50) {
  await act(async () => {
    await new Promise(r => setTimeout(r, ms))
  })
}

describe('#R4-1: tryAutoRestore — flow mode, recovery gated on open confirmation', () => {
  beforeEach(() => {
    commonBeforeEach()
    fileSystemAPI.loadProjectData.mockResolvedValue(FLOW_PROJECT_DATA)
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'prev', saveMode: 'folder' }))
  })

  afterEach(() => {
    delete window.electronAPI
  })

  it('does NOT call recoverInFlightVideos when openFlowProject returns success:false', async () => {
    window.electronAPI = {
      setStartupProject: vi.fn(),
      openFlowProject: vi.fn().mockResolvedValue({ success: false }),
    }
    const genAPI = makeGenAPI()
    await act(async () => {
      renderHook(() => useProjectData(makeHookProps({ mode: 'flow', genAPI })))
      await new Promise(r => setTimeout(r, 50))
    })
    expect(recoverInFlightVideos).not.toHaveBeenCalled()
  })

  it('DOES call recoverInFlightVideos when openFlowProject returns success:true (already)', async () => {
    window.electronAPI = {
      setStartupProject: vi.fn(),
      openFlowProject: vi.fn().mockResolvedValue({ success: true, already: true }),
    }
    const genAPI = makeGenAPI()
    await act(async () => {
      renderHook(() => useProjectData(makeHookProps({ mode: 'flow', genAPI })))
      await new Promise(r => setTimeout(r, 50))
    })
    expect(recoverInFlightVideos).toHaveBeenCalled()
  })

  it('does NOT call recoverInFlightVideos when openFlowProject throws', async () => {
    window.electronAPI = {
      setStartupProject: vi.fn(),
      openFlowProject: vi.fn().mockRejectedValue(new Error('ipc error')),
    }
    const genAPI = makeGenAPI()
    await act(async () => {
      renderHook(() => useProjectData(makeHookProps({ mode: 'flow', genAPI })))
      await new Promise(r => setTimeout(r, 50))
    })
    expect(recoverInFlightVideos).not.toHaveBeenCalled()
  })
})

describe('#R4-1: tryAutoRestore — API mode always calls recovery immediately', () => {
  beforeEach(() => {
    commonBeforeEach()
    fileSystemAPI.loadProjectData.mockResolvedValue(PLAIN_PROJECT_DATA)
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'prev', saveMode: 'folder' }))
  })

  afterEach(() => {
    delete window.electronAPI
  })

  it('calls recoverInFlightVideos in API mode (no openFlowProject required)', async () => {
    window.electronAPI = { setStartupProject: vi.fn() }
    const genAPI = makeGenAPI()
    await act(async () => {
      renderHook(() => useProjectData(makeHookProps({ mode: 'api', genAPI })))
      await new Promise(r => setTimeout(r, 50))
    })
    expect(recoverInFlightVideos).toHaveBeenCalled()
  })
})

describe('#R4-1: handleProjectChange — flow mode, recovery gated on open confirmation', () => {
  beforeEach(() => {
    commonBeforeEach()
    // No prev project in localStorage — auto-restore takes fast path
    // loadProjectData: first two calls return nothing (early meta + load), then return FLOW_PROJECT_DATA on switch
    fileSystemAPI.loadProjectData
      .mockResolvedValueOnce({ success: false }) // early meta for declareStartup
      .mockResolvedValueOnce({ success: false }) // loadProjectWithResources for empty project
      .mockResolvedValue(FLOW_PROJECT_DATA) // switch to 'next' project
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'old', saveMode: 'folder' }))
  })

  afterEach(() => {
    delete window.electronAPI
  })

  it('does NOT call recoverInFlightVideos when openFlowProject returns success:false', async () => {
    const openFlowProject = vi.fn().mockResolvedValue({ success: false })
    window.electronAPI = { setStartupProject: vi.fn(), openFlowProject }
    const genAPI = makeGenAPI()
    const { result } = renderHook(() => useProjectData(makeHookProps({ mode: 'flow', genAPI })))
    await waitForEffect()
    vi.clearAllMocks()
    await act(async () => {
      await result.current.handleProjectChange('next')
    })
    expect(recoverInFlightVideos).not.toHaveBeenCalled()
  })

  it('DOES call recoverInFlightVideos when openFlowProject returns success:true (already)', async () => {
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true })
    window.electronAPI = { setStartupProject: vi.fn(), openFlowProject }
    const genAPI = makeGenAPI()
    const { result } = renderHook(() => useProjectData(makeHookProps({ mode: 'flow', genAPI })))
    await waitForEffect()
    vi.clearAllMocks()
    await act(async () => {
      await result.current.handleProjectChange('next')
    })
    expect(recoverInFlightVideos).toHaveBeenCalled()
  })
})
