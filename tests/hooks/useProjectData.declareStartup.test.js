/**
 * declareStartup — tryAutoRestore が流ProjectId を main に早期通知する動作
 *
 * setStartupProject は tryAutoRestore 内の重いリソースロード (loadProjectWithResources)
 * より前に呼ばれる。これにより main の 30s startup gate がタイムアウトする前に
 * flowProjectId を受け取り、重複 Flow プロジェクトの生成を防ぐ。
 *
 * テスト対象: src/hooks/useProjectData.js の tryAutoRestore → declareStartup 呼び出し
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

// ── helper: mount the hook in a jsdom context ──────────────────────────────
// We need to test the useEffect inside useProjectData. Because the hook mounts
// on the same render loop, we use renderHook + act from @testing-library/react.
import { renderHook, act } from '@testing-library/react'
import { useProjectData } from '../../src/hooks/useProjectData'

function makeHookProps(overrides = {}) {
  return {
    settings: { projectName: null, saveMode: 'folder', aspectRatio: '16:9', defaultDuration: 3 },
    setSettings: vi.fn(),
    scenes: [], references: [], setScenes: vi.fn(), setReferences: vi.fn(),
    videoScenes: [], setVideoScenes: vi.fn(),
    framePairs: [], setFramePairs: vi.fn(),
    selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
    srtTrack: [], setSrtTrack: vi.fn(),
    openSettings: vi.fn(), onAudioSwitch: vi.fn(),
    genAPI: null,
    ...overrides,
  }
}

describe('declareStartup — setStartupProject early call in tryAutoRestore', () => {
  let setStartupProject

  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()

    // Default stubs — override per-test as needed
    fileSystemAPI.readResource.mockResolvedValue({ success: false })
    fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
    fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
    fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })

    // Wire up window.electronAPI.setStartupProject as a spy
    setStartupProject = vi.fn()
    window.electronAPI = { setStartupProject }
  })

  afterEach(() => {
    delete window.electronAPI
  })

  it('calls setStartupProject({ flowProjectId: <id> }) when saved project has a flowProjectId — BEFORE heavy load', async () => {
    const FLOW_ID = 'flow-proj-abc123'

    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'myproject', saveMode: 'folder' }))
    fileSystemAPI.projectExists.mockResolvedValue(true)

    // loadProjectData is called TWICE:
    //   1. Early meta-only read in declareStartup (before loadProjectWithResources)
    //   2. Inside loadProjectWithResources itself
    // Both return the same payload with the flowProjectId.
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: {
        flowProjectId: FLOW_ID,
        scenes: [],
        references: [],
        videoScenes: [],
        framePairs: [],
        srtTrack: [],
        settings: { aspectRatio: '16:9' },
        schemaVersion: 2,
      },
    })

    await act(async () => {
      renderHook(() => useProjectData(makeHookProps()))
      // Give the async effect time to run
      await new Promise(r => setTimeout(r, 50))
    })

    // setStartupProject must have been called with the saved flowProjectId
    expect(setStartupProject).toHaveBeenCalledWith({ flowProjectId: FLOW_ID })
  })

  it('calls setStartupProject({ flowProjectId: null }) when saved project has NO flowProjectId', async () => {
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'newproject', saveMode: 'folder' }))
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: {
        scenes: [],
        references: [],
        videoScenes: [],
        framePairs: [],
        srtTrack: [],
        settings: { aspectRatio: '16:9' },
        schemaVersion: 2,
        // no flowProjectId field
      },
    })

    await act(async () => {
      renderHook(() => useProjectData(makeHookProps()))
      await new Promise(r => setTimeout(r, 50))
    })

    expect(setStartupProject).toHaveBeenCalledWith({ flowProjectId: null })
  })

  it('calls setStartupProject({ flowProjectId: null }) when NO saved project exists in localStorage', async () => {
    // No entry in localStorage — hook should still call declareStartup(null)
    // so main's gate resolves instead of waiting 30s.

    await act(async () => {
      renderHook(() => useProjectData(makeHookProps()))
      await new Promise(r => setTimeout(r, 50))
    })

    expect(setStartupProject).toHaveBeenCalledWith({ flowProjectId: null })
  })

  it('calls setStartupProject({ flowProjectId: null }) when projectName key missing in localStorage settings', async () => {
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ saveMode: 'folder' })) // no projectName

    await act(async () => {
      renderHook(() => useProjectData(makeHookProps()))
      await new Promise(r => setTimeout(r, 50))
    })

    expect(setStartupProject).toHaveBeenCalledWith({ flowProjectId: null })
  })

  it('#R24-1: syncs startup-hint to the switched project flowProjectId on handleProjectChange', async () => {
    const FLOW_ID = 'flow-switch-target-999'
    // No saved project → auto-restore calls declareStartup(null) once at mount.
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: { flowProjectId: FLOW_ID, scenes: [], references: [], videoScenes: [], framePairs: [], srtTrack: [], settings: { aspectRatio: '16:9' }, schemaVersion: 2 },
    })

    let hook
    await act(async () => {
      hook = renderHook(() => useProjectData(makeHookProps()))
      await new Promise(r => setTimeout(r, 50))
    })

    setStartupProject.mockClear()  // ignore the mount-time declareStartup(null)

    await act(async () => {
      await hook.result.current.handleProjectChange('switched-project', {})
      await new Promise(r => setTimeout(r, 20))
    })

    // Switching projects (even in API mode) must re-declare the new project's flowProjectId
    // so a later first Flow attach doesn't open the previous project from a stale hint.
    expect(setStartupProject).toHaveBeenCalledWith({ flowProjectId: FLOW_ID })
  })

  it('is a no-op (does not throw) when window.electronAPI is absent (jsdom/api mode)', async () => {
    delete window.electronAPI  // simulate api mode / pure jsdom

    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'p', saveMode: 'folder' }))
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: { flowProjectId: 'f1', scenes: [], references: [], settings: {} },
    })

    await expect(act(async () => {
      renderHook(() => useProjectData(makeHookProps()))
      await new Promise(r => setTimeout(r, 50))
    })).resolves.not.toThrow()
  })
})

// ── loadProjectWithResources flowProjectId passthrough ─────────────────────
describe('loadProjectWithResources — flowProjectId in returned data', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    fileSystemAPI.readResource.mockResolvedValue({ success: false })
    fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
    fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })
  })

  it('surfaces flowProjectId from project.json', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: { flowProjectId: 'flow-xyz', scenes: [], references: [], settings: {} },
    })
    const result = await loadProjectWithResources('myproject')
    expect(result.flowProjectId).toBe('flow-xyz')
  })

  it('returns null flowProjectId when absent', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: { scenes: [], references: [], settings: {} },
    })
    const result = await loadProjectWithResources('myproject')
    expect(result.flowProjectId).toBeNull()
  })
})
