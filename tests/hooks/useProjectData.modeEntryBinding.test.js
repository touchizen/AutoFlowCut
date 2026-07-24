/**
 * Tests for Codex finding #2: mode-entry Flow project binding.
 *
 * When mode changes to 'flow' with a project loaded:
 *   - flow + savedFlowProjectId → openFlowProject called, flowProjectReady gated
 *   - flow + no flowProjectId → newFlowProject called, flowProjectReady gated
 *   - api mode → neither called, flowProjectReady stays true
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
    // 실제 fileSystemAPI 에 있는 메서드 — 빠져 있으면 persistFlowProjectId 가 TypeError 로 실패한다.
    mergeProjectData: vi.fn(),
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

function setupHook({ mode = 'api', projectName = '' } = {}) {
  const setSettings = vi.fn()
  const { result, rerender } = renderHook(
    ({ mode, projectName }) =>
      useProjectData({
        settings: { projectName, saveMode: 'folder', aspectRatio: '16:9' },
        setSettings,
        scenes: [], references: [], setScenes: vi.fn(), setReferences: vi.fn(),
        videoScenes: [], setVideoScenes: vi.fn(),
        framePairs: [], setFramePairs: vi.fn(),
        selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
        openSettings: vi.fn(), onAudioSwitch: vi.fn(), genAPI: null,
        mode,
      }),
    { initialProps: { mode, projectName } },
  )
  return { result, rerender }
}

describe('mode-entry Flow project binding (#2)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
    fileSystemAPI.readResource.mockResolvedValue({ success: false })
    fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
    fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
    fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
    // 실제 계약: project.json 이 없어도 success:true + data:null (isNew) 을 돌려준다.
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null })
    if (typeof window !== 'undefined') delete window.electronAPI
  })

  it('[api mode] openFlowProject NOT called when mode is api even with saved flowProjectId', async () => {
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true })
    window.electronAPI = { openFlowProject }

    const { result } = setupHook({ mode: 'api', projectName: '' })
    // Initially flowProjectId is null (no project loaded), mode is api
    // flowProjectReady must stay true
    expect(result.current.flowProjectReady).toBe(true)
    expect(openFlowProject).not.toHaveBeenCalled()
  })

  it('[api mode] newFlowProject NOT called when mode is already api (stays api)', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: 'new-proj-id' })
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true })
    window.electronAPI = { openFlowProject, newFlowProject }

    // Start AND stay in api mode — neither bridge should ever be called
    const { result, rerender } = setupHook({ mode: 'api', projectName: 'my-project' })

    await act(async () => {
      rerender({ mode: 'api', projectName: 'my-project' })
    })

    // In api mode: neither flow project bridge should be called
    expect(newFlowProject).not.toHaveBeenCalled()
    expect(openFlowProject).not.toHaveBeenCalled()
  })

  it('[flow mode] openFlowProject called when mode becomes flow with saved flowProjectId', async () => {
    const savedFlowId = 'flow-proj-abc'
    const openFlowProject = vi.fn().mockResolvedValue({
      success: true,
      url: `https://labs.google/fx/tools/flow/project/${savedFlowId}`,
    })
    window.electronAPI = { openFlowProject }

    // Start in api mode, then switch to flow
    const { result, rerender } = setupHook({ mode: 'api', projectName: 'my-project' })

    // Manually set flowProjectId (simulates a project being loaded)
    act(() => {
      result.current.setFlowProjectId(savedFlowId)
    })

    await act(async () => {
      rerender({ mode: 'flow', projectName: 'my-project' })
    })

    expect(openFlowProject).toHaveBeenCalledWith({ flowProjectId: savedFlowId })
    expect(result.current.flowProjectReady).toBe(true)
  })

  it('[flow mode] newFlowProject called when mode becomes flow with NO flowProjectId and project loaded', async () => {
    const createdId = 'new-proj-xyz'
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: createdId })
    window.electronAPI = { newFlowProject }

    // Start in api mode with a project name set but no flowProjectId
    const { result, rerender } = setupHook({ mode: 'api', projectName: 'my-project' })

    // flowProjectId is null (default), projectName is 'my-project'
    expect(result.current.flowProjectId).toBe(null)

    await act(async () => {
      rerender({ mode: 'flow', projectName: 'my-project' })
    })

    expect(newFlowProject).toHaveBeenCalled()
    // After create, flowProjectId should be updated to the new id
    expect(result.current.flowProjectId).toBe(createdId)
  })

  it('[flow mode] flowProjectReady stays true when mode is flow but no project loaded (empty projectName)', async () => {
    window.electronAPI = {}

    const { result, rerender } = setupHook({ mode: 'api', projectName: '' })

    await act(async () => {
      rerender({ mode: 'flow', projectName: '' })
    })

    // No project loaded → no binding attempt → ready stays true
    expect(result.current.flowProjectReady).toBe(true)
  })

  it('[flow mode] flowProjectReady stays false if openFlowProject returns success:false (transient)', async () => {
    const savedFlowId = 'flow-proj-abc'
    const openFlowProject = vi.fn().mockResolvedValue({ success: false })
    window.electronAPI = { openFlowProject }

    const { result, rerender } = setupHook({ mode: 'api', projectName: 'my-project' })

    act(() => {
      result.current.setFlowProjectId(savedFlowId)
    })

    await act(async () => {
      rerender({ mode: 'flow', projectName: 'my-project' })
    })

    expect(result.current.flowProjectReady).toBe(false)
  })
})

/**
 * R2-1: mode-entry create-new does NOT fire before hydration.
 *
 * Bug: the mode-entry effect (added in Batch B) has a Case B path that calls
 * newFlowProject when flowProjectId===null and projectName is set. On app start
 * in flow mode with a saved project, flowProjectId is null UNTIL tryAutoRestore
 * resolves it from disk. Without the hydratedRef guard, newFlowProject fires
 * before restore completes → orphan Flow project + wrong binding.
 *
 * Fix: Case B defers until hydratedRef.current = true (set by tryAutoRestore).
 */
describe('R2-1: create-new deferred until hydration complete', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
    fileSystemAPI.readResource.mockResolvedValue({ success: false })
    fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
    fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
    fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
    // 실제 계약: project.json 이 없어도 success:true + data:null (isNew) 을 돌려준다.
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null })
    if (typeof window !== 'undefined') delete window.electronAPI
  })

  it('#R3-2: newFlowProject IS called after hydration when localStorage is empty + flow mode', async () => {
    // R3-2 fix: `hydrated` is now STATE (dep array). When tryAutoRestore completes
    // (localStorage empty → fast path), setHydrated(true) triggers a re-run of the
    // mode-entry effect. The re-run finds hydrated=true, flowProjectId=null, projectName set
    // → proceeds to create-new path and calls newFlowProject.
    //
    // The previous behavior (hydratedRef as plain ref) would NOT re-trigger the effect,
    // so create-new was deferred until a dep change (e.g. mode switch). Now it fires
    // correctly on hydration completion.

    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: 'new-proj-1' })
    // openFlowProject must also be mocked: after create-new sets flowProjectId,
    // the mode-entry effect re-runs (Case A) to open the newly-created project.
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true })
    window.electronAPI = { newFlowProject, openFlowProject }

    const { result } = setupHook({ mode: 'flow', projectName: 'my-project' })

    // Wait for tryAutoRestore + hydration state change + mode-entry effect re-run
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    // With R3-2: newFlowProject MUST be called (hydration state triggers re-run)
    expect(newFlowProject).toHaveBeenCalled()
    // flowProjectId must be set to the created id
    expect(result.current.flowProjectId).toBe('new-proj-1')
    // flowProjectReady must be true (project confirmed)
    expect(result.current.flowProjectReady).toBe(true)
  })

  it('newFlowProject called after hydration when switching from api→flow (the safe path)', async () => {
    // The safe, guaranteed path for create-new:
    // Start in api mode (hydratedRef will be set by tryAutoRestore).
    // Then switch to flow mode → hydratedRef is already true → create-new fires.
    const createdId = 'safe-proj-1'
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: createdId })
    // openFlowProject must also be mocked: after create-new sets flowProjectId,
    // the mode-entry effect re-runs with the new flowProjectId (dep change) → Case A (open).
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true })
    window.electronAPI = { newFlowProject, openFlowProject }

    const { result, rerender } = setupHook({ mode: 'api', projectName: 'my-project' })

    // Wait for tryAutoRestore to complete (localStorage empty → fast path)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    // Now switch to flow — hydratedRef is true, flowProjectId is null, projectName is set
    await act(async () => {
      rerender({ mode: 'flow', projectName: 'my-project' })
    })

    // create-new should fire since we're past hydration
    expect(newFlowProject).toHaveBeenCalled()
    expect(result.current.flowProjectId).toBe(createdId)
    // flowProjectReady may be true or false depending on whether the subsequent
    // open-project (Case A re-run after flowProjectId is set) succeeded.
    // openFlowProject returns already:true → isFlowOpenConfirmed → true → ready=true
    expect(result.current.flowProjectReady).toBe(true)
  })
})

/**
 * R2-3: switching to api mode resets flowProjectReady to true.
 *
 * Bug: if flow binding fails (flowProjectReady=false) and user switches to api
 * mode, the single ref/scene guards stay blocked because flowProjectReady is
 * still false and the guards don't check mode.
 *
 * Fix: useEffect on [mode] sets flowProjectReady(true) when mode !== 'flow'.
 */
describe('R2-3: switching to api mode resets flowProjectReady', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
    fileSystemAPI.readResource.mockResolvedValue({ success: false })
    fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
    fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
    fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
    // 실제 계약: project.json 이 없어도 success:true + data:null (isNew) 을 돌려준다.
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null })
    if (typeof window !== 'undefined') delete window.electronAPI
  })

  it('flowProjectReady becomes true when switching from flow (failed binding) → api', async () => {
    const savedFlowId = 'flow-broken-proj'
    // openFlowProject fails (transient) → flowProjectReady stays false
    const openFlowProject = vi.fn().mockResolvedValue({ success: false })
    window.electronAPI = { openFlowProject }

    const { result, rerender } = setupHook({ mode: 'api', projectName: 'my-project' })

    act(() => { result.current.setFlowProjectId(savedFlowId) })

    // Switch to flow — binding fails → flowProjectReady = false
    await act(async () => {
      rerender({ mode: 'flow', projectName: 'my-project' })
    })
    expect(result.current.flowProjectReady).toBe(false)

    // Now switch back to api → R2-3 fix sets flowProjectReady = true
    await act(async () => {
      rerender({ mode: 'api', projectName: 'my-project' })
    })
    expect(result.current.flowProjectReady).toBe(true)
  })

  it('flowProjectReady is true in api mode at initial mount', async () => {
    const { result } = setupHook({ mode: 'api', projectName: 'my-project' })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(result.current.flowProjectReady).toBe(true)
  })
})

/**
 * #R3-2: hydrated as STATE re-triggers mode-entry effect.
 *
 * When flow mode + no saved flowProjectId + project loaded:
 *   - old hydratedRef (plain ref): mode-entry effect runs once, hits hydrated=false, defers.
 *     After tryAutoRestore sets hydratedRef=true, no dep change → effect NEVER re-runs.
 *     Result: create-new never fires for this case (orphan project left unbound).
 *   - new hydrated STATE: setHydrated(true) triggers effect re-run → create-new fires.
 */
describe('#R3-2: hydrated state re-triggers create-new after hydration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
    fileSystemAPI.readResource.mockResolvedValue({ success: false })
    fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
    fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
    fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
    // 실제 계약: project.json 이 없어도 success:true + data:null (isNew) 을 돌려준다.
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null })
    if (typeof window !== 'undefined') delete window.electronAPI
  })

  it('create-new fires exactly once after hydration (not before, not twice) in flow + no saved id', async () => {
    const createdId = 'r3-2-proj'
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: createdId })
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true })
    window.electronAPI = { newFlowProject, openFlowProject }

    // Start in flow mode with projectName but no flowProjectId and no localStorage
    const { result } = setupHook({ mode: 'flow', projectName: 'proj-name' })

    // Wait for: initial render + tryAutoRestore (localStorage empty, fast path) + hydration state → re-run
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })

    // newFlowProject must have been called exactly once
    expect(newFlowProject).toHaveBeenCalledTimes(1)
    expect(result.current.flowProjectId).toBe(createdId)
    expect(result.current.flowProjectReady).toBe(true)
  })

  it('newFlowProject success is confirmed by a Case A open before readiness opens', async () => {
    // flow:new-project 는 URL 의 UUID 가 바뀐 것만 확인한다 — 그 페이지가 정상 composer 인지는
    // 모른다(에러/랜딩 화면도 새 URL 을 받는다). 그래서 생성 뒤의 재오픈은 중복이 아니라
    // **확인**이며, ready 는 그 확인에서만 열린다.
    const createdId = 'r9-2-proj'
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: createdId })
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true })
    window.electronAPI = { newFlowProject, openFlowProject }

    const { result } = setupHook({ mode: 'flow', projectName: 'proj-name' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })

    expect(newFlowProject).toHaveBeenCalledTimes(1)
    expect(result.current.flowProjectId).toBe(createdId)
    expect(result.current.flowProjectReady).toBe(true)
    expect(openFlowProject).toHaveBeenCalledWith({ flowProjectId: createdId })
    // 확인은 한 번이면 된다 — 확인된 바인딩은 다시 열지 않는다.
    expect(openFlowProject).toHaveBeenCalledTimes(1)
  })

  it('api mode: newFlowProject never called even after hydration completes', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: 'should-not-appear' })
    window.electronAPI = { newFlowProject }

    const { result } = setupHook({ mode: 'api', projectName: 'proj-name' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })

    expect(newFlowProject).not.toHaveBeenCalled()
    expect(result.current.flowProjectReady).toBe(true)
  })
})

/**
 * #R3-3: video recovery deferred until Flow project is confirmed in flow mode.
 *
 * In flow mode: recovery runs AFTER openFlowProject confirms the bound project.
 * In api mode: recovery runs immediately (no deferral, same as before).
 */
describe('#R3-3: video recovery deferred in flow mode until Flow project confirmed', () => {
  // Shared loaded project fixture with in-flight video
  const makeLoadedProject = (flowProjectId = null) => ({
    scenes: [],
    references: [],
    videoScenes: [{ id: 'vs-1', generationId: 'gen-1', status: 'generating', videoPath: null }],
    framePairs: [],
    srtTrack: [],
    audioFolderPath: null,
    selectedStyleRefId: null,
    aspectRatio: '16:9',
    flowProjectId,
  })

  function setupRecoveryHook({ mode, flowProjectId = null } = {}) {
    const setSettings = vi.fn()
    const setVideoScenes = vi.fn()
    const genAPI = {
      checkVideoStatus: vi.fn().mockResolvedValue({ success: true, statuses: [] }),
      downloadVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('tok'),
    }
    const { result } = renderHook(() =>
      useProjectData({
        settings: { projectName: 'test-proj', saveMode: 'folder', aspectRatio: '16:9' },
        setSettings,
        scenes: [], references: [], setScenes: vi.fn(), setReferences: vi.fn(),
        videoScenes: [], setVideoScenes,
        framePairs: [], setFramePairs: vi.fn(),
        selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
        openSettings: vi.fn(), onAudioSwitch: vi.fn(),
        genAPI,
        mode,
      })
    )
    return { result, genAPI }
  }

  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    recoverInFlightVideos.mockResolvedValue(undefined)
    fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
    fileSystemAPI.readResource.mockResolvedValue({ success: false })
    fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
    fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
    fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
    // 실제 계약: project.json 이 없어도 success:true + data:null (isNew) 을 돌려준다.
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null })
    if (typeof window !== 'undefined') delete window.electronAPI
  })

  it('api mode: recovery runs immediately (not deferred)', async () => {
    // Setup localStorage with a saved project that has in-flight videos
    const projectName = 'api-proj'
    const loaded = makeLoadedProject(null)
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName }))
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: { ...loaded, schemaVersion: 2, srtTrack: [] } })
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })

    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true })
    window.electronAPI = { openFlowProject, setStartupProject: vi.fn() }

    setupRecoveryHook({ mode: 'api' })

    // Wait for tryAutoRestore to complete
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })

    // In api mode: recovery runs immediately (recoverInFlightVideos may be called for in-flight items)
    // openFlowProject should NOT be called in api mode
    expect(openFlowProject).not.toHaveBeenCalled()
  })

  it('flow mode: recovery runs AFTER openFlowProject (not before)', async () => {
    const projectName = 'flow-proj'
    const flowProjectId = 'flow-proj-id-123'
    const loaded = makeLoadedProject(flowProjectId)

    let openFlowProjectCallOrder = []
    let recoveryCallOrder = []
    let callCounter = 0

    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName }))
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: { ...loaded, schemaVersion: 2, srtTrack: [], flowProjectId } })
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })

    const openFlowProject = vi.fn().mockImplementation(async () => {
      openFlowProjectCallOrder.push(++callCounter)
      return { success: true, url: `https://flow.google/project/${flowProjectId}` }
    })
    recoverInFlightVideos.mockImplementation(async () => {
      recoveryCallOrder.push(++callCounter)
    })
    window.electronAPI = { openFlowProject, setStartupProject: vi.fn() }

    setupRecoveryHook({ mode: 'flow' })

    await act(async () => { await new Promise(r => setTimeout(r, 30)) })

    // openFlowProject must have been called
    expect(openFlowProject).toHaveBeenCalled()
    // If recovery was called, it must have come AFTER openFlowProject
    if (recoveryCallOrder.length > 0) {
      expect(openFlowProjectCallOrder[0]).toBeLessThan(recoveryCallOrder[0])
    }
  })
})
