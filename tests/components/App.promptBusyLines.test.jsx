import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const appMocks = vi.hoisted(() => {
  const noop = vi.fn()
  const asyncNoop = vi.fn(async () => null)
  const state = {
    generatingSceneId: null,
    preparingRefs: false,
    refBatchActive: false,
    isSceneBatchQueued: false,
    holdSceneBatch: false,
    heldQueueItem: null,
    mcpProps: null,
    framePanelProps: null,
    videoStartOptions: null,
  }
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
    updateSrtLine: noop,
    addScene: noop,
    trimScenes: noop,
    clearScenes: noop,
    deleteScene: noop,
    importStoryScenes: vi.fn(() => ({ nextScenes: scenes, nextSrtTrack: [] })),
  }
  const genAPI = {
    getAccessToken: vi.fn(async () => null),
    fetchGallery: vi.fn(async () => ({ success: true, items: [] })),
    listFlowProjects: asyncNoop,
    capabilities: {},
  }
  return {
    noop, asyncNoop, state,
    generationEnqueue, generationClearQueue, sceneBatchStart, automationStop, videoStart,
    scenes, scenesHook, genAPI,
  }
})

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key) => key, lang: 'ko' }),
}))
vi.mock('../../src/contexts/ModeContext', () => ({ useMode: () => ({ mode: 'api', clearMode: appMocks.noop }) }))
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
  useProjectData: () => ({
    addPendingSave: appMocks.noop,
    handleProjectChange: appMocks.noop,
    saveCurrentProject: appMocks.asyncNoop,
    saveCurrentProjectWithPayload: vi.fn(async () => ({ ok: true })),
    isRestoringRef: { current: false },
    projectLoading: false,
    hydratedRef: { current: true },
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
    retryErrors: appMocks.noop,
    retryScene: vi.fn(async () => null),
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
vi.mock('../../src/components/GenerateMenu', async () => {
  const React = await import('react')
  return {
    default: ({ disabled }) => React.createElement('button', {
      type: 'button',
      'data-testid': 'generate-menu',
      disabled,
    }),
  }
})
vi.mock('../../src/components/FrameToVideoPanel', () => ({
  default: props => { appMocks.state.framePanelProps = props; return null },
}))
vi.mock('../../src/components/ReferencePanel', () => ({ default: () => null }))
vi.mock('../../src/components/SettingsModal', () => ({ default: () => null }))
vi.mock('../../src/components/ImportModal', () => ({ default: () => null }))
vi.mock('../../src/components/StatusBar', () => ({ default: () => null }))
vi.mock('../../src/components/ResultsTable', () => ({ default: () => null }))
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
vi.mock('../../src/components/Modal', () => ({ default: ({ children }) => children }))
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
    appMocks.state.preparingRefs = false
    appMocks.state.refBatchActive = false
    appMocks.state.isSceneBatchQueued = false
    appMocks.state.holdSceneBatch = false
    appMocks.state.heldQueueItem = null
    appMocks.state.mcpProps = null
    appMocks.state.framePanelProps = null
    appMocks.state.videoStartOptions = null
    appMocks.scenesHook.scenes = appMocks.scenes
    appMocks.scenesHook.scenesRef.current = appMocks.scenes
    appMocks.genAPI.getAccessToken.mockReset().mockResolvedValue(null)
    appMocks.generationEnqueue.mockClear()
    appMocks.generationClearQueue.mockClear()
    appMocks.sceneBatchStart.mockClear()
    appMocks.automationStop.mockClear()
    appMocks.videoStart.mockClear()
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

  it('개별 씬 생성 중에는 primary Start만 비활성화하고 공유 큐에 enqueue하지 않는다', async () => {
    appMocks.state.generatingSceneId = 's4'
    appMocks.genAPI.getAccessToken.mockResolvedValue('token')
    render(<App />)

    const startButton = screen.getByTitle('actions.start')
    expect(startButton).toBeDisabled()

    fireEvent.click(startButton)

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

    expect(screen.getByTestId('generate-menu')).toBeDisabled()
  })

  it('useAutomation의 scene batch 대기 신호를 MCP liveness 입력에 전달한다', () => {
    appMocks.state.isSceneBatchQueued = true
    render(<App />)

    expect(appMocks.state.mcpProps.automationState.isSceneBatchQueued).toBe(true)
    expect(appMocks.state.mcpProps.isRunning).toBe(true)
  })

  it('I2V 결과는 StrictMode에서도 owner 씬을 한 번만 갱신하고 삭제된 행은 건드리지 않는다', async () => {
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

    act(() => appMocks.state.framePanelProps.onUpdate([]))
    await waitFor(() => expect(appMocks.state.framePanelProps.framePairs).toEqual([]))
    act(() => onItemUpdate('fp-1', 'complete', { base64: 'VIDEO' }))
    expect(appMocks.scenesHook.updateScene).toHaveBeenCalledTimes(1)
  })
})
