/**
 * AutoFlowCut - Main App
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { DEFAULTS, UI, TIMING, STYLE_PRESETS } from './config/defaults'
import { useGenerationEngine } from './engine/useGenerationEngine'
import { useMode } from './contexts/ModeContext'
import { useScenes } from './hooks/useScenes'
import { useAutomation } from './hooks/useAutomation'
import { useVideoAutomation } from './hooks/useVideoAutomation'
import { useVideoScenes } from './hooks/useVideoScenes'
import { useI18n } from './hooks/useI18n'
import { useProjectData } from './hooks/useProjectData'
import { useStoryPipeline } from './hooks/useStoryPipeline'
import { useStoryAutoOpen } from './hooks/useStoryAutoOpen'
import { STORY_TTS_PROVIDERS } from './config/storyTtsProviders'
import StoryView from './components/story/StoryView'
import { useReferenceGeneration } from './hooks/useReferenceGeneration'
import { useRefPanelVisibility } from './hooks/useRefPanelVisibility'
import { useStyleThumbnails } from './hooks/useStyleThumbnails'
import { useSceneGeneration } from './hooks/useSceneGeneration'
import { useSyncGateHost } from './hooks/useSyncGateHost'
import { useGenerationQueue } from './hooks/useGenerationQueue'
import { useExport } from './hooks/useExport'
import { useStoreRating } from './hooks/useStoreRating'
import { useAudioImport } from './hooks/useAudioImport'
import { useAppSettings } from './hooks/useAppSettings'
import { useAvailableModels } from './hooks/useAvailableModels'
import { computeModelHeal, computeModeSwitch } from './config/genModels'
import { isFlowTarget, isChatgptTarget, parseRoute } from './config/appRoute.js'
import { computeAppClass, flowLayoutForMode } from './utils/appLayout'
import { useAutoSave } from './hooks/useAutoSave'
import { useFlowEvents } from './hooks/useFlowEvents'
import { useMcpServer } from './hooks/useMcpServer'
import { useMenuActions } from './hooks/useMenuActions'
import { batchStartGate } from './hooks/batchStartGate'
import { upsertStoryCharacterRefs, assertStoryProjectCurrent } from './utils/storyCharacterRefs'
import { waitUntil } from './utils/waitUntil'
import { voiceKey } from './utils/voiceKey'
import { useFlowAdoptPrompt } from './hooks/useFlowAdoptPrompt'
import { ttsListVoicesReloadParams, replaceTtsVoicesForProvider } from './utils/ttsVoiceReload'
import { stripMentionsForNames } from './utils/mentionParser'
import { syncVideosIntoScenes } from './services/mediaSync'
import { retryVideoDownload } from './services/videoRecovery'
import { isStyleReference, previewStyleMatching } from './services/styleService'
import { isSceneGenerationDone } from './services/generationStatus'
import {
  computeGuardAvailable,
  isStartBlocked,
  runOuterStartAuthPreflight,
  shouldStopRefWork,
} from './services/startGuard'
import {
  buildEmptyRefGateDeps,
  nonInteractiveGateView,
  runEmptyRefGateFlow,
} from './services/emptyRefGate'
import { shouldSkipStaleF0Gender } from './services/genderGuard'
import { createStyleResolver } from './services/styleResolver'
import { buildVideoTextStartPayload } from './services/videoTextStart'
import { buildVideoI2VStartOptions } from './services/videoI2VStart'
import { buildImageStartOptions } from './services/startOptions'
import {
  buildVideoRetryFramePairPatch,
  buildVideoRetryScenePatch,
  buildVideoTextResultPatch,
  buildVideoI2VResultPatch,
} from './services/videoResultPatch'
import { filterPendingScenes } from './utils/sceneFilters'
import { isOmniFlashModel } from './utils/videoModels'
import { startButtonTier, startChipLabelVisible } from './utils/actionButtonLayout'
import { useElementWidth } from './hooks/useElementWidth'
import { videoClearPatch, buildFramePairVideoPatch, buildVideoRestorePatch, resolveI2vRestoreSceneId, regenTargetVideoId } from './utils/sceneMedia'
import { detectFileType, detectCSVType, parseCSVToScenes, parseSRTToScenes, csvPromptToVideoT2V } from './utils/parsers'
import { getSceneDuration, resolveAudioSrtEntries } from './utils/srtTrack'
import { tabAfterImport } from './utils/importTabRouting'
import { runSceneImportWithConfirmation } from './utils/importInspection'
import { checkFolderPermission, checkFlowProjectReady } from './utils/guards'
import { shouldApplyModeScopedUpdate } from './utils/modeSwitchGuard'
import { collectTagErrors } from './utils/tagMatch'
import { planMentionTagMerges } from './utils/mentionTagMerge'
import {
  buildM1FlowReferenceExclusionToast,
} from './utils/refImageGuard'
import { selectMentionSyncTargets } from './utils/mentionSyncTargets'
import { runMentionSyncRequest } from './services/mentionSyncRequest'
import { runSyncGate } from './services/syncGateRun'
import { getFramePairEffectivePrompt } from './utils/framePairPrompt'
import { buildI2VScenePatch } from './utils/i2vScenePatch'
import { frameImageFor, stripOmniEndFrame } from './utils/framePairImages'
import { resolveSceneVideoProvider } from './utils/sceneProviderResolution'
import { saveGalleryFrame } from './utils/galleryUpload'
import { isUsableVideoReference } from './utils/videoPromptReferences'
import { busyPromptLines } from './utils/promptBusyLines'
import { toast } from './components/Toast'
import { syncRefToFlow } from './utils/flowCharacterSync'
import { runFlowComposerRefresh } from './utils/flowCharacterCoordinator'
import { getAuthErrorMessage, getAuthRequiredMessage } from './utils/authMessages'

// Components
import Header from './components/Header'
import { SessionTargetComboPortal } from './components/TargetCombo'
import PromptInput from './components/PromptInput'
import SceneList from './components/SceneList'
import GenerateMenu from './components/GenerateMenu'
import FrameToVideoPanel from './components/FrameToVideoPanel'
import ReferencePanel from './components/ReferencePanel'
import SettingsModal from './components/SettingsModal'
import ImportModal from './components/ImportModal'
import StatusBar from './components/StatusBar'
import ResultsTable from './components/ResultsTable'
// SelectablePromptList 제거됨 — 체크박스 기능이 ResultsTable에 통합
import SceneDetailModal from './components/SceneDetailModal'
import VideoDetailModal from './components/VideoDetailModal'
import { genModeForTab } from './utils/generationItems'
import ResizeHandle from './components/ResizeHandle'
import { ExportModal } from './components/ExportModal'
import ExportSplitButton from './components/ExportSplitButton'
import { AuthModal } from './components/AuthModal'
import { PaywallModal } from './components/PaywallModal'
import TagValidationModal from './components/TagValidationModal'
import EmptyReferenceGateModal from './components/EmptyReferenceGateModal'
import StoreRatingModal from './components/StoreRatingModal'
import AudioResultModal from './components/AudioResultModal'
import QAProgressBanner from './components/QAProgressBanner'
import AudioPanel from './components/AudioPanel'
import BottomPanelTabs from './components/BottomPanelTabs'
import LiveTimeline from './components/LiveTimeline'
import { useMonitor } from './hooks/useMonitor'
import PreviewMonitor from './components/PreviewMonitor'
import { getSceneTimeRangeMs } from './components/AudioTimeline/useAudioTimeline'
import { resolveStorySrtEntries, withStoryAudio } from './utils/storyAudioPackage'
import { hasImageData } from './utils/formatters'
import { SubscriptionBanner } from './components/SubscriptionBanner'
import StylePicker from './components/StylePicker'
import Modal from './components/Modal'
import DeleteSceneConfirmModal from './components/DeleteSceneConfirmModal'
import FlowProjectAdoptModal from './components/FlowProjectAdoptModal'
import SrtImportConflictModal from './components/SrtImportConflictModal'
import ImportProcessingOverlay from './components/ImportProcessingOverlay'
import { useAuth } from './contexts/AuthContext'
import { useImportProcessing } from './hooks/useImportProcessing'
import { useTargetAuthReady } from './hooks/useTargetAuthReady'

export function useAppRouteTransaction({ route, commitRoute, setRoute }) {
  const requestSequenceRef = useRef(0)
  const adoptedRevisionRef = useRef(-1)
  const routeRef = useRef(route)
  routeRef.current = route

  return useCallback(async (next, options = {}) => {
    const accepted = parseRoute(next)
    if (!accepted) return { ok: false, error: 'invalid-route', route: routeRef.current }

    const requestSequence = ++requestSequenceRef.current
    let result
    try {
      result = typeof setRoute === 'function'
        ? await setRoute(options.boot ? { to: accepted, boot: true } : accepted)
        : { ok: false, error: 'route-api-unavailable' }
    } catch (error) {
      result = { ok: false, error: error?.message || 'route-set-failed' }
    }

    if (requestSequence !== requestSequenceRef.current) return result
    const reconcileFailure = options.reconcileOnFailure === true && result?.ok !== true
    if (result?.ok !== true && !reconcileFailure) return result
    const adopted = parseRoute(result.route)
    if (reconcileFailure && !adopted) return result
    if (!adopted) return { ok: false, error: 'invalid-adopted-route', route: routeRef.current }
    const revision = Number.isInteger(result.revision) ? result.revision : null
    if (revision != null && revision < adoptedRevisionRef.current) return result
    if (revision != null) adoptedRevisionRef.current = revision
    routeRef.current = adopted
    commitRoute?.(adopted)
    return result
  }, [commitRoute, setRoute])
}

export function useRouteQuiesceBridge(
  routeQuiesceOwnerRef,
  electronAPI = globalThis.window?.electronAPI,
) {
  useEffect(() => {
    if (typeof electronAPI?.onRouteQuiesceRequest !== 'function') return undefined
    const off = electronAPI.onRouteQuiesceRequest(async (request) => {
      const receipt = {
        requestId: request?.requestId,
        fromRevision: request?.fromRevision,
      }
      try {
        routeQuiesceOwnerRef.current?.stop()
        await routeQuiesceOwnerRef.current?.awaitIdle()
        electronAPI?.sendRouteQuiesceReceipt?.({ ...receipt, ok: true })
      } catch (error) {
        electronAPI?.sendRouteQuiesceReceipt?.({
          ...receipt,
          ok: false,
          error: error?.message || 'renderer-flow-quiesce-failed',
        })
      }
    })
    electronAPI.setRouteQuiesceOwner?.(true)
    return () => {
      electronAPI.setRouteQuiesceOwner?.(false)
      off?.()
    }
  }, [electronAPI, routeQuiesceOwnerRef])
}

function App() {
  const { t, lang } = useI18n()
  const isKo = t('common.cancel') === '취소'  // 간단한 언어 감지 (ReferencePanel 과 동일)
  // #R34: 생성 전 미동기화 @멘션 캐릭터 가드 모달. 게이트를 여는 경로가 여럿이라(배치/T2V/개별 씬)
  //   소유권 조정은 useSyncGateHost 하나가 맡는다 — 고아 promise·남의 모달 닫기 방지.
  const {
    gate: syncGate, busy: syncGateBusy, open: openSyncGateRaw,
    beginWork: beginSyncGateWork, endWork: endSyncGateWork,
    finish: finishSyncGate, cancel: cancelSyncGate, abort: abortSyncGate,
  } = useSyncGateHost()
  const [emptyRefGate, setEmptyRefGate] = useState(null)
  // #M2: coordinator가 폴링/effect chain 없이 사용자 선택을 await하도록 resolver를 state에 둔다.
  // failure 확인 resolver는 확인 즉시 모달도 닫아 coordinator finally가 latch를 풀 수 있게 한다.
  const emptyRefGateView = useMemo(() => ({
    confirm: items => new Promise(resolve => {
      setEmptyRefGate({ phase: 'confirm', items, failure: null, resolve })
    }),
    setBusy: () => setEmptyRefGate(prev => (
      prev ? { ...prev, phase: 'busy' } : prev
    )),
    failure: info => new Promise(resolve => {
      setEmptyRefGate(prev => ({
        ...(prev || {}),
        phase: 'failure',
        failure: info,
        resolve: () => {
          // coordinator의 failure 종료 경로는 close()를 호출하지 않으므로 확인 resolver가 직접 닫는다.
          setEmptyRefGate(null)
          resolve()
        },
      }))
    }),
    close: () => setEmptyRefGate(null),
  }), [])
  // 게이트를 여는 시점의 프로젝트를 새겨 둔다 — 전환 뒤에 눌린 Proceed 를 걸러낸다.
  const openSyncGate = useCallback(
    ({ refs, forceRepair = false }) => openSyncGateRaw({ refs, forceRepair, scope: projectNameRef.current }),
    [openSyncGateRaw],
  )
  const openEmptyRefSyncGate = openSyncGate
  const { isAuthenticated, subscription, refreshSubscription } = useAuth()
  // 두 자동화 훅(useAutomation, useVideoAutomation)에 동일한 안정 레퍼런스를 전달.
  // 인라인 객체 리터럴은 매 렌더마다 새 참조를 만들어 useCallback deps 를 불필요하게 갱신함.
  const subscriptionBatch = useMemo(
    () => ({ batchRemaining: subscription?.batchRemaining, batchUnlimited: subscription?.batchUnlimited }),
    [subscription?.batchRemaining, subscription?.batchUnlimited]
  )
  const { mode, sessionTarget = 'flow', clearMode } = useMode()
  const { setRoute: commitRoute } = useMode()
  const flowTargetActive = isFlowTarget({ mode, sessionTarget })
  const chatgptTargetActive = isChatgptTarget({ mode, sessionTarget })
  const [apiAuthReady, setApiAuthReady] = useState(false)
  const {
    authReadyByTarget,
    authReady: sessionTargetAuthReady,
    setTargetReady,
  } = useTargetAuthReady(sessionTarget)
  const authReady = mode === 'flow' ? sessionTargetAuthReady : apiAuthReady
  const modeRef = useRef(mode)
  const sessionTargetRef = useRef(sessionTarget)
  const flowTargetActiveRef = useRef(flowTargetActive)
  modeRef.current = mode
  sessionTargetRef.current = sessionTarget
  flowTargetActiveRef.current = flowTargetActive
  const setAuthReady = useCallback((ready) => {
    if (modeRef.current === 'flow') {
      setTargetReady(sessionTargetRef.current, ready)
    } else {
      setApiAuthReady(Boolean(ready))
    }
  }, [setTargetReady])
  const generationQueue = useGenerationQueue()
  const route = useMemo(() => mode ? { mode, sessionTarget } : null, [mode, sessionTarget])
  const invokeMainRoute = useCallback(async (next) => {
    if (typeof window.electronAPI?.setRoute !== 'function') {
      return { ok: false, error: 'route-api-unavailable' }
    }
    return window.electronAPI.setRoute(next)
  }, [])
  const requestRoute = useAppRouteTransaction({ route, commitRoute, setRoute: invokeMainRoute })

  // Auth/Payment Modals
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showPaywallModal, setShowPaywallModal] = useState(false)
  const [paywallReason, setPaywallReason] = useState('trial_expired')

  // Flow Login Expired Modal
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const emptyRefSubscriptionPreGate = useCallback(async () => {
    const gate = batchStartGate({
      subscriptionBatch,
      isAuthenticated,
      subscriptionStatus: subscription?.status,
      isReusingBatch: false,
    })
    if (gate.action === 'login') {
      setShowAuthModal(true)
    } else if (gate.action === 'paywall') {
      setPaywallReason('upgrade')
      setShowPaywallModal(true)
    } else if (gate.action === 'loading') {
      toast.warning(t('toast.subscriptionLoading'))
    }
    return gate.action
  }, [isAuthenticated, subscription?.status, subscriptionBatch, t])

  // Tag Validation Modal
  const [tagValidationErrors, setTagValidationErrors] = useState(null)

  // Scene delete confirmation
  const [sceneToDelete, setSceneToDelete] = useState(null) // { scene, sceneIndex } | null
  const [pendingStartOptions, setPendingStartOptions] = useState(null)

  // 실제 실행 중인 자동화의 스타일 snapshot — Stop 버튼이 표시함.
  // selectedStyleRefId / activeTab은 사용자가 실행 중에 변경할 수 있어서
  // Stop 버튼이 그걸 그대로 읽으면 "지금 돌고 있는 게 어떤 스타일인지" 표시 못 함.
  // applies=false면 Stop 버튼 표시 안 함 (frame-to-video처럼 스타일 무관 모드).
  const [runningStyle, setRunningStyle] = useState({ styleId: null, applies: false })

  // scene/video batch가 큐에 enqueue된 후 실제 실행 시작 전까지 true.
  // 이 사이에 사용자가 Start 또 누르면 runningStyle이 덮어써져서 Stop 라벨이
  // 실제 실행 중인 job과 어긋날 수 있으므로 Start 버튼을 비활성화해 차단한다.
  // (.finally로 작업 완료 시 자동 클리어 — 성공/에러/큐 클리어 모두 커버.)
  const [hasPendingBatch, setHasPendingBatch] = useState(false)

  // Settings (초기화 + localStorage 동기화)
  const { settings, setSettings, updateSetting, ensureProjectName, projectNameRef } = useAppSettings()

  // Start 버튼 반응형 라벨 — 버튼 폭(flex:1, 콘텐츠 무관)을 측정해 full/short/icon 으로 축약.
  const [startBtnRef, startBtnWidth] = useElementWidth()
  const startTier = startButtonTier(startBtnWidth)

  // Flow 이벤트 (로그인 만료, 레이아웃 보정)
  useFlowEvents({ onLoginExpired: () => setShowApiKeyModal(true), mode })

  // UI State
  const [activeTab, setActiveTab] = useState('text') // 'text' | 'video-text' | 'frame-to-video' | 'list' | 'audio'
  // 뷰 전환: 기존 생성 화면 vs Story 파이프라인 화면. activeTab 과 별개 — Story 는 씬/이미지
  // 생성과 무관한 별도 워크플로우(스텝퍼 + 단계 패널)라 탭 목록에 섞지 않는다.
  const [activeView, setActiveView] = useState('generate') // 'generate' | 'story'
  const [framePairs, setFramePairsState] = useState([])   // Frame to Video 매핑
  const framePairsRef = useRef(framePairs)
  framePairsRef.current = framePairs
  const setFramePairs = useCallback((nextFramePairsOrUpdater) => {
    const nextFramePairs = typeof nextFramePairsOrUpdater === 'function'
      ? nextFramePairsOrUpdater(framePairsRef.current)
      : nextFramePairsOrUpdater
    framePairsRef.current = nextFramePairs
    setFramePairsState(nextFramePairs)
  }, [])
  const [ftvPromptSource, setFtvPromptSource] = useState('image') // 'image' | 'video' | 'none'
  const [galleryItems, setGalleryItems] = useState([])
  const [galleryUploading, setGalleryUploading] = useState(false)  // #R29-3: F2V 디스크 업로드 중 전환 차단
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState(null) // 설정 모달 초기 탭
  const [showImport, setShowImport] = useState(false)
  // SRT 가져오기 충돌 모달: 기존 scenes/srtTrack 있을 때 사용자에게 대체/병합/취소 묻는 상태.
  // null = 미요청. { content, framePairs } 객체가 들어있으면 모달 띄움.
  const [srtImportPending, setSrtImportPending] = useState(null)
  const { processing: importProcessing, spinnerVisible: importSpinnerVisible, runImportProcessing } = useImportProcessing()
  const [showAudioResult, setShowAudioResult] = useState(false)
  // True after handleAuthError fires — disables the auto-recovery effect at line ~165
  // that would otherwise immediately re-extract a token from the webview and flip
  // authReady back to true (making the header revert from "Login" to green dot in
  // a single render tick — user observed this as "header stayed green during 401").
  // Cleared by handleAuthRecovered when the user explicitly re-authenticates.
  const authInvalidatedRef = useRef(false)
  const [selectedScene, setSelectedScene] = useState(null) // 상세 모달용 선택된 씬
  const [selectedStyleRefId, _setSelectedStyleRefIdRaw] = useState(null) // 레퍼런스 생성 시 적용할 스타일
  // 스타일 선택을 동기 ref 로도 즉시 반영한다. 씬 픽커는 "고르면 즉시 실행"이라, setState 커밋(리렌더)
  //   전에 배치/생성 핸들러가 옛 클로저의 stale selectedStyleRefId(null)를 읽어 방금 고른 스타일이
  //   첫 시도에 안 먹고 실사로 나가는 레이스가 있었다. ref 는 픽 즉시 갱신되므로 리렌더를 안 기다린다.
  const selectedStyleRefIdRef = useRef(null)
  const setSelectedStyleRefId = useCallback((v) => {
    selectedStyleRefIdRef.current = v
    _setSelectedStyleRefIdRaw(v)
  }, [])
  const [showStylePicker, setShowStylePicker] = useState(false) // 스타일 선택 모달
  const [selectedVideo, setSelectedVideo] = useState(null) // 비디오 상세 모달용
  const [bottomPanelHeight, setBottomPanelHeight] = useState(() => {
    const saved = localStorage.getItem('autoflowcut_bottomPanelHeight')
    return saved ? parseInt(saved, 10) : UI.DEFAULT_BOTTOM_PANEL_HEIGHT // 기본 높이
  })
  // 하단 패널 뷰: 'timeline'(라이브 NLE 프리뷰) | 'results'(결과표) | 'grid'(카드 그리드). 기본 타임라인.
  const [bottomPanelView, setBottomPanelView] = useState(() =>
    localStorage.getItem('autoflowcut_bottomPanelView') || 'timeline'
  )
  useEffect(() => {
    localStorage.setItem('autoflowcut_bottomPanelView', bottomPanelView)
  }, [bottomPanelView])
  // results/grid 둘 다 ResultsTable 로 렌더 — layout 만 다르다.
  const resultsLayout = bottomPanelView === 'grid' ? 'grid' : 'table'

  // Notify main process when mode changes (or on mount) so it can attach/detach the Flow view.
  // Optional-chaining keeps this a no-op in jsdom/test environments where electronAPI is absent.
  // In flow mode, request the default split layout (split-left = Flow 왼쪽). Shell 이 레이아웃의
  // 단일 소유자라(드래그/영속), 여기 setLayout 은 진입 시 Flow 뷰가 곧장 자리잡게 하는 fallback —
  // Shell 의 effect(부모)가 직후 저장값으로 덮어쓴다(자식 effect 가 먼저 → 부모가 나중).
  // Flow Agent(Maps 그라운딩) 모드를 main 에 push — generate 핸들러가 ensureAgentOn/Off 분기에 사용.
  useEffect(() => {
    if (flowTargetActive) window.electronAPI?.setFlowAgentMode?.({ on: !!settings.flowAgentOn })?.catch?.(() => {})
  }, [settings.flowAgentOn, flowTargetActive])

  // 상단 프리뷰 모니터 상태/효과/핸들러 — useMonitor 훅이 캡슐화(렌더는 <PreviewMonitor>).
  const {
    monitorMs, setMonitorMs,
    monitorPlaying, setMonitorPlaying,
    monitorHiddenRoles, setMonitorHiddenRoles,
    monitorWidth, startMonitorResize, resetMonitorWidth,
    monitorVolume, setMonitorVolume, monitorMuted, toggleMonitorMuted,
    monitorOverlayOpen, setMonitorOverlayOpen,
    monitorFullscreen, toggleMonitorFullscreen,
    monitorMode,
  } = useMonitor({ mode, activeTab })
  // 생성 중 모니터가 라이브 그리드로 보여줄 자산 모드 — 생성 시작 시 snapshot
  // (탭 버튼이 생성 중에도 활성이라 live activeTab 을 쓰면 탭 이동 시 엉뚱한 보드가 뜸).
  const [runningGenMode, setRunningGenMode] = useState('image')

  // 설정 모달 열기 (특정 탭으로)
  const openSettings = (tab = null) => {
    setSettingsTab(tab)
    setShowSettings(true)
  }

  // Hooks
  //
  // Single source of truth for the UI side of auth failure:
  //   setAuthReady(false) → mark invalidated → toast.
  // Cache clearing (state + localStorage) is owned upstream by useFlowAPI's wrapper
  // shim (see useFlowAPI.js — clearTokenCacheImpl runs before onAuthError delegates
  // here). This callback only handles what App actually controls: UI state + user
  // notification. Same callback is reused by useAutomation's preflight no-token
  // path (useAutomation.js:418) so the user sees a consistent message regardless
  // of which code path detected the failure.
  const handleAuthError = useCallback(() => {
    setAuthReady(false)
    authInvalidatedRef.current = true  // prevent auto-recovery effect from flipping us back
    toast.error(getAuthErrorMessage(modeRef.current, t), TIMING.AUTH_ERROR_TOAST)
  }, [t])

  // Called by Header when the user explicitly re-authenticates (login badge click or
  // openFlow polling detects a fresh token). Restores authReady and unblocks the
  // auto-recovery effect for future cycles.
  const handleAuthRecovered = useCallback(() => {
    authInvalidatedRef.current = false
    setAuthReady(true)
  }, [])

  // Microsoft Store 평점 유도 (appx/Store 빌드에서만 동작)
  // 내보내기 성공(3회) 또는 생성 100% 완료(5회) 시 평점 모달을 띄운다.
  const storeRating = useStoreRating({ isStoreBuild: __BUILD_TARGET__ === 'appx' })

  // #R3-1: flowProjectId ref — useProjectData 이전에 선언해 useGenerationEngine 에 넘긴다.
  // useProjectData 반환 후 effect에서 갱신. engineFlow 는 lazy getter 로 최신 id를 읽는다.
  const flowProjectIdRef = useRef(null)

  // 생성 엔진 facade(§3.1). mode에 따라 어댑터 선택(M2=api 항등, Flow는 M4).
  // 변수명 genAPI 유지(하위 소비자 호출부 불변) — 값은 이제 engine facade.
  const genAPI = useGenerationEngine(route, {
    onAuthError: handleAuthError,
    getProjectName: () => settings.projectName,
    // #R3-1: lazy getter — engineFlow 가 IPC 호출 시점에 최신 bound id 를 읽는다.
    getFlowProjectId: () => flowProjectIdRef.current,
  })

  // #R6-11: 현재 엔진을 가리키는 ref — mount 시점 genAPI 를 캡처해 stale 엔진의
  // getAccessToken 을 호출하지 않도록(useGenerationEngine 은 매 렌더 새 facade 를 반환).
  const genAPIRef = useRef(genAPI)
  useEffect(() => { genAPIRef.current = genAPI }, [genAPI])

  // 라이브 /models 로 채운 사용 가능 모델 목록(설정 드롭다운 + stale 저장값 치유에 공유).
  // mode를 dep에 추가(I1): mode 전환 시 해당 모드의 엔진에서 /models 를 재조회한다.
  const availableModels = useAvailableModels(genAPI, mode, sessionTarget)

  // Flow 모드 모델 동적 목록은 앱 시작 시 Flow 페이지가 아직 로딩(navigating) 중이라
  //   1회차 스크랩이 빈손 → 정적 폴백에 고정될 수 있다. 두 시점에 재시도한다:
  //   (1) Flow 프로젝트 준비됨(아래 effect) — 백그라운드로 미리 긁어 캐시(설정 열 때 즉시 표시).
  //   (2) 설정 모달 오픈 — 아직 dynamic 못 받았을 때만(이미 받았으면 느린 스크랩 생략).
  const refetchModels = availableModels.refetch
  const modelsSource = availableModels.source
  useEffect(() => {
    if (showSettings && flowTargetActive && modelsSource !== 'dynamic') refetchModels?.()
  }, [showSettings, flowTargetActive, modelsSource, refetchModels])

  // 모드 전환 시 per-mode 모델 선택을 스냅샷/복원 (C3).
  // 이전 모드 → 현재 모드로 전환될 때마다: prevMode의 선택을 modelsByMode[prevMode]에 저장하고,
  // modelsByMode[nextMode]에 기억이 있으면 활성 필드에 복원 → heal이 이후 유효성 보정.
  // api 단독 사용자(전환 없음)는 이 effect가 실행되지 않으므로 동작 불변.
  const prevModeRef = useRef(null)
  // Codex #6: tracks previous mode for auth reset (separate ref to avoid coupling model-switch logic)
  const prevModeForAuthRef = useRef(null)
  useEffect(() => {
    const prevMode = prevModeRef.current
    prevModeRef.current = mode
    if (!prevMode || prevMode === mode) return // 최초 마운트 or 동일 모드 → noop
    setSettings(prev => {
      const patch = computeModeSwitch(prev, prevMode, mode)
      return Object.keys(patch).length ? { ...prev, ...patch } : prev
    })
  }, [mode])

  // /models 가 성공해 권위 있는 동적 목록을 얻은 경우에만, 저장된 모델이 그 목록에 없으면
  // (= 이 키로 사용 불가한 stale 값) 기본/첫 사용가능 모델로 치유 → 생성 시 invalid 모델이
  // API 로 나가는 걸 막는다. 정적 폴백(=참조가 카탈로그 그대로)·로딩·실패면 보존(리뷰 P2).
  // availableModels 변경뿐 아니라 settings.모델 변경(프로젝트 로드·모달 저장 등)에도 반응 —
  // 로드 후 stale 모델이 setSettings 로 다시 들어와도 치유되도록(리뷰 P2). setSettings(prev=>)
  // + no-op(prev 그대로 반환) 가드로 무한 루프 없이 수렴.
  // heal은 mode-switch restore 이후 실행돼 활성 모드 catalog 내 유효성만 보정한다.
  // loading guard: availableModels.loading=true(카탈로그 재조회 중)면 heal 건너뜀 — stale
  // 카탈로그로 mode-switch restore 값을 덮어쓰는 transient 오염을 방지.
  // mode 전달: Flow 모드에서 videoModelF2V는 I2V 모델 기본값을 사용하도록.
  useEffect(() => {
    if (availableModels.loading) return
    setSettings(prev => {
      const heal = computeModelHeal(availableModels, prev, mode, sessionTarget)
      return Object.keys(heal).length ? { ...prev, ...heal } : prev
    })
  }, [availableModels.imageModels, availableModels.videoModels, availableModels.loading, settings.imageModel, settings.videoModelT2V, settings.videoModelF2V, mode, sessionTarget])
  const scenesHook = useScenes()
  const { scenes, references, parseFromText, parseFromCSV, parseFromSRT, parseReferencesFromCSV, updateReferences, setScenes, setReferences } = scenesHook
  const imageBusyLines = useMemo(
    () => busyPromptLines(scenes, { field: 'prompt', trimTrailing: false }),
    [scenes],
  )
  const videoBusyLines = useMemo(
    () => busyPromptLines(scenes, { field: 'videoT2VPrompt', trimTrailing: true }),
    [scenes],
  )
  const latestScenesRef = useRef(scenes)
  latestScenesRef.current = scenes
  const handleRequestSceneDelete = useCallback((sceneId, sceneIndex) => {
    const scene = latestScenesRef.current.find(item => item.id === sceneId)
    if (scene) setSceneToDelete({ scene, sceneIndex })
  }, [])
  // Step 3: videoScenes 는 scenes 에서 derived. useVideoScenes 가 scenesHook 으로 라우팅.
  const videoScenesHook = useVideoScenes(scenes, scenesHook)
  const { videoScenes, setVideoScenes } = videoScenesHook

  // 씬이 복원되어 들어온 경우에도 자동으로 인증 체크(키 존재 → authReady).
  // authInvalidatedRef: handleAuthError가 명시적으로 무효화한 후엔 자동 복구하지 않는다.
  // 사용자가 Header의 login badge로 직접 재인증해야 handleAuthRecovered가 ref를 풀고
  // authReady를 되살린다. 이게 없으면 401 직후 authReady=false → 이 effect → 새 토큰 추출 →
  // setAuthReady(true) 순으로 한 render tick 만에 되돌아가 header가 녹색을 유지하는 회귀가 발생.
  useEffect(() => {
    let cancelled = false
    if (scenes.length > 0 && !authReady && !authInvalidatedRef.current) {
      const startMode = modeRef.current
      const startSessionTarget = sessionTargetRef.current
      if (startMode === 'flow' && startSessionTarget !== 'flow') return undefined
      // #R7-6: 현재 엔진(genAPIRef) + stale-result guard — 모드가 바뀌면 옛 토큰 체크가
      //   새 모드를 authed 로 오인하지 않게(R6-10/11 과 동일 패턴).
      genAPIRef.current.getAccessToken(false, true).then(token => {
        if (cancelled || modeRef.current !== startMode || sessionTargetRef.current !== startSessionTarget) return
        if (token) setAuthReady(true)
      }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [scenes.length, authReady])

  // 앱 시작 시 키 존재 여부 1회 확인 → 있으면 정식 진입 상태(Header 배지 🟢).
  // (시작 화면을 제거했으므로 이 mount 체크가 그 역할을 대신한다.)
  useEffect(() => {
    const startMode = modeRef.current
    const startSessionTarget = sessionTargetRef.current
    let cancelled = false
    if (startMode === 'flow' && startSessionTarget !== 'flow') return undefined
    // #R7-6: 현재 엔진 + stale-result guard (모드가 바뀐 뒤 늦게 resolve 돼도 무시).
    genAPIRef.current.getAccessToken(false, true).then(token => {
      if (cancelled || modeRef.current !== startMode || sessionTargetRef.current !== startSessionTarget) return
      if (token) setAuthReady(true)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // BYOK 키가 앱 내에서 저장/삭제되면(useApiKey) 폴링 없이 즉시 인증 상태 재확인.
  // 사용자가 명시적으로 키를 바꾼 것이므로 authInvalidated 도 해제한다.
  useEffect(() => {
    const onKeyChanged = () => {
      // #R6-11: BYOK 키 변경은 api 모드 전용 신호 — flow 모드에서는 무시(Flow 인증은
      // BYOK 키가 아니다). 또한 mount 시점 genAPI 가 아니라 현재 엔진(genAPIRef)을 쓴다.
      if (modeRef.current !== 'api') return
      const startMode = modeRef.current
      genAPIRef.current.getAccessToken(false, true).then(token => {
        // #R8-5: recheck 도중 flow 로 전환됐으면 옛 api 결과로 authReady 를 set 하지 않는다.
        if (modeRef.current !== startMode) return
        authInvalidatedRef.current = false
        setApiAuthReady(!!token)
      }).catch(() => {})
    }
    window.addEventListener('byok-key-changed', onKeyChanged)
    return () => window.removeEventListener('byok-key-changed', onKeyChanged)
  }, [])

  // C1: ChatGPT 타깃은 화면비도 seed 도 제어하지 못한다(스파이크 실측: 정사각 출력만, seed 미측정).
  // 엔진이 프로젝트 화면비/seed 를 제출에서 제거할 때마다 이 이벤트를 쏘고, 여기서 세션당
  // 한 번만 하나의 정직한 메시지로 알린다(씬마다 아님, 필드마다 토스트 아님).
  const chatgptUnmeasuredNoticeShownRef = useRef(false)
  useEffect(() => {
    const onUnmeasuredOptionsIgnored = () => {
      if (chatgptUnmeasuredNoticeShownRef.current) return
      chatgptUnmeasuredNoticeShownRef.current = true
      toast.warning(t('toast.chatgptUnmeasuredOptionsIgnored'))
    }
    window.addEventListener('chatgpt-unmeasured-options-ignored', onUnmeasuredOptionsIgnored)
    return () => window.removeEventListener('chatgpt-unmeasured-options-ignored', onUnmeasuredOptionsIgnored)
  }, [t])

  const refuseIfSessionTargetUnsupported = useCallback(({ stage = 'image', hasReferences = false } = {}) => {
    if (modeRef.current !== 'flow' || flowTargetActiveRef.current) return false
    if (stage === 'image' && hasReferences !== true) return false
    toast.warning(t(
      stage === 'image'
        ? 'toast.chatgptReferencesUnsupported'
        : 'toast.chatgptVideoUsesApi'
    ))
    return true
  }, [t])

  const imageRequestCarriesReferences = useCallback((targetScenes = [], styleId = null) => {
    if (typeof styleId === 'string' && styleId.startsWith('ref:')) return true
    return targetScenes.some((scene) => (
      (scenesHook.getMatchingReferences(scene) || []).length > 0
    ))
  }, [scenesHook.getMatchingReferences])

  // Flow 모드 인증 완료 이벤트 — main 이 flow-status { authenticated: true } 를 보내면
  // authReady 를 올린다. optional-chaining 으로 jsdom / api 모드에서는 no-op.
  // onFlowStatus 는 unsubscribe 함수를 반환하므로 cleanup 에서 호출한다.
  // modeRef 로 gate: API 모드로 전환 후 늦게 도착한 Flow 인증 이벤트가
  // authReady 를 올려 api-unauth 를 가리는 것을 방지한다(#R2-6).
  useEffect(() => {
    const off = window.electronAPI?.onFlowStatus?.((status) => {
      if (status?.authenticated && flowTargetActiveRef.current) setTargetReady('flow', true)
    })
    return () => { off?.() }
  }, [setTargetReady])

  // API key readiness remains mode-scoped. Session readiness is preserved independently in
  // authReadyByTarget, so a Flow ↔ ChatGPT route round-trip cannot relabel one target's auth.
  useEffect(() => {
    const prevMode = prevModeForAuthRef.current
    prevModeForAuthRef.current = mode
    if (!prevMode || prevMode === mode) return // initial mount or no change → noop

    authInvalidatedRef.current = false

    // #R6-10: stale-result guard. flow→api→flow 처럼 빠르게 재전환되면, api 분기에서
    // 시작한 getAccessToken 이 늦게 resolve 되며 (이미 flow 로 돌아온) authReady 를
    // 옛 api 체크 결과로 덮어쓸 수 있다. cleanup 에서 cancelled 로 막는다.
    let cancelled = false
    if (mode === 'api') {
      // Re-verify BYOK key for api mode
      setApiAuthReady(false)
      genAPI.getAccessToken(false, true).then(token => {
        if (cancelled) return
        setApiAuthReady(!!token)
      }).catch(() => { if (!cancelled) setApiAuthReady(false) })
    }
    return () => { cancelled = true }
  }, [mode])

  // Audio Import — useProjectData에서 audioPackage?.folderPath를 의존성으로 쓰므로
  // 먼저 호출해야 한다.
  const audioSwitchRef = useRef()
  const { audioPackage, audioTracks, importing: audioImporting, audioLoading, importAudioPackage, importByPath, clearAudioPackage, audioReviews, saveReview, saveBulkReviews, refreshReviews, saveTimecodeOverride, importMp3ToTrack } = useAudioImport(t, {
    // Phase 12: 오디오 폴더 SRT 를 project.srtTrack 으로 흡수.
    // 정책: 현재 srtTrack 이 비어 있을 때만 폴더 SRT 로 채움 (사용자 작업 보호).
    onAudioSrtAbsorbed: (audioSrtTrack) => {
      if ((scenesHook.srtTrack || []).length === 0 && audioSrtTrack.length > 0) {
        scenesHook.setSrtTrack(audioSrtTrack)
        console.log('[App] Absorbed audio folder SRT into project.srtTrack:', audioSrtTrack.length)
      }
    },
  })

  // Project Data 관리
  const { addPendingSave, handleProjectChange, saveCurrentProject, saveCurrentProjectWithPayload, isRestoringRef, loadEpochRef, projectLoading, hydratedRef: projectHydratedRef, flowProjectReady, flowProjectId: _flowProjectId, tryAdoptFlowProject } = useProjectData({
    settings, setSettings, scenes, references, setScenes, setReferences,
    videoScenes, setVideoScenes,
    framePairs, framePairsRef, setFramePairs,
    selectedStyleRefId, setSelectedStyleRefId,
    // Phase 7: srtTrack 영속화 (load/save 시 useProjectData 가 동기화)
    srtTrack: scenesHook.srtTrack, setSrtTrack: scenesHook.setSrtTrack,
    // B-phase: 드롭으로 변경된 audio 폴더가 즉시 project.json에 박히도록 prop으로 전달.
    // audioPackage 로드 중(transient null)에 명시적 null로 덮어쓰지 않도록 undefined 유지 —
    // saveCurrentProject가 undefined일 때 localStorage fallback.
    audioFolderPath: audioPackage?.folderPath,
    openSettings,
    onAudioSwitch: (audioPath) => audioSwitchRef.current?.(audioPath),
    genAPI,
    onSaveError: () => toast.error(t('toast.projectSaveFailed')),
    mode, // flow 모드에서만 Flow 프로젝트 진입 게이팅 활성화 (api 모드에서는 flowProjectReady 항상 true)
    sessionTarget,
  })

  // #R3-1: flowProjectId ref 동기화 — engineFlow 가 IPC 호출 시 최신 bound id 를 사용한다.
  // (useEffect 대신 렌더 중 직접 갱신 — getFlowProjectId() 는 동기 호출이므로 최신값 필요)
  flowProjectIdRef.current = _flowProjectId ?? null

  // Story 파이프라인 — projectPath 는 폴더 저장 모드의 프로젝트 루트
  // (workFolder/projectName, useProjectData 의 audio 폴더 경로 계산과 동일 패턴).
  const workFolder = localStorage.getItem('workFolderPath')
  const storyProjectPath = settings.saveMode === 'folder' && workFolder && settings.projectName
    ? `${workFolder}/${settings.projectName}`
    : null
  // V2/Codex-High: story push 핸들러는 직렬화돼야 한다 — 연속 push가 겹치면 (a) 렌더 클로저의
  // 옛 references로 upsert해 중복 id/카드 유실, (b) whole-snapshot 저장이 순서 역전돼 옛 저장이
  // 새 저장을 덮어씀. referencesRef(동기 최신)로 upsert하고, pushQueueRef로 한 번에 하나씩 처리한다.
  const referencesRef = useRef(scenesHook.references)
  referencesRef.current = scenesHook.references
  // 앱 시작 직후 machine.open() 이 story:pushCharacters 를 쏘는데, 그때 references 는 아직 디스크에서
  //   안 올라와 빈 배열이다. 그 위에 upsert 하면 새 카드가 만들어지고 saveCurrentProjectWithPayload
  //   가 디바운스 없이 즉시 확정 저장해, 디스크의 카드(entityId/이미지 포인터/스타일 기억)를 통째로
  //   지운다. 프로젝트 전환은 저장→로드를 await 해서 안 겪지만, 복원 경로는 그 순서 보장이 없다.
  //   하이드레이션이 끝날 때까지 푸시를 미룬다(fire-and-forget 이라 미뤄도 안전하다).
  //   (전환 진행 여부의 동기 최신값 — await 를 건넌 코드가 렌더 클로저를 보면 안 된다. 동기화
  //    게이트의 프로젝트 스코프 판정도 이 값을 쓴다.)
  const projectLoadingRef = useRef(projectLoading)
  projectLoadingRef.current = projectLoading
  const awaitProjectHydration = useCallback(
    () => waitUntil(() => projectHydratedRef.current && !projectLoadingRef.current, { timeoutMs: 15000 }),
    [projectHydratedRef],
  )
  const pushQueueRef = useRef(Promise.resolve())
  // Codex-High: 큐에 대기 중인 push가 dequeue될 때 프로젝트가 이미 바뀌었으면 폐기 —
  // 안 그러면 옛 프로젝트 씬/카드가 새 프로젝트에 유입된다(토큰 무효화는 accept 전 이벤트만 커버).
  const storyProjectPathRef = useRef(storyProjectPath)
  storyProjectPathRef.current = storyProjectPath
  const storyPipeline = useStoryPipeline({
    projectPath: storyProjectPath,
    onPushCharacters: (payload) => {
      const enqueuedPath = storyProjectPathRef.current
      const run = async () => {
        const assertCurrent = () => assertStoryProjectCurrent(storyProjectPathRef.current, enqueuedPath, 'stale story characters discarded (project switched)')
        assertCurrent()
        if (!payload.storyCharacters?.length) return
        // references 가 올라오기 전 upsert 하면 디스크의 카드를 새 카드로 덮어쓴다.
        if (!(await awaitProjectHydration())) {
          console.warn('[App] project not hydrated — discarding character push to protect existing refs')
          return
        }
        assertCurrent()
        const { references: upserted, collisions } = upsertStoryCharacterRefs(referencesRef.current, payload.storyCharacters)
        if (collisions.length) {
          toast.warning(t('story.charRef.collision', { names: collisions.join(', ') }))
        }
        if (upserted === referencesRef.current) return
        const r = await saveCurrentProjectWithPayload({ references: upserted })
        if (!r.ok) throw new Error('project save failed')
        assertCurrent()
        referencesRef.current = upserted
        scenesHook.setReferences(upserted)
      }
      const p = pushQueueRef.current.then(run, run)
      pushQueueRef.current = p.catch(() => {})
      return p
    },
    onPushScenes: (payload) => {
      const enqueuedPath = storyProjectPathRef.current
      const run = async () => {
        const assertCurrent = () => assertStoryProjectCurrent(storyProjectPathRef.current, enqueuedPath, 'stale story push discarded (project switched)')
        // 프로젝트 전환됨 — stale push 폐기. return이 아니라 throw: hook이 ok:true ack로 옛 프로젝트
        // lastPushedRevision을 잘못 advance(재발신 억제)하지 않도록, ok:false가 나가게 한다(Codex).
        assertCurrent()
        // V2: 스토리 캐릭터 → Ref 탭 character 카드 upsert(먼저 — collision을 알아야 씬 멘션을 정리).
        // push 트랜잭션에서 refs도 함께 영속(autosave 디바운스 전 crash 시 카드 유실 방지).
        let nextReferences
        let importPayload = payload
        // 하이드레이션 전에는 scenesRef/referencesRef 가 비어 있다. 그 위에서 씬을 임포트하고
        //   saveCurrentProjectWithPayload 로 확정 저장하면 수동 씬과 카드(entityId/이미지 포인터/
        //   스타일 기억)가 통째로 사라진다. 캐릭터가 없는 푸시(내레이터-온리)도 똑같이 파괴적이라
        //   storyCharacters 유무와 무관하게 막는다.
        //   씬만 저장하고 캐릭터 upsert 만 건너뛰는 것도 안 된다 — @멘션이 가리킬 카드가 없는 채로
        //   확정되고 ok:true ack 때문에 재전송도 안 된다. 통째로 실패시켜 ok:false ack 을 내보낸다.
        if (!(await awaitProjectHydration())) {
          throw new Error('project not hydrated — story scene push deferred')
        }
        assertCurrent()
        if (payload.storyCharacters?.length) {
          const { references: upserted, collisions } = upsertStoryCharacterRefs(referencesRef.current, payload.storyCharacters)
          if (upserted !== referencesRef.current) {
            nextReferences = upserted
          }
          // Codex: 동명 비-character ref와 충돌해 카드가 없는 이름은 씬 프롬프트의 @멘션을 평문화한다
          // — 안 그러면 그 @이름이 엉뚱한 타입 ref(scene/style)에 바인딩된다.
          if (collisions.length) {
            importPayload = { ...payload, scenes: payload.scenes.map((sc) => ({
              ...sc,
              prompt: stripMentionsForNames(sc.prompt, collisions),
              videoT2VPrompt: stripMentionsForNames(sc.videoT2VPrompt, collisions),
            })) }
            toast.warning(t('story.charRef.collision', { names: collisions.join(', ') }))
          }
        }
        const { nextScenes, nextSrtTrack } = scenesHook.importStoryScenes(importPayload)
        // BUG #1 고침: nextReferences가 undefined(이번 push에서 refs 변경 없음, 예: 직전
        // onPushCharacters가 이미 반영)면 useProjectData.buildProjectPayload가 undefined를
        // stale render-closure `references`로 폴백해 방금 추가된 캐릭터 카드가 저장에서
        // 빠질 수 있다(재로드 시 카드 소실). referencesRef.current(동기 최신 스냅샷)로 대체.
        const r = await saveCurrentProjectWithPayload({ scenes: nextScenes, srtTrack: nextSrtTrack, references: nextReferences ?? referencesRef.current })
        if (!r.ok) throw new Error('project save failed')
        assertCurrent()
        if (nextReferences) {
          referencesRef.current = nextReferences
          scenesHook.setReferences(nextReferences)
        }
      }
      // 직렬화: 이전 push 완료 후 실행(성공/실패 무관). 반환 promise를 훅이 await 후 ack.
      const p = pushQueueRef.current.then(run, run)
      pushQueueRef.current = p.catch(() => {})
      return p
    },
  })

  // Story 프로젝트 경로가 준비되면 세션을 연다 — 일반 타임라인도 story audio/SFX를
  // `storyPipeline.scenes`에서 합류하므로 Story 화면 진입 전에도 hydrate가 필요하다.
  // 로컬 저장 모드(storyProjectPath null)면 open()이 실패할 수 있으므로(Task 9 리뷰 노트)
  // 폴더 저장 모드일 때만 호출한다.
  // storyProjectPath가 바뀌면(프로젝트 전환) state 유무와 무관하게 무조건 재open한다 — 그렇지
  // 않으면 main의 story 머신이 이전 프로젝트 경로에 바인딩된 채 새 프로젝트 화면에서 쓰기가
  // 발생하는 크로스 프로젝트 데이터 오염이 생긴다(Task 10 리뷰).
  useStoryAutoOpen({ activeView, projectPath: storyProjectPath, open: storyPipeline.open })

  // 일반 생성 화면의 프리뷰(LiveTimeline)들은 메인 audioPackage만 본다 — story 프로젝트면 story
  // 세그먼트 오디오(화자별 voices)를 얹어 프리뷰(상단/ResultsTable)에도 오디오 트랙이 보이게 한다.
  const effectiveAudioPackage = useMemo(
    () => withStoryAudio(audioPackage, storyPipeline.scenes || []),
    [audioPackage, storyPipeline.scenes]
  )
  const effectiveSrtEntries = useMemo(
    () => resolveStorySrtEntries(
      storyPipeline.scenes || [],
      resolveAudioSrtEntries(audioPackage, scenesHook.srtTrack, scenes),
      {
        srtTrack: scenesHook.srtTrack,
        audioPackageHasSrt: !!audioPackage?.srtEntries?.length,
      },
    ),
    [storyPipeline.scenes, audioPackage, scenesHook.srtTrack, scenes],
  )

  // Story 오디오 화자 매핑용 성우 목록 — story 뷰 진입 시 provider별로 로드해 합쳐 내려준다.
  // 각 provider 태그를 붙여 StoryView가 화자별 엔진(provider)+목소리를 고를 수 있게 한다.
  const [ttsVoices, setTtsVoices] = useState([])
  const ttsVoicesRef = useRef(ttsVoices)
  useEffect(() => { ttsVoicesRef.current = ttsVoices }, [ttsVoices])
  // Codex 최종 리뷰 Finding 2: ttsVoicesRef는 useEffect로 갱신되는 패시브 ref라, 미리듣기
  // F0 추정이 in-flight인 상태에서 사용자가 수동 지정 → stale f0 도착이 같은 tick에 몰리면
  // ttsVoicesRef만으로는 늦을 수 있다(genderSource==='manual' 체크가 아직 반영 전). manual
  // 지정은 handleTagGender 안에서 동기적으로 이 Set에 기록해 그 레이스를 막는다.
  const manualGenderKeysRef = useRef(new Set())
  const mergeTtsVoices = useCallback((incoming) => {
    setTtsVoices((prev) => {
      const byKey = new Map(prev.map((voice) => [voiceKey(voice.provider, voice.id), voice]))
      for (const voice of incoming || []) {
        if (!voice?.provider || !voice?.id) continue
        const k = voiceKey(voice.provider, voice.id)
        byKey.set(k, { ...byKey.get(k), ...voice })
      }
      return [...byKey.values()]
    })
  }, [])
  useEffect(() => {
    if (activeView !== 'story') return
    let alive = true
    Promise.all(
      STORY_TTS_PROVIDERS.map((p) =>
        Promise.resolve(window.electronAPI?.ttsListVoices?.({
          provider: p,
          includeShared: p === 'elevenlabs',
          limit: 100,
          maxSharedPages: p === 'elevenlabs' ? 10 : 1,
        }))
          .then((vs) => (Array.isArray(vs) ? vs.map((v) => ({ ...v, provider: p })) : []))
          .catch(() => []),
      ),
    ).then((lists) => { if (alive) mergeTtsVoices(lists.flat()) })
    return () => { alive = false }
  }, [activeView]) // eslint-disable-line react-hooks/exhaustive-deps

  // 성우 성별 태그 — VoicePicker 우클릭 수동 지정(manual)과 미리듣기 F0 추정(f0) 공통 진입점.
  // 항상 renderer의 ttsVoices를 낙관적으로 갱신하고, manual만 main에 영속 저장한다
  // (f0는 useVoicePreview.play()가 이미 ttsTagVoiceGender로 저장 — 여기서 또 저장하면 중복 IPC).
  const handleTagGender = useCallback(({ provider, voiceId, gender, f0, confidence, source }) => {
    const vKey = voiceKey(provider, voiceId)
    // manual은 항상 동기적으로 먼저 기록 — 뒤이어 도착하는 stale f0가 이 tick 안에서도 걸러지도록.
    if (source === 'manual') manualGenderKeysRef.current.add(vKey)
    // 방어선: useVoicePreview 쪽 가드(genderSource!=='manual')가 이미 F0 추정 자체를 건너뛰지만,
    // 혹시 남아있는 f0 태그가 도착하더라도 이미 manual인 voice는 여기서 다시 한 번 보호한다.
    if (shouldSkipStaleF0Gender({
      source,
      voiceKey: vKey,
      manualGenderKeys: manualGenderKeysRef.current,
      existingGenderSource: ttsVoicesRef.current.find((v) => v.provider === provider && v.id === voiceId)?.genderSource,
    })) return
    mergeTtsVoices([{ provider, id: voiceId, gender, genderSource: source, f0: f0 ?? null, confidence: confidence ?? null }])
    if (source === 'manual') {
      window.electronAPI?.ttsTagVoiceGender?.({ provider, voiceId, gender, f0: f0 ?? null, confidence: confidence ?? null, source: 'manual' })?.catch?.(() => {})
    }
  }, [mergeTtsVoices])

  // VoicePicker 검색창 디바운스 원격 검색 — ElevenLabs shared voice가 수천 개라 preload로는
  // 못 찾는 보이스를 검색어로 추가 조회해 ttsVoices에 병합한다(Typecast/Gemini는 이미 전량 로드).
  const handleTtsVoiceSearch = useCallback(async ({ provider, query }) => {
    const q = String(query || '').trim()
    if (!provider || q.length < 2) return
    try {
      const vs = await window.electronAPI?.ttsListVoices?.({
        provider,
        query: q,
        includeShared: provider === 'elevenlabs',
        limit: 100,
        maxSharedPages: provider === 'elevenlabs' ? 5 : 1,
      })
      if (Array.isArray(vs)) mergeTtsVoices(vs.map((v) => ({ ...v, provider })))
    } catch {
      // Search is opportunistic; existing seed/account voices remain usable.
    }
  }, [mergeTtsVoices])

  // M3b 리뷰 Finding 1: 오디오 pre-flight 게이트에서 키를 막 저장한 뒤엔 handleTtsVoiceSearch로
  // "재조회"할 수 없다 — 그 함수는 검색어 2자 미만이면 조용히 no-op하는 원격 검색이라(빈 검색어로
  // provider 전체를 다시 긁는 용도가 아니다), 그 provider의 목소리를 처음부터 다시 로드하는
  // 별도 경로가 필요하다. 초기 로드 이펙트(~L711)와 같은 모양으로 provider 하나만 다시 긁어 병합.
  // Finding2(2R 리뷰): mergeTtsVoices는 voice별 upsert라, 키를 다른 계정으로 교체한 뒤 재조회해도
  // 이전 계정의 stale voice가 그대로 남는다(새 목록에 없다고 지워지지 않음). 이 provider "슬라이스"는
  // 방금 받아온 목록으로 통째로 교체해야 한다 — 다른 provider의 voice는 그대로 둔다.
  const reloadTtsVoicesForProvider = useCallback(async (provider) => {
    if (!provider) return
    try {
      const vs = await window.electronAPI?.ttsListVoices?.(ttsListVoicesReloadParams(provider))
      if (!Array.isArray(vs)) return
      setTtsVoices((prev) => replaceTtsVoicesForProvider(prev, provider, vs))
    } catch {
      // best-effort — 실패해도 뒤이은 preflight 재검사는 별도로 진행된다.
    }
  }, [])

  // Flow 프로젝트가 준비되면(컴포저 가시·settle) 모델 목록을 백그라운드로 미리 스크랩한다.
  //   이렇게 캐시해 두면 설정 모달을 열 때 느린 라이브 스크랩 없이 즉시 동적 목록이 뜬다.
  //   아직 dynamic 을 못 받았을 때만 — 이미 받았으면 반복 스크랩 생략.
  useEffect(() => {
    if (flowTargetActive && flowProjectReady && modelsSource !== 'dynamic') refetchModels?.()
  }, [flowTargetActive, flowProjectReady, modelsSource, refetchModels])

  // Flow 바인딩이 막혀 생성이 차단된 동안 회복을 주기적으로 시도한다: 저장만 실패했으면 저장을
  // 재시도하고, 바인딩이 안 열렸으면 재바인딩을 요청하고, 사용자가 Flow 에서 다른 프로젝트를
  // 열었으면 채택을 묻는다. 회복되면 flowProjectReady 가 true 가 되어 폴링이 멈춘다.
  // 채택은 항상 사용자 확인을 거친다 — 훅은 후보를 찾으면 needs-confirm 을 돌려주고, 그때 확인
  // 모달을 띄운다(폴링/일시정지/취소 쿨다운/확인 대상 고정은 useFlowAdoptPrompt 안에 있다).
  const flowAdoptPrompt = useFlowAdoptPrompt({
    mode, sessionTarget, flowProjectReady, projectLoading,
    projectName: settings.projectName,
    tryAdopt: tryAdoptFlowProject,
    // 채택이 실패하면(에러 페이지, 저장 실패 등) 조용히 묻지 않는다 — 사용자는 연결됐다고 믿는다.
    onAdoptFailed: () => toast.error(t('toast.flowAdoptFailed')),
  })

  // 이미지 자동화 — flowProjectReady 를 useProjectData 이후에 참조하므로 이 위치에 선언.
  const automation = useAutomation(
    genAPI,
    scenesHook,
    null,
    () => openSettings('storage'),
    (saveFunc) => addPendingSave(saveFunc),
    t,
    handleAuthError,
    generationQueue,
    async (result) => {
      await saveCurrentProject()
      // 사용자 중단 없이 100% 완료된 배치만 평점 카운터에 반영
      if (result?.completed) storeRating.recordGeneration()
    },
    mode,
    flowProjectReady,
    !!settings.flowAgentOn,  // Agent ON 이면 배치를 직렬 수집(동기)으로 — 동시 DOM 수집 race 방지.
    subscriptionBatch,
    () => { setPaywallReason('upgrade'); setShowPaywallModal(true) },
    isAuthenticated,
    () => setShowAuthModal(true),
    subscription?.status,   // #5/#8: loading/error 상태 전달 — 미확인 subscription 에서 진행 금지
    refreshSubscription,    // #6: consume 성공 시 1회 refresh (stale 방지)
    route                   // ChatGPT 타깃 판정(sourceForStage) — model 스탬프를 엔진 라우팅과 일치시킴
  )

  // 비디오 자동화 — 동일 이유로 useProjectData 이후 선언.
  const videoAutomation = useVideoAutomation(genAPI, t, generationQueue, (result) => {
    // 비디오(T2V/I2V/F→V) 배치 100% 완료도 동일 generation 채널에 합산
    if (result?.completed) storeRating.recordGeneration()
  }, mode, flowProjectReady, subscriptionBatch, () => { setPaywallReason('upgrade'); setShowPaywallModal(true) }, isAuthenticated, () => setShowAuthModal(true),
    subscription?.status,   // #5/#8: loading/error 상태 전달
    refreshSubscription     // #6: consume 성공 시 1회 refresh
  )

  const { isRunning, isPaused, isStopping, isSceneBatchQueued, progress, status, statusMessage, start, togglePause, stop, retryErrors: retryErrorsUnsafe } = automation
  const retryErrors = useCallback((...args) => {
    const targets = scenes.filter(scene => scene.status === 'error')
    if (refuseIfSessionTargetUnsupported({
      stage: 'image',
      hasReferences: imageRequestCarriesReferences(targets, selectedStyleRefId),
    })) return Promise.resolve()
    return retryErrorsUnsafe(...args)
  }, [retryErrorsUnsafe, refuseIfSessionTargetUnsupported, scenes, imageRequestCarriesReferences, selectedStyleRefId])
  const retryScene = useCallback((...args) => {
    const target = scenes.find(scene => scene.id === args[0])
    if (refuseIfSessionTargetUnsupported({
      stage: 'image',
      hasReferences: imageRequestCarriesReferences(target ? [target] : [], selectedStyleRefId),
    })) return Promise.resolve()
    return automation.retryScene(...args)
  }, [automation.retryScene, refuseIfSessionTargetUnsupported, scenes, imageRequestCarriesReferences, selectedStyleRefId])
  // #M2: 모달/ref batch 대기 뒤 scene launch가 과거 render의 start closure를 부르지 않게 한다.
  const automationStartRef = useRef(start)
  automationStartRef.current = start

  // 자동화가 끝나면 Stop 버튼용 running snapshot 정리.
  // Transition-based: 실행 → 종료 전이일 때만 clear. 큐로 대기 중일 때는 deps가 변하지 않아
  // effect 자체가 재실행되지 않지만, 만에 하나 다른 state가 deps에 끼어드는 미래 변경에도
  // wasRunningRef 가드 덕에 stale 시점에 잘못 clear하지 않는다.
  const wasRunningRef = useRef(false)
  // requireStyle 가드가 StylePicker 를 띄울 때 force(전체 재생성) 의도를 보존 —
  // 스타일 선택 후 handleStart 로 재진입할 때 force 를 그대로 넘긴다.
  const pendingStyleForceRef = useRef(false)
  const pendingStyleSourceRef = useRef('ui')
  useEffect(() => {
    const running = isRunning || videoAutomation.isRunning
    if (wasRunningRef.current && !running) {
      setRunningStyle(prev => prev.applies || prev.styleId ? { styleId: null, applies: false } : prev)
    }
    wasRunningRef.current = running
  }, [isRunning, videoAutomation.isRunning])

  // Style Thumbnails
  const { thumbnails: styleThumbnails, generating: thumbnailGenerating, stopping: thumbnailStopping, progress: thumbnailProgress, generateThumbnails: generateThumbnailsUnsafe, stopGenerating: stopThumbnailGeneration, deleteThumbnail } = useStyleThumbnails(genAPI, { flowProjectReady, imageProvider: settings.generation?.image?.provider ?? 'google', imageModel: settings.imageModel })
  // customRefs are output definitions whose text prompts are submitted with an empty image-input
  // array inside useStyleThumbnails; they are not unmeasured ChatGPT reference uploads.
  const generateThumbnails = useCallback(
    (...args) => generateThumbnailsUnsafe(...args),
    [generateThumbnailsUnsafe],
  )

  // Reference 생성
  const { generatingRefs, stoppingRefs, preparingRefs, refBatchActive, handleGenerateRef: handleGenerateRefUnsafe, handleGenerateAllRefs: handleGenerateAllRefsUnsafe, stopGenerateAllRefs } = useReferenceGeneration({
    settings, references, scenes, setReferences, genAPI, addPendingSave, openSettings, t, selectedStyleRefId, selectedStyleRefIdRef, styleThumbnails, generationQueue, flowProjectReady,
    scenesRef: scenesHook.scenesRef, flowProjectId: _flowProjectId, projectNameRef,
    route,  // ChatGPT 타깃 판정(sourceForStage) — engineLabel/metadata.model 스탬프
  })
  const handleGenerateRef = useCallback((...args) => {
    const styleId = args[2] ?? selectedStyleRefId
    if (refuseIfSessionTargetUnsupported({
      stage: 'image',
      hasReferences: typeof styleId === 'string' && styleId.startsWith('ref:'),
    })) return
    return handleGenerateRefUnsafe(...args)
  }, [handleGenerateRefUnsafe, refuseIfSessionTargetUnsupported, selectedStyleRefId])
  const handleGenerateAllRefs = useCallback((...args) => {
    const styleId = args[0] ?? selectedStyleRefId
    if (refuseIfSessionTargetUnsupported({
      stage: 'image',
      hasReferences: typeof styleId === 'string' && styleId.startsWith('ref:'),
    })) return
    return handleGenerateAllRefsUnsafe(...args)
  }, [handleGenerateAllRefsUnsafe, refuseIfSessionTargetUnsupported, selectedStyleRefId])

  const { isOpen: showReferences, setOpenByUser } = useRefPanelVisibility({
    refBatchActive,
    generatingRefsCount: generatingRefs.length,
    stoppingRefs,
    syncGate,
    syncGateBusy,
    mode,
    automationStatus: status,
    hasPendingBatch,
    projectKey: settings.projectName,
  })

  // 개별 씬 생성이 "이 씬의 미동기화 @멘션을 처리해 달라"고 요청하면 **배치와 같은** 동기화
  // 게이트를 연다. 대상이 없으면 모달 없이 즉시 진행한다(평소엔 아무것도 안 뜬다).
  //   - names 없음(프리플라이트): 씬이 멘션한 캐릭터 중 미동기화 + 수리 가능한 것
  //   - names 있음(엔진이 미해결로 거절한 뒤): 그 이름들. 우리 기록상 synced 여도 엔진이 못 쓴다고
  //     했으므로 동기화 상태로 거르지 않는다 — 기록이 옛것일 수 있다.
  // 판정은 services/mentionSyncRequest 가 소유한다 — App 안에 두면 실행되는 테스트를 못 붙인다
  // (이 판정을 통째로 되돌려도 전체 스위트가 초록불이었다).
  const requestMentionSync = useCallback((req) => runMentionSyncRequest(req, {
    getReferences: () => referencesRef.current || [],
    getProjectName: () => projectNameRef.current,
    isProjectLoading: () => projectLoadingRef.current,
    openGate: openSyncGate,
    onBlocked: (reason) => toast.warning(t(reason === 'superseded' ? 'toast.flowSyncSuperseded' : 'toast.flowSyncBusy')),
  }), [openSyncGate, t])

  // Scene 재생성
  const { generatingSceneId, handleGenerateScene: handleGenerateSceneUnsafe } = useSceneGeneration({
    settings, scenes, scenesHook, genAPI, openSettings, setSelectedScene, t, generationQueue, flowProjectReady,
    requestMentionSync,
    route,  // ChatGPT 타깃 판정(sourceForStage) — model 스탬프를 엔진 라우팅과 일치시킴
  })
  const handleGenerateScene = useCallback((...args) => {
    const target = scenes.find(scene => scene.id === args[0])
    if (refuseIfSessionTargetUnsupported({
      stage: 'image',
      hasReferences: imageRequestCarriesReferences(target ? [target] : [], args[1] ?? selectedStyleRefId),
    })) return
    return handleGenerateSceneUnsafe(...args)
  }, [handleGenerateSceneUnsafe, refuseIfSessionTargetUnsupported, scenes, imageRequestCarriesReferences, selectedStyleRefId])
  const generatingSceneIdRef = useRef(generatingSceneId)
  generatingSceneIdRef.current = generatingSceneId
  const guardSceneBatchStart = (source = 'ui') => {
    if (source === 'mcp' || !generatingSceneIdRef.current) return true
    toast.warning(t('videoAutomation.busy') || 'Generation already running')
    return false
  }

  const handleImportAudio = async () => {
    setShowAudioResult(true)
    const result = await importAudioPackage()
    if (!result) {
      setShowAudioResult(false)
    }
  }

  // audioSwitchRef: 프로젝트 전환 시 오디오 복원 콜백
  audioSwitchRef.current = async (audioPath) => {
    clearAudioPackage()
    if (audioPath) {
      localStorage.setItem('audioFolderPath', audioPath)
      await importByPath(audioPath)
    } else {
      localStorage.removeItem('audioFolderPath')
    }
  }

  // Export
  const { showExportModal, setShowExportModal, exporting, exportPhase, exportFormat, handleExportClick, handleExportConfirm, handleExportPremiere, handleExportVrew } = useExport({
    settings, scenes, srtTrack: scenesHook.srtTrack, videoScenes, framePairs, openSettings,
    audioPackage,
    storyProjectPath,  // M2a-4: story 프로젝트면 export 시 나레이션 manifest 배치
    isAuthenticated,
    subscription,
    refreshSubscription,
    onLoginRequired: () => setShowAuthModal(true),
    onPaywallRequired: (reason) => {
      setPaywallReason(reason)
      setShowPaywallModal(true)
    },
    onExportSuccess: storeRating.recordExport
  })

  // ── 완성된 비디오 → 씬에 자동 동기화 (세션 내 기존 비디오 반영) ──
  useEffect(() => {
    // scenes 배열의 복사본을 만들어 sync 후 변경된 씬만 업데이트
    const scenesCopy = scenes.map(s => ({ ...s }))
    const synced = syncVideosIntoScenes(scenesCopy, videoScenes, framePairs, '[App]')
    if (synced) {
      // 변경된 씬만 개별 업데이트.
      // base64(videoT2V/videoI2V) 외에 path/duration 도 비교 — recovery / path-only 로드 시
      // base64 가 비어 있고 path 만 새로 채워지는 경우 base64 비교만으로는 변경 감지 안 됨.
      for (let i = 0; i < scenesCopy.length; i++) {
        const orig = scenes[i]
        const copy = scenesCopy[i]
        const changed =
          copy.videoT2V !== orig.videoT2V ||
          copy.videoI2V !== orig.videoI2V ||
          copy.videoT2VPath !== orig.videoT2VPath ||
          copy.videoI2VPath !== orig.videoI2VPath ||
          copy.videoT2VDuration !== orig.videoT2VDuration ||
          copy.videoI2VDuration !== orig.videoI2VDuration ||
          // 캐시버스터 — mediaSync 가 framePair.generatedAt 으로 mutate 하므로 함께 감지/반영해야
          // 함(아니면 path 등 다른 변경이 없을 때 generatedAt 갱신이 유실 → stale 비디오).
          copy.videoT2VGeneratedAt !== orig.videoT2VGeneratedAt ||
          copy.videoI2VGeneratedAt !== orig.videoI2VGeneratedAt
        if (changed) {
          scenesHook.updateScene(copy.id, {
            videoT2V: copy.videoT2V, videoT2VPath: copy.videoT2VPath,
            videoI2V: copy.videoI2V, videoI2VPath: copy.videoI2VPath,
            ...(copy.videoT2VDuration !== orig.videoT2VDuration ? { videoT2VDuration: copy.videoT2VDuration } : {}),
            ...(copy.videoI2VDuration !== orig.videoI2VDuration ? { videoI2VDuration: copy.videoI2VDuration } : {}),
            ...(copy.videoT2VGeneratedAt !== orig.videoT2VGeneratedAt ? { videoT2VGeneratedAt: copy.videoT2VGeneratedAt } : {}),
            ...(copy.videoI2VGeneratedAt !== orig.videoI2VGeneratedAt ? { videoI2VGeneratedAt: copy.videoI2VGeneratedAt } : {}),
          })
        }
      }
    }
  }, [videoScenes, framePairs])

  // 로컬 파일 → Flow uploadImage → galleryItems 에 추가
  // F2V Start/End Image 드롭다운에서 "📁 Upload from disk" 로 호출됨
  const handleUploadGalleryImage = async (file) => {
    if (!file) return { success: false, error: 'No file' }
    // #R29-3: 디스크 업로드(파일 읽기+저장) 동안 project/mode 전환을 막는다 — 안 그러면 전환 뒤
    //   결과(galleryItems + frame pair)가 새 프로젝트에 잘못 삽입된다. busy flag 로 토글/셀렉터 차단.
    setGalleryUploading(true)
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'))
        reader.readAsDataURL(file)
      })
      const base64 = String(dataUrl).split(',')[1] || ''
      if (!base64) return { success: false, error: 'Empty file' }

      // cloud(BYOK): Flow 업로드 없이 로컬 프레임을 프로젝트 리소스(frames/)로 저장.
      // folder 모드에서 디스크 영속 실패면 업로드 자체를 실패로 — pair 를 만들지 않아
      // 재오픈 시 frames/ 에서 못 살아나는 gallery::local-* 항목 생성을 막는다.
      // (desktop addPendingSave 는 no-op 이라 "나중에 재시도" 약속 대신 즉시 실패)
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const saved = await saveGalleryFrame({
        localId, dataUrl,
        saveMode: settings.saveMode,
        projectName: settings.projectName,
      })
      if (!saved.success) {
        toast.error(t('toast.folderSelectFirst'))
        return { success: false, error: saved.error || 'Frame save failed' }
      }
      setGalleryItems(prev => [{ mediaId: localId, url: dataUrl, dataUrl, local: true, persisted: saved.persisted }, ...prev])
      return { success: true, mediaId: localId, url: dataUrl, dataUrl, persisted: saved.persisted }
    } catch (e) {
      console.error('[Gallery] upload from disk failed:', e)
      return { success: false, error: e.message }
    } finally {
      setGalleryUploading(false)
    }
  }

  // Gallery 로드 (특정 projectId가 주어지면 그 프로젝트의 업로드 반환,
  // 없으면 현재 캡쳐된 projectId — App 전역 갤러리 state에 merge한다)
  const loadGallery = async (specificProjectId) => {
    if (galleryLoading) return
    setGalleryLoading(true)
    try {
      const result = await genAPI.fetchGallery(specificProjectId)
      if (result.success) {
        // 로컬 업로드 항목(local:true) 보존 + 서버 결과 merge.
        // 서버가 같은 mediaId를 이미 반환하면 서버 버전 우선.
        const serverItems = result.items || []
        setGalleryItems(prev => {
          const serverIds = new Set(serverItems.map(it => it.mediaId))
          const localOnly = prev.filter(it => it.local && !serverIds.has(it.mediaId))
          return [...localOnly, ...serverItems]
        })
      } else {
        console.warn('[Gallery] Load failed:', result.error)
      }
    } catch (e) {
      console.error('[Gallery] Error:', e)
    } finally {
      setGalleryLoading(false)
    }
  }

  // archive에서 사용자가 실제로 픽한 한 항목만 galleryItems에 합침 — 트리거 라벨/썸네일 렌더용.
  const addArchiveItem = (item) => {
    if (!item?.mediaId) return
    setGalleryItems(prev => {
      if (prev.some(it => it.mediaId === item.mediaId)) return prev
      return [{ ...item, archive: true }, ...prev]
    })
  }

  // Auto-save project data (debounce)
  useAutoSave({
    scenes, references, videoScenes, framePairs,
    selectedStyleRefId,
    // C17 review fix: srtTrack 변경도 autosave trigger
    srtTrack: scenesHook.srtTrack,
    // B-phase fix: audio 폴더 변경(드롭 등)도 autosave trigger — 그래야 project.json 영속화.
    // useAutoSave는 audio-only 가드용으로 truthy 검사만 하므로 || null 안전.
    audioFolderPath: audioPackage?.folderPath || null,
    settings, generatingRefsCount: generatingRefs.length,
    isRunning, isRestoringRef, saveCurrentProject,
    onSaveError: () => toast.error(t('toast.projectSaveFailed'))
  })

  // Save bottom panel height
  useEffect(() => {
    localStorage.setItem('autoflowcut_bottomPanelHeight', String(bottomPanelHeight))
  }, [bottomPanelHeight])

  // Load saved prompts — 프로젝트가 있으면 auto-restore가 처리하므로 스킵
  useEffect(() => {
    // 작업 폴더 + 프로젝트가 모두 설정되어 있으면 auto-restore가 scenes를 로드함
    // savedPrompts를 parseFromText하면 이미지/자막 없는 text-only scenes로 덮어쓰게 됨
    const workFolder = localStorage.getItem('workFolderPath')
    const settingsSaved = localStorage.getItem('autoflowcut_settings')
    if (workFolder && settingsSaved) {
      try {
        const parsed = JSON.parse(settingsSaved)
        if (parsed.projectName && parsed.saveMode === 'folder') {
          console.log('[App] Skipping savedPrompts load — auto-restore will handle scenes for project:', parsed.projectName)
          return
        }
      } catch (e) { /* ignore */ }
    }

    const saved = localStorage.getItem('autoflowcut_savedPrompts')
    if (saved) {
      console.log('[App] Loading savedPrompts from localStorage (no project folder configured)')
      parseFromText(saved, settings.defaultDuration)
    }

    // Video prompts도 localStorage에서 복원
    const savedVideo = localStorage.getItem('autoflowcut_savedVideoPrompts')
    if (savedVideo) {
      console.log('[App] Loading savedVideoPrompts from localStorage')
      videoScenesHook.parseFromText(savedVideo, settings.defaultDuration, framePairs)
    }
  }, [])

  // Handle text input change
  const handleTextChange = (text) => {
    // PromptInput 직접 편집: 입력창의 텍스트 = 최종 상태. truncateToIncoming 으로 줄 추가/삭제가
    // 즉시 scenes 에 반영 (이전 통째-덮어쓰기 동작과 같은 UX, 다만 머지로 subtitle/duration 보존).
    parseFromText(text, settings.defaultDuration, { truncateToIncoming: true }, framePairs)
    localStorage.setItem('autoflowcut_savedPrompts', text)
  }

  // Handle video text input change (T2V 독립 프롬프트)
  // Step 3: videoScenesHook 이 scenes 의 derived view — 내부에서 scenes.videoT2VPrompt 로 라우팅
  // PromptInput 직접 편집이라 truncateToIncoming — 줄 줄이면 그 위치 비디오 prompt 클리어,
  // 늘리면 scenes 도 같이 늘어남 (scenes 자체는 보존)
  const handleVideoTextChange = (text) => {
    scenesHook.parseFromText(text, settings.defaultDuration, {
      fieldName: 'videoT2VPrompt',
      truncateToIncoming: true,
    }, framePairs)
    localStorage.setItem('autoflowcut_savedVideoPrompts', text)
  }

  // 새 프로젝트 생성 핸들러 (설정창 열기)
  const handleNewProject = () => {
    openSettings('storage')
  }

  // Handle import
  const handleImport = async (type, content, mode = 'image') => {
    const detectedType = detectFileType(content)
    const projectName = settings.projectName

    // 비디오 모드: videoScenesHook 내부에서 scenes.videoT2VPrompt 로 라우팅 (Step 3)
    const isVideo = mode === 'video'

    const importIntoVideoT2V = (text) => {
      videoScenesHook.parseFromText(text, settings.defaultDuration, framePairs)
    }

    const importSceneCSV = (text) => (
      parseFromCSV(text, settings.defaultDuration, framePairs, { generationSettings: settings })
    )

    const hasExistingSrt = (scenesHook.srtTrack || []).length > 0

    // 타입별 실행 액션
    const actions = {
      text: () => isVideo
        ? importIntoVideoT2V(content)
        : parseFromText(content, settings.defaultDuration, {}, framePairs),
      csv: () => isVideo
        // CSV 비디오 모드: prompt 컬럼이 있으면 video_t2v_prompt 로 rename 한 후 parseFromCSV.
        // 행 단위 매칭은 그대로 보존되고, video_*_prompt 컬럼이 이미 있는 CSV 는 그대로 통과.
        ? importSceneCSV(csvPromptToVideoT2V(content))
        : importSceneCSV(content),
      // SRT 는 자막 전용 — 비디오 모드 의미 없음 (자막 → 비디오 prompt 강제 변환은 부자연)
      // 기존 srtTrack 이 있을 때만 충돌 모달 띄움. parseFromSRT 의 smart-match
      // (fuzzy 매칭) 분기는 oldTrack && prevScenes 둘 다 있을 때만 동작하므로,
      // srtTrack 없이 scenes 만 있는 케이스 (text/CSV import 이후 첫 SRT) 는
      // 모달 약속과 어긋남 → silent 로 wholesale index merge (기존 동작) 유지.
      srt: () => {
        if (hasExistingSrt) {
          setSrtImportPending({ content, framePairs })
          return  // conflict — 모달 resolve(replace/merge)가 list 전환 담당
        }
        parseFromSRT(content, framePairs)
        setActiveTab('list')  // 자막이 매칭된 결과를 씬 목록에서 확인
      },
      reference: async () => {
        await parseReferencesFromCSV(content, projectName)
        setOpenByUser(true)
      }
    }

    // 타입별 확인 메시지 키
    const confirmKeys = {
      srt: 'import.wrongTypeSrt',
      csv: type === 'reference' ? 'import.wrongTypeScene' : 'import.wrongTypeCsv',
      text: 'import.wrongTypeText',
      reference: 'import.wrongTypeReference'
    }

    // Wrong-type와 large-import 모두 같은 catalog-key → window.confirm 경로를 쓴다.
    const requestConfirmation = (confirmKey, params = {}) => window.confirm(t(confirmKey, params))

    const executeAction = async (effectiveType) => {
      const action = actions[effectiveType]
      if (!action) return
      // 기존 SRT가 있으면 여기서는 conflict modal만 연다. 실제 parse/commit은
      // modal의 replace/merge 선택 시 같은 processing controller로 감싼다.
      if (effectiveType === 'srt' && hasExistingSrt) return action()
      return runImportProcessing(action)
    }

    // import한 데이터를 보거나 편집할 수 있는 탭으로 자동 전환.
    //   text/csv 는 tabForType (이미지→text / 비디오→video-text).
    //   srt 는 actions.srt / 모달이 list 전환을 직접 담당, reference 는 Ref 패널.

    // 타입 불일치 시 확인 후 감지된 타입으로 실행
    let effectiveType = type
    if (detectedType && detectedType !== type) {
      const confirmKey = confirmKeys[detectedType]
      if (!confirmKey || !requestConfirmation(confirmKey)) {
        setShowImport(false)
        return
      }
      effectiveType = detectedType
    }

    // count-only preflight는 parser 결과를 버리고 state setter를 전혀 호출하지 않는다.
    // confirm 이후에만 action이 processing controller 안에서 실제 state를 commit한다.
    const { didImport } = await runSceneImportWithConfirmation({
      type: effectiveType,
      content,
      locale: lang === 'ko' ? 'ko-KR' : 'en-US',
      requestConfirmation,
      action: () => executeAction(effectiveType),
    })

    setShowImport(false)
    const tab = tabAfterImport({ didImport, type: effectiveType, isVideo })
    if (tab) setActiveTab(tab)
  }

  const resolveSrtImport = async (mode) => {
    if (!srtImportPending) return
    const pending = srtImportPending
    await runImportProcessing(() => {
      parseFromSRT(
        pending.content,
        pending.framePairs,
        mode === 'replace' ? { mode: 'replace' } : undefined,
      )
    })
    setSrtImportPending(null)
    setActiveTab('list')
  }

  // Handle start — 활성 탭에 따라 이미지/비디오 생성 모드 분기
  // #R12-11: 다운로드-only 비디오 retry 의 in-flight 래치 — Start/다른 retry 와의 경합 차단.
  const videoRetryInFlightRef = useRef(false)
  // #R24-2: ref 는 같은-tick 중복 가드용(비반응적). 모드 토글 차단(modeBusy)은 반응형 state 가
  //   필요하다 — retry 진행 중 모드를 바꾸면 retryVideoDownload 가 stale 엔진/프로젝트로 디스크
  //   저장을 끝내버린다(onUpdate 가드는 React 상태만 막고 디스크 쓰기는 이미 진행). 토글을 막아
  //   레이스 자체를 차단.
  const [videoRetryRunning, setVideoRetryRunning] = useState(false)
  /**
   * handleVideoRetry — video 단일 아이템 재시도
   *
   * generationId + mediaId 둘 다 있으면: 서버는 영상을 가지고 있고 로컬 다운로드만
   * 실패한 상황이므로 download-only 경로(videoRecovery.retryVideoDownload)로 재시도
   * 하여 quota 소비 없이 복구한다.
   *
   * 둘 중 하나라도 없으면: full 재생성이 필요하므로 해당 아이템 상태를 pending으로 되돌린 뒤
   * 사용자가 "Start Generation" 버튼으로 일괄 재생성할 수 있게 둔다.
   */
  const handleVideoRetry = useCallback(async (item, opts = {}) => {
    if (!item) return
    if (refuseIfSessionTargetUnsupported({ stage: 'video' })) return
    // #R30-4: timeline/scene-media 모달은 씬 미디어 id(t2v_N/i2v_N)로 연다. 재생성은 실제 generation
    //   아이템(vscene_N / fp_N)을 리셋해야 한다 — 안 그러면 updateVideoScene 매퍼가 t2v_/i2v_ 를 몰라
    //   no-op 이 되어 "재생성" 이 아무것도 안 한다. (t2v_N↔vscene_N, i2v_N↔fp_N: SceneList/LiveTimeline 매핑)
    if (opts.forceRegenerate && typeof item.id === 'string') {
      const mappedId = regenTargetVideoId(item.id)
      if (mappedId !== item.id) item = { ...item, id: mappedId }
    }
    // #R12-11/#R14-6: 다운로드-only retry 도 in-flight 추적 + 큐 대기(hasPendingBatch) 중엔 차단.
    if (isRunning || videoAutomation.isRunning || hasPendingBatch || videoRetryInFlightRef.current) {
      toast.warning(t('videoAutomation.busy') || 'Generation already running')
      return
    }
    // #R17-7: 시작 모드 스냅샷 — 다운로드 await 동안 모드가 바뀌면(stale 엔진) 중단.
    const startMode = modeRef.current
    const startLoadEpoch = loadEpochRef.current

    // 타입 판별: framePair는 pair.id가 fp_*, videoScene은 vscene_*
    const isFramePair = typeof item.id === 'string' && item.id.startsWith('fp_')
    const projectName = ensureProjectName()

    const onUpdate = (id, newStatus, result = {}) => {
      // 프로젝트/load 소유권이 바뀌었으면 id가 재사용된 새 프로젝트의 row를 보기 전에 중단한다.
      if (loadEpochRef.current !== startLoadEpoch) return
      // #R23-7: retryVideoDownload 완료는 비동기라 preflight 모드 가드(아래 R17-7) 이후에도
      //   모드가 바뀔 수 있다. 시작 모드와 현재 모드가 다르면 stale 교차-모드 비디오 데이터로
      //   현재 모드 UI 를 덮어쓰지 않는다.
      if (!shouldApplyModeScopedUpdate(modeRef.current, startMode)) {
        console.warn('[handleVideoRetry] onUpdate skipped — mode changed during retry')
        return
      }
      if (isFramePair) {
        const fpOwner = framePairsRef.current.find(p => p.id === id)
        // retry 완료 전에 행이 삭제됐으면 pair와 owner scene 모두 no-op.
        if (!fpOwner) return

        setFramePairs(prev => prev.map(p =>
          p.id === id ? {
            ...p,
            ...buildVideoRetryFramePairPatch(newStatus, result),
          } : p
        ))
        // ownerSceneId is the canonical row-to-scene binding. Gallery-rooted
        // rows have ownerSceneId=null and are skipped by the truthy guard.
        if (fpOwner.ownerSceneId) {
          scenesHook.updateScene(fpOwner.ownerSceneId, buildI2VScenePatch(newStatus, result))
        }
      } else {
        videoScenesHook.updateVideoScene(id, buildVideoRetryScenePatch(newStatus, result))
        if (newStatus === 'complete' && result?.base64) {
          const sceneId = id.replace('vscene_', 'scene_')
          scenesHook.updateScene(sceneId, {
            videoT2V: result.base64,
            videoT2VPath: result.videoPath || null,
            videoT2VDisabled: null,
            ...(result?.duration ? { videoT2VDuration: result.duration } : {}),
          })
        }
      }
    }

    // Fast path: download-only — 다운로드/상태조회에 키가 필요. 없으면 'No API key' 로
    // 조용히 실패하므로 여기서 가드 → API 키 모달. (slow path 의 pending 리셋은 키 불필요)
    // 개별 retry/다운로드는 무료(로그인/게이트 불필요) — 배치 다운로드만 과금 대상이다.
    // #R29-6: "재생성"(forceRegenerate)은 다운로드-only 가 아니라 새 generation 을 의도한다. 완료된
    //   영상은 generationId+mediaId 가 있어 이 fast-path 로 빠지면 기존 결과를 재다운로드만 했다.
    //   forceRegenerate 면 fast-path 를 건너뛰고 아래 slow-path 로 가 status 를 'pending' 으로 되돌린다
    //   → 분류상 download-only(status==='error')도 in-flight(status==='generating')도 아니라 freshGen
    //   으로 잡혀, 다음 Start 가 새로 생성한다(기존 영상은 덮어쓰기 전까지 폴백 유지).
    if (!opts.forceRegenerate && item.generationId && item.mediaId) {
      // #R12-11/#R13-8: 첫 await(getAccessToken) 전에 in-flight 를 세팅 — 같은 tick 의 중복 Retry/
      //   Retry+Start 가 auth await 동안 busy 가드를 통과하는 것을 막는다. 모든 종료 경로에서 해제.
      videoRetryInFlightRef.current = true
      setVideoRetryRunning(true)  // #R24-2: 모드 토글 차단(반응형)
      if (!(await genAPI.getAccessToken(
        false,
        true,
        item.generationProvider || resolveSceneVideoProvider(item, settings, isFramePair ? 'i2v' : 't2v').provider,
      ))) {
        videoRetryInFlightRef.current = false
        setVideoRetryRunning(false)
        if (flowTargetActiveRef.current) {
          toast.warning(getAuthRequiredMessage('flow', t))
        } else {
          window.dispatchEvent(new CustomEvent('flow-login-expired'))
        }
        return
      }
      // #R17-7: auth await 동안 모드가 바뀌었으면 stale 엔진으로 다운로드하지 않는다.
      if (modeRef.current !== startMode) {
        videoRetryInFlightRef.current = false
        setVideoRetryRunning(false)
        console.warn('[handleVideoRetry] aborted — mode changed during preflight')
        return
      }
      retryVideoDownload({
        item,
        genAPI,
        onUpdate,
        projectName,
        saveMode: settings.saveMode || 'folder',
        videoResolution: settings.videoResolution || '720p',
      }).catch(err => {
        console.error('[handleVideoRetry] Unexpected error:', err)
        onUpdate(item.id, 'error', { error: String(err?.message || err) })
      }).finally(() => { videoRetryInFlightRef.current = false; setVideoRetryRunning(false) })
      return
    }

    // Slow path: no generationId/mediaId — reset to pending; user clicks Start Generation to regenerate
    onUpdate(item.id, 'pending', { error: null })
    toast.info(t('videoAutomation.needsRegen') || 'Reset — click Start Generation to retry')
  }, [isRunning, videoAutomation.isRunning, hasPendingBatch, settings, genAPI, loadEpochRef, scenesHook, videoScenesHook, t, refuseIfSessionTargetUnsupported])

  const styleResolver = createStyleResolver({
    activeTab,
    scenes,
    references,
    selectedStyleRefId,
    t,
    isKo: t('common.cancel') === '취소',
  })
  const uploadedStyleRefsForPicker = activeTab === 'video-text'
    ? references.filter(ref => isStyleReference(ref) && ref.prompt)
    : references.filter(isStyleReference)

  // overrideStyleId 시그니처 (3가지 의미 구분):
  //   undefined: 호출자가 override 안 함 → UI selectedStyleRefId 사용
  //   null: 자동 모드 강제 (StylePicker 자동 카드 클릭) → UI 선택값 무시
  //   'ref:*' / 'preset:*': 그 스타일 강제 적용
  //
  // options = { force?: boolean, source?: 'ui' | 'mcp' } (선택):
  //   - force=true: 완료된 씬도 포함해 재생성 대상에 (필터 우회)
  //   - source='mcp': M2 질문을 M1 의미(exclude)로 자동 응답
  //   - 기본 false: 기존 동작 (pending/error만)
  // #R10-4: 동기 latch — 같은 tick 의 중복 Start/Proceed 가 isRunning/hasPendingBatch state 가
  //   반영되기 전(await 구간)에 둘 다 통과해 배치를 두 번 enqueue 하는 것을 막는다. handleStart 와
  //   tag-validation Proceed 가 공유.
  const startInFlightRef = useRef(false)
  const getEmptyRefGateDeps = (source = 'ui') => buildEmptyRefGateDeps({
    source,
    scenesRef: scenesHook.scenesRef,
    referencesRef,
    modeRef,
    getProjectName: () => projectNameRef.current,
    getMatchingReferences: scenesHook.getMatchingReferences,
    subscriptionPreGate: emptyRefSubscriptionPreGate,
    setPendingLatch: setHasPendingBatch,
    handleGenerateAllRefs,
    openSyncGate: openEmptyRefSyncGate,
    automationStartRef,
    guardSceneBatchStart,
    toastM1Exclusions: exclusions => {
      const warning = buildM1FlowReferenceExclusionToast(exclusions)
      if (warning) toast.warning(t(warning.key, warning.params))
    },
    gateView: source === 'mcp' ? nonInteractiveGateView : emptyRefGateView,
  })
  const handleStartImpl = async (overrideStyleId = undefined, options = {}) => {
    const { force = false, source = 'ui' } = options
    // 이미 실행 중이거나 큐에 batch가 대기 중이면 무시 (중지는 별도 버튼)
    // #R12-11: 다운로드-only 비디오 retry 진행 중에도 Start 차단(같은 아이템 경합 방지).
    if (isStartBlocked({
      isRunning,
      videoRunning: videoAutomation.isRunning,
      hasPendingBatch,
      retryInFlight: videoRetryInFlightRef.current,
      refBatchRunning,
    })) return
    const isImageBatchStart = activeTab === 'text' || activeTab === 'list'
    if (
      isImageBatchStart &&
      modeRef.current === 'flow' &&
      sessionTargetRef.current === 'chatgpt' &&
      authReadyByTarget.chatgpt !== true
    ) {
      toast.warning(t('header.chatgptLogin'))
      return
    }
    const imageTargetScenes = isImageBatchStart
      ? (force ? scenes.filter(scene => scene.prompt) : filterPendingScenes(scenes))
      : []

    if (imageTargetScenes.length > 0) {
      const imageTargetIds = new Set(imageTargetScenes.map(scene => scene.id))
      const mentionMergePlan = planMentionTagMerges(
        scenes,
        scenesHook.references,
        {
          filter: scene => imageTargetIds.has(scene.id),
        }
      )

      for (const patch of mentionMergePlan.patches) {
        scenesHook.updateScene(patch.sceneId, { characters: patch.characters })
      }
    }
    // #R7-5: 비동기 preflight(getAccessToken/폴더확인) 동안 route가 바뀌면 캡처한 엔진이
    //   stale 해진다 — mode+sessionTarget 전체를 잠그고, 디스패치 직전 바뀌었으면 중단.
    const startMode = modeRef.current
    const startSessionTarget = sessionTargetRef.current
    const i2vStartEpoch = loadEpochRef.current

    // BYOK 키 없으면 생성 불가 → 설정 안내 모달 (시작 화면으로 막지 않고 여기서 안내).
    // Flow 모드는 Flow 뷰/onFlowStatus 에서 인증을 처리하므로 BYOK 모달을 열지 않는다.
    if (!(await runOuterStartAuthPreflight({
      appMode: modeRef.current,
      sessionTarget: sessionTargetRef.current,
      getAccessToken: genAPI.getAccessToken,
    }))) {
      // #R8-4: getAccessToken await 동안 flow 로 전환됐을 수 있으니 stale closure `mode` 가
      //   아니라 현재 모드(modeRef)로 BYOK 모달 여부를 판단한다(flow 에서 BYOK 모달 방지).
      if (!flowTargetActiveRef.current) {
        setShowApiKeyModal(true)
      } else {
        toast.warning(getAuthRequiredMessage('flow', t))
      }
      return
    }
    // #R8-4: auth preflight 동안 route가 바뀌었으면 즉시 중단(stale 엔진/타깃 제출 방지).
    if (modeRef.current !== startMode || sessionTargetRef.current !== startSessionTarget) {
      console.warn('[App] handleStart aborted — route changed during auth preflight')
      return
    }

    // 생성 모드 snapshot — 라이브 그리드가 탭 이동과 무관하게 이 값을 쓴다.
    setRunningGenMode(genModeForTab(activeTab))

    // 선택 검증 (폴더 확인보다 먼저)
    if (activeTab === 'video-text') {
      if (videoScenes.filter(s => s.selected !== false).length === 0) {
        toast.warning(t('videoSelection.noneSelected'))
        return
      }
    }
    if (activeTab === 'frame-to-video') {
      if (framePairs.filter(p => p.selected !== false).length === 0) {
        toast.warning(t('videoSelection.noneSelected'))
        return
      }
    }

    // 폴더 설정 확인
    const folderCheck = await checkFolderPermission(settings, openSettings, t)
    if (!folderCheck.ok) return

    // R2-2: flow 모드에서 Flow 프로젝트 진입이 확인되지 않으면 batch 시작 차단.
    // API 모드에서 flowProjectReady는 항상 true → no-op.
    if (flowTargetActive) {
      const readyCheck = checkFlowProjectReady(flowProjectReady, t)
      if (!readyCheck.ok) return
    }

    // #R7-5: preflight 비동기 구간에서 route나 프로젝트 load 소유권이 바뀌었으면 중단
    // (stale 엔진/프로젝트로 제출 방지).
    if (modeRef.current !== startMode || sessionTargetRef.current !== startSessionTarget) {
      console.warn('[App] handleStart aborted — route changed during preflight')
      return
    }
    if (loadEpochRef.current !== i2vStartEpoch) {
      console.warn('[App] handleStart aborted — project changed during preflight')
      toast.warning(t('errorSection.kind.project-changed'))
      return
    }

    const projectName = ensureProjectName()

    switch (activeTab) {
      case 'text':
      case 'list': {
        // 이미지 생성 — 가드 순서: (1) 생성 대상 0개면 즉시 안내 (스타일 선택 요구하지 않음),
        // (2) 스타일 필수 검증. 순서가 반대면 "이미 다 생성됐는데 스타일 골라달라" 어색함.
        // force=true: 완료 씬 포함 강제 재생성 → "이미 다 생성됐다" 가드 우회 (prompt 있는 씬이 1개라도 있으면 진행).
        const targetScenes = imageTargetScenes
        if (targetScenes.length === 0) {
          toast.warning(t('toast.allScenesGenerated'))
          return
        }
        // 명시 선택 없을 때는 자동 매칭 모드로 통과 가능 — 단 generation 대상(targetScenes)에
        // 매칭 가능한 씬이 1개 이상일 때만. 전체 scenes 기준이면 완료된 씬 매칭이 false-positive.
        // override가 명시적 null이면 자동 모드 강제 (UI 선택값 무시) — 기본 default(undefined)는 UI 사용.
        const effectiveStyleId = styleResolver.resolveEffectiveStyleId(overrideStyleId)
        // force=true (MCP 강제 재생성)이면 force 대상 기준 autoAvailable 재계산 (P3 fix).
        // ('none' sentinel은 truthy라 `!effectiveStyleId` 조건 자체를 통과 안 함 → 가드 미적용 = 명시적 무스타일 허용)
        const guardAvailable = computeGuardAvailable({
          force,
          targetScenes,
          references: scenesHook.references,
          autoAvailable: styleResolver.autoAvailable,
          previewStyleMatchingFn: previewStyleMatching,
        })
        if (settings.requireStyle && !effectiveStyleId) {
          if (!guardAvailable) {
            // 스타일 선택 후 handleStart 로 재진입할 때 force 의도를 잃지 않도록 보존.
            pendingStyleForceRef.current = force
            pendingStyleSourceRef.current = source
            setShowStylePicker(true)
            return
          }
        }

        // 시작 옵션 파생은 services/startOptions 가 단일 소스 — 통합 테스트가 같은 함수로
        // "앱이 실제로 보내는 기본값"을 엔진 가드에 흘려보낸다 (aspectRatio/seed 사건 재발 방지).
        const startOptions = buildImageStartOptions(settings, { projectName, effectiveStyleId, force })

        // 태그 검증: 이미지 생성 대상 씬만 검사. 단 sceneIndex 는 원본 scenes 배열의 인덱스로
        // 와야 모달의 "#N" 표시가 실제 씬 번호와 일치한다 (filter 옵션으로 전달).
        const targetSet = new Set(targetScenes.map(s => s.id))
        const errors = collectTagErrors(scenes, scenesHook.references, {
          filter: s => targetSet.has(s.id),
        })
        if (errors.length > 0) {
          setTagValidationErrors(errors)
          // #R8-6: 모달 열린 동안 모드가 바뀌면 Proceed 가 가드를 우회하므로 시작 모드를 함께 보관.
          setPendingStartOptions({
            ...startOptions,
            __startMode: startMode,
            __startSessionTarget: startSessionTarget,
            __startSource: source,
          })
          return
        }

        if (!guardSceneBatchStart(source)) return
        if (modeRef.current !== startMode || sessionTargetRef.current !== startSessionTarget) {
          console.warn('[App] handleStart aborted — route changed before dispatch')
          return
        }
        // Stop 버튼이 현재 돌고 있는 스타일을 표시할 수 있도록 id + 라벨 모두 시작 시점 snapshot
        setRunningStyle({ styleId: effectiveStyleId, label: styleResolver.resolveLabelForId(effectiveStyleId), applies: true })
        // Keep the established Flow-gate structure; the full-route equality check immediately
        // above makes this live read equivalent to the captured startMode at dispatch time.
        if (modeRef.current === 'flow') {
          if (startSessionTarget === 'flow') {
            const { force: _force, ...startOptionsWithoutSceneIds } = startOptions
            const gateResult = await runEmptyRefGateFlow({
              startMode,
              projectName,
              force,
              initialTargetSceneIds: targetScenes.map(scene => scene.id),
              selectedStyleRefId: effectiveStyleId,
              startOptionsWithoutSceneIds,
            }, getEmptyRefGateDeps(source))
            // 모달 대기 중 다른 경로가 대상 씬을 모두 완료했으면 기존 완료 안내를 재사용한다.
            if (gateResult.reason === 'no-live-targets') {
              toast.warning(t('toast.allScenesGenerated'))
            }
            break
          } else {
            if (refuseIfSessionTargetUnsupported({
              stage: 'image',
              hasReferences: imageRequestCarriesReferences(targetScenes, effectiveStyleId),
            })) break
            setHasPendingBatch(true)
            start(startOptions).finally(() => setHasPendingBatch(false))
            break
          }
        }
        // API 모드는 M2 미노출 — 기존 scene start 경로를 그대로 유지한다(§11.12).
        setHasPendingBatch(true)
        start(startOptions).finally(() => setHasPendingBatch(false))
        break
      }

      case 'video-text': {
        if (refuseIfSessionTargetUnsupported({ stage: 'video' })) break
        // Text to Video — 선택된 videoScenes만 실행 (선택 검증은 상단에서 처리)
        const selectedVideoScenes = videoScenes.filter(s => s.selected !== false)

        // T2V는 video scene의 자체 prompt만 사용 — image scene과는 독립.
        // 스타일(selectedStyleRefId)만 추가로 prefix해서 적용.
        // (I2V는 이미지가 source라 별도 처리 — frame-to-video 케이스에서 미적용)
        // override → effective는 styleResolver.resolveEffectiveStyleId가 탭별로 처리.
        // video-text는 null override일 때 findAutoPromptStyle 결과로 변환됨 (resolver 내부 로직).
        const effectiveStyleId = styleResolver.resolveEffectiveStyleId(overrideStyleId)
        // #R36-fix(Codex R1[2]): build+start 를 클로저로 — sync gate 통과 후 patchedRefs 로 재빌드하기 위함.
        const startVideoTextWith = (refsForBuild) => {
        const { startOptions: videoTextStartOptions, runningStyle: videoTextRunningStyle, missing: videoTextMissing } = buildVideoTextStartPayload({
          videoScenes: selectedVideoScenes,
          references: refsForBuild || [],
          effectiveStyleId,
          srtTrack: scenesHook.srtTrack,
          settings,
          projectName,
          appMode: flowTargetActive ? 'flow' : 'api',  // #R36: Flow 모드면 @멘션을 컴포저 칩(segments)으로 처리
          styleLabel: styleResolver.resolveLabelForId(effectiveStyleId),
          warn: console.warn,
          onReferenceLimitWarning: (limit) => {
            toast.warning(t('videoAutomation.referenceLimitWarning', { limit }))
          },
        })

        // #R36-fix(Codex R2[1]): Flow 모드에서 미해결 @멘션(오타/없는 캐릭터/동기화 실패 잔여)이 남으면
        //   chip/ref 없이 raw "@name" 텍스트로 나가 잘못된 영상+quota 낭비 → 시작을 막는다. sync gate
        //   proceed 후 재빌드에도 동일 적용(이 클로저를 재사용하므로).
        if (flowTargetActive && Array.isArray(videoTextMissing) && videoTextMissing.length > 0) {
          toast.error(t('toast.videoUnknownMentions', { names: `@${videoTextMissing.join(', @')}` }))
          return
        }

        // Stop 버튼이 현재 실행 중인 스타일을 표시할 수 있도록 id + 라벨 모두 snapshot
        setRunningStyle(videoTextRunningStyle)
        setHasPendingBatch(true)

        videoAutomation.start({
          ...videoTextStartOptions,
          onItemUpdate: (id, newStatus, result) => {
            // 명시적 null 도 통과시켜야 하는 필드(video/videoPath/mediaId/generatedAt 등)는
            // `'X' in result` 체크 — useVideoAutomation 의 새 generation 제출 시 이전 complete
            // 메타를 의도적으로 null 로 지우기 때문 (regen 후 recovery 후보에 포함되도록).
            videoScenesHook.updateVideoScene(id, buildVideoTextResultPatch(newStatus, result))

            // #R36-fix(Codex R1[3]): T2V @멘션 칩이 stale(Flow 에서 캐릭터 삭제 등)면 그 ref 를 'failed' 로
            //   마킹 → 다음 실행 선등록(needsEntityRegistration)에서 자동 재등록(self-heal, 이미지와 동일).
            if (result?.staleMention) {
              const staleName = String(result.staleMention).toLowerCase()
              updateReferences(prev => prev.map(r => (r?.name && String(r.name).toLowerCase() === staleName) ? { ...r, flowNameSyncStatus: 'failed' } : r))
            }

            // ── T2V 완료 → 번호 매칭으로 씬에 videoT2V 동기화 ──
            // base64 또는 videoPath 중 하나라도 있으면 sync (DOM 다운로드 시 path만 있을 수 있음)
            if (newStatus === 'complete' && (result?.base64 || result?.videoPath)) {
              const sceneId = id.replace('vscene_', 'scene_')
              scenesHook.updateScene(sceneId, {
                ...(result?.base64 ? { videoT2V: result.base64 } : {}),
                videoT2VPath: result.videoPath || null,
                videoT2VDisabled: null,
                ...(result?.duration ? { videoT2VDuration: result.duration } : {}),
              })
            }
            // 새 generation 제출: 기존 비디오 데이터는 일부러 그대로 둔다(예전엔 여기서 clear).
            // 타임라인/모니터는 generating 동안 화면에서만 숨기므로(빈칸+shimmer) stale 노출이 없고,
            // 데이터를 유지해야 에러/취소 시 기존 비디오로 복귀한다. 완료 시 위 블록이 새 걸로 교체.
          },
        }).finally(() => setHasPendingBatch(false))
        }

        // #R36-fix(Codex R1[2]): Flow 모드 T2V 도 이미지 씬과 동일한 미동기화 @멘션 가드. 미동기화 캐릭터를
        //   먼저 동기화(칩으로 넣을 수 있게)한 뒤 patchedRefs 로 페이로드를 재빌드해 생성한다. 안 하면
        //   미동기화 @king 이 chip/ref 없이 텍스트로 나가 잘못된 영상 + quota 낭비.
        if (flowTargetActive) {
          // 이미지 배치와 **같은 셀렉터**를 쓴다. T2V 페이로드는 parseSceneMentions(case-sensitive,
          //   조사/공백 관용)로 칩을 붙이는데 게이트만 다른 매처로 고르면, `@hero`/`Hero` 는 동기화만
          //   시켜 놓고 칩이 안 붙고 `@문지기가` 는 게이트가 아예 안 열린다. 수리 불가 ref 제외도 포함.
          const unsyncedMentioned = [...new Set(
            selectedVideoScenes.flatMap(scene => selectMentionSyncTargets({ scene, references: scenesHook.references }))
          )]
          if (unsyncedMentioned.length > 0) {
            openSyncGate({ refs: unsyncedMentioned }).then((res) => {
              if (res.proceeded) startVideoTextWith(res.patchedRefs || scenesHook.references)
            })
            return
          }
        }
        startVideoTextWith(scenesHook.references)
        break
      }

      case 'frame-to-video': {
        if (refuseIfSessionTargetUnsupported({ stage: 'video' })) break
        // Frame to Video — 선택된 framePairs만 실행
        // Frame to Video — 선택된 framePairs만 실행 (선택 검증은 상단에서 처리)
        const selectedFramePairs = framePairs.filter(p => p.selected !== false)
        const GALLERY_PFX = 'gallery::'
        // OmniFlash 는 종료 프레임 미지원 — UI 는 End Image 를 비활성화하지만 state 의
        //   pair.endSceneId 는 남는다. 제출 payload 에서 끝 프레임을 strip 하지 않으면
        //   engineFlow 가 숨겨진 끝 이미지를 먼저 업로드하려다 실패해 start-only 생성을 막는다.
        const omniNoEndFrame = flowTargetActive && isOmniFlashModel(settings.videoModelF2V)
        const resolvedPairs = selectedFramePairs.map(p => {
          // gallery:: prefix면 mediaId 직접 추출, 아니면 씬에서 resolve
          const startIsGallery = p.startSceneId?.startsWith(GALLERY_PFX)
          const endIsGallery = p.endSceneId?.startsWith(GALLERY_PFX)
          const startScene = startIsGallery ? null : scenes.find(s => s.id === p.startSceneId)
          const endScene = endIsGallery ? null : scenes.find(s => s.id === p.endSceneId)
          const ownerScene = p.ownerSceneId ? scenes.find(s => s.id === p.ownerSceneId) : null

          // promptSource에 따라 effective prompt 계산 — ResultsTable 표시와 동일한 규칙이어야
          // mismatch (UI 가 옛 값을 보이는데 generation 은 새 값을 쓰는 등) 가 안 난다.
          // image 모드는 owner scene.prompt 가 진실 — pair.prompt 는 행 생성 시 스냅샷이라 stale 가능.
          const effectivePrompt = getFramePairEffectivePrompt(p, ftvPromptSource, videoScenes, scenes)

          const resolved = {
            ...p,
            prompt: effectivePrompt,
            _startMediaId: startIsGallery ? p.startSceneId.slice(GALLERY_PFX.length) : (startScene?.mediaId || null),
            _endMediaId: endIsGallery ? p.endSceneId.slice(GALLERY_PFX.length) : (endScene?.mediaId || null),
            // cloud(Veo) F2V: 갤러리(디스크 업로드) dataUrl 또는 씬 메모리 이미지 → inline 프레임.
            // 씬이 folder 모드라 image 가 null 이면 useVideoAutomation 이 readImage(sceneId) 폴백.
            _startImage: frameImageFor(p.startSceneId, { scenes, galleryItems, galleryPrefix: GALLERY_PFX }),
            _endImage: frameImageFor(p.endSceneId, { scenes, galleryItems, galleryPrefix: GALLERY_PFX }),
            targetDuration: ownerScene ? getSceneDuration(ownerScene, scenesHook.srtTrack) : (p.targetDuration ?? null),
            generation: ownerScene?.generation,
          }
          // OmniFlash 면 UI 에서 숨긴 끝 프레임을 payload 에서도 제거 (start-only 보장).
          return stripOmniEndFrame(resolved, omniNoEndFrame)
        })
        // seed: 이미지/T2V와 동일한 정책 — locked + 숫자일 때만 고정 seed
        const effectiveI2VSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
          ? settings.seedNo
          : null

        // I2V는 스타일 무관 — Stop 버튼에 표시 안 함
        setRunningStyle({ styleId: null, applies: false })
        setHasPendingBatch(true)

        videoAutomation.start({
          ...buildVideoI2VStartOptions({
            settings,
            framePairs: resolvedPairs,
            projectName,
            seed: effectiveI2VSeed,
          }),
          onItemUpdate: (id, newStatus, result) => {
            // epoch를 owner lookup보다 먼저 검사해야 재사용된 fp_* id를 새 프로젝트 소유자로 오인하지 않는다.
            if (loadEpochRef.current !== i2vStartEpoch) return
            const fpOwner = framePairsRef.current.find(p => p.id === id)
            // F2-1: 비동기 결과가 오기 전에 행이 삭제됐으면 owner scene도 건드리지 않는다.
            if (!fpOwner) return

            setFramePairs(prev => prev.map(p =>
              p.id === id ? {
                ...p,
                ...buildVideoI2VResultPatch(newStatus, result),
              } : p
            ))

            // ── I2V 상태/결과를 ownerSceneId 로 씬에 동기화 ──
            // ownerSceneId is the canonical row-to-scene binding. Gallery-rooted rows(null)는 스킵.
            // status + 경과 타이머 타임스탬프 + 완료 결과를 한 곳에서 적용한다.
            if (fpOwner.ownerSceneId) {
              const scenePatch = buildI2VScenePatch(newStatus, result)
              scenesHook.updateScene(fpOwner.ownerSceneId, scenePatch)
            }
          },
        }).finally(() => setHasPendingBatch(false))
        break
      }


      default:
        break
    }
  }

  // #R10-4: latch wrapper — 같은 tick 중복 진입 차단. 실제 로직은 handleStartImpl.
  const handleStart = async (overrideStyleId = undefined, options = {}) => {
    if (startInFlightRef.current) return
    startInFlightRef.current = true
    try {
      return await handleStartImpl(overrideStyleId, options)
    } finally {
      startInFlightRef.current = false
    }
  }

  // Tag validation modal callbacks
  const handleTagValidationProceed = async () => {
    setTagValidationErrors(null)
    if (!pendingStartOptions) return
    // #R10-4: 같은 latch 로 중복 Proceed/Start 차단.
    if (startInFlightRef.current) return
    startInFlightRef.current = true
    try {
      const {
        __startMode,
        __startSessionTarget,
        __startSource = 'ui',
        ...opts
      } = pendingStartOptions
      if (!guardSceneBatchStart(__startSource)) {
        setPendingStartOptions(null)
        return
      }
      // 이 경로는 handleStart 의 preflight(stale-mode/projectName/auth/flow-ready)를 우회하므로 재검증한다.
      // #R8-6: 모달이 열린 동안 route가 바뀌었으면 중단.
      if (
        (__startMode && modeRef.current !== __startMode) ||
        (__startSessionTarget && sessionTargetRef.current !== __startSessionTarget)
      ) {
        console.warn('[App] tag-validation proceed aborted — route changed while modal open')
        setPendingStartOptions(null)
        return
      }
      // #R9-4: 프로젝트가 바뀌었으면 중단 — stale projectName 으로 저장되면 엉뚱한 프로젝트 오염.
      if (ensureProjectName() !== opts.projectName) {
        console.warn('[App] tag-validation proceed aborted — project changed while modal open')
        setPendingStartOptions(null)
        return
      }
      // #R9-4: 인증 재확인(모달 사이 키 변경/만료 가능). flow 는 BYOK 모달 대신 Flow 뷰가 처리.
      if (!(await runOuterStartAuthPreflight({
        appMode: modeRef.current,
        sessionTarget: sessionTargetRef.current,
        getAccessToken: genAPI.getAccessToken,
      }))) {
        if (!flowTargetActiveRef.current) {
          setShowApiKeyModal(true)
        } else {
          toast.warning(getAuthRequiredMessage('flow', t))
        }
        setPendingStartOptions(null)
        return
      }
      if (
        modeRef.current !== __startMode ||
        sessionTargetRef.current !== __startSessionTarget
      ) {
        setPendingStartOptions(null)
        return
      } // auth await 동안 route 변경 재확인
      // #R10-5: auth await 동안 프로젝트가 바뀌었을 수 있으니 start 직전 다시 확인.
      if (ensureProjectName() !== opts.projectName) {
        console.warn('[App] tag-validation proceed aborted — project changed during auth recheck')
        setPendingStartOptions(null)
        return
      }
      if (flowTargetActiveRef.current) {
        const readyCheck = checkFlowProjectReady(flowProjectReady, t)
        if (!readyCheck.ok) { setPendingStartOptions(null); return }
      }
      // 시작 시점 snapshot — 사용자가 modal 띄운 사이 스타일 변경해도 startOptions에 들어간 게 진실
      const sid = opts.selectedStyleRefId
      if (
        modeRef.current !== __startMode ||
        sessionTargetRef.current !== __startSessionTarget
      ) {
        setPendingStartOptions(null)
        return
      }
      setRunningStyle({ styleId: sid, label: styleResolver.resolveLabelForId(sid), applies: true })
      // The full-route checks above guarantee this live marker still belongs to the captured route.
      if (modeRef.current === 'flow') {
        const liveScenes = scenesHook.scenesRef.current
        const liveTargetScenes = opts.force
          ? liveScenes.filter(scene => scene.prompt)
          : filterPendingScenes(liveScenes)
        if (__startSessionTarget === 'flow') {
          // #M2: tag modal 대기 중 바뀐 scene 상태를 useScenes의 동기 ref에서 다시 읽어 최초 의도 ID를
          // 새로 만든다. pendingStartOptions에는 설정만 남기고 과거 scene/M1 판정은 재사용하지 않는다.
          const { force = false, ...startOptionsWithoutSceneIds } = opts
          setPendingStartOptions(null)
          const gateResult = await runEmptyRefGateFlow({
            startMode: __startMode,
            projectName: opts.projectName,
            force,
            initialTargetSceneIds: liveTargetScenes.map(scene => scene.id),
            selectedStyleRefId: sid,
            startOptionsWithoutSceneIds,
          }, getEmptyRefGateDeps(__startSource))
          // 태그 모달까지 기다리는 동안 대상이 사라진 경우도 direct Start와 같은 안내를 낸다.
          if (gateResult.reason === 'no-live-targets') {
            toast.warning(t('toast.allScenesGenerated'))
          }
          return
        } else {
          if (refuseIfSessionTargetUnsupported({
            stage: 'image',
            hasReferences: imageRequestCarriesReferences(liveTargetScenes, sid),
          })) {
            setPendingStartOptions(null)
            return
          }
          setHasPendingBatch(true)
          start(opts).finally(() => setHasPendingBatch(false))
          setPendingStartOptions(null)
          return
        }
      }
      // API 모드는 M2 미노출 — 기존 tag proceed 직접 시작을 유지한다(§11.12).
      if (!guardSceneBatchStart(__startSource)) {
        setPendingStartOptions(null)
        return
      }
      setHasPendingBatch(true)
      start(opts).finally(() => setHasPendingBatch(false))
      setPendingStartOptions(null)
    } finally {
      startInFlightRef.current = false
    }
  }
  const handleTagValidationCancel = () => {
    setTagValidationErrors(null)
    setPendingStartOptions(null)
  }

  // #R34: 생성 전 가드 — '동기화 후 생성'. 미동기화 @멘션 캐릭터를 직렬(1건씩)로 Flow 에 동기화한 뒤
  //   SPA 새로고침하고, 원래 생성(proceed 클로저)을 이어서 실행한다. 동시 실행 금지(공유 flowView).
  const handleSyncGateProceed = async () => {
    if (!syncGate || syncGateBusy) return
    // 이 핸들러가 처리하는 게이트를 고정한다 — 동기화가 도는 동안 다른 경로가 새 게이트를 열어도
    // 자기 게이트만 닫는다(남의 모달을 닫으면 그 대기자가 영구히 매달린다).
    const myGate = syncGate
    beginSyncGateWork()
    // 실행부는 services/syncGateRun 이 소유한다 — App 안에 두면 프로젝트 스코프 판정과
    // forceRepair 전달을 되돌려도 전체 스위트가 초록불이었다(뮤테이션 실측).
    try {
      await runSyncGate({ gate: myGate }, {
        getReferences: () => referencesRef.current || [],
        getProjectName: () => projectNameRef.current,
        isProjectLoading: () => projectLoadingRef.current,
        getFlowProjectId: () => flowProjectIdRef.current,
        getScopeToken: () => `${modeRef.current ?? ''}::${settings.projectName ?? ''}`,
        syncRef: (ref, opts) => syncRefToFlow(ref, genAPI.uploadReference, opts),
        publishRefs: updateReferences,
        refreshComposer: () => {
          const scopeToken = `${modeRef.current ?? ''}::${projectNameRef.current ?? ''}`
          return runFlowComposerRefresh({
            projectId: flowProjectIdRef.current,
            scopeToken,
            shouldRun: () => `${modeRef.current ?? ''}::${projectNameRef.current ?? ''}` === scopeToken,
          })
        },
        onIncomplete: ({ ok, fail }) => toast.error(t('toast.flowSyncIncomplete', { ok, fail })),
        onSuccess: ({ ok }) => toast.success(t('toast.flowSyncGenerationStarting', { ok })),
        finish: (patchedRefs) => finishSyncGate(myGate, patchedRefs),
        abort: (reason) => abortSyncGate(myGate, reason),
      })
    } catch (e) {
      // 예기치 못한 예외로도 대기자를 남기지 않는다 — 남기면 모달이 화면에 그대로 있고
      // 그 promise 를 기다리던 생성 큐가 영영 멈춘다.
      console.error('[App] sync-gate failed:', e)
      toast.error(t('toast.flowSyncIncomplete', { ok: 0, fail: myGate.refs?.length ?? 0 }))
      abortSyncGate(myGate, 'sync-error')
    } finally {
      endSyncGateWork()
    }
  }
  const handleSyncGateCancel = () => {
    if (syncGateBusy) return
    cancelSyncGate(syncGate)
  }

  // ref batch는 generatingRefs.length만으로 부족 — refBatchActive가 batch-global preflight부터
  // 아이템별 auth와 정리까지 덮고, stoppingRefs는 중지 정리 창을 잇는다.
  const refBatchRunning = refBatchActive || stoppingRefs || generatingRefs.length > 0

  // Handle stop — 활성 자동화 중지 (scene + video + ref batch 모두 cover).
  // Phase 2: MCP 자동 stop-restart 플로우가 handleStop을 trigger하므로 ref batch도 stop해야 함.
  const handleStop = () => {
    // 실행 중인 개별 씬(type: scene)은 그대로 두고, 공유 큐에서 아직 시작하지 않은
    // 씬 배치만 reject한다. queue reject는 start(...).finally / emptyRefGate finally로
    // 이어져 hasPendingBatch latch도 해제된다.
    generationQueue.clearQueue?.('scene_batch')
    if (isRunning) stop()
    if (videoAutomation.isRunning) videoAutomation.stop()
    if (shouldStopRefWork({ refBatchRunning, gatePhase: emptyRefGate?.phase })) stopGenerateAllRefs()
  }

  const routeQuiesceOwnerRef = useRef(null)
  routeQuiesceOwnerRef.current = {
    busy: isRunning || isSceneBatchQueued || videoAutomation.isRunning || refBatchRunning || hasPendingBatch,
    stop: handleStop,
    awaitIdle: async () => {
      await automation.awaitIdle?.()
      const idle = await waitUntil(
        () => !routeQuiesceOwnerRef.current?.busy,
        { timeoutMs: 30_000, intervalMs: 20 },
      )
      if (!idle) throw new Error('renderer-flow-idle-timeout')
    },
  }

  useRouteQuiesceBridge(routeQuiesceOwnerRef)

  // quiesce listener가 먼저 설치된 다음 stored/current route를 main에 adopt한다. 이 순서를
  // 뒤집으면 초기 IPC가 빠른 환경에서 첫 request를 놓쳐 main timeout까지 view 전환이 막힌다.
  const previousLayoutModeRef = useRef(null)
  const bootRouteRequestRef = useRef(true)
  useEffect(() => {
    if (!route) return
    const enteringFlow = route.mode === 'flow' && previousLayoutModeRef.current !== 'flow'
    previousLayoutModeRef.current = route.mode
    // Shell/useSplitLayout 이 저장 레이아웃의 단일 소유자다. 진입 기본값은 child effect 에서
    // 동기 push 해야 뒤이어 도는 Shell parent effect 의 저장값이 최종 승자가 된다. IPC 응답 뒤에
    // 보내면 저장값을 덮고 echo 가 localStorage 까지 오염시킨다. target-only 변경에는 보내지 않는다.
    if (enteringFlow) {
      const layout = flowLayoutForMode(route.mode)
      if (layout) window.electronAPI?.setLayout?.(layout)?.catch?.((e) => console.warn('[App] setLayout failed:', e?.message))
    }
    const isBootRequest = bootRouteRequestRef.current
    bootRouteRequestRef.current = false
    requestRoute(route, {
      boot: isBootRequest,
      reconcileOnFailure: isBootRequest,
    }).then((result) => {
      if (!result?.ok) {
        console.warn('[App] setRoute failed:', result?.error)
      }
    }).catch((e) => console.warn('[App] setRoute failed:', e?.message))
  }, [route, requestRoute])

  // MCP HTTP 서버 (시작/중지, 글로벌 접근자, 업데이트 수신, 배치 핸들러)
  // isRunning: scene OR ref(prepare/stop/generating) OR video — Phase 2 auto stop-restart 트리거.
  useMcpServer({
    settings,
    scenes, setScenes,
    references, setReferences,
    // Phase 11: MCP 가 srtTrack 동기화할 수 있게 setter 전달
    srtTrack: scenesHook.srtTrack, setSrtTrack: scenesHook.setSrtTrack,
    handleGenerateRef, handleGenerateScene,
    handleGenerateAllRefs, handleStart, handleStop,
    handleProjectChange, handleExportConfirm, handleExportPremiere,
    selectedStyleRefId, setSelectedStyleRefId,
    refreshReviews, audioReviews,
    importByPath, audioPackage,
    automationState: { isRunning, isSceneBatchQueued, isPaused, progress, status, statusMessage },
    videoAutomation, generatingRefs,
    refBatchRunning,
    isRunning: isRunning || isSceneBatchQueued || videoAutomation.isRunning || refBatchRunning
  })

  // 어느 자동화든 실행 중이면 true
  // #R13-14: 큐 대기(hasPendingBatch) 구간도 busy 로 본다 — isRunning 으로 뒤집기 전 windows 에서
  //   편집/프로젝트 액션이 열려 있던 비일관성 차단. (anyRunning 은 videoRetryInFlightRef 를 제외하지만,
  //   #R24-2 로 모드 토글 차단용 반응형 videoRetryRunning 은 별도로 modeBusy 에 포함된다.)
  const anyRunning = isRunning || videoAutomation.isRunning || hasPendingBatch
  // 개별 씬 생성은 MCP·프로그램 배치를 공유 큐에 대기시킬 수 있어야 한다. 로직 가드가 아니라
  // 사용자가 동시에 scene batch를 넣을 수 있는 UI 진입점만 공통으로 차단한다.
  const uiSceneBatchBlocked = !!generatingSceneId
  // Header의 프로젝트/모드 액션과 네이티브 File 메뉴가 같은 전체 busy 계약을 쓴다.
  const fullProjectBusy = anyRunning || refBatchRunning || videoRetryRunning || uiSceneBatchBlocked || thumbnailGenerating || galleryUploading

  // 네이티브 File 메뉴 ↔ renderer 연결 (New Project / Recent Projects)
  // Recent 항목은 work folder 단위로 구분되므로 현재 work folder 경로도 함께 전달.
  useMenuActions({
    activeProject: settings.saveMode === 'folder' ? settings.projectName : null,
    workFolder: settings.saveMode === 'folder' ? (localStorage.getItem('workFolderPath') || null) : null,
    onNewProject: () => openSettings('storage'),
    onOpenProject: handleProjectChange,
    onShowModeSelector: clearMode,
    busy: fullProjectBusy,
    busyMessage: t('modeInfo.busySwitch'),
  })

  // 생성 중: 가장 최근 생성된 이미지 씬으로 모니터를 점프 → "만들어지는 걸 본다".
  // (씬에 SRT/길이 타이밍이 있어야 위치 계산 가능 — 없으면 그대로 둠)
  const lastMonitorSceneRef = useRef(null)
  useEffect(() => {
    if (!anyRunning) return
    let latest = null
    for (const s of scenes) {
      if (hasImageData(s) && s.generatedAt && (!latest || s.generatedAt > latest.generatedAt)) latest = s
    }
    if (latest && latest.id !== lastMonitorSceneRef.current) {
      lastMonitorSceneRef.current = latest.id
      const range = getSceneTimeRangeMs(latest)
      if (range) setMonitorMs(range.startMs)
    }
  }, [scenes, anyRunning])
  const isVideoTab = activeTab === 'video-text' || activeTab === 'frame-to-video'
  // 생성 중에는 snapshot 된 runningGenMode 로 자동화 상태를 고른다 — Grid 와 일관되게,
  // 탭을 바꿔도 StatusBar 가 다른 automation 상태로 튀지 않게(live activeTab 사용 시 회귀).
  const showVideoAutomation = anyRunning ? (runningGenMode !== 'image') : isVideoTab
  const currentProgress = showVideoAutomation ? videoAutomation.progress : progress
  const currentStatus = showVideoAutomation ? videoAutomation.status : status
  const currentStatusMessage = showVideoAutomation ? videoAutomation.statusMessage : statusMessage

  // #R7-18: mp3 드롭 → 나레이션/SFX 트랙 import. 메인(하단 패널) 타임라인이 공유하는 핸들러.
  const handleTrackDrop = async ({ trackRole, files, timecodeMs }) => {
    const workFolder = localStorage.getItem('workFolderPath')
    const projectName = settings.projectName
    const fallbackFolderPath = workFolder && projectName ? `${workFolder}/${projectName}/audio` : null
    for (const file of files) {
      const mp3Path = window.electronAPI?.getPathForFile?.(file)
      if (!mp3Path) continue
      await importMp3ToTrack({ mp3Path, trackType: trackRole, timecodeMs, fallbackFolderPath })
      if (trackRole === 'narration') break // narration 은 1개(교체)
    }
  }

  return (
    <div className={computeAppClass(mode)}>
      <SessionTargetComboPortal
        busy={fullProjectBusy}
        authReadyByTarget={authReadyByTarget}
        onRouteRequest={requestRoute}
      />
      <QAProgressBanner />
      <ImportProcessingOverlay
        processing={importProcessing}
        spinnerVisible={importSpinnerVisible}
        label={t('import.processing')}
      />
      {projectLoading && (
        <div className="project-loading-overlay">
          <div className="project-loading-spinner" />
          <span>Loading project...</span>
        </div>
      )}
      <Header
        onRouteRequest={requestRoute}
        onSettings={(tab) => openSettings(typeof tab === 'string' ? tab : null)}
        onExport={handleExportClick}
        exportFormat={exportFormat}
        hasImages={scenes.some(isSceneGenerationDone)}
        getAccessToken={genAPI.getAccessToken}
        authReady={authReady}
        authReadyByTarget={authReadyByTarget}
        onAuthRecovered={handleAuthRecovered}
        projectName={settings.projectName}
        onProjectChange={handleProjectChange}
        onNewProject={() => openSettings('storage')}
        saveMode={settings.saveMode}
        // NOTE(#6): onLoginClick → setShowAuthModal (Google/subscription auth).
        // This is mode-agnostic intentionally — both modes may need to log into the app.
        // Mode-specific auth (BYOK key for api, Flow webview for flow) is handled separately.
        onLoginClick={() => setShowAuthModal(true)}
        onUpgradeClick={() => {
          setPaywallReason('upgrade')
          setShowPaywallModal(true)
        }}
        disabled={fullProjectBusy}
        modeBusy={fullProjectBusy}
        storyActive={activeView === 'story'}
        onStoryClick={() => setActiveView(v => v === 'story' ? 'generate' : 'story')}
      />

      {/* 구독 상태 배너 (Trial/만료 시에만 표시) */}
      <SubscriptionBanner
        onUpgradeClick={() => {
          setPaywallReason('upgrade')
          setShowPaywallModal(true)
        }}
        onLoginClick={() => setShowAuthModal(true)}
        hideWhenPro={true}
      />

      {/* 메인 UI - 항상 표시. 키 없으면 생성(Start) 시 API 키 모달로 안내(시작 화면 게이트 제거). */}
      {activeView === 'generate' && (
      <>
      <div className="main-panel">
        {/* 탭 헤더 */}
        <div className="tabs-header">
          {/* 왼쪽 그룹: 생성 탭 (프롬프트, 비디오, F→V, R→V) */}
          <div className="tabs-left">
            <button
              className={`tab tab-fixed ${activeTab === 'text' ? 'active' : ''}`}
              onClick={() => setActiveTab('text')}
            >
              📝 {t('tabs.text')}
            </button>
            <button
              className={`tab tab-icon ${activeTab === 'video-text' ? 'active' : ''}`}
              onClick={() => setActiveTab('video-text')}
              title={t('tabs.videoText')}
            >
              🎬 <span className="tab-label">{t('tabs.videoText')}</span>
            </button>
            <button
              className={`tab tab-icon ${activeTab === 'frame-to-video' ? 'active' : ''}`}
              onClick={() => setActiveTab('frame-to-video')}
              title={t('tabs.frameToVideo')}
            >
              🎞️ <span className="tab-label">{t('tabs.frameToVideo')}</span>
            </button>
          </div>

          {/* 오른쪽 그룹: 관리 탭 (씬목록, Ref, 가져오기) */}
          <div className="tabs-right">
            <button
              className={`tab tab-icon ${activeTab === 'list' ? 'active' : ''}`}
              onClick={() => setActiveTab('list')}
              title={t('tabs.list')}
            >
              📋 <span className="tab-label">{t('tabs.list')}</span> ({scenes.length})
            </button>
            {/* Audio 탭 — SFX 입력용. 현재 상단 프리뷰(LiveTimeline)가 타임라인을 커버해 중복이라 숨김.
                SFX 입력 처리 재개 시 주석 해제. (content 블록은 activeTab==='audio' 가 안 돼 자동 미렌더) */}
            {/* <button
              className={`tab tab-icon ${activeTab === 'audio' ? 'active' : ''}`}
              onClick={() => setActiveTab('audio')}
              title={t('audioTab.title') || '오디오'}
            >
              🎵 <span className="tab-label">{t('audioTab.title') || '오디오'}</span>
              {audioPackage && <span className="tab-count"> ({(audioPackage.summary?.totalVoiceFiles || 0) + (audioPackage.summary?.totalSfxFiles || 0)})</span>}
            </button> */}
            <button
              className={`tab tab-icon ${showReferences ? 'active' : ''}`}
              onClick={() => setOpenByUser(!showReferences)}
              title={t('tabs.references')}
            >
              🖼️ <span className="tab-label">Ref</span> ({references.length})
            </button>
            <button
              className="tab tab-fixed"
              onClick={() => setShowImport(true)}
              title={t('tabs.import')}
              disabled={anyRunning || generatingRefs.length > 0}
            >
              📂 {t('tabs.import')}
            </button>
          </div>
        </div>

        {/* 편집 영역(좌: 콘텐츠+액션버튼) | 프리뷰 모니터(우) — 모니터가 둘을 아우름 */}
        <div className="editor-row">
        <div className="editor-col">

        {/* 스크롤 가능한 콘텐츠 영역 (레퍼런스 + 탭 콘텐츠) */}
        <div className="tab-content">
        {/* 레퍼런스 패널 (접기 가능) */}
        {showReferences && (
          <ReferencePanel
            references={references}
            scenes={scenes}
            aspectRatio={settings.aspectRatio}
            appMode={mode}
            onUpdate={updateReferences}
            onUpload={async (...args) => {
              if (refuseIfSessionTargetUnsupported({ stage: 'image', hasReferences: true })) {
                return { success: false, error: 'chatgpt_reference_images_unmeasured' }
              }
              const readyCheck = checkFlowProjectReady(flowProjectReady, t)
              if (!readyCheck.ok) return { success: false, error: 'flow_project_not_ready' }
              return genAPI.uploadReference(...args)
            }}
            onGenerate={handleGenerateRef}
            onGenerateAll={handleGenerateAllRefs}
            onStopGenerateAll={stopGenerateAllRefs}
            onClearAll={() => setReferences([])}
            generatingRefs={generatingRefs}
            stoppingRefs={stoppingRefs}
            preparingRefs={preparingRefs}
            refBatchActive={refBatchActive}
            refBatchRunning={refBatchRunning}
            hasPendingBatch={hasPendingBatch}
            selectedStyleRefId={selectedStyleRefId}
            onStyleRefChange={setSelectedStyleRefId}
            flowProjectId={_flowProjectId}
            projectName={settings.projectName}
            thumbnails={styleThumbnails}
            thumbnailGenerating={thumbnailGenerating}
            thumbnailStopping={thumbnailStopping}
            thumbnailProgress={thumbnailProgress}
            onGenerateThumbnails={async (presetIds, customRefs) => {
              const customResults = await generateThumbnails(presetIds, customRefs, t)
              if (customResults?.length > 0) {
                setReferences(prev => prev.map(ref => {
                  const result = customResults.find(r => r.refId === ref.id)
                  return result ? { ...ref, data: result.data, filePath: null, dataStorage: null } : ref
                }))
              }
            }}
            onStopThumbnailGeneration={stopThumbnailGeneration}
            onDeleteThumbnail={deleteThumbnail}
          />
        )}

        {/* 탭 콘텐츠 */}
        <div className="tab-content-inner">
          {activeTab === 'text' && (
            <PromptInput
              value={scenes.map(s => s.prompt).join('\n')}
              busyLines={imageBusyLines}
              onChange={handleTextChange}
              disabled={anyRunning}
              references={scenesHook.references}
              seedNo={settings.seedNo}
              seedLocked={settings.seedLocked}
              onSeedChange={(v) => setSettings(s => ({ ...s, seedNo: v }))}
              onSeedLockToggle={() => setSettings(s => ({ ...s, seedLocked: !s.seedLocked }))}
              onSeedRandom={() => {
                const n = Math.floor(Math.random() * 1000000)
                setSettings(s => ({ ...s, seedNo: n, seedLocked: true }))
              }}
            />
          )}
          {activeTab === 'video-text' && (
            <PromptInput
              // 압축된 derived videoScenes 가 아니라 전체 scenes 기준으로 value 생성 — 갭이 있는
              // 비디오 prompt 가 편집 순간 다른 씬으로 당겨지는 회귀를 막는다. 마지막 trailing
              // 빈 줄만 정리해서 표시 깔끔하게.
              value={scenes.map(s => s.videoT2VPrompt || '').join('\n').replace(/\n+$/, '')}
              busyLines={videoBusyLines}
              onChange={handleVideoTextChange}
              disabled={anyRunning}
              references={(scenesHook.references || []).filter(isUsableVideoReference)}
              placeholder={t('prompt.videoPlaceholder')}
              seedNo={settings.seedNo}
              seedLocked={settings.seedLocked}
              onSeedChange={(v) => setSettings(s => ({ ...s, seedNo: v }))}
              onSeedLockToggle={() => setSettings(s => ({ ...s, seedLocked: !s.seedLocked }))}
              onSeedRandom={() => {
                const n = Math.floor(Math.random() * 1000000)
                setSettings(s => ({ ...s, seedNo: n, seedLocked: true }))
              }}
            />
          )}
          {activeTab === 'frame-to-video' && (
            <FrameToVideoPanel
              scenes={scenes}
              videoScenes={videoScenes}
              framePairs={framePairs}
              onUpdate={setFramePairs}
              // image 모드의 단일 진실 소스 = owner scene.prompt. F→V 행에서 image 프롬프트 편집은
              // scene 본체로 라우팅 — 이미지/T2V 탭에서 수정한 값과 자동 일치 유지.
              onScenePromptUpdate={(sceneId, newPrompt) => scenesHook.updateScene(sceneId, { prompt: newPrompt })}
              // video 모드도 동일한 단일 진실 소스 = scene.videoT2VPrompt. F→V 의 video prompt
              // 편집은 owner scene 의 T2V prompt 로 라우팅 → T2V 탭과 양방향 일치.
              onSceneVideoPromptUpdate={(sceneId, newPrompt) => scenesHook.updateScene(sceneId, { videoT2VPrompt: newPrompt })}
              promptSource={ftvPromptSource}
              onPromptSourceChange={setFtvPromptSource}
              onShowSceneDetail={(scene) => setSelectedScene(scene)}
              onVideoRetry={handleVideoRetry}
              disabled={anyRunning}
              endImageDisabled={flowTargetActive && isOmniFlashModel(settings.videoModelF2V)}
              t={t}
              galleryItems={galleryItems}
              galleryLoading={galleryLoading}
              onLoadGallery={loadGallery}
              onUploadFromDisk={handleUploadGalleryImage}
              hasFlowArchive={genAPI.capabilities?.hasFlowArchive}
              onListFlowProjects={genAPI.listFlowProjects}
              onFetchProjectGallery={genAPI.fetchGallery}
              onPickArchiveImage={addArchiveItem}
              seedNo={settings.seedNo}
              seedLocked={settings.seedLocked}
              onSeedChange={(v) => setSettings(s => ({ ...s, seedNo: v }))}
              onSeedLockToggle={() => setSettings(s => ({ ...s, seedLocked: !s.seedLocked }))}
              onSeedRandom={() => {
                const n = Math.floor(Math.random() * 1000000)
                setSettings(s => ({ ...s, seedNo: n, seedLocked: true }))
              }}
              onRequestNewScene={() => scenesHook.addScene()  /* returns new scene id */}
              onRequestSceneTrim={(nextFramePairs) => scenesHook.trimScenes(nextFramePairs)}
            />
          )}
          {activeTab === 'list' && (
            <SceneList
              scenes={scenes}
              srtTrack={scenesHook.srtTrack}
              framePairs={framePairs}
              aspectRatio={settings.aspectRatio}
              onUpdate={scenesHook.updateScene}
              onUpdateFramePair={(fpId, patch) => setFramePairs(prev => prev.map(p => p.id === fpId ? { ...p, ...patch } : p))}
              onUpdateSrtLine={scenesHook.updateSrtLine}
              onDelete={handleRequestSceneDelete}
              onAdd={scenesHook.addScene}
              onClearAll={() => {
                // 씬 통째 삭제 = framePairs 도 같이 cascade. 그렇지 않으면 ownerSceneId
                // 가 전부 dangling 됨 (deleteScene cascade 와 동일 class 의 회귀).
                scenesHook.clearScenes()
                setFramePairs([])
              }}
              defaultDuration={settings.defaultDuration}
              disabled={anyRunning}
              projectName={ensureProjectName()}
              onGenerate={handleGenerateScene}
              generatingSceneId={generatingSceneId}
              references={references}
              styleThumbnails={styleThumbnails}
            />
          )}
          {activeTab === 'audio' && (
            <AudioPanel
              audioPackage={audioPackage}
              audioReviews={audioReviews}
              loading={audioLoading}
              onSaveReview={saveReview}
              onBulkReview={saveBulkReviews}
              onRefresh={refreshReviews}
              onSaveTimecodeOverride={saveTimecodeOverride}
              srtEntries={effectiveSrtEntries}
              scenes={scenes}
              onImportMp3={async (params) => {
                // 드롭한 mp3는 audioFolderPath/media[/sfx]/로 복사되어 영속화.
                // 기존 audioPackage가 있으면 그 folderPath를, 없으면 프로젝트 폴더 내
                // audio/로 자동 생성.
                const workFolder = localStorage.getItem('workFolderPath')
                const projectName = settings.projectName
                const fallbackFolderPath = workFolder && projectName
                  ? `${workFolder}/${projectName}/audio`
                  : null
                return importMp3ToTrack({ ...params, fallbackFolderPath })
              }}
              onSrtImport={(content) => handleImport('srt', content)}
              onSceneUpdate={scenesHook.updateScene}
            />
          )}
        </div>
        </div>


        {/* 액션 버튼 */}
        <div className="action-buttons">
          {/* expired 상태: 생성 시작 전에 업그레이드 버튼 표시 */}
          {subscription?.status === 'expired' && !anyRunning && (
            <button
              className="btn-upgrade"
              onClick={() => {
                setPaywallReason('upgrade')
                setShowPaywallModal(true)
              }}
            >
              {t('subscription.upgradeToPro')}
            </button>
          )}

          {/* 생성 완료 후 설정된 완료율 이상 성공 시 버튼 2개로 분할 */}
          {(() => {
            const doneCount = scenes.filter(isSceneGenerationDone).length
            const hasScenes = scenes.length > 0
            // 생성이 한 번이라도 실행되고 완료됐는지 (done 또는 error 상태가 있음)
            const hasRun = scenes.some(s => s.status === 'done' || s.status === 'error')
            // 설정된 완료율 이상 && 실행 완료 && 현재 실행 중 아님
            const threshold = settings.exportThreshold || 50
            const requiredCount = Math.ceil(scenes.length * threshold / 100)
            const canExport = hasScenes && hasRun && !anyRunning && doneCount >= requiredCount
            // 전체 재생성 ▾ — 이미지 탭 + 생성된 이미지가 1개 이상일 때만 노출 (덮어쓸 게 있어야 의미)
            const showGenerateMenu = (activeTab === 'text' || activeTab === 'list')
              && scenes.some(s => s.image || s.imagePath)

            const startStyleId = styleResolver.resolveEffectiveStyleId(undefined)
            const startStyleLabel = styleResolver.resolveLabelForId(startStyleId)
            const startStyleApplies = activeTab === 'text' || activeTab === 'list' || activeTab === 'video-text'
            // Stop 버튼은 실행 시작 시 snapshot된 runningStyle.label 우선 사용.
            // label snapshot이 없는 케이스(이전 동작 호환)만 fallback으로 다시 계산.
            const stopStyleLabel = runningStyle.label !== undefined
              ? runningStyle.label
              : styleResolver.resolveLabelForId(runningStyle.styleId)
            const stopStyleApplies = runningStyle.applies

            return (
              <>
                {anyRunning ? (
                  <button
                    className={`btn-danger ${canExport ? 'half' : ''}`}
                    onClick={handleStop}
                    disabled={isStopping}
                  >
                    {isStopping ? `⏳ ${t('status.stopping')}` : `⏹️ ${t('actions.stop')}`}
                    {stopStyleApplies && (
                      <>
                        {' ▸ '}
                        <span className="btn-style-display" title={stopStyleLabel}>
                          🎨 {stopStyleLabel}
                        </span>
                      </>
                    )}
                  </button>
                ) : (
                  <div className={`generate-split ${showGenerateMenu ? 'has-menu' : ''}`}>
                    <button
                      ref={startBtnRef}
                      data-testid={(activeTab === 'text' || activeTab === 'list') ? 'image-start' : undefined}
                      className={`btn-primary ${canExport ? 'half' : ''}`}
                      onClick={() => handleStart()}
                      title={t('actions.start')}
                      disabled={
                        ((activeTab === 'text' || activeTab === 'list') && scenes.length === 0) ||
                        (activeTab === 'video-text' && videoScenes.length === 0) ||
                        (activeTab === 'frame-to-video' && framePairs.length === 0) ||
                        hasPendingBatch ||
                        refBatchRunning ||
                        uiSceneBatchBlocked ||
                        ((activeTab === 'text' || activeTab === 'list') && chatgptTargetActive && !authReady)
                      }
                    >
                      {(() => {
                        // 시작 라벨은 full("Start Generation")→short("Start Gen.")→icon(텍스트 생략) 축약.
                        //   🎨 스타일칩은 **항상** 노출(스타일 적용 탭) — 라벨이 줄어도 스타일 진입점은
                        //   남는다. 좁은 tier 에선 스타일 라벨 텍스트만 숨긴다(startChipLabelVisible).
                        const emoji = activeTab === 'video-text' ? '🎬' : '✨'
                        const label =
                          startTier === 'icon' ? '' :
                          startTier === 'mini' ? t('actions.startMini') :
                          startTier === 'short' ? t('actions.startShort') :
                          t('actions.start')
                        if (!startStyleApplies) return `🎬${label ? ` ${label}` : ''}`
                        return (
                          <>
                            {emoji}{label && ` ${label}`}
                            {' ▸ '}
                            <span className="btn-style-link" onClick={(e) => { e.stopPropagation(); pendingStyleForceRef.current = false; pendingStyleSourceRef.current = 'ui'; setShowStylePicker(true) }}>
                              🎨{startChipLabelVisible(startTier) ? ` ${startStyleLabel}` : ''}
                            </span>
                          </>
                        )
                      })()}
                    </button>
                    {/* 전체 재생성 ▾ — split-button 으로 생성 버튼에 붙는다 */}
                    {showGenerateMenu && (
                      <GenerateMenu
                        onForceRegenerate={() => {
                          if (uiSceneBatchBlocked) return
                          handleStart(undefined, { force: true })
                        }}
                        disabled={hasPendingBatch || refBatchRunning || uiSceneBatchBlocked}
                      />
                    )}
                  </div>
                )}

                {canExport && (
                  <ExportSplitButton
                    format={exportFormat}
                    onSelect={handleExportClick}
                    className="btn-success"
                    wrapperClassName="half"
                    direction="up"
                    title={t('actions.scenesComplete').replace('{done}', doneCount).replace('{total}', scenes.length)}
                  />
                )}
              </>
            )
          })()}

          {!anyRunning && !hasPendingBatch && scenes.some(s => s.status === 'error') && (
            <button
              className="btn-secondary"
              onClick={() => {
                // 큐 대기(hasPendingBatch, isRunning 아직 false) 구간에도 노출될 수 있으니
                // snapshot 을 덮기 전에 먼저 차단 — Start 버튼의 disabled 조건과 동일선상.
                if (anyRunning || hasPendingBatch || uiSceneBatchBlocked) return
                // ⚠️ 직접 바인딩(`onClick={retryErrors}`) 시 React SyntheticEvent 가
                //    options 인자로 들어가서 projectName 누락 → start() 가 'Untitled' 로
                //    폴백 → 모든 저장이 다른 프로젝트로 잘못 가는 데이터 손실 회귀.
                //    개별 재시도(onRetry, line ~1162) 와 동일한 옵션 명시 패턴 적용.
                const effectiveSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
                  ? settings.seedNo
                  : null
                // Stop 버튼이 retry 중에도 스타일을 표시하도록 snapshot — 정상 생성(handleStart)과 동일.
                setRunningStyle({ styleId: selectedStyleRefId, label: styleResolver.resolveLabelForId(selectedStyleRefId), applies: true })
                // retryErrors 는 handleStart 를 우회하므로 모드 snapshot 을 직접 set (에러 재시도 = 이미지).
                setRunningGenMode('image')
                // 큐 대기 구간 중복 enqueue 방지 — 정상 Start 와 동일하게 pending 플래그.
                setHasPendingBatch(true)
                retryErrors({
                  projectName: ensureProjectName(),
                  saveMode: settings.saveMode,
                  // 동시성 — retryErrors 도 정상 생성과 동일하게 전달 (Stage 2 에서
                  // runConcurrentQueue 가 실제 소비). 게이트가 clampInt 로 재방어.
                  concurrency: settings.concurrency || 5,
                  flowPacingMinMs: settings.flowPacingMinMs,
                  flowPacingMaxMs: settings.flowPacingMaxMs,
                  imageBatchCount: settings.imageBatchCount || 1,
                  imageUpscale: settings.imageUpscale || 'off',
                  aspectRatio: settings.aspectRatio,
                  imageModel: settings.imageModel,
                  imageProvider: settings.generation?.image?.provider ?? 'google',
                  generationSettings: settings,
                  selectedStyleRefId,
                  seed: effectiveSeed,
                }).finally(() => setHasPendingBatch(false))
              }}
            >
              🔄 {t('actions.retryErrors')}
            </button>
          )}
        </div>
        </div>

        {/* 프리뷰 모니터(inline) — 입력 프롬프트 왼쪽(.editor-row 가 row-reverse). API 모드는 상시,
            Flow 모드는 '프리뷰' 라벨 토글/재생 자동 open 일 때만 표시. 좌우 드래그로 폭 조절.
            전체화면은 .main-panel(container-type)이 fixed 의 containing block 이 돼 뷰포트 풀스크린이
            안 되므로 body 로 portal 한다. */}
        <PreviewMonitor
          monitorMode={monitorMode}
          monitorFullscreen={monitorFullscreen}
          monitorWidth={monitorWidth}
          monitorMs={monitorMs}
          monitorPlaying={monitorPlaying}
          monitorHiddenRoles={monitorHiddenRoles}
          monitorVolume={monitorVolume}
          monitorMuted={monitorMuted}
          setMonitorVolume={setMonitorVolume}
          toggleMonitorMuted={toggleMonitorMuted}
          toggleMonitorFullscreen={toggleMonitorFullscreen}
          onCloseOverlay={() => setMonitorOverlayOpen(false)}
          startMonitorResize={startMonitorResize}
          resetMonitorWidth={resetMonitorWidth}
          mode={mode}
          anyRunning={anyRunning}
          runningGenMode={runningGenMode}
          bottomPanelView={bottomPanelView}
          scenes={scenes}
          videoScenes={videoScenes}
          framePairs={framePairs}
          settings={settings}
          srtEntries={effectiveSrtEntries}
          onSelectVideo={setSelectedVideo}
          onSelectScene={setSelectedScene}
          t={t}
        />
        </div>
      </div>

      {/* 리사이즈 핸들 */}
      <ResizeHandle
        onResize={setBottomPanelHeight}
        minTop={UI.MIN_TOP_PANEL_HEIGHT}
        minBottom={UI.MIN_BOTTOM_PANEL_HEIGHT}
      />

      {/* 하단 패널: 상태 + 결과 */}
      <div className="bottom-panel" style={{ height: bottomPanelHeight }}>
        <StatusBar
          progress={currentProgress}
          status={currentStatus}
          message={currentStatusMessage}
          scenes={scenes}
          progressIsVideo={showVideoAutomation}
        />

        {activeTab !== 'audio' && (
          <>
            <BottomPanelTabs view={bottomPanelView} onChange={setBottomPanelView} t={t} />
            {bottomPanelView === 'timeline' ? (
              <LiveTimeline
                scenes={scenes}
                srtEntries={effectiveSrtEntries}
                audioPackage={effectiveAudioPackage}
                framePairs={framePairs}
                onSceneSelect={(scene) => setSelectedScene(scene)}
                onVideoSelect={(item) => setSelectedVideo(item)}
                onSaveTimecodeOverride={saveTimecodeOverride}
                onPlayheadChange={setMonitorMs}
                onPlayingChange={setMonitorPlaying}
                onHiddenRolesChange={setMonitorHiddenRoles}
                onTrackDrop={handleTrackDrop}
                onSceneUpdate={scenesHook.updateScene}
                disabled={anyRunning}
                onTitleClick={flowTargetActive ? () => setMonitorOverlayOpen(o => !o) : null}
                titleActive={monitorOverlayOpen}
              />
            ) : (
              <>
        {activeTab === 'text' && (
            <ResultsTable
              items={scenes}
              mediaType="image"
              layout={resultsLayout}
              aspectRatio={settings.aspectRatio}
              onRetry={(id) => {
                // 실행 중·큐 대기(hasPendingBatch) 중엔 retryScene→start() 가 무시되거나 큐에
                // 쌓인다. snapshot 만 덮어 돌고 있는 배치의 스타일 표시가 틀어지지 않도록 먼저 차단.
                if (anyRunning || hasPendingBatch || uiSceneBatchBlocked) return
                const effectiveSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
                  ? settings.seedNo : null
                // Stop 버튼이 retry 중에도 스타일을 표시하도록 snapshot — 정상 생성(handleStart)과 동일.
                setRunningStyle({ styleId: selectedStyleRefId, label: styleResolver.resolveLabelForId(selectedStyleRefId), applies: true })
                // 개별 재시도도 handleStart 를 우회하므로 모드 snapshot 직접 set (이미지 씬 재시도 = image).
                setRunningGenMode('image')
                // 큐 대기 구간 중복 enqueue 방지 — 정상 Start 와 동일하게 pending 플래그.
                setHasPendingBatch(true)
                retryScene(id, {
                  projectName: ensureProjectName(),
                  saveMode: settings.saveMode,
                  imageBatchCount: settings.imageBatchCount || 1,
                  imageUpscale: settings.imageUpscale || 'off',
                  aspectRatio: settings.aspectRatio,
                  imageModel: settings.imageModel,
                  imageProvider: settings.generation?.image?.provider ?? 'google',
                  generationSettings: settings,
                  selectedStyleRefId,
                  seed: effectiveSeed,
                }).finally(() => setHasPendingBatch(false))
              }}
              onShowDetail={(scene) => setSelectedScene(scene)}
              onClearMedia={(id) => scenesHook.updateScene(id, {
                // 이미지 미디어 전체 정리 — mediaId 남기면 isSceneEmpty 가 scene을 non-empty 로
                // 판정해 trim 안 됨. derived 메타도 같이 비워야 history/재생성 경로가 stale 메타로 흐트러지지 않음.
                image: null, imagePath: null, filePath: null, data: null, status: 'pending',
                mediaId: null, seed: null, generatedAt: null, model: null,
              })}
            />
        )}
        {activeTab === 'video-text' && (
          <ResultsTable
            items={videoScenes}
            mediaType="video"
            layout={resultsLayout}
            aspectRatio={settings.aspectRatio}
            onShowDetail={(item) => setSelectedVideo(item)}
            onVideoRetry={handleVideoRetry}
            selectable={true}
            onToggle={videoScenesHook.toggleSelect}
            onToggleAll={videoScenesHook.toggleSelectAll}
            onPromptEdit={(id, newPrompt) => {
              // Step 3: videoScenesHook 내부에서 scenes.videoT2VPrompt 로 라우팅
              videoScenesHook.updateVideoScene(id, { prompt: newPrompt })
            }}
            onClearMedia={(id) => videoScenesHook.updateVideoScene(id, {
              // T2V 비디오 전체 정리 — sceneTrim/SceneList 가 stale path 를 안 잡도록,
              // 그리고 generationId 가 남으면 useProjectData 의 recovery 가 reload 시
              // "in-flight 였던 항목" 으로 오해해 서버 결과를 다시 attach 함 (= clear 무효화).
              // FIELD_MAP 으로 scene.videoT2V* 로 매핑됨.
              video: null, videoPath: null, mediaId: null, generationId: null,
              status: 'pending', selected: false,
              // 비디오 메타도 정리 — 상세 모달/저장에 이전 비디오 메타 잔류 방지.
              generatedAt: null, seed: null, model: null, error: null, errorKind: null, videoSaveId: null,
              generationProvider: null, appliedInputs: null,
              // per-clip toggle 도 reset — stale disabled 가 project.json 에 남아 history 복원 등
              // path 재부착 경로와 만나면 새 영상이 숨겨짐. (FIELD_MAP 미매핑 → scene.videoT2VDisabled 로 직행)
              videoT2VDisabled: null,
            })}
            disabled={anyRunning}
          />
        )}
        {activeTab === 'frame-to-video' && (
          // ResultsTable 은 item.prompt 만 본다. F→V 는 promptSource(image/video/none) 에
          // 따라 effective prompt 가 달라지므로, generation 과 동일한 규칙을 적용해 derived
          // prompt 를 매핑해 넘긴다 (안 그러면 video/none 모드 편집이 ResultsTable 에 반영 안 됨).
          // 다른 필드는 그대로 보존 — status/mediaId/generationId 등.
          <ResultsTable items={framePairs.map(p => ({
            ...p,
            prompt: getFramePairEffectivePrompt(p, ftvPromptSource, videoScenes, scenes),
          }))} mediaType="frame-pair" layout={resultsLayout} aspectRatio={settings.aspectRatio} onShowDetail={(item) => setSelectedVideo(item)} onVideoRetry={handleVideoRetry} onClearMedia={(id) => {
            // FramePair clear — 전체 미디어/recovery 식별자/메타 정리.
            // generationId/mediaId 가 남으면 useProjectData reload 시 in-flight 로 오인되어
            // videoRecovery 가 서버 결과를 다시 attach (= clear 무효화). 옛 error/timing 메타가
            // 남으면 UI 가 stale 상태 표시. owner scene 의 derived videoI2V* 도 같이 정리.
            const fp = framePairs.find(f => f.id === id)
            setFramePairs(prev => prev.map(p => p.id === id ? {
              ...p,
              // 미디어 자체
              base64: null, video: null, videoPath: null, videoSaveId: null,
              // recovery 식별자 — reload 시 in-flight 로 안 잡히도록 둘 다 null
              generationId: null, mediaId: null,
              // 상태/에러 — pending 으로 되돌리고 stale error 제거
              status: 'pending', error: null, errorKind: null,
              // timing / 메타 — history 모달에 stale 값 표시 안 되도록
              generatingStartedAt: null, generatingEndedAt: null,
              seed: null, generatedAt: null, model: null, duration: null,
              generationProvider: null, appliedInputs: null,
            } : p))
            if (fp?.ownerSceneId) {
              scenesHook.updateScene(fp.ownerSceneId, { ...videoClearPatch('i2v'), videoI2VGeneratedAt: null })
            }
          }} />
        )}
        {activeTab === 'list' && (
          <ResultsTable
            items={scenes}
            mediaType="image"
            layout={resultsLayout}
            aspectRatio={settings.aspectRatio}
            onRetry={(id) => {
              // 실행 중·큐 대기(hasPendingBatch) 중엔 retryScene→start() 가 무시되거나 큐에
              // 쌓인다. snapshot 만 덮어 돌고 있는 배치의 스타일 표시가 틀어지지 않도록 먼저 차단.
              if (anyRunning || hasPendingBatch || uiSceneBatchBlocked) return
              const effectiveSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
                ? settings.seedNo : null
              // Stop 버튼이 retry 중에도 스타일을 표시하도록 snapshot — 정상 생성(handleStart)과 동일.
              setRunningStyle({ styleId: selectedStyleRefId, label: styleResolver.resolveLabelForId(selectedStyleRefId), applies: true })
              // 개별 재시도도 handleStart 를 우회하므로 모드 snapshot 직접 set (이미지 씬 재시도 = image).
              setRunningGenMode('image')
              // 큐 대기 구간 중복 enqueue 방지 — 정상 Start 와 동일하게 pending 플래그.
              setHasPendingBatch(true)
              retryScene(id, {
                projectName: ensureProjectName(),
                saveMode: settings.saveMode,
                imageBatchCount: settings.imageBatchCount || 1,
                imageUpscale: settings.imageUpscale || 'off',
                aspectRatio: settings.aspectRatio,
                imageModel: settings.imageModel,
                imageProvider: settings.generation?.image?.provider ?? 'google',
                generationSettings: settings,
                selectedStyleRefId,
                seed: effectiveSeed,
              }).finally(() => setHasPendingBatch(false))
            }}
            onShowDetail={(scene) => setSelectedScene(scene)}
            onClearMedia={(id) => scenesHook.updateScene(id, {
              // 이미지 미디어 전체 정리 — mediaId 남기면 isSceneEmpty 가 scene을 non-empty 로
              // 판정해 trim 안 됨. derived 메타도 같이 비워야 history/재생성 경로가 stale 메타로 흐트러지지 않음.
              image: null, imagePath: null, filePath: null, data: null, status: 'pending',
              mediaId: null, seed: null, generatedAt: null, model: null,
            })}
          />
        )}
              </>
            )}
          </>
        )}
      </div>
      </>
      )}

      {/* Story 뷰 — 폴더 저장 모드 전용(로컬 저장 모드는 프로젝트 경로가 없어 open()이 실패할 수
          있다, Task 9 리뷰 노트). 로컬 저장 모드면 안내만 보여주고 StoryView/파이프라인을 띄우지 않는다. */}
      {activeView === 'story' && (
        storyProjectPath ? (
          <div className="main-panel">
            {/* key={storyProjectPath}: 프로젝트 전환 시 재마운트해 StoryView 로컬 state
                (scriptPhase/title/genre/length/... 폼)를 새 프로젝트의 pipeline 값 기준으로
                초기화한다 — 없으면 A(editor)→B(빈) 전환에서 B가 A의 제목/옵션과 빈 editor로 열림. */}
            <StoryView
              key={storyProjectPath}
              pipeline={storyPipeline}
              voices={ttsVoices}
              onTagGender={handleTagGender}
              onVoiceSearch={handleTtsVoiceSearch}
              onReloadVoices={reloadTtsVoicesForProvider}
              onClose={() => setActiveView('generate')}
            />
          </div>
        ) : (
          <div className="story-guard">
            <p>📁 폴더 저장 모드에서만 Story 기능을 사용할 수 있습니다. 설정에서 저장 모드를 폴더로 변경해주세요.</p>
          </div>
        )
      )}

      {/* 씬 상세 모달 (ResultsTable에서 열림) */}
      {selectedScene && (
        <SceneDetailModal
          scene={scenes.find(s => s.id === selectedScene.id) || selectedScene}
          aspectRatio={settings.aspectRatio}
          onUpdate={scenesHook.updateScene}
          onClose={() => setSelectedScene(null)}
          onGenerate={handleGenerateScene}
          isGenerating={generatingSceneId === selectedScene.id}
          t={t}
          projectName={ensureProjectName()}
          references={references}
          styleThumbnails={styleThumbnails}
        />
      )}

      {/* 비디오 상세 모달 (ResultsTable에서 열림) */}
      {selectedVideo && (
        <VideoDetailModal
          video={selectedVideo}
          onClose={() => setSelectedVideo(null)}
          t={t}
          projectName={ensureProjectName()}
          onRegenerate={(video) => handleVideoRetry(video, { forceRegenerate: true })}
          isGenerating={videoAutomation.isRunning || hasPendingBatch}
          references={scenesHook.references}
          onPromptSave={(videoId, prompt) => {
            // 비디오 프롬프트 편집 저장 — source(prefix)별로 canonical prompt 필드에 반영.
            if (videoId.startsWith('vscene_')) {
              // updateVideoScene 이 prompt→videoT2VPrompt 로 매핑(scene 직접 갱신).
              videoScenesHook.updateVideoScene(videoId, { prompt })
            } else if (videoId.startsWith('t2v_')) {
              const n = videoId.replace('t2v_', '')
              scenesHook.updateScene(`scene_${n}`, { videoT2VPrompt: prompt })
            } else if (videoId.startsWith('fp_')) {
              setFramePairs(prev => prev.map(p => p.id === videoId ? { ...p, prompt } : p))
              const fp = framePairs.find(p => p.id === videoId)
              if (fp?.ownerSceneId) scenesHook.updateScene(fp.ownerSceneId, { videoI2VPrompt: prompt })
            } else if (videoId.startsWith('i2v_')) {
              const { fpId, sceneId } = resolveI2vRestoreSceneId(selectedVideo, framePairs)
              if (sceneId) scenesHook.updateScene(sceneId, { videoI2VPrompt: prompt })
              if (fpId) setFramePairs(prev => prev.map(p => p.id === fpId ? { ...p, prompt } : p))
            }
          }}
          onUpdate={(videoId, patch) => {
            // VideoDetailModal 의 history 복원 patch 에는 video/videoPath 외에
            // seed/generatedAt/model/mediaId 도 포함될 수 있음 (메타 변경 보존).
            // 'seed' in patch 로 명시적 null 도 보존 (history 메타가 빈 경우 stale 값 제거).
            const metaPatch = {}
            if ('seed' in patch) metaPatch.seed = patch.seed
            if ('generatedAt' in patch) metaPatch.generatedAt = patch.generatedAt
            if ('model' in patch) metaPatch.model = patch.model
            if ('mediaId' in patch) metaPatch.mediaId = patch.mediaId
            // #R33-2: 복원 시 generationId 도 전달(보통 null)해 stale routing 메타를 지운다 — 안 그러면
            //   이후 retry 가 옛 generation 자산을 재다운로드해 복원 결과를 덮는다.
            if ('generationId' in patch) metaPatch.generationId = patch.generationId

            // ID prefix로 source 분기:
            //   vscene_X → videoScenes (T2V 결과 테이블)
            //   fp_X     → framePairs (F2V 결과 테이블)
            //   t2v_X    → scenes.videoT2V/videoT2VPath (SceneList의 T2V 미디어)
            //   i2v_X    → scenes.videoI2V/videoI2VPath (SceneList의 I2V 미디어)
            if (videoId.startsWith('vscene_')) {
              videoScenesHook.updateVideoScene(videoId, {
                video: patch.video,
                videoPath: patch.videoPath,
                ...metaPatch,
              })
              // 매칭되는 image scene에도 동기화 (메타는 videoScenes 가 source-of-truth — scene 엔 시각용 필드만)
              const sceneId = videoId.replace('vscene_', 'scene_')
              scenesHook.updateScene(sceneId, {
                ...(patch.video ? { videoT2V: patch.video } : {}),
                videoT2VPath: patch.videoPath || null,
                videoT2VDisabled: null, // history 복원 = 새 영상 → enabled (per-clip toggle)
              })
            } else if (videoId.startsWith('fp_')) {
              setFramePairs(prev => prev.map(p =>
                p.id === videoId ? { ...p, ...buildFramePairVideoPatch(patch) } : p
              ))
              // 매칭 image scene의 videoI2V 동기화 — ownerSceneId 기준
              const fp = framePairs.find(p => p.id === videoId)
              // ownerSceneId is the canonical row-to-scene binding. Gallery-rooted
              // rows have ownerSceneId=null and are skipped by the truthy guard.
              if (fp?.ownerSceneId) {
                // i2v_ 분기와 동일 helper — generatedAt→videoI2VGeneratedAt 매핑으로 cache-buster
                // 갱신(같은 i2v_N.mp4 덮어쓰기 시 timeline/monitor stale preview 방지).
                scenesHook.updateScene(fp.ownerSceneId, buildVideoRestorePatch('i2v', patch))
              }
            } else if (videoId.startsWith('t2v_')) {
              // synthetic id — scene 에는 비디오 데이터/path 만 sync (이미지 메타 슬롯 보호).
              // scene.seed/generatedAt/model 은 IMAGE 메타로 SceneDetailModal 이 사용하므로
              // video metaPatch 로 덮어쓰면 안 됨. video 메타는 source-of-truth 인 vscene_X 에만.
              const sceneId = `scene_${videoId.replace('t2v_', '')}`
              scenesHook.updateScene(sceneId, {
                ...(patch.video ? { videoT2V: patch.video } : {}),
                videoT2VPath: patch.videoPath || null,
                videoT2VDisabled: null, // history 복원 = 새 영상 → enabled (per-clip toggle)
              })
              const vsceneId = `vscene_${videoId.replace('t2v_', '')}`
              videoScenesHook.updateVideoScene(vsceneId, metaPatch)
            } else if (videoId.startsWith('i2v_')) {
              // synthetic id — scene 에는 비디오 데이터/path 만 sync (이미지 메타 슬롯 보호).
              // video 메타는 source-of-truth 인 fp_X 에만 반영.
              // i2v_N 은 fp.id 기반이라 owning framePair 의 ownerSceneId 로 scene 을 찾는다.
              // owning fp 가 없으면(폴백 id) payload 의 sceneId 로 폴백 — 아니면 저장 no-op(P2-1).
              const { fpId, sceneId: i2vSceneId } = resolveI2vRestoreSceneId(selectedVideo, framePairs)
              if (i2vSceneId) {
                // buildVideoRestorePatch 가 videoI2VPath/Disabled + generatedAt→videoI2VGeneratedAt
                // 매핑 → cache-buster 갱신(같은 i2v_N.mp4 덮어쓰기 시 stale preview 방지, P2-2).
                scenesHook.updateScene(i2vSceneId, buildVideoRestorePatch('i2v', patch))
              }
              // P3 fix: fp_ 와 동일하게 video/base64/videoPath 까지 갱신(이전엔 metaPatch 만 → stale 결과표).
              setFramePairs(prev => prev.map(p =>
                p.id === fpId ? { ...p, ...buildFramePairVideoPatch(patch) } : p
              ))
            }
          }}
        />
      )}

      {/* 모달들 */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          initialTab={settingsTab}
          onProjectChange={handleProjectChange}
          availableModels={availableModels}
          appMode={mode}
          sessionTarget={sessionTarget}
          // §4.7 R3: "모든 저장 wrapper가 App-level 리로드를 공유한다" — Settings › API Keys에서
          // provider 키를 저장하면 그 provider의 목소리 목록을 다시 긁는다. Story가 안 열려 있으면
          // (voices가 안 쓰이면) best-effort로 조용히 끝난다 — 무해하다.
          onKeySaved={reloadTtsVoicesForProvider}
          onSave={async (newSettings) => {
            setSettings(newSettings)
            setShowSettings(false)
            setSettingsTab(null)
            // 화면비 등 project.json 메타가 바뀌었을 수 있으니 현재 프로젝트에 즉시
            // 반영 (autosave 는 빈 프로젝트를 건너뜀). 저장 실패는 사용자에게 알린다.
            const res = await saveCurrentProject(newSettings)
            if (res && res.success === false) {
              console.warn('[App] Project meta save failed:', res.error)
              toast.error(t('toast.projectSaveFailed'))
            }
          }}
          onClose={() => {
            setShowSettings(false)
            setSettingsTab(null)
          }}
        />
      )}

      {showImport && (
        <ImportModal
          onImport={handleImport}
          onImportAudio={handleImportAudio}
          onClose={() => setShowImport(false)}
        />
      )}

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        onExport={handleExportConfirm}
        onExportPremiere={handleExportPremiere}
        onExportVrew={handleExportVrew}
        initialFormat={exportFormat}
        projectName={ensureProjectName()}
        loading={exporting}
        exportPhase={exportPhase}
        hasSubtitles={
          // R12 review fix: scene.subtitle 뿐 아니라 srtTrack 또는 audioPackage SRT 도
          // 자막 source 로 인정. audio 폴더 SRT 흡수만 한 케이스에서 export 옵션 숨겨지는
          // 회귀 방지.
          scenes.some(s => s.subtitle && s.subtitle.trim())
            || (scenesHook.srtTrack || []).some(l => l.text && l.text.trim())
            || !!audioPackage?.srtContent
        }
        onUpgradeClick={() => {
          setShowExportModal(false)
          setPaywallReason('upgrade')
          setShowPaywallModal(true)
        }}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />

      {/* Paywall Modal */}
      <PaywallModal
        isOpen={showPaywallModal}
        onClose={() => setShowPaywallModal(false)}
        reason={paywallReason}
      />

      {/* API 키 필요 모달 — 키 없이 생성 시도 시 설정으로 안내 */}
      <Modal
        isOpen={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
        title={t('apiKeyNeeded.title')}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowApiKeyModal(false)}>
              {t('settings.cancel') || '닫기'}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => { setShowApiKeyModal(false); openSettings('apiKey') }}
            >
              🔑 {t('apiKeyNeeded.cta')}
            </button>
          </>
        }
      >
        <p>{t('apiKeyNeeded.message')}</p>
      </Modal>

      {tagValidationErrors && (
        <TagValidationModal
          errors={tagValidationErrors}
          onProceed={handleTagValidationProceed}
          onCancel={handleTagValidationCancel}
          t={t}
        />
      )}

      {emptyRefGate && (
        <EmptyReferenceGateModal
          phase={emptyRefGate.phase}
          items={emptyRefGate.items}
          failure={emptyRefGate.failure}
          onChoose={emptyRefGate.resolve}
          onAcknowledge={emptyRefGate.resolve}
        />
      )}

      {/* #R34: 생성 전 미동기화 @멘션 캐릭터 가드 — '동기화 후 생성' 시 자동 일괄 동기화 후 진행 */}
      {syncGate && (
        <Modal
          isOpen={true}
          onClose={handleSyncGateCancel}
          title={`🔄 ${isKo ? 'Flow 동기화 필요' : 'Flow sync needed'}`}
        >
          <div style={{ padding: '4px 2px', maxWidth: 460 }}>
            <p style={{ marginTop: 0 }}>
              {isKo
                ? '다음 캐릭터가 Flow 에 동기화되지 않았습니다. 동기화 후 생성하면 @멘션이 정상 동작합니다.'
                : 'These characters are not synced to Flow. Sync first so @mentions resolve correctly.'}
            </p>
            <ul style={{ margin: '8px 0 14px', paddingLeft: 20 }}>
              {syncGate.refs.map(r => (<li key={r.id}>{r.name || `#${r.id}`}</li>))}
            </ul>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={handleSyncGateCancel} disabled={syncGateBusy}>
                {t('common.cancel')}
              </button>
              <button className="btn-primary" onClick={handleSyncGateProceed} disabled={syncGateBusy}>
                {syncGateBusy
                  ? `⏳ ${isKo ? '동기화 중' : 'Syncing'}…`
                  : (isKo ? '동기화 후 생성' : 'Sync & generate')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <Modal
        isOpen={showStylePicker}
        onClose={() => setShowStylePicker(false)}
        title={`🎨 ${t('actions.selectStyle')}`}
        className="style-picker-modal"
      >
        <StylePicker
          selectedId={selectedStyleRefId}
          onSelect={(id) => {
            setSelectedStyleRefId(id)
            const startSource = pendingStyleSourceRef.current
            if (id) {
              setShowStylePicker(false)
              if (!guardSceneBatchStart(startSource)) return
              handleStart(id, { force: pendingStyleForceRef.current, source: startSource })
              return
            }
            // 자동 카드 (id === null) — availability는 styleResolver가 탭별로 판단:
            //   - image/list: 씬별 매칭 가능 여부
            //   - video-text: 첫 사용 가능한 스타일 카드 존재 여부
            // requireStyle=false면 어느 탭이든 통과.
            if (styleResolver.autoAvailable || !settings.requireStyle) {
              setShowStylePicker(false)
              if (!guardSceneBatchStart(startSource)) return
              handleStart(null, { force: pendingStyleForceRef.current, source: startSource })
            } else {
              toast.warning(t('toast.autoMatchNoMatchesPickStyle'))
            }
          }}
          thumbnails={styleThumbnails}
          uploadedStyleRefs={uploadedStyleRefsForPicker}
          generating={thumbnailGenerating}
          stopping={thumbnailStopping}
          progress={thumbnailProgress}
          onGenerateThumbnails={async (presetIds, customRefs) => {
            const customResults = await generateThumbnails(presetIds, customRefs, t)
            if (customResults?.length > 0) {
              setReferences(prev => prev.map(ref => {
                const result = customResults.find(r => r.refId === ref.id)
                return result ? { ...ref, data: result.data, filePath: null, dataStorage: null } : ref
              }))
            }
          }}
          onStopGenerating={stopThumbnailGeneration}
          onDeleteThumbnail={deleteThumbnail}
          autoCardMeta={styleResolver.autoCardMeta}
          t={t}
          isKo={t('common.cancel') === '취소'}
        />
      </Modal>

      {showAudioResult && (
        <AudioResultModal
          audioPackage={audioPackage}
          loading={audioImporting}
          onClose={() => {
            setShowAudioResult(false)
            // Audio 탭은 현재 숨김. import 후 숨은 activeTab='audio' 상태로 보내지 않고,
            // 씬/자막 확인이 가능한 list 탭으로 복귀한다.
            // if (audioPackage) setActiveTab('audio')
            if (audioPackage) setActiveTab('list')
          }}
        />
      )}

      <DeleteSceneConfirmModal
        scene={sceneToDelete?.scene || null}
        sceneIndex={sceneToDelete?.sceneIndex ?? 0}
        framePairs={framePairs}
        onConfirm={() => {
          if (!sceneToDelete) return
          const nextFramePairs = scenesHook.deleteScene(sceneToDelete.scene.id, framePairs)
          if (nextFramePairs !== framePairs) setFramePairs(nextFramePairs)
          setSceneToDelete(null)
        }}
        onCancel={() => setSceneToDelete(null)}
        t={t}
      />

      {/* Flow 자동 생성 실패 후, Flow 가 baseline 과 다른 프로젝트를 보고 있을 때 뜬다.
          연결하면 그 Flow 프로젝트에 앞으로의 캐릭터·씬이 만들어진다(자동 채택은 하지 않는다). */}
      <FlowProjectAdoptModal
        projectId={flowAdoptPrompt.candidate}
        onConfirm={flowAdoptPrompt.confirm}
        onCancel={flowAdoptPrompt.cancel}
        t={t}
      />

      <StoreRatingModal
        isOpen={storeRating.showModal}
        onRate={storeRating.rateNow}
        onLater={storeRating.remindLater}
        onNever={storeRating.dismissForever}
      />

      <SrtImportConflictModal
        isOpen={!!srtImportPending}
        existingSceneCount={(scenesHook.scenes || []).length}
        existingSrtLineCount={(scenesHook.srtTrack || []).length}
        onReplace={() => resolveSrtImport('replace')}
        onMerge={() => resolveSrtImport('merge')}
        onCancel={() => setSrtImportPending(null)}
        t={t}
      />
    </div>
  )
}

export default App
