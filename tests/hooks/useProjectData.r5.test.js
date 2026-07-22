/**
 * useProjectData.r5.test.js — regression tests for Codex R5 batch J fixes.
 *
 * #R5-1: Flow-no-mapping recovery gate — skip triggerVideoRecovery unless CONFIRMED bound.
 *   In both tryAutoRestore and handleProjectChange, the old `else` branch ran
 *   triggerVideoRecovery unconditionally for BOTH api-mode AND flow+no-mapping.
 *   R5-1 splits it into three explicit cases:
 *     - flow + saved flowProjectId  → wait for openFlowProject (existing R4 behavior)
 *     - flow + NO saved flowProjectId → setFlowProjectReady(true) only, NO recovery
 *     - api mode → setFlowProjectReady(true) + recovery immediately
 *
 * #R5-2: Epoch guard for rapid project switch race.
 *   loadEpochRef tracks the latest handleProjectChange / tryAutoRestore invocation.
 *   Superseded switches skip state mutations so stale data never overwrites newer state.
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

// In-flight video scene fixture — 'pending' with generationId triggers recovery check
const IN_FLIGHT_VIDEO = { id: 'v1', generationId: 'g1', status: 'pending' }

// Project data WITH a flowProjectId saved
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

// Project data WITHOUT a flowProjectId (no mapping)
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

async function waitForEffect(ms = 80) {
  await act(async () => {
    await new Promise(r => setTimeout(r, ms))
  })
}

// ─── R5-1: tryAutoRestore — flow mode, no saved flowProjectId ──────────────────

describe('#R5-1: tryAutoRestore — flow + no flowProjectId → recovery NOT called', () => {
  beforeEach(() => {
    commonBeforeEach()
    // PLAIN_PROJECT_DATA has no flowProjectId
    fileSystemAPI.loadProjectData.mockResolvedValue(PLAIN_PROJECT_DATA)
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'prev', saveMode: 'folder' }))
  })

  afterEach(() => {
    delete window.electronAPI
  })

  it('does NOT call recoverInFlightVideos in flow mode when no flowProjectId is saved', async () => {
    window.electronAPI = { setStartupProject: vi.fn() }
    const genAPI = makeGenAPI()
    await act(async () => {
      renderHook(() => useProjectData(makeHookProps({ mode: 'flow', genAPI })))
      await new Promise(r => setTimeout(r, 80))
    })
    expect(recoverInFlightVideos).not.toHaveBeenCalled()
  })
})

// ─── R5-1: tryAutoRestore — api mode calls recovery immediately ─────────────────

describe('#R5-1: tryAutoRestore — api mode → recovery called immediately', () => {
  beforeEach(() => {
    commonBeforeEach()
    // PLAIN_PROJECT_DATA has no flowProjectId
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
      await new Promise(r => setTimeout(r, 80))
    })
    expect(recoverInFlightVideos).toHaveBeenCalled()
  })
})

// ─── R5-1: tryAutoRestore — flow + saved flowProjectId confirmed → recovery ─────

describe('#R5-1: tryAutoRestore — flow + confirmed flowProjectId → recovery called (R4 behavior preserved)', () => {
  beforeEach(() => {
    commonBeforeEach()
    // FLOW_PROJECT_DATA has flowProjectId: 'fp-1'
    fileSystemAPI.loadProjectData.mockResolvedValue(FLOW_PROJECT_DATA)
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'prev', saveMode: 'folder' }))
  })

  afterEach(() => {
    delete window.electronAPI
  })

  it('DOES call recoverInFlightVideos when openFlowProject returns success:true (already)', async () => {
    window.electronAPI = {
      setStartupProject: vi.fn(),
      openFlowProject: vi.fn().mockResolvedValue({ success: true, already: true }),
    }
    const genAPI = makeGenAPI()
    await act(async () => {
      renderHook(() => useProjectData(makeHookProps({ mode: 'flow', genAPI })))
      await new Promise(r => setTimeout(r, 80))
    })
    expect(recoverInFlightVideos).toHaveBeenCalled()
  })
})

// ─── R5-1: handleProjectChange — flow + no flowProjectId ───────────────────────

describe('#R5-1: handleProjectChange — flow + no flowProjectId → recovery NOT called', () => {
  beforeEach(() => {
    commonBeforeEach()
    // Restore fast path: prev project exists but loadProjectData returns data without flowProjectId
    fileSystemAPI.loadProjectData
      .mockResolvedValueOnce({ success: false }) // early meta for declareStartup
      .mockResolvedValueOnce({ success: false }) // loadProjectWithResources for 'old' (auto-restore, empty)
      .mockResolvedValue(PLAIN_PROJECT_DATA)     // switch to 'next' — no flowProjectId
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'old', saveMode: 'folder' }))
  })

  afterEach(() => {
    delete window.electronAPI
  })

  it('does NOT call recoverInFlightVideos when switching to a flow project with no saved flowProjectId', async () => {
    window.electronAPI = { setStartupProject: vi.fn() }
    const genAPI = makeGenAPI()
    const { result } = renderHook(() => useProjectData(makeHookProps({ mode: 'flow', genAPI })))
    await waitForEffect()
    vi.clearAllMocks()
    await act(async () => {
      await result.current.handleProjectChange('next')
    })
    expect(recoverInFlightVideos).not.toHaveBeenCalled()
  })
})

// ─── R5-1: handleProjectChange — api mode calls recovery ───────────────────────

describe('#R5-1: handleProjectChange — api mode → recovery called', () => {
  beforeEach(() => {
    commonBeforeEach()
    fileSystemAPI.loadProjectData
      .mockResolvedValueOnce({ success: false }) // early meta for declareStartup
      .mockResolvedValueOnce({ success: false }) // loadProjectWithResources for 'old' (auto-restore)
      .mockResolvedValue(PLAIN_PROJECT_DATA)     // switch to 'next'
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'old', saveMode: 'folder' }))
  })

  afterEach(() => {
    delete window.electronAPI
  })

  it('calls recoverInFlightVideos when switching in API mode (no flowProjectId required)', async () => {
    window.electronAPI = { setStartupProject: vi.fn() }
    const genAPI = makeGenAPI()
    const { result } = renderHook(() => useProjectData(makeHookProps({ mode: 'api', genAPI })))
    await waitForEffect()
    vi.clearAllMocks()
    await act(async () => {
      await result.current.handleProjectChange('next')
    })
    expect(recoverInFlightVideos).toHaveBeenCalled()
  })
})

// ─── R25-1: Recovery epoch guard — late recovery patch dropped after switch ────

describe('#R25-1: triggerVideoRecovery patch guarded by epoch', () => {
  beforeEach(() => {
    commonBeforeEach()
    localStorage.clear()
    // auto-restore fast path (no localStorage), then both switches load in-flight T2V data
    fileSystemAPI.loadProjectData.mockResolvedValue(PLAIN_PROJECT_DATA)
  })
  afterEach(() => { delete window.electronAPI })

  it('drops a late recovery patch when a newer project switch has bumped the epoch', async () => {
    window.electronAPI = { setStartupProject: vi.fn() }
    // Capture only the FIRST recovery callback (proj-A's); do NOT invoke it from inside the mock.
    let firstCb = null
    recoverInFlightVideos.mockImplementation(async ({ onFramePairUpdate }) => {
      if (!firstCb) firstCb = onFramePairUpdate
    })
    const setVideoScenes = vi.fn()
    const genAPI = makeGenAPI()
    const { result } = renderHook(() => useProjectData(makeHookProps({
      mode: 'api', genAPI, setVideoScenes,
      settings: { projectName: null, saveMode: 'folder', aspectRatio: '16:9' },
    })))
    await waitForEffect(30)

    // Switch to proj-A → triggers recovery, captures proj-A's epoch-bound callback
    await act(async () => { await result.current.handleProjectChange('proj-a'); await new Promise(r => setTimeout(r, 20)) })
    expect(firstCb).toBeTypeOf('function')

    // Switch to proj-B → bumps loadEpochRef, superseding proj-A
    await act(async () => { await result.current.handleProjectChange('proj-b'); await new Promise(r => setTimeout(r, 20)) })

    // Clear AFTER proj-B's legitimate load (which calls setVideoScenes with proj-B data),
    // so only a stale recovery patch could register a call now.
    setVideoScenes.mockClear()
    // proj-A's recovery download finishes late and fires its captured callback
    act(() => { firstCb('v1', { status: 'complete', base64: 'x', videoPath: '/p' }) })

    // Guarded: stale proj-A patch must NOT mutate the (now proj-B) videoScenes state
    expect(setVideoScenes).not.toHaveBeenCalled()
  })
})

// ─── I2V recovery: framePair patch와 owner scene 상태를 함께 복구 ──────────────

describe('I2V recovery callback updates its owner scene', () => {
  beforeEach(() => {
    commonBeforeEach()
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'prev', saveMode: 'folder' }))
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: {
        scenes: [{ id: 'scene-1', status: 'done' }],
        references: [],
        settings: { aspectRatio: '16:9' },
        videoScenes: [],
        framePairs: [
          { id: 'fp-owned', ownerSceneId: 'scene-1', generationId: 'g-owned', status: 'pending' },
          { id: 'fp-gallery', ownerSceneId: null, generationId: 'g-gallery', status: 'pending' },
        ],
        srtTrack: [],
        schemaVersion: 2,
      },
    })
  })

  afterEach(() => { delete window.electronAPI })

  it.each([
    ['generating', { status: 'generating' }, {
      videoI2VStatus: 'generating',
      videoI2VGeneratingStartedAt: expect.any(Number),
      videoI2VGeneratingEndedAt: null,
    }],
    ['complete', { status: 'complete', base64: 'VIDEO', videoPath: '/videos/fp-owned.mp4', generatedAt: 123 }, {
      videoI2VStatus: 'complete',
      videoI2VGeneratingEndedAt: expect.any(Number),
      videoI2V: 'VIDEO',
      videoI2VPath: '/videos/fp-owned.mp4',
      videoI2VDisabled: null,
      videoI2VGeneratedAt: 123,
    }],
    ['error', { status: 'error', error: 'failed' }, {
      videoI2VStatus: 'error',
      videoI2VGeneratingEndedAt: expect.any(Number),
    }],
  ])('%s patch를 owner scene에 병합하고 gallery 행은 제외한다', async (_status, recoveryPatch, expectedPatch) => {
    window.electronAPI = { setStartupProject: vi.fn() }
    let i2vRecoveryCallback = null
    recoverInFlightVideos.mockImplementation(async ({ framePairs, onFramePairUpdate }) => {
      if (framePairs.some(fp => fp.id === 'fp-owned')) i2vRecoveryCallback = onFramePairUpdate
    })
    const setFramePairs = vi.fn()
    const setScenes = vi.fn()

    renderHook(() => useProjectData(makeHookProps({
      mode: 'api', genAPI: makeGenAPI(),
      framePairs: [
        { id: 'fp-owned', ownerSceneId: 'scene-1', generationId: 'g-owned', status: 'pending' },
        { id: 'fp-gallery', ownerSceneId: null, generationId: 'g-gallery', status: 'pending' },
      ],
      setFramePairs, setScenes,
    })))
    await waitForEffect()
    expect(i2vRecoveryCallback).toBeTypeOf('function')

    setFramePairs.mockClear()
    setScenes.mockClear()
    act(() => i2vRecoveryCallback('fp-owned', recoveryPatch))

    expect(setFramePairs).toHaveBeenCalledTimes(1)
    expect(setFramePairs.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: 'fp-owned', ownerSceneId: 'scene-1', ...recoveryPatch }),
      expect.objectContaining({ id: 'fp-gallery', ownerSceneId: null }),
    ])
    expect(setScenes).toHaveBeenCalledTimes(1)
    const ownerUpdater = setScenes.mock.calls[0][0]
    const ownerResult = ownerUpdater([
      { id: 'scene-1', untouched: 'keep' },
      { id: 'scene-2', untouched: 'other' },
    ])
    expect(ownerResult).toEqual([
      expect.objectContaining({ id: 'scene-1', untouched: 'keep', ...expectedPatch }),
      { id: 'scene-2', untouched: 'other' },
    ])

    act(() => i2vRecoveryCallback('fp-gallery', recoveryPatch))
    expect(setFramePairs).toHaveBeenCalledTimes(2)
    expect(setFramePairs.mock.calls[1][0]).toEqual([
      expect.objectContaining({ id: 'fp-owned', ownerSceneId: 'scene-1', ...recoveryPatch }),
      expect.objectContaining({ id: 'fp-gallery', ownerSceneId: null, ...recoveryPatch }),
    ])
    expect(setScenes).toHaveBeenCalledTimes(1)
  })

  it('복구 중 live framePair가 삭제됐으면 owner scene patch도 no-op이다', async () => {
    window.electronAPI = { setStartupProject: vi.fn() }
    let i2vRecoveryCallback = null
    recoverInFlightVideos.mockImplementation(async ({ framePairs, onFramePairUpdate }) => {
      if (framePairs.some(fp => fp.id === 'fp-owned')) i2vRecoveryCallback = onFramePairUpdate
    })
    const setFramePairs = vi.fn()
    const setScenes = vi.fn()

    let liveFramePairs = [
      { id: 'fp-owned', ownerSceneId: 'scene-1', generationId: 'g-owned', status: 'pending' },
      { id: 'fp-gallery', ownerSceneId: null, generationId: 'g-gallery', status: 'pending' },
    ]
    const hook = renderHook(() => useProjectData(makeHookProps({
      mode: 'api', genAPI: makeGenAPI(), framePairs: liveFramePairs, setFramePairs, setScenes,
    })))
    await waitForEffect()
    expect(i2vRecoveryCallback).toBeTypeOf('function')

    liveFramePairs = []
    hook.rerender()
    setFramePairs.mockClear()
    setScenes.mockClear()
    act(() => i2vRecoveryCallback('fp-owned', { status: 'complete', base64: 'VIDEO' }))

    expect(setFramePairs).not.toHaveBeenCalled()
    expect(setScenes).not.toHaveBeenCalled()
  })

  it('generating 복구 timestamp를 live framePair와 owner scene에 같은 값으로 적용한다', async () => {
    window.electronAPI = { setStartupProject: vi.fn() }
    let i2vRecoveryCallback = null
    recoverInFlightVideos.mockImplementation(async ({ framePairs, onFramePairUpdate }) => {
      if (framePairs.some(fp => fp.id === 'fp-owned')) i2vRecoveryCallback = onFramePairUpdate
    })
    const setFramePairs = vi.fn()
    const setScenes = vi.fn()

    renderHook(() => useProjectData(makeHookProps({
      mode: 'api', genAPI: makeGenAPI(),
      framePairs: [
        { id: 'fp-owned', ownerSceneId: 'scene-1', generationId: 'g-owned', status: 'pending' },
      ],
      setFramePairs, setScenes,
    })))
    await waitForEffect()
    expect(i2vRecoveryCallback).toBeTypeOf('function')

    setFramePairs.mockClear()
    setScenes.mockClear()
    const generatingStartedAt = 1_753_200_000_123
    act(() => i2vRecoveryCallback('fp-owned', { status: 'generating', generatingStartedAt }))

    const framePairResult = setFramePairs.mock.calls[0][0]
    expect(framePairResult[0].generatingStartedAt).toBe(generatingStartedAt)

    expect(setScenes).toHaveBeenCalledTimes(1)
    const sceneUpdater = setScenes.mock.calls[0][0]
    const sceneResult = sceneUpdater([{ id: 'scene-1' }])
    expect(sceneResult[0].videoI2VGeneratingStartedAt).toBe(generatingStartedAt)
  })
})

// ─── R5-2: Epoch guard — rapid switch, older resolves last ─────────────────────

describe('#R5-2: Epoch guard — rapid switch stale state skipped', () => {
  beforeEach(() => {
    commonBeforeEach()
    // No prior localStorage so auto-restore takes the fast path (empty project)
    localStorage.clear()
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: false })
  })

  afterEach(() => {
    delete window.electronAPI
  })

  it('skips setScenes from proj-A when proj-B switch completes first (B state wins)', async () => {
    window.electronAPI = { setStartupProject: vi.fn() }

    const SCENES_A = [{ id: 'a1', status: 'done' }]
    const SCENES_B = [{ id: 'b1', status: 'done' }]

    // proj-A data — has scenes A, no videos
    const PROJECT_A_DATA = {
      success: true,
      data: {
        scenes: SCENES_A,
        references: [],
        settings: { aspectRatio: '16:9' },
        videoScenes: [],
        framePairs: [],
        srtTrack: [],
        schemaVersion: 2,
      },
    }

    // proj-B data — has scenes B, no videos
    const PROJECT_B_DATA = {
      success: true,
      data: {
        scenes: SCENES_B,
        references: [],
        settings: { aspectRatio: '16:9' },
        videoScenes: [],
        framePairs: [],
        srtTrack: [],
        schemaVersion: 2,
      },
    }

    // Resolve controls for the two overlapping handleProjectChange calls.
    // proj-A uses a deferred promise; proj-B resolves immediately.
    let resolveA
    const deferredA = new Promise(res => { resolveA = res })

    fileSystemAPI.projectExists.mockResolvedValue(true)

    // loadProjectData calls: 0=deferredA (proj-A, slow), 1=immediate (proj-B, fast)
    fileSystemAPI.loadProjectData
      .mockImplementationOnce(() => deferredA)
      .mockImplementationOnce(() => Promise.resolve(PROJECT_B_DATA))

    const setScenes = vi.fn()
    const props = makeHookProps({ mode: 'api', setScenes })

    const { result } = renderHook(() => useProjectData(props))
    // Allow hook to mount (auto-restore fast path — no localStorage → no state mutations)
    await waitForEffect(20)

    // Launch proj-A switch (hangs on loadProjectData until we manually resolve)
    const switchAPromise = result.current.handleProjectChange('proj-a')

    // Allow proj-A to advance past saveCurrentProject + projectExists (both resolve fast),
    // so its epoch is claimed but loadProjectData is still awaiting
    await new Promise(r => setTimeout(r, 10))

    // Launch proj-B switch — this bumps loadEpochRef so proj-A becomes superseded
    const switchBPromise = result.current.handleProjectChange('proj-b')

    // Wait for proj-B to fully complete (its loadProjectData resolves immediately)
    await act(async () => {
      await switchBPromise
    })

    // Now resolve proj-A's deferred load — it should detect supersession and skip state
    await act(async () => {
      resolveA(PROJECT_A_DATA)
      await switchAPromise
    })

    // Verify: setScenes was called with B's scenes
    const calls = setScenes.mock.calls
    const calledWithB = calls.some(([arg]) =>
      Array.isArray(arg) && arg.some(s => s.id === 'b1')
    )
    expect(calledWithB).toBe(true)

    // Verify: the LAST array call to setScenes did NOT have A's scenes
    // (A's mutations should have been skipped after B completed)
    const arrayCalls = calls.filter(([arg]) => Array.isArray(arg))
    if (arrayCalls.length > 0) {
      const lastArg = arrayCalls[arrayCalls.length - 1][0]
      const lastIsOnlyA = lastArg.some(s => s.id === 'a1') && !lastArg.some(s => s.id === 'b1')
      expect(lastIsOnlyA).toBe(false)
    }
  })
})
