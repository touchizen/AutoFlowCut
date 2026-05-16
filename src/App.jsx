/**
 * AutoFlowCut - Main App
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { DEFAULTS, UI, TIMING, STYLE_PRESETS } from './config/defaults'
import { useFlowAPI } from './hooks/useFlowAPI'
import { useScenes } from './hooks/useScenes'
import { useAutomation } from './hooks/useAutomation'
import { useVideoAutomation } from './hooks/useVideoAutomation'
import { useVideoScenes } from './hooks/useVideoScenes'
import { useI18n } from './hooks/useI18n'
import { useProjectData } from './hooks/useProjectData'
import { useReferenceGeneration } from './hooks/useReferenceGeneration'
import { useStyleThumbnails } from './hooks/useStyleThumbnails'
import { useSceneGeneration } from './hooks/useSceneGeneration'
import { useGenerationQueue } from './hooks/useGenerationQueue'
import { useExport } from './hooks/useExport'
import { useAudioImport } from './hooks/useAudioImport'
import { useAppSettings } from './hooks/useAppSettings'
import { useAutoSave } from './hooks/useAutoSave'
import { useFlowEvents } from './hooks/useFlowEvents'
import { useMcpServer } from './hooks/useMcpServer'
import { useMenuActions } from './hooks/useMenuActions'
import { syncVideosIntoScenes } from './services/mediaSync'
import { retryVideoDownload } from './services/videoRecovery'
import { applyStyle, previewStyleMatching } from './services/styleService'
import { computeGuardAvailable } from './services/startGuard'
import { createStyleResolver } from './services/styleResolver'
import { filterPendingScenes } from './utils/sceneFilters'
import { detectFileType, detectCSVType, parseCSVToScenes, parseSRTToScenes } from './utils/parsers'
import { checkFolderPermission } from './utils/guards'
import { collectTagErrors } from './utils/tagMatch'
import { toast } from './components/Toast'

// Components
import Header from './components/Header'
import WelcomeScreen from './components/WelcomeScreen'
import PromptInput from './components/PromptInput'
import SceneList from './components/SceneList'
import FrameToVideoPanel from './components/FrameToVideoPanel'
import ReferencePanel from './components/ReferencePanel'
import SettingsModal from './components/SettingsModal'
import ImportModal from './components/ImportModal'
import StatusBar from './components/StatusBar'
import ResultsTable from './components/ResultsTable'
// SelectablePromptList 제거됨 — 체크박스 기능이 ResultsTable에 통합
import SceneDetailModal from './components/SceneDetailModal'
import VideoDetailModal from './components/VideoDetailModal'
import ResizeHandle from './components/ResizeHandle'
import { ExportModal } from './components/ExportModal'
import { AuthModal } from './components/AuthModal'
import { PaywallModal } from './components/PaywallModal'
import TagValidationModal from './components/TagValidationModal'
import AudioResultModal from './components/AudioResultModal'
import QAProgressBanner from './components/QAProgressBanner'
import AudioPanel from './components/AudioPanel'
import { SubscriptionBanner } from './components/SubscriptionBanner'
import StylePicker from './components/StylePicker'
import Modal from './components/Modal'
import { useAuth } from './contexts/AuthContext'

function App() {
  const { t } = useI18n()
  const { isAuthenticated, subscription, refreshSubscription } = useAuth()
  const generationQueue = useGenerationQueue()

  // Auth/Payment Modals
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showPaywallModal, setShowPaywallModal] = useState(false)
  const [paywallReason, setPaywallReason] = useState('trial_expired')

  // Flow Login Expired Modal
  const [showLoginExpiredModal, setShowLoginExpiredModal] = useState(false)

  // Tag Validation Modal
  const [tagValidationErrors, setTagValidationErrors] = useState(null)
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
  const { settings, setSettings, updateSetting, ensureProjectName } = useAppSettings()

  // Flow 이벤트 (로그인 만료, 레이아웃 보정)
  useFlowEvents({ onLoginExpired: () => setShowLoginExpiredModal(true) })

  // UI State
  const [activeTab, setActiveTab] = useState('text') // 'text' | 'video-text' | 'frame-to-video' | 'list' | 'audio'
  const [framePairs, setFramePairs] = useState([])   // Frame to Video 매핑
  const [ftvPromptSource, setFtvPromptSource] = useState('image') // 'image' | 'video' | 'none'
  const [galleryItems, setGalleryItems] = useState([])
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState(null) // 설정 모달 초기 탭
  const [showImport, setShowImport] = useState(false)
  const [showAudioResult, setShowAudioResult] = useState(false)
  const [showReferences, setShowReferences] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [selectedScene, setSelectedScene] = useState(null) // 상세 모달용 선택된 씬
  const [selectedStyleRefId, setSelectedStyleRefId] = useState(null) // 레퍼런스 생성 시 적용할 스타일
  const [showStylePicker, setShowStylePicker] = useState(false) // 스타일 선택 모달
  const [selectedVideo, setSelectedVideo] = useState(null) // 비디오 상세 모달용
  const [bottomPanelHeight, setBottomPanelHeight] = useState(() => {
    const saved = localStorage.getItem('autoflowcut_bottomPanelHeight')
    return saved ? parseInt(saved, 10) : UI.DEFAULT_BOTTOM_PANEL_HEIGHT // 기본 높이
  })

  // 설정 모달 열기 (특정 탭으로)
  const openSettings = (tab = null) => {
    setSettingsTab(tab)
    setShowSettings(true)
  }

  // Hooks
  const flowAPI = useFlowAPI()
  const scenesHook = useScenes()
  const automation = useAutomation(
    flowAPI,
    scenesHook,
    null,
    () => openSettings('storage'),
    (saveFunc) => addPendingSave(saveFunc),
    t,
    () => {
      setAuthReady(false)
      flowAPI.clearTokenCache()  // 캐시된 만료 토큰 제거
      toast.error(t('status.authErrorStopped'), TIMING.AUTH_ERROR_TOAST)
    },
    generationQueue,
    () => saveCurrentProject()
  )

  const videoAutomation = useVideoAutomation(flowAPI, t, () => {
    setAuthReady(false)
    flowAPI.clearTokenCache()  // 캐시된 만료 토큰 제거 → 재로그인 후 새 토큰 획득
    toast.error(t('status.authErrorStopped'))
  }, generationQueue)
  const videoScenesHook = useVideoScenes()
  const { videoScenes, setVideoScenes } = videoScenesHook

  const { scenes, references, parseFromText, parseFromCSV, parseFromSRT, parseReferencesFromCSV, updateReferences, setScenes, setReferences } = scenesHook
  const { isRunning, isPaused, isStopping, progress, status, statusMessage, start, togglePause, stop, retryErrors } = automation

  // 씬이 복원되어 WelcomeScreen이 스킵될 때도 자동으로 인증 체크
  useEffect(() => {
    if (scenes.length > 0 && !authReady) {
      flowAPI.getAccessToken(false, true).then(token => {
        if (token) setAuthReady(true)
      }).catch(() => {})
    }
  }, [scenes.length, authReady])

  // 자동화가 끝나면 Stop 버튼용 running snapshot 정리.
  // Transition-based: 실행 → 종료 전이일 때만 clear. 큐로 대기 중일 때는 deps가 변하지 않아
  // effect 자체가 재실행되지 않지만, 만에 하나 다른 state가 deps에 끼어드는 미래 변경에도
  // wasRunningRef 가드 덕에 stale 시점에 잘못 clear하지 않는다.
  const wasRunningRef = useRef(false)
  useEffect(() => {
    const running = isRunning || videoAutomation.isRunning
    if (wasRunningRef.current && !running) {
      setRunningStyle(prev => prev.applies || prev.styleId ? { styleId: null, applies: false } : prev)
    }
    wasRunningRef.current = running
  }, [isRunning, videoAutomation.isRunning])

  // Project Data 관리
  const audioSwitchRef = useRef()
  const { addPendingSave, handleProjectChange, saveCurrentProject, isRestoringRef, projectLoading } = useProjectData({
    settings, setSettings, scenes, references, setScenes, setReferences,
    videoScenes, setVideoScenes,
    framePairs, setFramePairs,
    selectedStyleRefId, setSelectedStyleRefId,
    openSettings,
    onAudioSwitch: (audioPath) => audioSwitchRef.current?.(audioPath),
    flowAPI,
  })

  // 네이티브 File 메뉴 ↔ renderer 연결 (New Project / Recent Projects)
  // Recent 항목은 work folder 단위로 구분되므로 현재 work folder 경로도 함께 전달.
  useMenuActions({
    activeProject: settings.saveMode === 'folder' ? settings.projectName : null,
    workFolder: settings.saveMode === 'folder' ? (localStorage.getItem('workFolderPath') || null) : null,
    onNewProject: () => openSettings('storage'),
    onOpenProject: handleProjectChange,
  })

  // Style Thumbnails
  const { thumbnails: styleThumbnails, generating: thumbnailGenerating, stopping: thumbnailStopping, progress: thumbnailProgress, generateThumbnails, stopGenerating: stopThumbnailGeneration, deleteThumbnail } = useStyleThumbnails(flowAPI)

  // Reference 생성
  const { generatingRefs, stoppingRefs, preparingRefs, handleGenerateRef, handleGenerateAllRefs, stopGenerateAllRefs } = useReferenceGeneration({
    settings, references, setReferences, flowAPI, addPendingSave, openSettings, t, selectedStyleRefId, styleThumbnails, generationQueue
  })

  // Scene 재생성
  const { generatingSceneId, handleGenerateScene } = useSceneGeneration({
    settings, scenes, scenesHook, flowAPI, openSettings, setSelectedScene, t, generationQueue
  })

  // Audio Import
  const { audioPackage, audioTracks, importing: audioImporting, audioLoading, importAudioPackage, importByPath, clearAudioPackage, audioReviews, saveReview, saveBulkReviews, refreshReviews, saveTimecodeOverride } = useAudioImport(t)

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
  const { showExportModal, setShowExportModal, exporting, exportPhase, handleExportClick, handleExportConfirm } = useExport({
    settings, scenes, videoScenes, framePairs, openSettings,
    audioPackage,
    isAuthenticated,
    subscription,
    refreshSubscription,
    onLoginRequired: () => setShowAuthModal(true),
    onPaywallRequired: (reason) => {
      setPaywallReason(reason)
      setShowPaywallModal(true)
    }
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
          copy.videoI2VDuration !== orig.videoI2VDuration
        if (changed) {
          scenesHook.updateScene(copy.id, {
            videoT2V: copy.videoT2V, videoT2VPath: copy.videoT2VPath,
            videoI2V: copy.videoI2V, videoI2VPath: copy.videoI2VPath,
            ...(copy.videoT2VDuration !== orig.videoT2VDuration ? { videoT2VDuration: copy.videoT2VDuration } : {}),
            ...(copy.videoI2VDuration !== orig.videoI2VDuration ? { videoI2VDuration: copy.videoI2VDuration } : {}),
          })
        }
      }
    }
  }, [videoScenes, framePairs])

  // 로컬 파일 → Flow uploadImage → galleryItems 에 추가
  // F2V Start/End Image 드롭다운에서 "📁 Upload from disk" 로 호출됨
  const handleUploadGalleryImage = async (file) => {
    if (!file) return { success: false, error: 'No file' }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'))
        reader.readAsDataURL(file)
      })
      const base64 = String(dataUrl).split(',')[1] || ''
      if (!base64) return { success: false, error: 'Empty file' }

      const result = await flowAPI.uploadReference(base64, 'frame')
      if (!result?.success || !result.mediaId) {
        return { success: false, error: result?.error || 'Upload failed' }
      }

      setGalleryItems(prev => {
        if (prev.some(it => it.mediaId === result.mediaId)) return prev
        return [{ mediaId: result.mediaId, url: dataUrl, local: true }, ...prev]
      })
      return { success: true, mediaId: result.mediaId, url: dataUrl }
    } catch (e) {
      console.error('[Gallery] upload from disk failed:', e)
      return { success: false, error: e.message }
    }
  }

  // Gallery 로드 (특정 projectId가 주어지면 그 프로젝트의 업로드 반환,
  // 없으면 현재 캡쳐된 projectId — App 전역 갤러리 state에 merge한다)
  const loadGallery = async (specificProjectId) => {
    if (galleryLoading) return
    setGalleryLoading(true)
    try {
      const result = await flowAPI.fetchGallery(specificProjectId)
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

  // 특정 프로젝트의 갤러리 항목을 가져오고 App의 galleryItems에 merge.
  // 이렇게 해야 사용자가 그 항목을 picker에서 선택했을 때 트리거 라벨/썸네일이
  // 정상 렌더된다 (gallerySelected 조회는 galleryItems에서만 함).
  // 특정 프로젝트의 이미지 목록을 가져옴. 결과는 *App 전역 state에 저장하지 않는다* —
  // 메모리 폭증 방지(이미지 base64는 무거움). 사용자가 dropdown 안에서 한 항목을 실제로
  // 픽할 때만 onPickArchiveImage 콜백이 그 한 개를 galleryItems에 추가한다.
  const fetchProjectGallery = async (projectId) => {
    try {
      return await flowAPI.fetchGallery(projectId)
    } catch (e) {
      return { success: false, error: e.message, items: [] }
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

  // Flow 프로젝트(날짜) 목록 — 두 번째 단계 진입점
  const listFlowProjectsHandler = async () => {
    try {
      const result = await flowAPI.listFlowProjects(20)
      return result
    } catch (e) {
      return { success: false, error: e.message, items: [] }
    }
  }

  // Auto-save project data (debounce)
  useAutoSave({
    scenes, references, videoScenes, framePairs,
    selectedStyleRefId,
    settings, generatingRefsCount: generatingRefs.length,
    isRunning, isRestoringRef, saveCurrentProject
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
      videoScenesHook.parseFromText(savedVideo, settings.defaultDuration)
    }
  }, [])

  // Handle text input change
  const handleTextChange = (text) => {
    parseFromText(text, settings.defaultDuration)
    localStorage.setItem('autoflowcut_savedPrompts', text)
  }

  // Handle video text input change (T2V 독립 프롬프트)
  const handleVideoTextChange = (text) => {
    videoScenesHook.parseFromText(text, settings.defaultDuration)
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

    // 비디오 모드: videoScenesHook으로 라우팅
    const isVideo = mode === 'video'

    // 타입별 실행 액션
    const actions = {
      text: () => isVideo
        ? videoScenesHook.parseFromText(content, settings.defaultDuration)
        : parseFromText(content, settings.defaultDuration),
      csv: () => isVideo
        ? videoScenesHook.parseFromText(
            parseCSVToScenes(content, settings.defaultDuration).map(s => s.prompt).join('\n'),
            settings.defaultDuration
          )
        : parseFromCSV(content, settings.defaultDuration),
      srt: () => isVideo
        ? videoScenesHook.parseFromText(
            parseSRTToScenes(content).map(s => s.prompt).join('\n'),
            settings.defaultDuration
          )
        : parseFromSRT(content),
      reference: async () => {
        await parseReferencesFromCSV(content, projectName)
        setShowReferences(true)
      }
    }

    // 타입별 확인 메시지 키
    const confirmKeys = {
      srt: 'import.wrongTypeSrt',
      csv: type === 'reference' ? 'import.wrongTypeScene' : 'import.wrongTypeCsv',
      text: 'import.wrongTypeText',
      reference: 'import.wrongTypeReference'
    }

    // 타입 불일치 시 확인 후 감지된 타입으로 실행
    if (detectedType && detectedType !== type) {
      const confirmKey = confirmKeys[detectedType]
      if (confirmKey && window.confirm(t(confirmKey))) {
        await actions[detectedType]?.()
      }
      setShowImport(false)
      if (isVideo) setActiveTab('video-text')
      return
    }

    // 정상 처리
    await actions[type]?.()
    setShowImport(false)
    if (isVideo) setActiveTab('video-text')
  }

  // Handle start — 활성 탭에 따라 이미지/비디오 생성 모드 분기
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
  const handleVideoRetry = useCallback((item) => {
    if (!item) return
    if (isRunning || videoAutomation.isRunning) {
      toast.warning(t('videoAutomation.busy') || 'Generation already running')
      return
    }

    // 타입 판별: framePair는 pair.id가 fp_*, videoScene은 vscene_*
    const isFramePair = typeof item.id === 'string' && item.id.startsWith('fp_')
    const projectName = ensureProjectName()

    const onUpdate = (id, newStatus, result = {}) => {
      if (isFramePair) {
        setFramePairs(prev => prev.map(p =>
          p.id === id ? {
            ...p, status: newStatus,
            ...(newStatus === 'generating' && result?.generatingStartedAt ? { generatingStartedAt: result.generatingStartedAt, generatingEndedAt: null } : {}),
            ...(newStatus === 'complete' || newStatus === 'error' ? { generatingEndedAt: result?.generatingEndedAt || Date.now() } : {}),
            ...(result?.base64 ? { video: result.base64, base64: result.base64 } : {}),
            ...(result?.mediaId ? { mediaId: result.mediaId } : {}),
            ...(result?.generationId ? { generationId: result.generationId } : {}),
            ...(result?.videoPath ? { videoPath: result.videoPath } : {}),
            ...(result?.videoSaveId ? { videoSaveId: result.videoSaveId } : {}),
            ...(result?.duration ? { duration: result.duration } : {}),
            ...(result?.seed != null ? { seed: result.seed } : {}),
            ...(result?.generatedAt ? { generatedAt: result.generatedAt } : {}),
            ...(result?.model ? { model: result.model } : {}),
            ...(result?.error ? { error: result.error } : {}),
          } : p
        ))
        if (newStatus === 'complete' && result?.base64) {
          const fp = framePairs.find(p => p.id === id)
          if (fp?.startSceneId && !fp.startSceneId.startsWith('gallery::')) {
            scenesHook.updateScene(fp.startSceneId, {
              videoI2V: result.base64,
              videoI2VPath: result.videoPath || null,
              ...(result?.duration ? { videoI2VDuration: result.duration } : {}),
            })
          }
        }
      } else {
        videoScenesHook.updateVideoScene(id, {
          status: newStatus,
          ...(newStatus === 'generating' && result?.generatingStartedAt ? { generatingStartedAt: result.generatingStartedAt, generatingEndedAt: null } : {}),
          ...(newStatus === 'complete' || newStatus === 'error' ? { generatingEndedAt: result?.generatingEndedAt || Date.now() } : {}),
          ...(result?.base64 ? { video: result.base64 } : {}),
          ...(result?.mediaId ? { mediaId: result.mediaId } : {}),
          ...(result?.generationId ? { generationId: result.generationId } : {}),
          ...(result?.videoPath ? { videoPath: result.videoPath } : {}),
          ...(result?.videoSaveId ? { videoSaveId: result.videoSaveId } : {}),
          ...(result?.duration ? { duration: result.duration } : {}),
          ...(result?.seed != null ? { seed: result.seed } : {}),
          ...(result?.generatedAt ? { generatedAt: result.generatedAt } : {}),
          ...(result?.model ? { model: result.model } : {}),
          ...(result?.error ? { error: result.error } : {}),
        })
        if (newStatus === 'complete' && result?.base64) {
          const sceneId = id.replace('vscene_', 'scene_')
          scenesHook.updateScene(sceneId, {
            videoT2V: result.base64,
            videoT2VPath: result.videoPath || null,
            ...(result?.duration ? { videoT2VDuration: result.duration } : {}),
          })
        }
      }
    }

    // Fast path: download-only
    if (item.generationId && item.mediaId) {
      retryVideoDownload({
        item,
        flowAPI,
        onUpdate,
        projectName,
        saveMode: settings.saveMode || 'folder',
        videoResolution: settings.videoResolution || '1080p',
      }).catch(err => {
        console.error('[handleVideoRetry] Unexpected error:', err)
        onUpdate(item.id, 'error', { error: String(err?.message || err) })
      })
      return
    }

    // Slow path: no generationId/mediaId — reset to pending; user clicks Start Generation to regenerate
    onUpdate(item.id, 'pending', { error: null })
    toast.info(t('videoAutomation.needsRegen') || 'Reset — click Start Generation to retry')
  }, [isRunning, videoAutomation.isRunning, settings, flowAPI, framePairs, scenesHook, videoScenesHook, t])

  const styleResolver = createStyleResolver({
    activeTab,
    scenes,
    references,
    selectedStyleRefId,
    t,
    isKo: t('common.cancel') === '취소',
  })

  // overrideStyleId 시그니처 (3가지 의미 구분):
  //   undefined: 호출자가 override 안 함 → UI selectedStyleRefId 사용
  //   null: 자동 모드 강제 (StylePicker 자동 카드 클릭) → UI 선택값 무시
  //   'ref:*' / 'preset:*': 그 스타일 강제 적용
  //
  // options = { force?: boolean } (선택, MCP 전용):
  //   - force=true: 완료된 씬도 포함해 재생성 대상에 (필터 우회)
  //   - 기본 false: 기존 동작 (pending/error만)
  const handleStart = async (overrideStyleId = undefined, options = {}) => {
    const { force = false } = options
    // 이미 실행 중이거나 큐에 batch가 대기 중이면 무시 (중지는 별도 버튼)
    if (isRunning || videoAutomation.isRunning || hasPendingBatch) return

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

    // tab이면 split으로 전환 (Flow UI가 보여야 함)
    try {
      const current = JSON.parse(localStorage.getItem('layoutSettings') || '{}')
      if (!current.mode || current.mode === 'tab') {
        window.electronAPI?.setLayout?.({ mode: 'split-left', ratio: 0.5 })
      }
    } catch (e) {
      window.electronAPI?.setLayout?.({ mode: 'split-left', ratio: 0.5 })
    }

    const projectName = ensureProjectName()

    switch (activeTab) {
      case 'text':
      case 'list': {
        // 이미지 생성 — 가드 순서: (1) 생성 대상 0개면 즉시 안내 (스타일 선택 요구하지 않음),
        // (2) 스타일 필수 검증. 순서가 반대면 "이미 다 생성됐는데 스타일 골라달라" 어색함.
        // force=true: 완료 씬 포함 강제 재생성 → "이미 다 생성됐다" 가드 우회 (prompt 있는 씬이 1개라도 있으면 진행).
        const targetScenes = force ? scenes.filter(s => s.prompt) : filterPendingScenes(scenes)
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
            setShowStylePicker(true)
            return
          }
        }

        // seedLocked && seedNo 가 숫자일 때만 고정 seed 사용, 그 외엔 Flow 랜덤
        const effectiveSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
          ? settings.seedNo
          : null
        const startOptions = {
          projectName,
          saveMode: settings.saveMode,
          concurrency: settings.concurrency || 2,
          imageBatchCount: settings.imageBatchCount || 1,
          imageUpscale: settings.imageUpscale || 'off',
          selectedStyleRefId: effectiveStyleId,
          seed: effectiveSeed,
          force,
        }

        const errors = collectTagErrors(scenes, scenesHook.references)
        if (errors.length > 0) {
          setTagValidationErrors(errors)
          setPendingStartOptions(startOptions)
          return
        }

        // Stop 버튼이 현재 돌고 있는 스타일을 표시할 수 있도록 id + 라벨 모두 시작 시점 snapshot
        setRunningStyle({ styleId: effectiveStyleId, label: styleResolver.resolveLabelForId(effectiveStyleId), applies: true })
        setHasPendingBatch(true)
        start(startOptions).finally(() => setHasPendingBatch(false))
        break
      }

      case 'video-text': {
        // Text to Video — 선택된 videoScenes만 실행 (선택 검증은 상단에서 처리)
        const selectedVideoScenes = videoScenes.filter(s => s.selected !== false)

        // T2V는 video scene의 자체 prompt만 사용 — image scene과는 독립.
        // 스타일(selectedStyleRefId)만 추가로 prefix해서 적용.
        // (I2V는 이미지가 source라 별도 처리 — frame-to-video 케이스에서 미적용)
        // override → effective는 styleResolver.resolveEffectiveStyleId가 탭별로 처리.
        // video-text는 null override일 때 findAutoStyle 결과로 변환됨 (resolver 내부 로직).
        const effectiveStyleId = styleResolver.resolveEffectiveStyleId(overrideStyleId)
        const styledVideoScenes = selectedVideoScenes.map(vs => {
          const matchedRefs = []
          const { styledPrompt } = applyStyle(vs.prompt, effectiveStyleId, scenesHook.references, matchedRefs)
          return { ...vs, prompt: styledPrompt }
        })

        // seed: 이미지와 동일한 정책 — locked + 숫자일 때만 고정 seed
        const effectiveVideoSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
          ? settings.seedNo
          : null

        // Stop 버튼이 현재 실행 중인 스타일을 표시할 수 있도록 id + 라벨 모두 snapshot
        setRunningStyle({ styleId: effectiveStyleId, label: styleResolver.resolveLabelForId(effectiveStyleId), applies: true })
        setHasPendingBatch(true)

        videoAutomation.start({
          mode: 't2v',
          scenes: styledVideoScenes,
          seed: effectiveVideoSeed,
          projectName,
          saveMode: settings.saveMode,
          videoResolution: settings.videoResolution || '1080p',
          videoBatchCount: settings.videoBatchCount || 1,
          onItemUpdate: (id, newStatus, result) => {
            // 명시적 null 도 통과시켜야 하는 필드(video/videoPath/mediaId/generatedAt 등)는
            // `'X' in result` 체크 — useVideoAutomation 의 새 generation 제출 시 이전 complete
            // 메타를 의도적으로 null 로 지우기 때문 (regen 후 recovery 후보에 포함되도록).
            videoScenesHook.updateVideoScene(id, {
              status: newStatus,
              ...(newStatus === 'generating' ? { generatingStartedAt: Date.now(), generatingEndedAt: null } : {}),
              ...(newStatus === 'complete' || newStatus === 'error' ? { generatingEndedAt: Date.now() } : {}),
              ...(result && 'base64' in result ? { video: result.base64 } : {}),
              ...(result && 'mediaId' in result ? { mediaId: result.mediaId } : {}),
              ...(result?.generationId ? { generationId: result.generationId } : {}),
              ...(result && 'videoPath' in result ? { videoPath: result.videoPath } : {}),
              ...(result?.videoSaveId ? { videoSaveId: result.videoSaveId } : {}),
              ...(result?.duration ? { duration: result.duration } : {}),
              ...(result?.seed != null ? { seed: result.seed } : {}),
              ...(result && 'generatedAt' in result ? { generatedAt: result.generatedAt } : {}),
              ...(result?.model ? { model: result.model } : {}),
              ...(result?.error ? { error: result.error } : {}),
            })

            // ── T2V 완료 → 번호 매칭으로 씬에 videoT2V 동기화 ──
            // base64 또는 videoPath 중 하나라도 있으면 sync (DOM 다운로드 시 path만 있을 수 있음)
            if (newStatus === 'complete' && (result?.base64 || result?.videoPath)) {
              const sceneId = id.replace('vscene_', 'scene_')
              scenesHook.updateScene(sceneId, {
                ...(result?.base64 ? { videoT2V: result.base64 } : {}),
                videoT2VPath: result.videoPath || null,
                ...(result?.duration ? { videoT2VDuration: result.duration } : {}),
              })
            }
            // 새 generation 제출 — scene-level derived 비디오 메타도 함께 클리어.
            // 빠뜨리면 export/SceneList 가 옛 videoT2V/Path/Duration 으로 옛 비디오를 계속 사용.
            if (newStatus === 'generating' && result && 'videoPath' in result) {
              const sceneId = id.replace('vscene_', 'scene_')
              scenesHook.updateScene(sceneId, {
                videoT2V: null,
                videoT2VPath: null,
                videoT2VDuration: null,
              })
            }
          },
        }).finally(() => setHasPendingBatch(false))
        break
      }

      case 'frame-to-video': {
        // Frame to Video — 선택된 framePairs만 실행
        // Frame to Video — 선택된 framePairs만 실행 (선택 검증은 상단에서 처리)
        const selectedFramePairs = framePairs.filter(p => p.selected !== false)
        const GALLERY_PFX = 'gallery::'
        const resolvedPairs = selectedFramePairs.map(p => {
          // gallery:: prefix면 mediaId 직접 추출, 아니면 씬에서 resolve
          const startIsGallery = p.startSceneId?.startsWith(GALLERY_PFX)
          const endIsGallery = p.endSceneId?.startsWith(GALLERY_PFX)
          const startScene = startIsGallery ? null : scenes.find(s => s.id === p.startSceneId)
          const endScene = endIsGallery ? null : scenes.find(s => s.id === p.endSceneId)

          // promptSource에 따라 effective prompt 계산
          const originalIdx = framePairs.indexOf(p)
          let effectivePrompt = p.prompt // default: image prompt
          if (ftvPromptSource === 'video') {
            effectivePrompt = p.videoPrompt || videoScenes[originalIdx]?.prompt || p.prompt
          } else if (ftvPromptSource === 'none') {
            effectivePrompt = p.customPrompt || ''
          }

          return {
            ...p,
            prompt: effectivePrompt,
            _startMediaId: startIsGallery ? p.startSceneId.slice(GALLERY_PFX.length) : (startScene?.mediaId || null),
            _endMediaId: endIsGallery ? p.endSceneId.slice(GALLERY_PFX.length) : (endScene?.mediaId || null),
          }
        })
        // seed: 이미지/T2V와 동일한 정책 — locked + 숫자일 때만 고정 seed
        const effectiveI2VSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
          ? settings.seedNo
          : null

        // I2V는 스타일 무관 — Stop 버튼에 표시 안 함
        setRunningStyle({ styleId: null, applies: false })
        setHasPendingBatch(true)

        videoAutomation.start({
          mode: 'i2v',
          framePairs: resolvedPairs,
          projectName,
          saveMode: settings.saveMode,
          videoResolution: settings.videoResolution || '1080p',
          videoBatchCount: settings.videoBatchCount || 1,
          seed: effectiveI2VSeed,
          onItemUpdate: (id, newStatus, result) => {
            setFramePairs(prev => {
              const updated = prev.map(p =>
                p.id === id ? {
                  ...p, status: newStatus,
                  ...(newStatus === 'generating' ? { generatingStartedAt: Date.now(), generatingEndedAt: null } : {}),
                  ...(newStatus === 'complete' || newStatus === 'error' ? { generatingEndedAt: Date.now() } : {}),
                  // 'X' in result — useVideoAutomation 의 새 generation 제출 시 옛 complete 메타를
                  // 의도적으로 null 로 지우는 흐름 지원 (regen 후 recovery 후보 포함되도록).
                  ...(result && 'base64' in result ? { video: result.base64, base64: result.base64 } : {}),
                  ...(result && 'mediaId' in result ? { mediaId: result.mediaId } : {}),
                  ...(result?.generationId ? { generationId: result.generationId } : {}),
                  ...(result && 'videoPath' in result ? { videoPath: result.videoPath } : {}),
                  ...(result?.videoSaveId ? { videoSaveId: result.videoSaveId } : {}),
                  ...(result?.duration ? { duration: result.duration } : {}),
                  ...(result?.seed != null ? { seed: result.seed } : {}),
                  ...(result && 'generatedAt' in result ? { generatedAt: result.generatedAt } : {}),
                  ...(result?.model ? { model: result.model } : {}),
                  ...(result?.error ? { error: result.error } : {}),
                } : p
              )

              // ── I2V 완료 → startSceneId로 씬에 videoI2V 동기화 ──
              // prev를 사용해 stale closure 방지
              if (newStatus === 'complete' && result?.base64) {
                const fp = prev.find(p => p.id === id)
                if (fp?.startSceneId && !fp.startSceneId.startsWith('gallery::')) {
                  scenesHook.updateScene(fp.startSceneId, {
                    videoI2V: result.base64,
                    videoI2VPath: result.videoPath || null,
                    ...(result?.duration ? { videoI2VDuration: result.duration } : {}),
                  })
                }
              }
              // 새 generation 제출 — scene-level derived 비디오 메타도 클리어.
              if (newStatus === 'generating' && result && 'videoPath' in result) {
                const fp = prev.find(p => p.id === id)
                if (fp?.startSceneId && !fp.startSceneId.startsWith('gallery::')) {
                  scenesHook.updateScene(fp.startSceneId, {
                    videoI2V: null,
                    videoI2VPath: null,
                    videoI2VDuration: null,
                  })
                }
              }

              return updated
            })
          },
        }).finally(() => setHasPendingBatch(false))
        break
      }


      default:
        break
    }
  }

  // Tag validation modal callbacks
  const handleTagValidationProceed = () => {
    setTagValidationErrors(null)
    if (pendingStartOptions) {
      // 시작 시점 snapshot — 사용자가 modal 띄운 사이 스타일 변경해도 startOptions에 들어간 게 진실
      const sid = pendingStartOptions.selectedStyleRefId
      setRunningStyle({ styleId: sid, label: styleResolver.resolveLabelForId(sid), applies: true })
      setHasPendingBatch(true)
      start(pendingStartOptions).finally(() => setHasPendingBatch(false))
      setPendingStartOptions(null)
    }
  }
  const handleTagValidationCancel = () => {
    setTagValidationErrors(null)
    setPendingStartOptions(null)
  }

  // ref batch는 generatingRefs.length만으로 부족 — preparingRefs(폴더/토큰 체크 ~ 첫 submit 사이)와
  // stoppingRefs(중지 진행 중)도 "실행 중"에 포함해야 한다. 안 그러면 그 구간에 MCP가 batch 다시
  // 호출 시 stop-restart 우회하고 동시에 두 batch가 진행되는 회귀 발생.
  const refBatchRunning = preparingRefs || stoppingRefs || generatingRefs.length > 0

  // Handle stop — 활성 자동화 중지 (scene + video + ref batch 모두 cover).
  // Phase 2: MCP 자동 stop-restart 플로우가 handleStop을 trigger하므로 ref batch도 stop해야 함.
  const handleStop = () => {
    if (isRunning) stop()
    if (videoAutomation.isRunning) videoAutomation.stop()
    if (refBatchRunning) stopGenerateAllRefs()
  }

  // MCP HTTP 서버 (시작/중지, 글로벌 접근자, 업데이트 수신, 배치 핸들러)
  // isRunning: scene OR ref(prepare/stop/generating) OR video — Phase 2 auto stop-restart 트리거.
  useMcpServer({
    settings,
    scenes, setScenes,
    references, setReferences,
    handleGenerateRef, handleGenerateScene,
    handleGenerateAllRefs, handleStart, handleStop,
    handleProjectChange, handleExportConfirm,
    selectedStyleRefId, setSelectedStyleRefId,
    refreshReviews, audioReviews,
    importByPath, audioPackage,
    automationState: { isRunning, isPaused, progress, status, statusMessage },
    videoAutomation, generatingRefs,
    refBatchRunning,
    isRunning: isRunning || videoAutomation.isRunning || refBatchRunning
  })

  // 어느 자동화든 실행 중이면 true
  const anyRunning = isRunning || videoAutomation.isRunning
  const isVideoTab = activeTab === 'video-text' || activeTab === 'frame-to-video'
  const currentProgress = isVideoTab ? videoAutomation.progress : progress
  const currentStatus = isVideoTab ? videoAutomation.status : status
  const currentStatusMessage = isVideoTab ? videoAutomation.statusMessage : statusMessage

  return (
    <div className="app">
      <QAProgressBanner />
      {projectLoading && (
        <div className="project-loading-overlay">
          <div className="project-loading-spinner" />
          <span>Loading project...</span>
        </div>
      )}
      <Header
        onSettings={() => openSettings()}
        onExport={handleExportClick}
        hasImages={scenes.some(s => s.image || s.imagePath)}
        getAccessToken={flowAPI.getAccessToken}
        authReady={authReady}
        projectName={settings.projectName}
        onProjectChange={handleProjectChange}
        onNewProject={() => openSettings('storage')}
        saveMode={settings.saveMode}
        onLoginClick={() => setShowAuthModal(true)}
        onUpgradeClick={() => {
          setPaywallReason('upgrade')
          setShowPaywallModal(true)
        }}
        disabled={anyRunning || generatingRefs.length > 0}
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

      {/* 시작 화면 - 씬 없고 인증 안됐을 때 */}
      {scenes.length === 0 && !authReady && (
        <WelcomeScreen
          getAccessToken={flowAPI.getAccessToken}
          onReady={() => setAuthReady(true)}
        />
      )}

      {/* 메인 UI - 인증됐거나 씬 있을 때 */}
      {(authReady || scenes.length > 0) && (
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
            <button
              className={`tab tab-icon ${activeTab === 'audio' ? 'active' : ''}${!audioPackage ? ' tab-disabled' : ''}`}
              onClick={() => audioPackage ? setActiveTab('audio') : null}
              title={t('audioTab.title') || '오디오'}
              disabled={!audioPackage}
            >
              🎵 <span className="tab-label">{t('audioTab.title') || '오디오'}</span>
              {audioPackage && <span className="tab-count"> ({(audioPackage.summary?.totalVoiceFiles || 0) + (audioPackage.summary?.totalSfxFiles || 0)})</span>}
            </button>
            <button
              className={`tab tab-icon ${showReferences ? 'active' : ''}`}
              onClick={() => setShowReferences(!showReferences)}
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

        {/* 스크롤 가능한 콘텐츠 영역 (레퍼런스 + 탭 콘텐츠) */}
        <div className="tab-content">
        {/* 레퍼런스 패널 (접기 가능) */}
        {showReferences && (
          <ReferencePanel
            references={references}
            onUpdate={updateReferences}
            onUpload={flowAPI.uploadReference}
            onGenerate={handleGenerateRef}
            onGenerateAll={handleGenerateAllRefs}
            onStopGenerateAll={stopGenerateAllRefs}
            onClearAll={() => setReferences([])}
            generatingRefs={generatingRefs}
            stoppingRefs={stoppingRefs}
            preparingRefs={preparingRefs}
            selectedStyleRefId={selectedStyleRefId}
            onStyleRefChange={setSelectedStyleRefId}
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
              onChange={handleTextChange}
              disabled={anyRunning}
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
              value={videoScenes.map(s => s.prompt).join('\n')}
              onChange={handleVideoTextChange}
              disabled={anyRunning}
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
              promptSource={ftvPromptSource}
              onPromptSourceChange={setFtvPromptSource}
              onShowSceneDetail={(scene) => setSelectedScene(scene)}
              onVideoRetry={handleVideoRetry}
              disabled={anyRunning}
              t={t}
              galleryItems={galleryItems}
              galleryLoading={galleryLoading}
              onLoadGallery={loadGallery}
              onUploadFromDisk={handleUploadGalleryImage}
              onListFlowProjects={listFlowProjectsHandler}
              onFetchProjectGallery={fetchProjectGallery}
              onPickArchiveImage={addArchiveItem}
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
          {activeTab === 'list' && (
            <SceneList
              scenes={scenes}
              onUpdate={scenesHook.updateScene}
              onDelete={scenesHook.deleteScene}
              onAdd={scenesHook.addScene}
              onClearAll={scenesHook.clearScenes}
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
              srtEntries={audioPackage?.srtEntries}
              scenes={scenes}
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
            const doneCount = scenes.filter(s => s.image || s.imagePath).length
            const hasScenes = scenes.length > 0
            // 생성이 한 번이라도 실행되고 완료됐는지 (done 또는 error 상태가 있음)
            const hasRun = scenes.some(s => s.status === 'done' || s.status === 'error')
            // 설정된 완료율 이상 && 실행 완료 && 현재 실행 중 아님
            const threshold = settings.exportThreshold || 50
            const requiredCount = Math.ceil(scenes.length * threshold / 100)
            const canExport = hasScenes && hasRun && !anyRunning && doneCount >= requiredCount

            const startStyleLabel = styleResolver.resolveLabelForId(selectedStyleRefId)
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
                  <button
                    className={`btn-primary ${canExport ? 'half' : ''}`}
                    onClick={() => handleStart()}
                    disabled={
                      ((activeTab === 'text' || activeTab === 'list') && scenes.length === 0) ||
                      (activeTab === 'video-text' && videoScenes.length === 0) ||
                      (activeTab === 'frame-to-video' && framePairs.length === 0) ||
                      hasPendingBatch
                    }
                  >
                    {startStyleApplies
                      ? <>
                          {activeTab === 'video-text' ? '🎬' : '✨'} {t('actions.start')}
                          ▸
                          <span className="btn-style-link" onClick={(e) => { e.stopPropagation(); setShowStylePicker(true) }}>
                            🎨 {startStyleLabel}
                          </span>
                        </>
                      : `🎬 ${t('actions.start')}`}
                  </button>
                )}

                {canExport && (
                  <button
                    className="btn-success half"
                    onClick={handleExportClick}
                    title={t('actions.scenesComplete').replace('{done}', doneCount).replace('{total}', scenes.length)}
                  >
                    📦 {t('actions.exportCapcut')}
                  </button>
                )}
              </>
            )
          })()}

          {!anyRunning && scenes.some(s => s.status === 'error') && (
            <button
              className="btn-secondary"
              onClick={() => {
                // ⚠️ 직접 바인딩(`onClick={retryErrors}`) 시 React SyntheticEvent 가
                //    options 인자로 들어가서 projectName 누락 → start() 가 'Untitled' 로
                //    폴백 → 모든 저장이 다른 프로젝트로 잘못 가는 데이터 손실 회귀.
                //    개별 재시도(onRetry, line ~1162) 와 동일한 옵션 명시 패턴 적용.
                const effectiveSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
                  ? settings.seedNo
                  : null
                retryErrors({
                  projectName: ensureProjectName(),
                  saveMode: settings.saveMode,
                  // concurrency 는 현재 useAutomation.start() 가 destructure 하지
                  // 않는 dead field 지만, 정상 시작(line 549) 옵션과의 symmetry 를
                  // 유지해 미래에 실제 구현될 때 retryErrors 만 누락되는 회귀를 차단.
                  concurrency: settings.concurrency || 2,
                  imageBatchCount: settings.imageBatchCount || 1,
                  imageUpscale: settings.imageUpscale || 'off',
                  selectedStyleRefId,
                  seed: effectiveSeed,
                })
              }}
            >
              🔄 {t('actions.retryErrors')}
            </button>
          )}
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
        />

        {activeTab === 'text' && (
          <ResultsTable
            items={scenes}
            mediaType="image"
            onRetry={(id) => {
              const effectiveSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
                ? settings.seedNo : null
              automation.retryScene(id, {
                projectName: ensureProjectName(),
                saveMode: settings.saveMode,
                imageBatchCount: settings.imageBatchCount || 1,
                imageUpscale: settings.imageUpscale || 'off',
                selectedStyleRefId,
                seed: effectiveSeed,
              })
            }}
            onShowDetail={(scene) => setSelectedScene(scene)}
            onClearMedia={(id) => scenesHook.updateScene(id, { image: null, imagePath: null, filePath: null, data: null, status: 'pending' })}
          />
        )}
        {activeTab === 'video-text' && (
          <ResultsTable
            items={videoScenes}
            mediaType="video"
            onShowDetail={(item) => setSelectedVideo(item)}
            onVideoRetry={handleVideoRetry}
            selectable={true}
            onToggle={videoScenesHook.toggleSelect}
            onToggleAll={videoScenesHook.toggleSelectAll}
            onPromptEdit={(id, newPrompt) => videoScenesHook.updateVideoScene(id, { prompt: newPrompt })}
            onClearMedia={(id) => videoScenesHook.updateVideoScene(id, { video: null, status: 'pending' })}
            disabled={anyRunning}
          />
        )}
        {activeTab === 'frame-to-video' && (
          <ResultsTable items={framePairs} mediaType="frame-pair" onShowDetail={(item) => setSelectedVideo(item)} onVideoRetry={handleVideoRetry} onClearMedia={(id) => setFramePairs(prev => prev.map(fp => fp.id === id ? { ...fp, base64: null, videoPath: null, status: 'pending' } : fp))} />
        )}
        {activeTab === 'list' && (
          <ResultsTable
            items={scenes}
            mediaType="image"
            onRetry={(id) => {
              const effectiveSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
                ? settings.seedNo : null
              automation.retryScene(id, {
                projectName: ensureProjectName(),
                saveMode: settings.saveMode,
                imageBatchCount: settings.imageBatchCount || 1,
                imageUpscale: settings.imageUpscale || 'off',
                selectedStyleRefId,
                seed: effectiveSeed,
              })
            }}
            onShowDetail={(scene) => setSelectedScene(scene)}
            onClearMedia={(id) => scenesHook.updateScene(id, { image: null, imagePath: null, filePath: null, data: null, status: 'pending' })}
          />
        )}
      </div>
      </>
      )}

      {/* 씬 상세 모달 (ResultsTable에서 열림) */}
      {selectedScene && (
        <SceneDetailModal
          scene={scenes.find(s => s.id === selectedScene.id) || selectedScene}
          onUpdate={scenesHook.updateScene}
          onClose={() => setSelectedScene(null)}
          onGenerate={handleGenerateScene}
          isGenerating={generatingSceneId === selectedScene.id}
          t={t}
          projectName={ensureProjectName()}
        />
      )}

      {/* 비디오 상세 모달 (ResultsTable에서 열림) */}
      {selectedVideo && (
        <VideoDetailModal
          video={selectedVideo}
          onClose={() => setSelectedVideo(null)}
          t={t}
          projectName={ensureProjectName()}
          onUpdate={(videoId, patch) => {
            // VideoDetailModal 의 history 복원 patch 에는 video/videoPath 외에
            // seed/generatedAt/model/mediaId 도 포함될 수 있음 (메타 변경 보존).
            // 'seed' in patch 로 명시적 null 도 보존 (history 메타가 빈 경우 stale 값 제거).
            const metaPatch = {}
            if ('seed' in patch) metaPatch.seed = patch.seed
            if ('generatedAt' in patch) metaPatch.generatedAt = patch.generatedAt
            if ('model' in patch) metaPatch.model = patch.model
            if ('mediaId' in patch) metaPatch.mediaId = patch.mediaId

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
              })
            } else if (videoId.startsWith('fp_')) {
              setFramePairs(prev => prev.map(p =>
                p.id === videoId
                  ? { ...p, video: patch.video, base64: patch.video, videoPath: patch.videoPath, ...metaPatch }
                  : p
              ))
              // 매칭 image scene의 videoI2V 동기화 — startSceneId 기준
              const fp = framePairs.find(p => p.id === videoId)
              if (fp?.startSceneId && !fp.startSceneId.startsWith('gallery::')) {
                scenesHook.updateScene(fp.startSceneId, {
                  ...(patch.video ? { videoI2V: patch.video } : {}),
                  videoI2VPath: patch.videoPath || null,
                })
              }
            } else if (videoId.startsWith('t2v_')) {
              // synthetic id — scene 에는 비디오 데이터/path 만 sync (이미지 메타 슬롯 보호).
              // scene.seed/generatedAt/model 은 IMAGE 메타로 SceneDetailModal 이 사용하므로
              // video metaPatch 로 덮어쓰면 안 됨. video 메타는 source-of-truth 인 vscene_X 에만.
              const sceneId = `scene_${videoId.replace('t2v_', '')}`
              scenesHook.updateScene(sceneId, {
                ...(patch.video ? { videoT2V: patch.video } : {}),
                videoT2VPath: patch.videoPath || null,
              })
              const vsceneId = `vscene_${videoId.replace('t2v_', '')}`
              videoScenesHook.updateVideoScene(vsceneId, metaPatch)
            } else if (videoId.startsWith('i2v_')) {
              // synthetic id — scene 에는 비디오 데이터/path 만 sync (이미지 메타 슬롯 보호).
              // video 메타는 source-of-truth 인 fp_X 에만 반영.
              const sceneId = `scene_${videoId.replace('i2v_', '')}`
              scenesHook.updateScene(sceneId, {
                ...(patch.video ? { videoI2V: patch.video } : {}),
                videoI2VPath: patch.videoPath || null,
              })
              const fpId = `fp_${videoId.replace('i2v_', '')}`
              setFramePairs(prev => prev.map(p =>
                p.id === fpId ? { ...p, ...metaPatch } : p
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
          onSave={(newSettings) => {
            setSettings(newSettings)
            setShowSettings(false)
            setSettingsTab(null)
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
        projectName={ensureProjectName()}
        loading={exporting}
        exportPhase={exportPhase}
        hasSubtitles={scenes.some(s => s.subtitle && s.subtitle.trim())}
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

      {/* Flow Login Expired Modal */}
      <Modal
        isOpen={showLoginExpiredModal}
        onClose={() => setShowLoginExpiredModal(false)}
        title={t('toast.flowLoginExpiredTitle')}
        footer={
          <button className="btn btn-primary" onClick={() => setShowLoginExpiredModal(false)}>
            {t('export.confirm') || '확인'}
          </button>
        }
      >
        <p>{t('toast.flowLoginExpiredMessage')}</p>
      </Modal>

      {tagValidationErrors && (
        <TagValidationModal
          errors={tagValidationErrors}
          onProceed={handleTagValidationProceed}
          onCancel={handleTagValidationCancel}
          t={t}
        />
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
            if (id) {
              setShowStylePicker(false)
              handleStart(id)
              return
            }
            // 자동 카드 (id === null) — availability는 styleResolver가 탭별로 판단:
            //   - image/list: 씬별 매칭 가능 여부
            //   - video-text: 첫 사용 가능한 스타일 카드 존재 여부
            // requireStyle=false면 어느 탭이든 통과.
            if (styleResolver.autoAvailable || !settings.requireStyle) {
              setShowStylePicker(false)
              handleStart(null)
            } else {
              toast.warning(t('toast.autoMatchNoMatchesPickStyle'))
            }
          }}
          thumbnails={styleThumbnails}
          uploadedStyleRefs={references.filter(r => r.type === 'style')}
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
            if (audioPackage) setActiveTab('audio')
          }}
        />
      )}
    </div>
  )
}

export default App
