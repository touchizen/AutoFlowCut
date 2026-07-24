/**
 * useProjectData.r6.test.js — regression tests for Codex R6 deep-tail fixes.
 *
 * #R6-5: tryAutoRestore flow + NO saved flowProjectId must NOT set flowProjectReady(true)
 *   before newFlowProject establishes a project. It keeps generation blocked and defers
 *   establishment to the mode-entry effect (Case B). (Defense-in-depth guard — the
 *   mode-entry effect also sets false synchronously, so this locks the safe invariant.)
 * #R6-6: tryAutoRestore rechecks loadEpochRef after the openFlowProject await — a switch
 *   that started mid-restore supersedes it, so the stale restore must NOT flip readiness
 *   or run video recovery.
 * #R6-7: a superseded handleProjectChange must NOT clear isRestoringRef/projectLoading in
 *   its finally — the newer (latest-epoch) switch owns those flags.
 * #R6-8: mode-entry create-new persists the new flowProjectId by MERGING into the on-disk
 *   project.json (latest data), NOT by writing the effect closure's stale scenes/refs snapshot.
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
    mergeProjectData: vi.fn(),
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
  fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
  fileSystemAPI.readResource.mockResolvedValue({ success: false })
  fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })
  fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
  fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
  fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
  // 실제 계약: project.json 이 없어도 success:true + data:null (isNew) 을 돌려준다.
  // Case B 는 이 결과를 보고 "매핑 없음"을 확인한 뒤에야 새 Flow 프로젝트를 만든다.
  fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null })
  fileSystemAPI.projectExists.mockResolvedValue(true)
  recoverInFlightVideos.mockResolvedValue(undefined)
}

async function waitForEffect(ms = 80) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)) })
}

// ─── #R6-5: flow + no saved id restore keeps readiness blocked ──────────────────
describe('#R6-5: restore flow + no flowProjectId does NOT prematurely grant readiness', () => {
  beforeEach(commonBeforeEach)
  afterEach(() => { delete window.electronAPI })

  it('flowProjectReady stays false while newFlowProject is still pending (no premature true)', async () => {
    // PLAIN project (no flowProjectId)
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: { scenes: [], references: [], settings: { aspectRatio: '16:9' }, videoScenes: [], framePairs: [], srtTrack: [], schemaVersion: 2 },
    })
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'prev', saveMode: 'folder' }))

    // newFlowProject never resolves during the test → establishment never completes
    const newFlowProject = vi.fn().mockReturnValue(new Promise(() => {}))
    window.electronAPI = { setStartupProject: vi.fn(), newFlowProject }

    const { result } = renderHook(() => useProjectData(makeHookProps({ mode: 'flow', genAPI: makeGenAPI() })))
    await waitForEffect(60)

    // No confirmed Flow project exists yet → generation must stay blocked.
    expect(result.current.flowProjectReady).toBe(false)
  })
})

// ─── #R6-6: restore superseded during openFlowProject → skip readiness + recovery ──
describe('#R6-6: restore rechecks epoch after openFlowProject await', () => {
  beforeEach(commonBeforeEach)
  afterEach(() => { delete window.electronAPI })

  it('does NOT run recovery when a project switch supersedes the restore mid-open', async () => {
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'prev', saveMode: 'folder' }))
    // meta read + loadProjectWithResources both return the flow project (with in-flight video)
    fileSystemAPI.loadProjectData.mockResolvedValue(FLOW_PROJECT_DATA)
    // 'other' must look like a NEW project (projectExists=false) so the superseding switch
    // takes the empty-new path and never calls recovery itself.
    fileSystemAPI.projectExists.mockImplementation(async (name) => name !== 'other')

    let resolveOpen
    const openDeferred = new Promise(res => { resolveOpen = res })
    window.electronAPI = {
      setStartupProject: vi.fn(),
      openFlowProject: vi.fn().mockReturnValue(openDeferred),
    }

    const { result } = renderHook(() => useProjectData(makeHookProps({ mode: 'flow', genAPI: makeGenAPI() })))
    // Let restore park on the openFlowProject await
    await waitForEffect(40)

    // Supersede: a new switch bumps loadEpochRef synchronously
    act(() => { result.current.handleProjectChange('other') })

    // Now resolve the restore's openFlowProject — it must detect supersession and bail
    await act(async () => {
      resolveOpen({ success: true, already: true })
      await new Promise(r => setTimeout(r, 60))
    })

    expect(recoverInFlightVideos).not.toHaveBeenCalled()
  })
})

// ─── #R6-7: superseded handleProjectChange does not clear shared flags ───────────
describe('#R6-7: superseded handleProjectChange finally does not clear loading flags', () => {
  beforeEach(() => {
    commonBeforeEach()
    localStorage.clear() // empty → fast restore, no state churn
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: false })
  })
  afterEach(() => { delete window.electronAPI })

  it('keeps projectLoading=true when the older switch resolves while the newer is still in flight', async () => {
    window.electronAPI = { setStartupProject: vi.fn() }

    const DATA = (id) => ({ success: true, data: { scenes: [{ id, status: 'done' }], references: [], settings: { aspectRatio: '16:9' }, videoScenes: [], framePairs: [], srtTrack: [], schemaVersion: 2 } })

    let resolveA, resolveB
    const deferredA = new Promise(res => { resolveA = res })
    const deferredB = new Promise(res => { resolveB = res })

    // loadProjectData: 1st = A (slow), 2nd = B (slow)
    fileSystemAPI.loadProjectData
      .mockImplementationOnce(() => deferredA)
      .mockImplementationOnce(() => deferredB)

    const { result } = renderHook(() => useProjectData(makeHookProps({ mode: 'api' })))
    await waitForEffect(20)

    // Start switch A — parks on loadProjectData (deferredA)
    let switchA
    act(() => { switchA = result.current.handleProjectChange('proj-a') })
    await new Promise(r => setTimeout(r, 10))

    // Start switch B — bumps epoch (A superseded), parks on deferredB
    let switchB
    act(() => { switchB = result.current.handleProjectChange('proj-b') })
    await new Promise(r => setTimeout(r, 10))

    // Resolve A first — it is superseded, so its finally must NOT clear projectLoading
    await act(async () => {
      resolveA(DATA('a1'))
      await switchA
    })
    // B is still in flight → loading overlay must remain
    expect(result.current.projectLoading).toBe(true)

    // Resolve B — the owning (latest) switch clears the flag
    await act(async () => {
      resolveB(DATA('b1'))
      await switchB
    })
    expect(result.current.projectLoading).toBe(false)
  })
})

// ─── #R6-8/#R7-4: mode-entry persists new flowProjectId via atomic merge ─────────
describe('#R6-8/#R7-4: mode-entry persists new flowProjectId via atomic merge (no stale snapshot, no clobber)', () => {
  beforeEach(commonBeforeEach)
  afterEach(() => { delete window.electronAPI })

  it('calls mergeProjectData with only the flowProjectId patch (never saveProjectData with stale closure scenes)', async () => {
    // localStorage empty → restore fast-path → hydrated true → mode-entry Case B fires.
    const createdId = 'new-flow-id-xyz'
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: createdId })
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true })
    window.electronAPI = { setStartupProject: vi.fn(), newFlowProject, openFlowProject }

    // Hook is given STALE closure scenes — the persist must NOT write a full snapshot at all.
    renderHook(() => useProjectData(makeHookProps({
      mode: 'flow',
      scenes: [{ id: 'closure-scene', status: 'done' }],
      references: [{ name: 'closure-ref' }],
    })))

    await waitForEffect(60)

    expect(newFlowProject).toHaveBeenCalled()
    // Persist goes through the atomic merge with ONLY the flowProjectId key.
    const mergeCall = fileSystemAPI.mergeProjectData.mock.calls.find(([, patch]) => patch?.flowProjectId === createdId)
    expect(mergeCall).toBeTruthy()
    expect(mergeCall[1]).toEqual({ flowProjectId: createdId })
    // It must NOT have written a full project snapshot (which would carry the stale closure scenes).
    const staleSnapshot = fileSystemAPI.saveProjectData.mock.calls.find(([, payload]) =>
      payload?.flowProjectId === createdId && Array.isArray(payload?.scenes) && payload.scenes.some(s => s.id === 'closure-scene')
    )
    expect(staleSnapshot).toBeFalsy()
  })
})
