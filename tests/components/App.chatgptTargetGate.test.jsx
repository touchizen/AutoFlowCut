import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const appMocks = vi.hoisted(() => {
  const noop = vi.fn()
  const asyncNoop = vi.fn(async () => null)
  const state = {
    mode: 'flow',
    sessionTarget: 'chatgpt',
    sessionStatus: { target: 'chatgpt', status: 'ready', ready: true, revision: 1 },
    tagErrors: [],
    framePanelProps: null,
  }
  const sessionStatusListeners = new Set()
  const loadEpochRef = { current: 0 }
  const flowGenerateImage = vi.fn(async () => ({ success: true }))
  const sceneBatchStart = vi.fn(async options => flowGenerateImage(options))
  const videoStart = vi.fn(async () => ({ success: true }))
  const toastWarning = vi.fn()
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
  return {
    noop,
    asyncNoop,
    state,
    sessionStatusListeners,
    emitSessionStatus(status) {
      state.sessionStatus = status
      for (const listener of sessionStatusListeners) listener(status)
    },
    loadEpochRef,
    flowGenerateImage,
    sceneBatchStart,
    videoStart,
    toastWarning,
    scenes,
    scenesHook,
    genAPI,
  }
})

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: key => key, lang: 'ko' }),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: {
    success: appMocks.noop,
    error: appMocks.noop,
    warning: appMocks.toastWarning,
    info: appMocks.noop,
  },
}))
vi.mock('../../src/contexts/ModeContext', () => ({
  useMode: () => ({
    mode: appMocks.state.mode,
    sessionTarget: appMocks.state.sessionTarget,
    clearMode: appMocks.noop,
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
      projectName: 'chatgpt-target-gate-test',
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
    ensureProjectName: () => 'chatgpt-target-gate-test',
    projectNameRef: { current: 'chatgpt-target-gate-test' },
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
    start: appMocks.sceneBatchStart,
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
    start: appMocks.videoStart,
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
  useRefPanelVisibility: () => ({ isOpen: false, setOpenByUser: appMocks.noop }),
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
vi.mock('../../src/components/ReferencePanel', () => ({ default: () => null }))
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
vi.mock('../../src/components/TagValidationModal', () => ({
  default: ({ onProceed }) => <button type="button" onClick={onProceed}>tag-proceed</button>,
}))
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

describe('App flow + chatgpt target gate', () => {
  beforeEach(() => {
    localStorage.clear()
    appMocks.state.mode = 'flow'
    appMocks.state.sessionTarget = 'chatgpt'
    appMocks.state.sessionStatus = { target: 'chatgpt', status: 'ready', ready: true, revision: 1 }
    appMocks.sessionStatusListeners.clear()
    appMocks.state.tagErrors = []
    appMocks.state.framePanelProps = null
    appMocks.loadEpochRef.current = 0
    appMocks.flowGenerateImage.mockClear()
    appMocks.sceneBatchStart.mockClear()
    appMocks.videoStart.mockClear()
    appMocks.toastWarning.mockClear()
    appMocks.genAPI.getAccessToken.mockClear().mockResolvedValue('token')
    window.electronAPI = {
      setMode: vi.fn(async () => ({ ok: true })),
      setLayout: vi.fn(async () => ({ ok: true })),
      getSessionTargetStatus: vi.fn(async (target) => (
        target === 'chatgpt' ? appMocks.state.sessionStatus : null
      )),
      onSessionTargetStatus: vi.fn((listener) => {
        appMocks.sessionStatusListeners.add(listener)
        return () => appMocks.sessionStatusListeners.delete(listener)
      }),
    }
  })

  afterEach(() => {
    cleanup()
    delete window.electronAPI
  })

  it('flow + chatgpt does not push the legacy Flow attach IPC', async () => {
    render(<App />)

    await act(async () => { await Promise.resolve() })

    expect(window.electronAPI.setMode).not.toHaveBeenCalled()
    expect(window.electronAPI.setLayout).not.toHaveBeenCalled()
  })

  it('flow + flow keeps pushing the legacy Flow attach IPC', async () => {
    appMocks.state.sessionTarget = 'flow'
    render(<App />)

    await waitFor(() => expect(window.electronAPI.setMode).toHaveBeenCalledWith({ mode: 'flow' }))
    expect(window.electronAPI.setLayout).toHaveBeenCalled()
  })

  it('api keeps pushing the legacy detach IPC for any target', async () => {
    appMocks.state.mode = 'api'
    render(<App />)

    await waitFor(() => expect(window.electronAPI.setMode).toHaveBeenCalledWith({ mode: 'api' }))
    expect(window.electronAPI.setLayout).not.toHaveBeenCalled()
  })

  it('flow + chatgpt Start does not reach the Flow image engine seam', async () => {
    render(<App />)

    const start = screen.getByTitle('actions.start')
    await waitFor(() => expect(start).toBeEnabled())
    fireEvent.click(start)

    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(appMocks.flowGenerateImage).not.toHaveBeenCalled()
    expect(appMocks.toastWarning).toHaveBeenCalledWith('toast.sessionTargetUnsupported')
  })

  it('flow + flow Start still reaches the Flow image engine seam', async () => {
    appMocks.state.sessionTarget = 'flow'
    render(<App />)

    fireEvent.click(screen.getByTitle('actions.start'))

    await waitFor(() => expect(appMocks.flowGenerateImage).toHaveBeenCalledTimes(1))
  })

  it('does not reuse Flow token readiness as ChatGPT readiness on a target round-trip', async () => {
    appMocks.state.sessionTarget = 'flow'
    appMocks.state.sessionStatus = {
      target: 'chatgpt', status: 'session-blocked', ready: false, revision: 2,
    }
    const { rerender } = render(<App />)
    await waitFor(() => expect(appMocks.genAPI.getAccessToken).toHaveBeenCalled())

    appMocks.state.sessionTarget = 'chatgpt'
    rerender(<App />)
    const start = screen.getByTestId('image-start')
    await waitFor(() => expect(start).toBeDisabled())

    act(() => appMocks.emitSessionStatus({
      target: 'chatgpt', status: 'ready', ready: true, revision: 3,
    }))
    expect(start).toBeEnabled()

    appMocks.state.sessionTarget = 'flow'
    rerender(<App />)
    appMocks.state.sessionTarget = 'chatgpt'
    rerender(<App />)
    expect(screen.getByTestId('image-start')).toBeEnabled()
  })

  it('flow + chatgpt blocks tag-validation Proceed before the Flow image engine seam', async () => {
    appMocks.state.tagErrors = [{ sceneIndex: 0, missingTags: ['hero'] }]
    render(<App />)

    const start = screen.getByTitle('actions.start')
    await waitFor(() => expect(start).toBeEnabled())
    fireEvent.click(start)
    fireEvent.click(await screen.findByRole('button', { name: 'tag-proceed' }))

    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(appMocks.flowGenerateImage).not.toHaveBeenCalled()
    expect(appMocks.toastWarning).toHaveBeenCalledWith('toast.sessionTargetUnsupported')
  })

  it.each([
    'login-required',
    'challenge',
    'rate-limited',
    'session-blocked',
    'unknown',
  ])('closes ChatGPT image admission when status is %s after a ready positive control', async (status) => {
    render(<App />)
    const start = screen.getByTitle('actions.start')

    await waitFor(() => expect(start).toBeEnabled())
    fireEvent.click(start)
    await waitFor(() => expect(appMocks.toastWarning).toHaveBeenCalledWith('toast.sessionTargetUnsupported'))
    appMocks.toastWarning.mockClear()

    act(() => appMocks.emitSessionStatus({
      target: 'chatgpt', status, ready: true, revision: 2,
    }))
    expect(start).toBeDisabled()

    fireEvent.click(start)
    await act(async () => { await Promise.resolve() })
    expect(appMocks.flowGenerateImage).not.toHaveBeenCalled()
    expect(appMocks.toastWarning).not.toHaveBeenCalled()
  })

  it('flow + chatgpt blocks text-to-video before the Flow video engine seam', async () => {
    render(<App />)

    fireEvent.click(screen.getByTitle('tabs.videoText'))
    fireEvent.click(screen.getByTitle('actions.start'))

    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(appMocks.videoStart).not.toHaveBeenCalled()
    expect(appMocks.toastWarning).toHaveBeenCalledWith('toast.sessionTargetUnsupported')
  })

  it('flow + chatgpt blocks frame-to-video before the Flow video engine seam', async () => {
    render(<App />)
    fireEvent.click(screen.getByTitle('tabs.frameToVideo'))
    await waitFor(() => expect(appMocks.state.framePanelProps).toBeTruthy())
    act(() => appMocks.state.framePanelProps.onUpdate([{
      id: 'fp_1',
      ownerSceneId: 'scene_1',
      startSceneId: 'scene_1',
      endSceneId: null,
      prompt: 'animate',
      selected: true,
      status: 'pending',
    }]))

    fireEvent.click(screen.getByTitle('actions.start'))

    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(appMocks.videoStart).not.toHaveBeenCalled()
    expect(appMocks.toastWarning).toHaveBeenCalledWith('toast.sessionTargetUnsupported')
  })

  it('flow + chatgpt video retry does not extract a Flow access token', async () => {
    render(<App />)
    fireEvent.click(screen.getByTitle('tabs.frameToVideo'))
    await waitFor(() => expect(appMocks.state.framePanelProps).toBeTruthy())
    const accessTokenCallsBeforeRetry = appMocks.genAPI.getAccessToken.mock.calls.length

    await act(async () => {
      await appMocks.state.framePanelProps.onVideoRetry({
        id: 'fp_1',
        generationId: 'generation-1',
        mediaId: 'media-1',
        status: 'error',
      })
    })

    expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(accessTokenCallsBeforeRetry)
    expect(appMocks.toastWarning).toHaveBeenCalledWith('toast.sessionTargetUnsupported')
  })
})
