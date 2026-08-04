/**
 * Flow launch must not destroy the user's saved split layout.
 *
 * Regression guard for a shipped Critical: App's flow-entry default-layout push used to run
 * inside a .then() AFTER `await requestRoute`, so it landed after Shell's synchronous
 * saved-value push. The late echo (main → layout-changed → useSplitLayout) then clobbered the
 * saved layout in state AND re-persisted the clobbered value to localStorage — an existing
 * Flow user with split-right/0.7 launched and permanently got split-left/0.5.
 *
 * The fix (src/App.jsx route effect): an `enteringFlow` edge check via previousLayoutModeRef
 * plus a synchronous push — it fires only when the mode actually enters flow, before the
 * owner's saved push, and never on a route change that is not a mode entry.
 *
 * These tests assert the OBSERVABLE outcome (rendered layout + localStorage after the
 * layout-changed echoes flush), not call order/counts — call counts are blind to the
 * ordering bug. The real useSplitLayout owner is used (parent of App, same child-effect →
 * parent-effect ordering as Shell/App) with an async echo harness modelling main's
 * layout-changed round trip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { useSplitLayout } from '../../src/hooks/useSplitLayout.js'

const appMocks = vi.hoisted(() => {
  const noop = vi.fn()
  const asyncNoop = vi.fn(async () => null)
  const state = {
    mode: 'flow',
    sessionTarget: 'flow',
    tagErrors: [],
    framePanelProps: null,
    referencePanelProps: null,
    showReferences: false,
  }
  const loadEpochRef = { current: 0 }
  const commitRoute = vi.fn()
  const scenes = [
    { id: 'scene_1', prompt: 'a test scene', videoT2VPrompt: 'a test video', status: 'pending' },
  ]
  const scenesHook = {
    scenes,
    scenesRef: { current: scenes },
    references: [],
    srtTrack: [],
    parseFromText: noop,
    parseFromCSV: noop,
    parseFromSRT: noop,
    parseReferencesFromCSV: noop,
    updateReferences: noop,
    setScenes: noop,
    setReferences: noop,
    setSrtTrack: noop,
    updateScene: noop,
    getMatchingReferences: vi.fn(() => []),
    updateSrtLine: noop,
    addScene: noop,
    trimScenes: noop,
    clearScenes: noop,
    deleteScene: noop,
    importStoryScenes: vi.fn(() => ({ nextScenes: scenes, nextSrtTrack: [] })),
  }
  const genAPI = {
    getAccessToken: vi.fn(async () => 'token'),
    checkVideoStatus: vi.fn(),
    downloadVideo: vi.fn(),
    fetchGallery: vi.fn(async () => ({ success: true, items: [] })),
    listFlowProjects: asyncNoop,
    capabilities: {},
  }
  return { noop, asyncNoop, state, loadEpochRef, commitRoute, scenes, scenesHook, genAPI }
})

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: key => key, lang: 'ko' }),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: {
    success: appMocks.noop,
    error: appMocks.noop,
    warning: appMocks.noop,
    info: appMocks.noop,
  },
}))
vi.mock('../../src/contexts/ModeContext', () => ({
  useMode: () => ({
    mode: appMocks.state.mode,
    sessionTarget: appMocks.state.sessionTarget,
    clearMode: appMocks.noop,
    setRoute: appMocks.commitRoute,
  }),
}))
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    subscription: { status: 'active', batchRemaining: 10, batchUnlimited: false },
    refreshSubscription: appMocks.asyncNoop,
  }),
}))
vi.mock('../../src/hooks/useSyncGateHost', () => ({
  useSyncGateHost: () => ({
    gate: null,
    busy: false,
    open: appMocks.asyncNoop,
    beginWork: appMocks.noop,
    endWork: appMocks.noop,
    finish: appMocks.noop,
    cancel: appMocks.noop,
    abort: appMocks.noop,
  }),
}))
vi.mock('../../src/hooks/useAppSettings', () => ({
  useAppSettings: () => ({
    settings: {
      projectName: 'flow-layout-preservation-test',
      saveMode: 'local',
      defaultDuration: 5,
      aspectRatio: '16:9',
      seedNo: null,
      seedLocked: false,
      exportThreshold: 50,
      imageModel: 'image-model',
      videoModelT2V: 'video-model',
      videoModelF2V: 'video-model',
      flowAgentOn: false,
      requireStyle: false,
    },
    setSettings: appMocks.noop,
    updateSetting: appMocks.noop,
    ensureProjectName: () => 'flow-layout-preservation-test',
    projectNameRef: { current: 'flow-layout-preservation-test' },
  }),
}))
vi.mock('../../src/hooks/useElementWidth', () => ({ useElementWidth: () => [appMocks.noop, 800] }))
vi.mock('../../src/hooks/useFlowEvents', () => ({ useFlowEvents: appMocks.noop }))
vi.mock('../../src/hooks/useMonitor', () => ({
  useMonitor: () => ({
    monitorMs: 0,
    setMonitorMs: appMocks.noop,
    monitorPlaying: false,
    setMonitorPlaying: appMocks.noop,
    monitorHiddenRoles: new Set(),
    setMonitorHiddenRoles: appMocks.noop,
    monitorWidth: null,
    startMonitorResize: appMocks.noop,
    resetMonitorWidth: appMocks.noop,
    monitorVolume: 1,
    setMonitorVolume: appMocks.noop,
    monitorMuted: false,
    toggleMonitorMuted: appMocks.noop,
    monitorOverlayOpen: false,
    setMonitorOverlayOpen: appMocks.noop,
    monitorFullscreen: false,
    toggleMonitorFullscreen: appMocks.noop,
    monitorMode: 'inline',
  }),
}))
vi.mock('../../src/hooks/useStoreRating', () => ({
  useStoreRating: () => ({
    showModal: false,
    recordExport: appMocks.noop,
    recordGeneration: appMocks.noop,
    rateNow: appMocks.noop,
    remindLater: appMocks.noop,
    dismissForever: appMocks.noop,
  }),
}))
vi.mock('../../src/engine/useGenerationEngine', () => ({ useGenerationEngine: () => appMocks.genAPI }))
vi.mock('../../src/hooks/useAvailableModels', () => ({
  useAvailableModels: () => ({ imageModels: [], videoModels: [], loading: false, source: 'static', refetch: appMocks.noop }),
}))
vi.mock('../../src/hooks/useScenes', () => ({ useScenes: () => appMocks.scenesHook }))
vi.mock('../../src/hooks/useVideoScenes', () => ({
  useVideoScenes: () => ({
    videoScenes: [{ id: 'vscene_1', prompt: 'a test video', selected: true, status: 'pending' }],
    setVideoScenes: appMocks.noop,
    toggleSelect: appMocks.noop,
    toggleSelectAll: appMocks.noop,
    updateVideoScene: appMocks.noop,
  }),
}))
vi.mock('../../src/hooks/useAudioImport', () => ({
  useAudioImport: () => ({
    audioPackage: null,
    audioTracks: [],
    importing: false,
    audioLoading: false,
    importAudioPackage: appMocks.asyncNoop,
    importByPath: appMocks.asyncNoop,
    clearAudioPackage: appMocks.noop,
    audioReviews: [],
    saveReview: appMocks.noop,
    saveBulkReviews: appMocks.noop,
    refreshReviews: appMocks.noop,
    saveTimecodeOverride: appMocks.noop,
    importMp3ToTrack: appMocks.asyncNoop,
  }),
}))
vi.mock('../../src/hooks/useProjectData', () => ({
  useProjectData: () => ({
    addPendingSave: appMocks.noop,
    handleProjectChange: appMocks.noop,
    saveCurrentProject: appMocks.asyncNoop,
    saveCurrentProjectWithPayload: vi.fn(async () => ({ ok: true })),
    isRestoringRef: { current: false },
    projectLoading: false,
    hydratedRef: { current: true },
    loadEpochRef: appMocks.loadEpochRef,
    flowProjectReady: true,
    flowProjectId: null,
    tryAdoptFlowProject: appMocks.asyncNoop,
  }),
}))
vi.mock('../../src/hooks/useStoryPipeline', () => ({
  useStoryPipeline: () => ({ scenes: [], open: appMocks.asyncNoop }),
}))
vi.mock('../../src/hooks/useStoryAutoOpen', () => ({ useStoryAutoOpen: appMocks.noop }))
vi.mock('../../src/hooks/useFlowAdoptPrompt', () => ({
  useFlowAdoptPrompt: () => ({ candidate: null, confirm: appMocks.noop, cancel: appMocks.noop }),
}))
vi.mock('../../src/hooks/useGenerationQueue', () => ({
  useGenerationQueue: () => ({ enqueue: vi.fn(job => job.execute?.()), clearQueue: appMocks.noop }),
}))
vi.mock('../../src/hooks/useAutomation', () => ({
  useAutomation: () => ({
    isRunning: false,
    isPaused: false,
    isStopping: false,
    isSceneBatchQueued: false,
    progress: 0,
    status: 'idle',
    statusMessage: '',
    start: appMocks.asyncNoop,
    togglePause: appMocks.noop,
    stop: appMocks.noop,
    retryErrors: appMocks.noop,
    retryScene: appMocks.noop,
  }),
}))
vi.mock('../../src/hooks/useVideoAutomation', () => ({
  useVideoAutomation: () => ({
    isRunning: false,
    isPaused: false,
    progress: 0,
    status: 'idle',
    statusMessage: '',
    start: appMocks.asyncNoop,
    togglePause: appMocks.noop,
    stop: appMocks.noop,
    retryErrors: appMocks.noop,
  }),
}))
vi.mock('../../src/hooks/useMenuActions', () => ({ useMenuActions: appMocks.noop }))
vi.mock('../../src/hooks/useStyleThumbnails', () => ({
  useStyleThumbnails: () => ({
    thumbnails: [],
    generating: false,
    stopping: false,
    progress: 0,
    generateThumbnails: appMocks.asyncNoop,
    stopGenerating: appMocks.noop,
    deleteThumbnail: appMocks.noop,
  }),
}))
vi.mock('../../src/hooks/useReferenceGeneration', () => ({
  useReferenceGeneration: () => ({
    generatingRefs: [],
    stoppingRefs: false,
    preparingRefs: false,
    refBatchActive: false,
    handleGenerateRef: appMocks.noop,
    handleGenerateAllRefs: appMocks.noop,
    stopGenerateAllRefs: appMocks.noop,
  }),
}))
vi.mock('../../src/hooks/useRefPanelVisibility', () => ({
  useRefPanelVisibility: () => ({
    isOpen: appMocks.state.showReferences,
    setOpenByUser: value => { appMocks.state.showReferences = value },
  }),
}))
vi.mock('../../src/hooks/useSceneGeneration', () => ({
  useSceneGeneration: () => ({ generatingSceneId: null, handleGenerateScene: appMocks.noop }),
}))
vi.mock('../../src/hooks/useExport', () => ({
  useExport: () => ({
    showExportModal: false,
    setShowExportModal: appMocks.noop,
    exporting: false,
    exportPhase: null,
    exportFormat: null,
    handleExportClick: appMocks.noop,
    handleExportConfirm: appMocks.noop,
    handleExportPremiere: appMocks.noop,
    handleExportVrew: appMocks.noop,
  }),
}))
vi.mock('../../src/hooks/useAutoSave', () => ({ useAutoSave: appMocks.noop }))
vi.mock('../../src/hooks/useMcpServer', () => ({ useMcpServer: appMocks.noop }))
vi.mock('../../src/hooks/useImportProcessing', () => ({
  useImportProcessing: () => ({ processing: false, spinnerVisible: false, runImportProcessing: appMocks.asyncNoop }),
}))
vi.mock('../../src/utils/guards', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, checkFolderPermission: vi.fn(async () => ({ ok: true })) }
})
vi.mock('../../src/utils/tagMatch', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, collectTagErrors: () => appMocks.state.tagErrors }
})

vi.mock('../../src/components/PromptInput', () => ({ default: () => null }))
vi.mock('../../src/components/Header', () => ({ default: () => null }))
vi.mock('../../src/components/SceneList', () => ({ default: () => null }))
vi.mock('../../src/components/ResultsTable', () => ({ default: () => null }))
vi.mock('../../src/components/FrameToVideoPanel', () => ({
  default: props => { appMocks.state.framePanelProps = props; return null },
}))
vi.mock('../../src/components/ReferencePanel', () => ({
  default: props => { appMocks.state.referencePanelProps = props; return null },
}))
vi.mock('../../src/components/SettingsModal', () => ({ default: () => null }))
vi.mock('../../src/components/ImportModal', () => ({ default: () => null }))
vi.mock('../../src/components/StatusBar', () => ({ default: () => null }))
vi.mock('../../src/components/SceneDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/VideoDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/ResizeHandle', () => ({ default: () => null }))
vi.mock('../../src/components/ExportModal', () => ({ ExportModal: () => null }))
vi.mock('../../src/components/ExportSplitButton', () => ({ default: () => null }))
vi.mock('../../src/components/AuthModal', () => ({ AuthModal: () => null }))
vi.mock('../../src/components/PaywallModal', () => ({ PaywallModal: () => null }))
vi.mock('../../src/components/TagValidationModal', () => ({ default: () => null }))
vi.mock('../../src/components/EmptyReferenceGateModal', () => ({ default: () => null }))
vi.mock('../../src/components/StoreRatingModal', () => ({ default: () => null }))
vi.mock('../../src/components/AudioResultModal', () => ({ default: () => null }))
vi.mock('../../src/components/QAProgressBanner', () => ({ default: () => null }))
vi.mock('../../src/components/AudioPanel', () => ({ default: () => null }))
vi.mock('../../src/components/BottomPanelTabs', () => ({ default: () => null }))
vi.mock('../../src/components/LiveTimeline', () => ({ default: () => null }))
vi.mock('../../src/components/PreviewMonitor', () => ({ default: () => null }))
vi.mock('../../src/components/SubscriptionBanner', () => ({ SubscriptionBanner: () => null }))
vi.mock('../../src/components/StylePicker', () => ({ default: () => null }))
vi.mock('../../src/components/Modal', () => ({ default: ({ isOpen, children }) => isOpen ? <div>{children}</div> : null }))
vi.mock('../../src/components/DeleteSceneConfirmModal', () => ({ default: () => null }))
vi.mock('../../src/components/FlowProjectAdoptModal', () => ({ default: () => null }))
vi.mock('../../src/components/SrtImportConflictModal', () => ({ default: () => null }))
vi.mock('../../src/components/ImportProcessingOverlay', () => ({ default: () => null }))
vi.mock('../../src/components/story/StoryView', () => ({ default: () => null }))

import App from '../../src/App'

const shellRef = {
  current: {
    getBoundingClientRect: () => ({
      left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900,
    }),
  },
}

/**
 * Same ownership shape as the real Shell/App tree: the useSplitLayout owner is the PARENT
 * of App, so App's route effect (child) runs before the owner's effects — the exact
 * child-effect → parent-effect ordering the fix relies on.
 */
function SplitLayoutOwner() {
  const layout = useSplitLayout({ isFlow: appMocks.state.mode === 'flow', shellRef })
  return (
    <>
      <output data-testid="owned-layout">{layout.layoutMode}:{layout.splitRatio}</output>
      <App />
    </>
  )
}

function installLayoutEchoAPI() {
  const listeners = new Set()
  const events = []
  window.electronAPI = {
    setRoute: vi.fn(async (payload) => {
      const route = payload?.to || payload
      return { ok: true, route, revision: 1 }
    }),
    setLayout: vi.fn(async ({ mode, ratio }) => {
      events.push(`layout:${mode}:${ratio}`)
      // Electron IPC/event delivery is asynchronous. Keeping the echo on a microtask is what
      // makes this harness exercise the child-effect → parent-effect ordering contract:
      // a push delayed past the owner's saved push echoes back LAST and clobbers it.
      queueMicrotask(() => {
        for (const listener of listeners) listener({ mode, splitRatio: ratio })
      })
      return { success: true, mode, splitRatio: ratio }
    }),
    onLayoutChanged: vi.fn((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
  return { events }
}

const flushEchoes = () => act(async () => {
  // echo → setState → persist effect → (possible re-push) → echo — give the chain
  // several microtask+render turns so assertions see the settled end state.
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
})

describe('App flow launch preserves the saved split layout', () => {
  beforeEach(() => {
    localStorage.clear()
    appMocks.state.mode = 'flow'
    appMocks.state.sessionTarget = 'flow'
    appMocks.state.tagErrors = []
    appMocks.state.framePanelProps = null
    appMocks.state.referencePanelProps = null
    appMocks.state.showReferences = false
    appMocks.loadEpochRef.current = 0
    appMocks.commitRoute.mockClear()
  })

  afterEach(() => {
    cleanup()
    delete window.electronAPI
  })

  it.each([
    { mode: 'split-right', ratio: 0.7 },
    { mode: 'split-top', ratio: 0.64 },
  ])('keeps the saved non-default layout on a flow-mode launch: $mode/$ratio', async (savedLayout) => {
    localStorage.setItem('layoutSettings', JSON.stringify(savedLayout))
    installLayoutEchoAPI()

    render(<SplitLayoutOwner />)

    await waitFor(() => expect(screen.getByTestId('owned-layout')).toHaveTextContent(
      `${savedLayout.mode}:${savedLayout.ratio}`,
    ))
    await flushEchoes()
    expect(JSON.parse(localStorage.getItem('layoutSettings'))).toEqual(savedLayout)
    expect(screen.getByTestId('owned-layout')).toHaveTextContent(`${savedLayout.mode}:${savedLayout.ratio}`)
  })

  it('keeps the saved layout across an api → flow mode toggle', async () => {
    const savedLayout = { mode: 'split-bottom', ratio: 0.67 }
    localStorage.setItem('layoutSettings', JSON.stringify(savedLayout))
    const { events } = installLayoutEchoAPI()
    const view = render(<SplitLayoutOwner />)
    await waitFor(() => expect(screen.getByTestId('owned-layout')).toHaveTextContent('split-bottom:0.67'))
    await flushEchoes()

    events.length = 0
    appMocks.state.mode = 'api'
    view.rerender(<SplitLayoutOwner />)
    await flushEchoes()
    // leaving flow is a route change but NOT a flow entry — no default push at all
    expect(events).toEqual([])
    expect(JSON.parse(localStorage.getItem('layoutSettings'))).toEqual(savedLayout)

    appMocks.state.mode = 'flow'
    view.rerender(<SplitLayoutOwner />)
    await flushEchoes()

    // re-entering flow DOES push the entry default (positive control for the edge check) …
    expect(events).toContain('layout:split-left:0.5')
    // … but the saved layout still wins in state and in localStorage, because the push
    // lands synchronously before the owner's saved push.
    expect(JSON.parse(localStorage.getItem('layoutSettings'))).toEqual(savedLayout)
    expect(screen.getByTestId('owned-layout')).toHaveTextContent('split-bottom:0.67')
  })

  it('pushes no default layout on a route change that is not a mode entry', async () => {
    // The route foundation is target-agnostic (VALID_SESSION_TARGETS grows when a future
    // target registers). A target-only route change keeps mode === 'flow', so it must not
    // re-fire the entry default — the enteringFlow edge check is what blocks it.
    const savedLayout = { mode: 'split-right', ratio: 0.7 }
    localStorage.setItem('layoutSettings', JSON.stringify(savedLayout))
    const { events } = installLayoutEchoAPI()
    const view = render(<SplitLayoutOwner />)
    await waitFor(() => expect(screen.getByTestId('owned-layout')).toHaveTextContent('split-right:0.7'))
    await flushEchoes()

    events.length = 0
    appMocks.state.sessionTarget = 'future-target'
    view.rerender(<SplitLayoutOwner />)
    await flushEchoes()

    expect(events).not.toContain('layout:split-left:0.5')
    expect(JSON.parse(localStorage.getItem('layoutSettings'))).toEqual(savedLayout)
    expect(screen.getByTestId('owned-layout')).toHaveTextContent('split-right:0.7')
  })

  it('POSITIVE CONTROL: a flow launch with no saved layout receives the entry default push', async () => {
    // Without this, a guard that simply never pushes would pass the preservation tests.
    const { events } = installLayoutEchoAPI()

    render(<SplitLayoutOwner />)
    await flushEchoes()

    expect(events).toContain('layout:split-left:0.5')
    expect(JSON.parse(localStorage.getItem('layoutSettings'))).toEqual({ mode: 'split-left', ratio: 0.5 })
    expect(screen.getByTestId('owned-layout')).toHaveTextContent('split-left:0.5')
  })
})
