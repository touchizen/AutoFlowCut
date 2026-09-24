/**
 * App — Flow 세션 이유가 Start 프리플라이트의 안내문에 닿는가 (R1#1 / R2#3)
 *
 * useAutomation.start() 는 훅 테스트가 덮지만, 사용자가 누르는 Start 는 App.handleStartImpl 의 프리플라이트가 먼저
 * getAccessToken() 을 묻고, 실패하면 getAuthRequiredMessage('flow', t) 로 토스트를 띄운다. 여기에 이유
 * (genAPI.flowSessionReason) 를 안 넘기면 nzlxg 500/timeout 이 "Flow 로그인이 필요합니다" 로 둔갑한다 — 사용자는 멀쩡한
 * 세션을 다시 로그인한다. 진짜 App 을 flow 모드로 렌더하고 handleStart 를 불러 토스트 문구를 본다.
 *
 * 하네스: tests/components/App.exportWiring.test.jsx 의 mock 세트를 그대로(모드·genAPI·toast·MCP 관측만 다르다).
 *
 * R2-2#4(§12 #46): 같은 이유가 영상 단일 재시도(ResultsTable 의 onVideoRetry → handleVideoRetry 의 download-only 프리플라이트)와
 *   태그 검증 모달의 진행(TagValidationModal 의 onProceed → handleTagValidationProceed 의 인증 재확인)에도 닿는다.
 * M2-5(T6): videoAutomation.start 의 onItemUpdate 화이트리스트가 errorParams·rejectedMediaId(s) 를 updateVideoScene 패치로 통과시킨다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

const appMocks = vi.hoisted(() => {
  const noop = vi.fn()
  const asyncNoop = vi.fn(async () => null)
  const loadEpochRef = { current: 0 }
  const captured = { headerProps: null, exportModalProps: null, mcpProps: null, resultsTableProps: null, tagModalProps: null, videoStart: null }
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
  // R2-2#4 / M2-5: 영상 씬·패치 관측
  const videoScenes = []
  const updateVideoScene = vi.fn()
  const videoStart = vi.fn(async (opts) => { captured.videoStart = opts })
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
    mode: 'flow',
    // flow:session-status 가 not-ready(rpc:http:500) 라고 답한 상태 — 로그인이 답이 아닌 이유.
    getAccessToken: vi.fn(async () => null),
    flowSessionReason: vi.fn(() => 'rpc:http:500'),
    checkVideoStatus: vi.fn(),
    downloadVideo: vi.fn(),
    fetchGallery: vi.fn(async () => ({ success: true, items: [] })),
    listFlowProjects: asyncNoop,
    capabilities: {},
  }
  return { noop, asyncNoop, loadEpochRef, captured, scenesHook, genAPI, toast, videoScenes, updateVideoScene, videoStart }
})

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key) => key, lang: 'ko' }),
}))
vi.mock('../../src/components/Toast', () => ({ toast: appMocks.toast }))
vi.mock('../../src/contexts/ModeContext', () => ({ useMode: () => ({ mode: 'flow', clearMode: appMocks.noop }) }))
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
    videoScenes: appMocks.videoScenes,
    setVideoScenes: appMocks.noop,
    toggleSelect: appMocks.noop,
    toggleSelectAll: appMocks.noop,
    updateVideoScene: appMocks.updateVideoScene,
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
    start: appMocks.videoStart,   // M2-5: App 이 넘기는 onItemUpdate(화이트리스트)를 붙잡는다
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
// 관측 지점: MCP 훅이 받는 handleStart 가 App 의 진짜 Start 프리플라이트다(Header 의 버튼과 같은 함수).
vi.mock('../../src/hooks/useMcpServer', () => ({ useMcpServer: props => { appMocks.captured.mcpProps = props } }))
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
// R2-2#4: 영상 표의 onVideoRetry(handleVideoRetry) 를 붙잡는다 — 이미지 표(onVideoRetry 없음)는 무시.
vi.mock('../../src/components/ResultsTable', () => ({ default: props => { if (props?.onVideoRetry) appMocks.captured.resultsTableProps = props; return null } }))
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
vi.mock('../../src/components/TagValidationModal', () => ({ default: props => { appMocks.captured.tagModalProps = props; return null } }))
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

afterEach(() => {
  cleanup(); vi.clearAllMocks()
  appMocks.genAPI.flowSessionReason.mockReturnValue('rpc:http:500')
  appMocks.genAPI.getAccessToken.mockImplementation(async () => null)   // clearAllMocks 는 구현을 되돌리지 않는다
  appMocks.scenesHook.scenes = []; appMocks.scenesHook.scenesRef.current = []
  appMocks.videoScenes.length = 0
  appMocks.captured.resultsTableProps = null; appMocks.captured.tagModalProps = null; appMocks.captured.videoStart = null
  localStorage.removeItem('autoflowcut_bottomPanelView')
})

describe('App Start 프리플라이트 — Flow 세션 이유', () => {
  it('세션 판정 실패(rpc:http:500)면 이유가 든 안내를 띄운다 — "Flow 로그인" 안내가 아니다', async () => {
    render(<App />)
    expect(appMocks.captured.mcpProps?.handleStart).toBeTypeOf('function')

    await act(async () => { await appMocks.captured.mcpProps.handleStart() })

    expect(appMocks.genAPI.getAccessToken).toHaveBeenCalled()
    expect(appMocks.toast.warning).toHaveBeenCalledTimes(1)
    const msg = appMocks.toast.warning.mock.calls[0][0]
    expect(msg).toContain('rpc:http:500')
    expect(msg).not.toContain('Flow login required')
    expect(msg).not.toBe('toast.flowLoginRequired')
  })

  it('이유가 로그인 쪽(wiz-missing)이면 로그인 안내', async () => {
    appMocks.genAPI.flowSessionReason.mockReturnValue('wiz-missing')
    render(<App />)
    await act(async () => { await appMocks.captured.mcpProps.handleStart() })
    const msg = appMocks.toast.warning.mock.calls[0][0]
    expect(msg).toMatch(/Flow login required|toast\.flowLoginRequired/)
    expect(msg).not.toContain('wiz-missing')
  })
})

// ── R2-2#4 (§12 #46): 영상 재시도 · 태그 진행 자리도 같은 이유를 쓴다 ────────────────────────────────────────────
describe('App — 영상 재시도(onVideoRetry)와 태그 진행(onProceed)의 Flow 세션 이유 (R2-2#4)', () => {
  it('ResultsTable 의 onVideoRetry(download-only 항목) 프리플라이트가 세션 미준비(rpc:http:500)면 이유가 든 안내 — 로그인 안내가 아니다', async () => {
    appMocks.videoScenes.push({ id: 'vscene_1', prompt: 'p', selected: true, status: 'error', generationId: 'g1', mediaId: 'm1' })
    localStorage.setItem('autoflowcut_bottomPanelView', 'table')   // 하단 패널 기본은 타임라인 — 표 뷰여야 ResultsTable 이 그려진다
    render(<App />)
    // 영상 표는 영상 탭에서만 렌더된다 — 탭 오버라이드 Start 로 탭을 옮긴다(세션 미준비라 Start 자체는 안내 뒤 멈춘다).
    await act(async () => { await appMocks.captured.mcpProps.handleStart(undefined, { tab: 'video-text' }) })
    appMocks.toast.warning.mockClear()
    const props = appMocks.captured.resultsTableProps
    expect(props?.onVideoRetry).toBeTypeOf('function')
    await act(async () => { await props.onVideoRetry({ id: 'vscene_1', generationId: 'g1', mediaId: 'm1' }) })
    expect(appMocks.genAPI.getAccessToken).toHaveBeenCalled()
    expect(appMocks.toast.warning).toHaveBeenCalledTimes(1)
    const msg = appMocks.toast.warning.mock.calls[0][0]
    expect(msg).toContain('rpc:http:500')
    expect(msg).not.toMatch(/Flow login required|toast\.flowLoginRequired/)
  })

  it('TagValidationModal 의 onProceed 인증 재확인이 세션 미준비(rpc:http:500)면 이유가 든 안내', async () => {
    // 태그 오류가 있는 씬 → 첫 handleStart(세션 준비됨)는 모달을 띄우고 멈춘다 → onProceed 에서 세션이 죽었다.
    appMocks.scenesHook.scenes = [{ id: 'scene_1', prompt: 'a', status: 'pending', characters: 'ghost' }]
    appMocks.scenesHook.scenesRef.current = appMocks.scenesHook.scenes
    appMocks.genAPI.getAccessToken.mockImplementation(async () => 'flow-session')   // 마운트 재확인도 이 값을 본다
    render(<App />)
    await act(async () => { await appMocks.captured.mcpProps.handleStart() })
    expect(appMocks.captured.tagModalProps?.onProceed).toBeTypeOf('function')
    expect(appMocks.toast.warning).not.toHaveBeenCalled()
    appMocks.genAPI.getAccessToken.mockImplementation(async () => null)   // 모달이 떠 있는 동안 세션이 죽었다
    await act(async () => { await appMocks.captured.tagModalProps.onProceed() })
    expect(appMocks.toast.warning).toHaveBeenCalledTimes(1)
    const msg = appMocks.toast.warning.mock.calls[0][0]
    expect(msg).toContain('rpc:http:500')
    expect(msg).not.toMatch(/Flow login required|toast\.flowLoginRequired/)
  })
})

// ── M2-R3 H3 (A3): Regenerate 는 항목을 fresh 로 만든다 ─────────────────────────────────────────────────────────────
// Flow 모드 Phase 0 은 출처(generationId 있음 + videoPath 없음)로 분류한다 — Regenerate(handleVideoRetry forceRegenerate 의 slow path)가 generationId·mediaId 를
//   남기면 재생성이 download-only/in-flight 로 잡혀 새 생성이 안 된다. Regenerate/Clear 만이 항목을 fresh 로 만든다.
describe('App — Regenerate(forceRegenerate) 는 generationId·mediaId 를 null 로 지운다 (M2-R3 H3)', () => {
  it('download-only 항목의 onVideoRetry(item, {forceRegenerate:true}) → updateVideoScene 패치 {status:pending, error:null, generationId:null, mediaId:null}, 상태 확인·다운로드 없음', async () => {
    appMocks.videoScenes.push({ id: 'vscene_1', prompt: 'p', selected: true, status: 'error', generationId: 'g1', mediaId: 'm1' })
    localStorage.setItem('autoflowcut_bottomPanelView', 'table')
    render(<App />)
    await act(async () => { await appMocks.captured.mcpProps.handleStart(undefined, { tab: 'video-text' }) })
    const props = appMocks.captured.resultsTableProps
    expect(props?.onVideoRetry).toBeTypeOf('function')
    appMocks.updateVideoScene.mockClear(); appMocks.genAPI.getAccessToken.mockClear()
    await act(async () => { await props.onVideoRetry({ id: 'vscene_1', generationId: 'g1', mediaId: 'm1', status: 'error' }, { forceRegenerate: true }) })
    expect(appMocks.updateVideoScene).toHaveBeenCalledTimes(1)
    expect(appMocks.updateVideoScene).toHaveBeenLastCalledWith('vscene_1', expect.objectContaining({ status: 'pending', error: null, generationId: null, mediaId: null, downloadGated: null }))   // downloadGated: M2-R3 H6
    expect(appMocks.genAPI.getAccessToken).not.toHaveBeenCalled()   // slow path — download-only 프리플라이트가 아니다
    expect(appMocks.genAPI.checkVideoStatus).not.toHaveBeenCalled()
  })
})

// ── M2-5 (T6): App 의 영상 onItemUpdate 화이트리스트 ────────────────────────────────────────────────────────────
describe('App — videoAutomation.start 의 onItemUpdate 화이트리스트가 errorParams·rejectedMediaId(s) 를 통과시킨다 (M2-5)', () => {
  it('거부 패치 → updateVideoScene 에 errorParams·rejectedMediaId; count-mismatch → rejectedMediaIds; mediaId 키는 없다', async () => {
    appMocks.videoScenes.push({ id: 'vscene_1', prompt: 'p', selected: true })
    appMocks.genAPI.getAccessToken.mockImplementation(async () => 'flow-session')
    render(<App />)
    await act(async () => { await appMocks.captured.mcpProps.handleStart(undefined, { tab: 'video-text' }) })
    const start = appMocks.captured.videoStart
    expect(start?.onItemUpdate).toBeTypeOf('function')
    act(() => { start.onItemUpdate('vscene_1', 'error', { error: 'flow-video-settings-mismatch', errorKind: 'flow-video-settings-mismatch', errorParams: { expected: 'a', actual: 'b' }, rejectedMediaId: 'rm' }) })
    expect(appMocks.updateVideoScene).toHaveBeenLastCalledWith('vscene_1', expect.objectContaining({ status: 'error', errorKind: 'flow-video-settings-mismatch', errorParams: { expected: 'a', actual: 'b' }, rejectedMediaId: 'rm' }))
    expect(appMocks.updateVideoScene.mock.calls.at(-1)[1]).not.toHaveProperty('mediaId')
    act(() => { start.onItemUpdate('vscene_1', 'error', { error: 'flow-video-count-mismatch', errorKind: 'flow-video-count-mismatch', rejectedMediaIds: ['a', 'b'] }) })
    expect(appMocks.updateVideoScene).toHaveBeenLastCalledWith('vscene_1', expect.objectContaining({ errorKind: 'flow-video-count-mismatch', rejectedMediaIds: ['a', 'b'] }))
    act(() => { start.onItemUpdate('vscene_3', 'error', { error: 'flow-batch-halted', errorKind: 'flow-batch-halted', errorParams: { cause: 'flow-video-settings-mismatch' } }) })
    expect(appMocks.updateVideoScene).toHaveBeenLastCalledWith('vscene_3', expect.objectContaining({ errorKind: 'flow-batch-halted', errorParams: { cause: 'flow-video-settings-mismatch' } }))
  })

  // M2-R2 G6(B3): 훅의 F1 fetch-failed 패치 {error, errorKind, mediaId, generationId} 와 G1(b) 의 stopped/auth/timeout 패치는 **'error' 상태로** mediaId 를 싣는다 —
  //   App 이 그걸 씬에 넘겨야 download-only(error+generationId+mediaId)가 성립해 다음 Start 가 재제출(10크레딧) 대신 재다운로드한다. "거부 id 는 mediaId 로 못 간다"
  //   (M2-5)를 지키려는 방어 편집(`newStatus !== 'error' && 'mediaId' in result`)이 F1/G1 을 조용히 깬다 — 이 핀이 문다. flowRejected 의 mergeLikeApp 은 이 화이트리스트의 손 사본.
  it('error 상태의 fetch-failed / stopped 패치도 mediaId·generationId 가 updateVideoScene 에 닿는다 (M2-R2 G6)', async () => {
    appMocks.videoScenes.push({ id: 'vscene_1', prompt: 'p', selected: true })
    appMocks.genAPI.getAccessToken.mockImplementation(async () => 'flow-session')
    render(<App />)
    await act(async () => { await appMocks.captured.mcpProps.handleStart(undefined, { tab: 'video-text' }) })
    const start = appMocks.captured.videoStart
    expect(start?.onItemUpdate).toBeTypeOf('function')
    act(() => { start.onItemUpdate('vscene_1', 'error', { error: 'flow-video-fetch-failed', errorKind: 'flow-video-fetch-failed', mediaId: '<uuid#11>', generationId: '<uuid#11>' }) })
    expect(appMocks.updateVideoScene).toHaveBeenLastCalledWith('vscene_1', expect.objectContaining({ status: 'error', errorKind: 'flow-video-fetch-failed', mediaId: '<uuid#11>', generationId: '<uuid#11>' }))
    act(() => { start.onItemUpdate('vscene_1', 'error', { error: 'Stopped by user', errorKind: 'stopped', generationId: '<uuid#12>', mediaId: '<uuid#12>' }) })
    expect(appMocks.updateVideoScene).toHaveBeenLastCalledWith('vscene_1', expect.objectContaining({ status: 'error', errorKind: 'stopped', mediaId: '<uuid#12>', generationId: '<uuid#12>' }))
    // M2-R3 H6(B2): 배치 다운로드 권한 마커 downloadGated 도 통과(true 와 null 둘 다 — 제출 패치가 null 로 지운다)
    act(() => { start.onItemUpdate('vscene_1', 'error', { error: 'Stopped by user', errorKind: 'stopped', generationId: '<uuid#12>', mediaId: '<uuid#12>', downloadGated: true }) })
    expect(appMocks.updateVideoScene).toHaveBeenLastCalledWith('vscene_1', expect.objectContaining({ downloadGated: true }))
    act(() => { start.onItemUpdate('vscene_1', 'generating', { generationId: '<uuid#13>', mediaId: null, downloadGated: null }) })
    expect(appMocks.updateVideoScene).toHaveBeenLastCalledWith('vscene_1', expect.objectContaining({ status: 'generating', downloadGated: null }))
  })
})

// ── M2-R2 G8 (B7): 영상 표의 Clear ────────────────────────────────────────────────────────────────────────────────────
// onClearMedia 는 error/errorKind 만 지우고 F2 가 더한 errorParams·rejectedMediaId(s) 는 남겼다 — project.json 에 stale videoT2V* 가 남는다(다음 generating 패치가
//   지우기 전까지). 셋도 null 로(FIELD_MAP 으로 videoT2V* 에 닿는다).
describe('App — 영상 onClearMedia 는 errorParams·rejectedMediaId(s) 도 비운다 (M2-R2 G8)', () => {
  it('ResultsTable(영상) 의 onClearMedia → updateVideoScene 패치에 errorParams/rejectedMediaId/rejectedMediaIds: null (+ 기존 media/error 필드)', async () => {
    appMocks.videoScenes.push({ id: 'vscene_1', prompt: 'p', selected: true, status: 'error', errorKind: 'flow-video-settings-mismatch', errorParams: { expected: 'a', actual: 'b' }, rejectedMediaId: 'rm' })
    localStorage.setItem('autoflowcut_bottomPanelView', 'table')
    render(<App />)
    await act(async () => { await appMocks.captured.mcpProps.handleStart(undefined, { tab: 'video-text' }) })
    const props = appMocks.captured.resultsTableProps
    expect(props?.onClearMedia).toBeTypeOf('function')
    appMocks.updateVideoScene.mockClear()
    act(() => { props.onClearMedia('vscene_1') })
    expect(appMocks.updateVideoScene).toHaveBeenCalledTimes(1)
    expect(appMocks.updateVideoScene).toHaveBeenLastCalledWith('vscene_1', expect.objectContaining({
      status: 'pending', mediaId: null, generationId: null, videoPath: null, error: null, errorKind: null,
      errorParams: null, rejectedMediaId: null, rejectedMediaIds: null,
      downloadGated: null,   // M2-R3 H6: 배치 다운로드 권한 마커도 정리
    }))
  })
})
