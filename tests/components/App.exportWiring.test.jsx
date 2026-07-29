/**
 * App export wiring — Header.hasImages / ExportModal 카운트가 실제로 배선돼 있는가
 *
 * 회귀 컨텍스트:
 *   519 씬 프로젝트에서 518 개가 `status:'pending'` 인데 `imagePath` 는 채워져 있었다.
 *   1) Header 의 `hasImages` 가 `scenes.some(isSceneGenerationDone)` 이면 그 프로젝트는
 *      내보내기 버튼 자체가 비활성 — 모달에 도달조차 못 한다.
 *   2) ExportModal 에 `{...buildExportModalCounts(scenes)}` 를 안 넘기면 세 카운트가 전부
 *      0 으로 기본값 처리돼 포함/제외 모달이 영영 안 뜬다(기능 통째로 무음 revert).
 *
 *   두 배선 모두 `src/App.jsx` 의 JSX 안에만 존재해서, 서비스 단위 테스트(exportSelection)
 *   로는 잡히지 않는다 — 술어는 맞는데 App 이 그걸 안 부르는 형태의 회귀다.
 *   그래서 여기서는 **진짜 App 을 렌더**하고 Header / ExportModal 이 실제로 받은 props 를 본다.
 *
 * 하네스: `tests/components/App.promptBusyLines.test.jsx` 의 mock 세트를 그대로 따랐다
 *   (App 은 훅 의존이 많아 이 세트가 있어야 mount 된다).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const appMocks = vi.hoisted(() => {
  const noop = vi.fn()
  const asyncNoop = vi.fn(async () => null)
  const loadEpochRef = { current: 0 }
  const captured = { headerProps: null, exportModalProps: null }
  // 기본 fixture — 아무 씬도 없는 상태로 mount 한 뒤 테스트마다 갈아끼운다.
  const scenesHook = {
    scenes: [],
    scenesRef: { current: [] },
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
    importStoryScenes: vi.fn(() => ({ nextScenes: [], nextSrtTrack: [] })),
  }
  const genAPI = {
    getAccessToken: vi.fn(async () => null),
    checkVideoStatus: vi.fn(),
    downloadVideo: vi.fn(),
    fetchGallery: vi.fn(async () => ({ success: true, items: [] })),
    listFlowProjects: asyncNoop,
    capabilities: {},
  }
  return { noop, asyncNoop, loadEpochRef, captured, scenesHook, genAPI }
})

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key) => key, lang: 'ko' }),
  // 에이전트 패널(ChatPanel)은 provider 없이도 렌더되도록 useOptionalI18n 을 쓴다 — App 이 그걸
  // 렌더하므로 이 mock 에도 있어야 한다(없으면 모듈 로드가 통째로 터진다). 4차 머지 이후 이 브랜치의
  // App 이 agent 패널을 마운트하면서 main 의 이 테스트가 그 표면을 함께 렌더하게 됐다.
  useOptionalI18n: () => ({ t: (key) => key, lang: 'ko' }),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: appMocks.noop, error: appMocks.noop, warning: appMocks.noop, info: appMocks.noop },
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
      projectName: 'export-wiring-test',
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
    ensureProjectName: () => 'export-wiring-test',
    projectNameRef: { current: 'export-wiring-test' },
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
  useGenerationQueue: () => ({ enqueue: appMocks.asyncNoop, clearQueue: appMocks.noop }),
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
    retryErrors: appMocks.asyncNoop,
    retryScene: appMocks.asyncNoop,
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
  return { ...actual, checkFolderPermission: async () => ({ ok: true }) }
})

// ── 관측 지점 두 개 ──────────────────────────────────────────────────────────
// 실제 컴포넌트를 그대로 두면 hasImages / 카운트가 내부 렌더 디테일에 묻힌다.
// props 를 그대로 붙잡아 App 이 "무엇을 넘겼는가"만 본다.
vi.mock('../../src/components/Header', () => ({
  default: props => { appMocks.captured.headerProps = props; return null },
}))
vi.mock('../../src/components/ExportModal', () => ({
  ExportModal: props => { appMocks.captured.exportModalProps = props; return null },
}))

vi.mock('../../src/components/PromptInput', () => ({ default: () => null }))
vi.mock('../../src/components/SceneList', () => ({ default: () => null }))
vi.mock('../../src/components/ResultsTable', () => ({ default: () => null }))
vi.mock('../../src/components/FrameToVideoPanel', () => ({ default: () => null }))
vi.mock('../../src/components/ReferencePanel', () => ({ default: () => null }))
vi.mock('../../src/components/SettingsModal', () => ({ default: () => null }))
vi.mock('../../src/components/ImportModal', () => ({ default: () => null }))
vi.mock('../../src/components/StatusBar', () => ({ default: () => null }))
vi.mock('../../src/components/SceneDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/VideoDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/ResizeHandle', () => ({ default: () => null }))
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
vi.mock('../../src/components/Modal', () => ({ default: () => null }))
vi.mock('../../src/components/DeleteSceneConfirmModal', () => ({ default: () => null }))
vi.mock('../../src/components/FlowProjectAdoptModal', () => ({ default: () => null }))
vi.mock('../../src/components/SrtImportConflictModal', () => ({ default: () => null }))
vi.mock('../../src/components/ImportProcessingOverlay', () => ({ default: () => null }))
vi.mock('../../src/components/story/StoryView', () => ({ default: () => null }))

import App from '../../src/App'

/** 씬을 갈아끼우고 App 을 렌더한 뒤, 붙잡은 props 를 돌려준다. */
function renderAppWithScenes(scenes) {
  appMocks.scenesHook.scenes = scenes
  appMocks.scenesHook.scenesRef.current = scenes
  render(<App />)
  return appMocks.captured
}

describe('App export wiring — Header.hasImages / ExportModal 카운트', () => {
  afterEach(() => {
    cleanup()
    appMocks.captured.headerProps = null
    appMocks.captured.exportModalProps = null
    appMocks.scenesHook.scenes = []
    appMocks.scenesHook.scenesRef.current = []
    appMocks.loadEpochRef.current = 0
  })

  // ⭐ 원래 버그 그 자체 — 519 씬 프로젝트에서 518 개가 pending + imagePath 였다.
  // `hasImages={scenes.some(isSceneGenerationDone)}` 로 되돌리면 여기서 false 가 되어 죽는다.
  it('전부 pending 이어도 imagePath 가 있으면 Header 에 hasImages=true 를 넘긴다', () => {
    const { headerProps } = renderAppWithScenes([
      { id: 's1', prompt: 'p1', status: 'pending', imagePath: '/work/s1.png' },
      { id: 's2', prompt: 'p2', status: 'pending', imagePath: '/work/s2.png' },
      { id: 's3', prompt: 'p3', status: 'pending', imagePath: '/work/s3.png' },
    ])

    expect(headerProps).not.toBeNull()
    expect(headerProps.hasImages).toBe(true)
  })

  it('done 씬이 하나라도 있으면 hasImages=true 다 (기존 동작 보존)', () => {
    const { headerProps } = renderAppWithScenes([
      { id: 's1', prompt: 'p1', status: 'done', imagePath: '/work/s1.png' },
      { id: 's2', prompt: 'p2', status: 'pending' },
    ])

    expect(headerProps.hasImages).toBe(true)
  })

  it('내보낼 수 있는 씬이 하나도 없으면 hasImages=false 다', () => {
    // pending 인데 이미지가 없고, error/generating 은 디스크 이미지가 있어도 대상이 아니다.
    const { headerProps } = renderAppWithScenes([
      { id: 's1', prompt: 'p1', status: 'pending' },
      { id: 's2', prompt: 'p2', status: 'error', imagePath: '/work/s2.png' },
      { id: 's3', prompt: 'p3', status: 'generating', imagePath: '/work/s3.png' },
    ])

    expect(headerProps.hasImages).toBe(false)
  })

  it('씬이 아예 없으면 hasImages=false 다', () => {
    const { headerProps } = renderAppWithScenes([])
    expect(headerProps.hasImages).toBe(false)
  })

  // ⭐ `{...buildExportModalCounts(scenes)}` 를 지우면 세 prop 이 통째로 사라지고
  // 모달은 카운트 0 으로 기본값 처리 → 포함/제외 UI 가 영영 안 뜬다.
  //
  // 리터럴로 못박는다. 2 done / 3 pending+image / 2 unusable 이라
  // `readyCount + pendingWithImageCount (5) !== totalSceneCount (7)` 이므로,
  // total 을 "ready+pending" 으로 계산하는 잘못된 식과도 구별된다.
  it('ExportModal 에 씬 전체·ready·pending+image 카운트를 넘긴다', () => {
    const { exportModalProps } = renderAppWithScenes([
      { id: 'd1', prompt: 'p', status: 'done', imagePath: '/work/d1.png' },
      { id: 'd2', prompt: 'p', status: 'done', image: 'data:image/png;base64,AAA' },
      { id: 'p1', prompt: 'p', status: 'pending', imagePath: '/work/p1.png' },
      { id: 'p2', prompt: 'p', status: 'pending', imagePath: '/work/p2.png' },
      { id: 'p3', prompt: 'p', status: 'pending', image: 'data:image/png;base64,BBB' },
      { id: 'u1', prompt: 'p', status: 'pending' },
      { id: 'u2', prompt: 'p', status: 'error', imagePath: '/work/u2.png' },
    ])

    expect(exportModalProps).not.toBeNull()
    expect(exportModalProps.totalSceneCount).toBe(7)
    expect(exportModalProps.readyCount).toBe(2)
    expect(exportModalProps.pendingWithImageCount).toBe(3)
  })

  it('pending+image 가 없으면 pendingWithImageCount=0 을 넘긴다', () => {
    const { exportModalProps } = renderAppWithScenes([
      { id: 'd1', prompt: 'p', status: 'done', imagePath: '/work/d1.png' },
      { id: 'u1', prompt: 'p', status: 'pending' },
    ])

    expect(exportModalProps.totalSceneCount).toBe(2)
    expect(exportModalProps.readyCount).toBe(1)
    expect(exportModalProps.pendingWithImageCount).toBe(0)
  })
})
