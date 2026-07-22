import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const appMocks = vi.hoisted(() => {
  const noop = vi.fn()
  const asyncNoop = vi.fn(async () => null)
  const loadEpochRef = { current: 0 }
  const state = {
    mode: 'api',
    generatingSceneId: null,
    preparingRefs: false,
    refBatchActive: false,
    isSceneBatchQueued: false,
    holdSceneBatch: false,
    heldQueueItem: null,
    mcpProps: null,
    framePanelProps: null,
    videoStartOptions: null,
    projectDataProps: null,
    menuProps: null,
  }
  const toastWarning = vi.fn()
  const generationEnqueue = vi.fn(job => {
    if (!state.holdSceneBatch) return Promise.resolve(job.execute?.())
    return new Promise((resolve, reject) => {
      state.heldQueueItem = { job, resolve, reject }
    })
  })
  const generationClearQueue = vi.fn(type => {
    const held = state.heldQueueItem
    if (!held || (type && held.job.type !== type)) return
    state.heldQueueItem = null
    held.reject(Object.assign(new Error('Queue cleared'), { alreadySurfaced: true }))
  })
  const sceneBatchStart = vi.fn(async options => {
    try {
      return await generationEnqueue({
        type: 'scene_batch',
        label: 'Batch Scene Generation',
        execute: async () => options,
      })
    } catch {
      return undefined
    }
  })
  const automationStop = vi.fn()
  const retryErrors = vi.fn(async options => generationEnqueue({
    type: 'scene_batch',
    label: 'Retry Error Scenes',
    execute: async () => options,
  }))
  const retryScene = vi.fn(async (id, options) => generationEnqueue({
    type: 'scene_batch',
    label: `Retry Scene ${id}`,
    execute: async () => options,
  }))
  const videoStart = vi.fn(async options => {
    state.videoStartOptions = options
  })
  const scenes = [
    { id: 's1', prompt: 'scene 1-a\nscene 1-b', videoT2VPrompt: 'video 1', status: 'pending' },
    { id: 's2', prompt: 'scene 2', videoT2VPrompt: '', status: 'pending', videoT2VStatus: 'generating' },
    { id: 's3', prompt: 'scene 3', videoT2VPrompt: 'video 3', status: 'pending', videoI2VStatus: 'generating' },
    { id: 's4', prompt: 'scene 4', videoT2VPrompt: '', status: 'generating' },
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
    updateScene: vi.fn(),
    getMatchingReferences: vi.fn(() => []),
    updateSrtLine: noop,
    addScene: noop,
    trimScenes: noop,
    clearScenes: noop,
    deleteScene: noop,
    importStoryScenes: vi.fn(() => ({ nextScenes: scenes, nextSrtTrack: [] })),
  }
  const genAPI = {
    getAccessToken: vi.fn(async () => null),
    checkVideoStatus: vi.fn(),
    downloadVideo: vi.fn(),
    fetchGallery: vi.fn(async () => ({ success: true, items: [] })),
    listFlowProjects: asyncNoop,
    capabilities: {},
  }
  return {
    noop, asyncNoop, state, loadEpochRef,
    generationEnqueue, generationClearQueue, sceneBatchStart, automationStop, retryErrors, retryScene, videoStart,
    scenes, scenesHook, genAPI, toastWarning,
  }
})

const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key) => key, lang: 'ko' }),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: {
    success: appMocks.noop,
    error: appMocks.noop,
    warning: appMocks.toastWarning,
    info: appMocks.noop,
  },
}))
vi.mock('../../src/contexts/ModeContext', () => ({ useMode: () => ({ mode: appMocks.state.mode, clearMode: appMocks.noop }) }))
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
      projectName: 'busy-lines-test',
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
    ensureProjectName: () => 'busy-lines-test',
    projectNameRef: { current: 'busy-lines-test' },
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
    videoScenes: [],
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
  useProjectData: props => {
    appMocks.state.projectDataProps = props
    return ({
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
    })
  },
}))
vi.mock('../../src/hooks/useStoryPipeline', () => ({
  useStoryPipeline: () => ({ scenes: [], open: appMocks.asyncNoop }),
}))
vi.mock('../../src/hooks/useStoryAutoOpen', () => ({ useStoryAutoOpen: appMocks.noop }))
vi.mock('../../src/hooks/useFlowAdoptPrompt', () => ({
  useFlowAdoptPrompt: () => ({ candidate: null, confirm: appMocks.noop, cancel: appMocks.noop }),
}))
vi.mock('../../src/hooks/useGenerationQueue', () => ({
  useGenerationQueue: () => ({
    enqueue: appMocks.generationEnqueue,
    clearQueue: appMocks.generationClearQueue,
  }),
}))
vi.mock('../../src/hooks/useAutomation', () => ({
  useAutomation: () => ({
    isRunning: false,
    isPaused: false,
    isStopping: false,
    isSceneBatchQueued: appMocks.state.isSceneBatchQueued,
    progress: 0,
    status: 'idle',
    statusMessage: '',
    start: appMocks.sceneBatchStart,
    togglePause: appMocks.noop,
    stop: appMocks.automationStop,
    retryErrors: appMocks.retryErrors,
    retryScene: appMocks.retryScene,
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
vi.mock('../../src/hooks/useMenuActions', () => ({
  useMenuActions: props => { appMocks.state.menuProps = props },
}))
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
    preparingRefs: appMocks.state.preparingRefs,
    refBatchActive: appMocks.state.refBatchActive,
    handleGenerateRef: appMocks.noop,
    handleGenerateAllRefs: appMocks.noop,
    stopGenerateAllRefs: appMocks.noop,
  }),
}))
vi.mock('../../src/hooks/useRefPanelVisibility', () => ({
  useRefPanelVisibility: () => ({ isOpen: false, setOpenByUser: appMocks.noop }),
}))
vi.mock('../../src/hooks/useSceneGeneration', () => ({
  useSceneGeneration: () => ({ generatingSceneId: appMocks.state.generatingSceneId, handleGenerateScene: appMocks.noop }),
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
vi.mock('../../src/hooks/useMcpServer', () => ({
  useMcpServer: props => { appMocks.state.mcpProps = props },
}))
vi.mock('../../src/hooks/useImportProcessing', () => ({
  useImportProcessing: () => ({ processing: false, spinnerVisible: false, runImportProcessing: appMocks.asyncNoop }),
}))

vi.mock('../../src/components/PromptInput', async () => {
  const React = await import('react')
  return {
    default: ({ value, placeholder, busyLines }) => React.createElement('div', {
      'data-testid': placeholder ? 'video-prompt-input' : 'image-prompt-input',
      'data-value': value,
      'data-busy-lines': busyLines ? [...busyLines].join(',') : 'missing',
    }),
  }
})

vi.mock('../../src/components/Header', () => ({ default: () => null }))
vi.mock('../../src/components/SceneList', () => ({ default: () => null }))
vi.mock('../../src/components/ResultsTable', async () => {
  const React = await import('react')
  return {
    default: ({ items, mediaType, onRetry }) => onRetry && items?.length
      ? React.createElement('button', {
      type: 'button',
      onClick: () => onRetry(items[0].id),
    }, `retry-${mediaType}-${items[0].id}`)
      : null,
  }
})
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
vi.mock('../../src/components/BottomPanelTabs', () => ({
  default: ({ onChange }) => <button type="button" onClick={() => onChange('results')}>show-results</button>,
}))
vi.mock('../../src/components/LiveTimeline', () => ({ default: () => null }))
vi.mock('../../src/components/PreviewMonitor', () => ({ default: () => null }))
vi.mock('../../src/components/SubscriptionBanner', () => ({ SubscriptionBanner: () => null }))
vi.mock('../../src/components/StylePicker', () => ({
  default: ({ onSelect }) => <button type="button" onClick={() => onSelect('preset:test')}>pick-style</button>,
}))
vi.mock('../../src/components/Modal', () => ({
  default: ({ isOpen, children, footer }) => isOpen ? <div>{children}{footer}</div> : null,
}))
vi.mock('../../src/components/DeleteSceneConfirmModal', () => ({ default: () => null }))
vi.mock('../../src/components/FlowProjectAdoptModal', () => ({ default: () => null }))
vi.mock('../../src/components/SrtImportConflictModal', () => ({ default: () => null }))
vi.mock('../../src/components/ImportProcessingOverlay', () => ({ default: () => null }))
vi.mock('../../src/components/story/StoryView', () => ({ default: () => null }))

import App from '../../src/App'

describe('App prompt busyLines wiring', () => {
  afterEach(() => {
    cleanup()
    appMocks.state.generatingSceneId = null
    appMocks.state.mode = 'api'
    appMocks.loadEpochRef.current = 0
    appMocks.state.preparingRefs = false
    appMocks.state.refBatchActive = false
    appMocks.state.isSceneBatchQueued = false
    appMocks.state.holdSceneBatch = false
    appMocks.state.heldQueueItem = null
    appMocks.state.mcpProps = null
    appMocks.state.framePanelProps = null
    appMocks.state.videoStartOptions = null
    appMocks.state.projectDataProps = null
    appMocks.state.menuProps = null
    appMocks.scenesHook.scenes = appMocks.scenes
    appMocks.scenesHook.scenesRef.current = appMocks.scenes
    appMocks.genAPI.getAccessToken.mockReset().mockResolvedValue(null)
    appMocks.genAPI.checkVideoStatus.mockReset()
    appMocks.genAPI.downloadVideo.mockReset()
    appMocks.generationEnqueue.mockClear()
    appMocks.generationClearQueue.mockClear()
    appMocks.sceneBatchStart.mockClear()
    appMocks.automationStop.mockClear()
    appMocks.retryErrors.mockClear()
    appMocks.retryScene.mockClear()
    appMocks.videoStart.mockClear()
    appMocks.toastWarning.mockClear()
    appMocks.scenesHook.updateScene.mockClear()
  })

  it('이미지·비디오 PromptInput에 각 value 규칙으로 계산한 busy 문단을 전달한다', async () => {
    render(<App />)

    const imageInput = screen.getByTestId('image-prompt-input')
    expect(imageInput).toHaveAttribute('data-value', 'scene 1-a\nscene 1-b\nscene 2\nscene 3\nscene 4')
    expect(imageInput).toHaveAttribute('data-busy-lines', '2,3,4')

    fireEvent.click(screen.getByRole('button', { name: /tabs\.videoText/ }))

    const videoInput = await screen.findByTestId('video-prompt-input')
    expect(videoInput).toHaveAttribute('data-value', 'video 1\n\nvideo 3')
    expect(videoInput).toHaveAttribute('data-busy-lines', '1,2')
    await waitFor(() => expect(screen.queryByTestId('image-prompt-input')).not.toBeInTheDocument())
  })

  // 위 테스트는 한 번만 렌더하므로 memo 의존성을 []로 바꿔도 통과한다(뮤테이션 실측). 실앱은 씬이
  // 빈 배열로 시작해 나중에 채워지므로, 그 뮤턴트는 링이 영영 안 뜨는 죽은 기능이 된다.
  // 씬이 바뀐 뒤 다시 계산되는 경로를 실제로 지나간다.
  it('씬 상태가 바뀌면 busy 문단을 다시 계산한다', async () => {
    const original = appMocks.scenesHook.scenes
    try {
      render(<App />)
      expect(screen.getByTestId('image-prompt-input')).toHaveAttribute('data-busy-lines', '2,3,4')

      // 새 배열로 교체한다 — 제자리 수정은 identity 가 안 바뀌어 실제 갱신 경로가 아니다.
      appMocks.scenesHook.scenes = original.map(
        scene => scene.id === 's1' ? { ...scene, status: 'generating' } : scene
      )

      // 탭을 오가며 App 을 다시 렌더시킨다.
      fireEvent.click(screen.getByRole('button', { name: /tabs\.videoText/ }))
      await screen.findByTestId('video-prompt-input')
      fireEvent.click(screen.getByRole('button', { name: /tabs\.text/ }))

      const imageInput = await screen.findByTestId('image-prompt-input')
      expect(imageInput).toHaveAttribute('data-busy-lines', '0,2,3,4')
    } finally {
      appMocks.scenesHook.scenes = original
    }
  })

  it('개별 씬 생성 중에는 primary Start와 전체 재생성 trigger를 비활성화한다', async () => {
    appMocks.state.generatingSceneId = 's4'
    appMocks.genAPI.getAccessToken.mockResolvedValue('token')
    appMocks.scenesHook.scenes = appMocks.scenes.map((scene, index) => (
      index === 0 ? { ...scene, image: 'generated-image' } : scene
    ))
    render(<App />)

    const startButton = screen.getByTitle('actions.start')
    expect(startButton).toBeDisabled()
    const generateMenuTrigger = screen.getByRole('button', { name: /actions\.moreGenerateOptions/ })
    expect(generateMenuTrigger).toBeDisabled()

    fireEvent.click(startButton)
    fireEvent.click(generateMenuTrigger)

    expect(screen.queryByRole('button', { name: /actions\.forceRegenerate/ })).not.toBeInTheDocument()
    expect(appMocks.generationEnqueue).not.toHaveBeenCalled()
  })

  it('UI Start preflight 중 개별 씬 생성이 시작되면 재개된 배치를 enqueue하지 않고 알린다', async () => {
    appMocks.genAPI.getAccessToken.mockResolvedValue('mount-token')
    const view = render(<App />)
    await waitFor(() => expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(2))

    const token = deferred()
    appMocks.genAPI.getAccessToken.mockReset().mockReturnValueOnce(token.promise)

    fireEvent.click(screen.getByTitle('actions.start'))
    await waitFor(() => expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(1))

    appMocks.state.generatingSceneId = 's4'
    view.rerender(<App />)
    await act(async () => {
      token.resolve('token')
      await token.promise
    })

    await waitFor(() => expect(appMocks.toastWarning).toHaveBeenCalledWith('videoAutomation.busy'))
    expect(appMocks.sceneBatchStart).not.toHaveBeenCalled()
    expect(appMocks.generationEnqueue).not.toHaveBeenCalled()
  })

  it('MCP Start는 같은 preflight race에서도 scene batch를 enqueue한다', async () => {
    appMocks.genAPI.getAccessToken.mockResolvedValue('mount-token')
    const view = render(<App />)
    await waitFor(() => expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(2))

    const token = deferred()
    appMocks.genAPI.getAccessToken.mockReset().mockReturnValueOnce(token.promise)

    const startPromise = appMocks.state.mcpProps.handleStart(undefined, { source: 'mcp' })
    await waitFor(() => expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(1))

    appMocks.state.generatingSceneId = 's4'
    view.rerender(<App />)
    await act(async () => {
      token.resolve('token')
      await startPromise
    })

    expect(appMocks.sceneBatchStart).toHaveBeenCalledTimes(1)
    expect(appMocks.generationEnqueue).toHaveBeenCalledTimes(1)
    expect(appMocks.toastWarning).not.toHaveBeenCalled()
  })

  it('StylePicker가 열린 뒤 개별 씬 생성이 시작되면 선택 시 preflight에 재진입하지 않고 알린다', async () => {
    appMocks.genAPI.getAccessToken.mockResolvedValue('mount-token')
    const { container, rerender } = render(<App />)
    await waitFor(() => expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(2))
    appMocks.genAPI.getAccessToken.mockReset().mockResolvedValue('token')

    fireEvent.click(container.querySelector('.btn-style-link'))
    expect(screen.getByRole('button', { name: 'pick-style' })).toBeInTheDocument()

    appMocks.state.generatingSceneId = 's4'
    rerender(<App />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'pick-style' }))
      await Promise.resolve()
    })

    expect(appMocks.genAPI.getAccessToken).not.toHaveBeenCalled()
    expect(appMocks.sceneBatchStart).not.toHaveBeenCalled()
    expect(appMocks.toastWarning).toHaveBeenCalledWith('videoAutomation.busy')
  })

  it('비차단 StylePicker 선택은 handleStart preflight와 empty-ref gate를 거쳐 UI 배치를 시작한다', async () => {
    appMocks.state.mode = 'flow'
    appMocks.genAPI.getAccessToken.mockResolvedValue('mount-token')
    const { container } = render(<App />)
    await waitFor(() => expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(2))
    appMocks.genAPI.getAccessToken.mockReset().mockResolvedValue('token')

    fireEvent.click(container.querySelector('.btn-style-link'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'pick-style' }))
      await Promise.resolve()
    })

    await waitFor(() => expect(appMocks.sceneBatchStart).toHaveBeenCalledTimes(1))
    expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(1)
    // sceneIds/batchIntent/currentRefs는 runEmptyRefGateFlow가 launch 직전에 만드는 payload다.
    // StylePicker가 automationStartRef를 직접 부르면 이 계약을 만들 수 없다.
    expect(appMocks.sceneBatchStart).toHaveBeenCalledWith(expect.objectContaining({
      selectedStyleRefId: 'preset:test',
      sceneIds: ['s1', 's2', 's3', 's4'],
      batchIntent: 'full',
      currentRefs: [],
    }))
  })

  it("비차단 StylePicker 선택 뒤 preflight 중 개별 생성이 시작되면 source:'ui' 재검사로 배치를 막는다", async () => {
    appMocks.state.mode = 'flow'
    appMocks.genAPI.getAccessToken.mockResolvedValue('mount-token')
    const { container, rerender } = render(<App />)
    await waitFor(() => expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(2))

    const token = deferred()
    appMocks.genAPI.getAccessToken.mockReset().mockReturnValueOnce(token.promise)
    fireEvent.click(container.querySelector('.btn-style-link'))
    fireEvent.click(screen.getByRole('button', { name: 'pick-style' }))
    await waitFor(() => expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(1))

    appMocks.state.generatingSceneId = 's4'
    rerender(<App />)
    await act(async () => {
      token.resolve('token')
      await token.promise
    })

    await waitFor(() => expect(appMocks.toastWarning).toHaveBeenCalledWith('videoAutomation.busy'))
    expect(appMocks.sceneBatchStart).not.toHaveBeenCalled()
    expect(appMocks.generationEnqueue).not.toHaveBeenCalled()
  })

  it('태그 Proceed 전에 개별 씬 생성이 시작되면 auth 재검사나 enqueue 없이 알린다', async () => {
    appMocks.genAPI.getAccessToken.mockResolvedValue('mount-token')
    appMocks.scenesHook.scenes = appMocks.scenes.map((scene, index) => (
      index === 0 ? { ...scene, characters: 'Missing' } : scene
    ))
    const view = render(<App />)
    await waitFor(() => expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(2))
    appMocks.genAPI.getAccessToken.mockReset().mockResolvedValue('token')

    fireEvent.click(screen.getByTitle('actions.start'))
    await screen.findByRole('button', { name: 'tag-proceed' })
    expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(1)

    appMocks.state.generatingSceneId = 's4'
    view.rerender(<App />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'tag-proceed' }))
      await Promise.resolve()
    })

    expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(1)
    expect(appMocks.sceneBatchStart).not.toHaveBeenCalled()
    expect(appMocks.toastWarning).toHaveBeenCalledWith('videoAutomation.busy')
  })

  it('태그 Proceed의 auth 재검사 중 개별 씬 생성이 시작되면 enqueue 직전에 차단한다', async () => {
    appMocks.genAPI.getAccessToken.mockResolvedValue('mount-token')
    appMocks.scenesHook.scenes = appMocks.scenes.map((scene, index) => (
      index === 0 ? { ...scene, characters: 'Missing' } : scene
    ))
    const view = render(<App />)
    await waitFor(() => expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(2))
    appMocks.genAPI.getAccessToken.mockReset().mockResolvedValue('token')

    fireEvent.click(screen.getByTitle('actions.start'))
    await screen.findByRole('button', { name: 'tag-proceed' })
    expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(1)

    const token = deferred()
    appMocks.genAPI.getAccessToken.mockReset().mockReturnValueOnce(token.promise)
    fireEvent.click(screen.getByRole('button', { name: 'tag-proceed' }))
    await waitFor(() => expect(appMocks.genAPI.getAccessToken).toHaveBeenCalledTimes(1))

    appMocks.state.generatingSceneId = 's4'
    view.rerender(<App />)
    await act(async () => {
      token.resolve('token')
      await token.promise
    })

    await waitFor(() => expect(appMocks.toastWarning).toHaveBeenCalledWith('videoAutomation.busy'))
    expect(appMocks.sceneBatchStart).not.toHaveBeenCalled()
    expect(appMocks.generationEnqueue).not.toHaveBeenCalled()
  })

  it('전체 재생성 확인창이 열린 뒤 개별 씬 생성이 시작돼도 확인은 배치를 넣지 않는다', async () => {
    appMocks.genAPI.getAccessToken.mockResolvedValue('token')
    appMocks.scenesHook.scenes = appMocks.scenes.map((scene, index) => (
      index === 0 ? { ...scene, image: 'generated-image' } : scene
    ))
    const view = render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /actions\.moreGenerateOptions/ }))
    fireEvent.click(screen.getByRole('button', { name: /actions\.forceRegenerate/ }))
    expect(screen.getByText('actions.forceRegenerateWarn')).toBeInTheDocument()

    appMocks.state.generatingSceneId = 's4'
    view.rerender(<App />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /actions\.forceRegenerate/ }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(appMocks.generationEnqueue).not.toHaveBeenCalled()
  })

  it('개별 씬 생성 중 Retry All 클릭은 배치를 넣지 않는다', () => {
    appMocks.state.generatingSceneId = 's4'
    appMocks.scenesHook.scenes = appMocks.scenes.map((scene, index) => (
      index === 0 ? { ...scene, status: 'error' } : scene
    ))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /actions\.retryErrors/ }))

    expect(appMocks.retryErrors).not.toHaveBeenCalled()
    expect(appMocks.generationEnqueue).not.toHaveBeenCalled()
  })

  it('개별 씬 생성 중 text 결과 Retry 클릭은 배치를 넣지 않는다', () => {
    appMocks.state.generatingSceneId = 's4'
    appMocks.scenesHook.scenes = appMocks.scenes.map((scene, index) => (
      index === 0 ? { ...scene, status: 'error' } : scene
    ))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'show-results' }))
    fireEvent.click(screen.getByRole('button', { name: 'retry-image-s1' }))

    expect(appMocks.retryScene).not.toHaveBeenCalled()
    expect(appMocks.generationEnqueue).not.toHaveBeenCalled()
  })

  it('개별 씬 생성 중 list 결과 Retry 클릭은 배치를 넣지 않는다', () => {
    appMocks.state.generatingSceneId = 's4'
    appMocks.scenesHook.scenes = appMocks.scenes.map((scene, index) => (
      index === 0 ? { ...scene, status: 'error' } : scene
    ))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /tabs\.list/ }))
    fireEvent.click(screen.getByRole('button', { name: 'show-results' }))
    fireEvent.click(screen.getByRole('button', { name: 'retry-image-s1' }))

    expect(appMocks.retryScene).not.toHaveBeenCalled()
    expect(appMocks.generationEnqueue).not.toHaveBeenCalled()
  })

  it('개별 씬 실행 중 MCP가 넣은 대기 배치는 Stop으로 scene_batch만 취소하고 래치를 푼다', async () => {
    appMocks.state.generatingSceneId = 's4'
    appMocks.state.holdSceneBatch = true
    appMocks.genAPI.getAccessToken.mockResolvedValue('token')
    render(<App />)

    await act(async () => {
      await appMocks.state.mcpProps.handleStart(undefined, { source: 'mcp' })
    })
    expect(appMocks.state.heldQueueItem?.job.type).toBe('scene_batch')

    const stopButton = await screen.findByRole('button', { name: /actions\.stop/ })
    fireEvent.click(stopButton)

    expect(appMocks.generationClearQueue).toHaveBeenCalledTimes(1)
    expect(appMocks.generationClearQueue).toHaveBeenCalledWith('scene_batch')
    expect(appMocks.automationStop).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('button', { name: /actions\.stop/ })).not.toBeInTheDocument())
  })

  it('Ref batch preflight 중에는 전체 재생성 메뉴를 비활성화한다', () => {
    appMocks.state.preparingRefs = true
    appMocks.state.refBatchActive = true
    appMocks.scenesHook.scenes = appMocks.scenes.map((scene, index) => (
      index === 0 ? { ...scene, image: 'generated-image' } : scene
    ))

    render(<App />)

    expect(screen.getByRole('button', { name: /actions\.moreGenerateOptions/ })).toBeDisabled()
  })

  it('useAutomation의 scene batch 대기 신호를 MCP liveness 입력에 전달한다', () => {
    appMocks.state.isSceneBatchQueued = true
    render(<App />)

    expect(appMocks.state.mcpProps.automationState.isSceneBatchQueued).toBe(true)
    expect(appMocks.state.mcpProps.isRunning).toBe(true)
  })

  it('개별 씬 생성 중 신호를 네이티브 프로젝트 메뉴의 busy로 전달한다', () => {
    appMocks.state.generatingSceneId = 's4'
    render(<App />)

    expect(appMocks.state.menuProps.busy).toBe(true)
  })

  it('I2V 행 삭제와 늦은 완료 사이에 렌더가 없어도 owner 씬을 건드리지 않는다', async () => {
    appMocks.genAPI.getAccessToken.mockResolvedValue('token')
    render(<StrictMode><App /></StrictMode>)

    fireEvent.click(screen.getByTitle('tabs.frameToVideo'))
    await waitFor(() => expect(appMocks.state.framePanelProps).toBeTruthy())

    const pair = {
      id: 'fp-1',
      ownerSceneId: 's1',
      startSceneId: 's1',
      endSceneId: null,
      prompt: 'scene 1',
      selected: true,
      status: 'pending',
    }
    act(() => appMocks.state.framePanelProps.onUpdate([pair]))
    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs).toEqual([pair]))

    fireEvent.click(screen.getByTitle('actions.start'))
    await waitFor(() => expect(appMocks.videoStart).toHaveBeenCalledTimes(1))
    const { onItemUpdate } = appMocks.state.videoStartOptions
    appMocks.scenesHook.updateScene.mockClear()

    act(() => onItemUpdate('fp-1', 'generating', { generatingStartedAt: 123 }))
    expect(appMocks.scenesHook.updateScene).toHaveBeenCalledTimes(1)
    expect(appMocks.scenesHook.updateScene).toHaveBeenCalledWith('s1', expect.objectContaining({
      videoI2VStatus: 'generating',
      videoI2VGeneratingStartedAt: 123,
    }))

    act(() => {
      appMocks.state.framePanelProps.onUpdate([])
      onItemUpdate('fp-1', 'complete', { base64: 'VIDEO' })
    })
    expect(appMocks.scenesHook.updateScene).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs).toEqual([]))
  })

  it('I2V onItemUpdate를 렌더 없이 연속 호출해도 첫 완료의 비디오 데이터와 둘째 패치가 모두 남는다', async () => {
    appMocks.genAPI.getAccessToken.mockResolvedValue('token')
    render(<App />)

    fireEvent.click(screen.getByTitle('tabs.frameToVideo'))
    await waitFor(() => expect(appMocks.state.framePanelProps).toBeTruthy())
    const pair = {
      id: 'fp-1', ownerSceneId: 's1', startSceneId: 's1', endSceneId: null,
      prompt: 'scene 1', selected: true, status: 'pending',
    }
    act(() => appMocks.state.framePanelProps.onUpdate([pair]))
    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs).toEqual([pair]))

    fireEvent.click(screen.getByTitle('actions.start'))
    await waitFor(() => expect(appMocks.videoStart).toHaveBeenCalledTimes(1))
    const { onItemUpdate } = appMocks.state.videoStartOptions

    act(() => {
      onItemUpdate('fp-1', 'complete', { base64: 'VIDEO' })
      onItemUpdate('fp-1', 'complete', { videoPath: '/videos/fp-1.mp4' })
    })

    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs[0]).toEqual(expect.objectContaining({
      id: 'fp-1', status: 'complete', base64: 'VIDEO', videoPath: '/videos/fp-1.mp4',
    })))
  })

  it('프로젝트 framePairs 교체와 옛 완료 사이에 렌더가 없어도 같은 id의 새 프로젝트 씬을 건드리지 않는다', async () => {
    appMocks.genAPI.getAccessToken.mockResolvedValue('token')
    render(<App />)

    fireEvent.click(screen.getByTitle('tabs.frameToVideo'))
    await waitFor(() => expect(appMocks.state.framePanelProps).toBeTruthy())
    const oldPair = {
      id: 'fp-old', ownerSceneId: 's1', startSceneId: 's1', endSceneId: null,
      prompt: 'old scene', selected: true, status: 'pending',
    }
    act(() => appMocks.state.framePanelProps.onUpdate([oldPair]))
    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs).toEqual([oldPair]))

    fireEvent.click(screen.getByTitle('actions.start'))
    await waitFor(() => expect(appMocks.videoStart).toHaveBeenCalledTimes(1))
    const { onItemUpdate } = appMocks.state.videoStartOptions
    const loadedPair = {
      id: 'fp-new', ownerSceneId: 's1', startSceneId: 's1', endSceneId: null,
      prompt: 'new scene', selected: true, status: 'pending',
    }

    appMocks.scenesHook.updateScene.mockClear()
    act(() => {
      appMocks.state.projectDataProps.setFramePairs([loadedPair])
      onItemUpdate('fp-old', 'complete', { base64: 'OLD_VIDEO' })
    })

    expect(appMocks.scenesHook.updateScene).not.toHaveBeenCalled()
    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs).toEqual([loadedPair]))
  })

  it('I2V 시작 뒤 load epoch가 바뀌면 같은 fp_1의 새 프로젝트 pair와 owner 씬을 건드리지 않는다', async () => {
    appMocks.genAPI.getAccessToken.mockResolvedValue('token')
    render(<App />)

    fireEvent.click(screen.getByTitle('tabs.frameToVideo'))
    await waitFor(() => expect(appMocks.state.framePanelProps).toBeTruthy())
    const oldPair = {
      id: 'fp_1', ownerSceneId: 's1', startSceneId: 's1', endSceneId: null,
      prompt: 'old scene', selected: true, status: 'pending',
    }
    act(() => appMocks.state.framePanelProps.onUpdate([oldPair]))
    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs).toEqual([oldPair]))

    fireEvent.click(screen.getByTitle('actions.start'))
    await waitFor(() => expect(appMocks.videoStart).toHaveBeenCalledTimes(1))
    const { onItemUpdate } = appMocks.state.videoStartOptions
    const newPair = {
      id: 'fp_1', ownerSceneId: 's2', startSceneId: 's2', endSceneId: null,
      prompt: 'new scene', selected: true, status: 'pending',
    }

    appMocks.scenesHook.updateScene.mockClear()
    act(() => {
      appMocks.loadEpochRef.current += 1
      appMocks.state.projectDataProps.setFramePairs([newPair])
      onItemUpdate('fp_1', 'complete', { base64: 'OLD_VIDEO', videoPath: '/old.mp4' })
    })

    expect(appMocks.scenesHook.updateScene).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ videoI2V: 'OLD_VIDEO' }),
    )
    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs).toEqual([newPair]))
  })

  it('다운로드 재시도 대기 중 행을 지우면 늦은 완료가 pair와 owner 씬을 모두 건드리지 않는다', async () => {
    appMocks.genAPI.getAccessToken.mockResolvedValue('token')
    appMocks.genAPI.checkVideoStatus.mockResolvedValue({
      success: true,
      statuses: [{ status: 'complete', mediaId: 'media-old', videoUrl: 'https://video.test/old' }],
    })
    const download = deferred()
    appMocks.genAPI.downloadVideo.mockReturnValue(download.promise)
    render(<App />)

    fireEvent.click(screen.getByTitle('tabs.frameToVideo'))
    await waitFor(() => expect(appMocks.state.framePanelProps).toBeTruthy())
    const pair = {
      id: 'fp_1', ownerSceneId: 's1', startSceneId: 's1', endSceneId: null,
      prompt: 'old scene', selected: true, status: 'error',
      generationId: 'generation-old', mediaId: 'media-old',
    }
    act(() => appMocks.state.framePanelProps.onUpdate([pair]))
    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs).toEqual([pair]))

    await act(async () => {
      await appMocks.state.framePanelProps.onVideoRetry(pair)
    })
    await waitFor(() => expect(appMocks.genAPI.downloadVideo).toHaveBeenCalledTimes(1))

    act(() => appMocks.state.framePanelProps.onUpdate([]))
    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs).toEqual([]))
    appMocks.scenesHook.updateScene.mockClear()
    await act(async () => {
      download.resolve({ success: true, base64: 'OLD_VIDEO' })
      await download.promise
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(appMocks.scenesHook.updateScene).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ videoI2V: 'OLD_VIDEO' }),
    )
    expect(appMocks.state.framePanelProps.framePairs).toEqual([])
  })

  it('다운로드 재시도 시작 뒤 load epoch가 바뀌면 같은 fp_1의 새 pair와 owner 씬을 건드리지 않는다', async () => {
    appMocks.genAPI.getAccessToken.mockResolvedValue('token')
    appMocks.genAPI.checkVideoStatus.mockResolvedValue({
      success: true,
      statuses: [{ status: 'complete', mediaId: 'media-old', videoUrl: 'https://video.test/old' }],
    })
    const download = deferred()
    appMocks.genAPI.downloadVideo.mockReturnValue(download.promise)
    render(<App />)

    fireEvent.click(screen.getByTitle('tabs.frameToVideo'))
    await waitFor(() => expect(appMocks.state.framePanelProps).toBeTruthy())
    const oldPair = {
      id: 'fp_1', ownerSceneId: 's1', startSceneId: 's1', endSceneId: null,
      prompt: 'old scene', selected: true, status: 'error',
      generationId: 'generation-old', mediaId: 'media-old',
    }
    act(() => appMocks.state.framePanelProps.onUpdate([oldPair]))
    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs).toEqual([oldPair]))

    await act(async () => {
      await appMocks.state.framePanelProps.onVideoRetry(oldPair)
    })
    await waitFor(() => expect(appMocks.genAPI.downloadVideo).toHaveBeenCalledTimes(1))
    const newPair = {
      id: 'fp_1', ownerSceneId: 's2', startSceneId: 's2', endSceneId: null,
      prompt: 'new scene', selected: true, status: 'pending',
    }

    act(() => {
      appMocks.loadEpochRef.current += 1
      appMocks.state.projectDataProps.setFramePairs([newPair])
    })
    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs).toEqual([newPair]))
    appMocks.scenesHook.updateScene.mockClear()
    await act(async () => {
      download.resolve({ success: true, base64: 'OLD_VIDEO' })
      await download.promise
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(appMocks.scenesHook.updateScene).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ videoI2V: 'OLD_VIDEO' }),
    )
    expect(appMocks.state.framePanelProps.framePairs).toEqual([newPair])
  })
})
