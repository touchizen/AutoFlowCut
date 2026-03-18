/**
 * AutoFlowCut - Main App
 */

import { useState, useEffect, useCallback } from 'react'
import { DEFAULTS, UI, TIMING } from './config/defaults'
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
import { generateProjectName } from './utils/formatters'
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
import AudioPanel from './components/AudioPanel'
import { SubscriptionBanner } from './components/SubscriptionBanner'
import Modal from './components/Modal'
import { useAuth } from './contexts/AuthContext'

function App() {
  const { t } = useI18n()
  const { isAuthenticated, subscription } = useAuth()
  const generationQueue = useGenerationQueue({ t, showToast: (msg, type) => type === 'error' ? toast.error(msg) : toast.info(msg) })

  // Auth/Payment Modals
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showPaywallModal, setShowPaywallModal] = useState(false)
  const [paywallReason, setPaywallReason] = useState('trial_expired')

  // Flow Login Expired Modal
  const [showLoginExpiredModal, setShowLoginExpiredModal] = useState(false)

  // Tag Validation Modal
  const [tagValidationErrors, setTagValidationErrors] = useState(null)
  const [pendingStartOptions, setPendingStartOptions] = useState(null)

  // Settings
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('flow2capcut_settings')
    const defaults = {
      defaultDuration: DEFAULTS.scene.duration,
      projectName: DEFAULTS.project.defaultName,
      saveMode: 'folder',      // 'folder' | 'none'
      concurrency: DEFAULTS.generation.concurrency,
      exportThreshold: UI.EXPORT_THRESHOLD,     // 내보내기 버튼 표시 완료율 (%)
      imageBatchCount: 1,     // 이미지 배치 카운트 (x1~x4)
      imageUpscale: 'off',   // 이미지 업스케일 해상도 ('off' | '2k' | '4k')
      videoBatchCount: 1,     // 비디오 배치 카운트 (x1~x4)
      videoResolution: '1080p', // 비디오 다운로드 해상도
      mcpHttpEnabled: false,  // MCP HTTP 서버 활성화
      mcpHttpPort: 3210       // MCP HTTP 서버 포트
    }
    if (saved) {
      const parsed = JSON.parse(saved)
      // File System 권한은 리로드 시 만료되므로 프로젝트명 초기화
      parsed.projectName = DEFAULTS.project.defaultName
      // 이전 버전 호환: 불필요한 설정 제거
      delete parsed.method
      delete parsed.seed
      delete parsed.seedLocked
      delete parsed.aspectRatio
      return { ...defaults, ...parsed }
    }
    return defaults
  })

  // Flow 로그인 만료 이벤트 수신
  useEffect(() => {
    const handler = () => setShowLoginExpiredModal(true)
    window.addEventListener('flow-login-expired', handler)
    return () => window.removeEventListener('flow-login-expired', handler)
  }, [])

  // DOM 모드: 레이아웃이 'tab'이면 split으로 보정 (Flow UI가 보여야 함)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('layoutSettings')
      const layout = saved ? JSON.parse(saved) : {}
      if (!layout.mode || layout.mode === 'tab') {
        const splitLayout = { mode: 'split-left', ratio: 0.5 }
        localStorage.setItem('layoutSettings', JSON.stringify(splitLayout))
        window.electronAPI?.setLayout?.(splitLayout)
      }
    } catch (e) { /* ignore */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
  const [selectedVideo, setSelectedVideo] = useState(null) // 비디오 상세 모달용
  const [bottomPanelHeight, setBottomPanelHeight] = useState(() => {
    const saved = localStorage.getItem('flow2capcut_bottomPanelHeight')
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
    }
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

  // Project Data 관리
  const { addPendingSave, handleProjectChange, saveCurrentProject, isRestoringRef } = useProjectData({
    settings, setSettings, scenes, references, setScenes, setReferences,
    videoScenes, setVideoScenes,
    framePairs, setFramePairs,
    openSettings
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
  const { audioPackage, audioTracks, importing: audioImporting, importAudioPackage, importByPath, clearAudioPackage, audioReviews, saveReview, saveBulkReviews, refreshReviews } = useAudioImport(t)

  const handleImportAudio = async () => {
    setShowAudioResult(true)
    const result = await importAudioPackage()
    if (!result) {
      setShowAudioResult(false)
    }
  }

  // Export
  const { showExportModal, setShowExportModal, exporting, exportPhase, handleExportClick, handleExportConfirm } = useExport({
    settings, scenes, videoScenes, framePairs, openSettings,
    audioPackage,
    isAuthenticated,
    subscription,
    onLoginRequired: () => setShowAuthModal(true),
    onPaywallRequired: (reason) => {
      setPaywallReason(reason)
      setShowPaywallModal(true)
    }
  })

  // ── 완성된 비디오 → 씬에 자동 동기화 (세션 내 기존 비디오 반영) ──
  useEffect(() => {
    if (!scenes?.length) return
    let synced = false

    // T2V: vscene_N → scene_N
    if (videoScenes?.length) {
      for (const vs of videoScenes) {
        if ((vs.status === 'complete' || vs.status === 'done') && vs.video) {
          const sceneId = vs.id.replace('vscene_', 'scene_')
          const scene = scenes.find(s => s.id === sceneId)
          if (scene && !scene.videoT2V) {
            scenesHook.updateScene(sceneId, {
              videoT2V: vs.video,
              videoT2VPath: vs.videoPath || null,
            })
            synced = true
          }
        }
      }
    }

    // I2V: framePair.startSceneId → scene
    if (framePairs?.length) {
      for (const fp of framePairs) {
        if ((fp.status === 'complete' || fp.status === 'done') && fp.base64 && fp.startSceneId && !fp.startSceneId.startsWith('gallery::')) {
          const scene = scenes.find(s => s.id === fp.startSceneId)
          if (scene && !scene.videoI2V) {
            scenesHook.updateScene(fp.startSceneId, {
              videoI2V: fp.base64,
              videoI2VPath: fp.videoPath || null,
            })
            synced = true
          }
        }
      }
    }

    if (synced) console.log('[App] Synced existing videos → scenes')
  }, [videoScenes, framePairs])

  // Gallery 로드
  const loadGallery = async () => {
    if (galleryLoading) return
    setGalleryLoading(true)
    try {
      const result = await flowAPI.fetchGallery()
      if (result.success) {
        setGalleryItems(result.items || [])
      } else {
        console.warn('[Gallery] Load failed:', result.error)
      }
    } catch (e) {
      console.error('[Gallery] Error:', e)
    } finally {
      setGalleryLoading(false)
    }
  }

  // Auto-save project data when scenes/references/videoScenes/framePairs change (생성 중 또는 복원 중 아닐 때만)
  useEffect(() => {
    if (generatingRefs.length > 0 || isRunning) return
    if (isRestoringRef?.current) return  // ← 복원 중에는 auto-save 스킵 (project.json 오염 방지)
    if (scenes.length === 0 && references.length === 0 && videoScenes.length === 0) return  // ← 빈 데이터로 덮어쓰기 방지
    if (settings.saveMode === 'folder' && settings.projectName) {
      const timer = setTimeout(async () => {
        if (isRestoringRef?.current) return  // ← 타이머 실행 시점에도 재확인
        await saveCurrentProject()
        console.log('[App] Auto-saved project data')
      }, TIMING.AUTO_SAVE_DEBOUNCE)
      return () => clearTimeout(timer)
    }
  }, [scenes, references, videoScenes, framePairs, settings.projectName, settings.saveMode, generatingRefs.length, isRunning])

  // Save settings
  useEffect(() => {
    localStorage.setItem('flow2capcut_settings', JSON.stringify(settings))
  }, [settings])

  // MCP HTTP 서버 시작/중지
  useEffect(() => {
    if (settings.mcpHttpEnabled) {
      window.electronAPI?.startMcpHttp?.({ port: settings.mcpHttpPort || 3210 })
    } else {
      window.electronAPI?.stopMcpHttp?.()
    }
  }, [settings.mcpHttpEnabled, settings.mcpHttpPort])

  // MCP HTTP GET 요청을 위한 글로벌 접근자 등록
  useEffect(() => {
    window.__mcpOpenProject = (name) => handleProjectChange(name)
    window.__mcpGetReferences = () => references.map(({ data, ...rest }) => rest)
    window.__mcpGetScenes = () => scenes.map(({ image, videoT2V, videoI2V, ...rest }) => rest)
    window.__mcpGenerateRef = (index) => handleGenerateRef(index).catch(e => ({ success: false, error: e.message }))
    window.__mcpGenerateScene = (sceneId) => handleGenerateScene(sceneId)
    window.__mcpSetStyle = (styleId) => { setSelectedStyleRefId(styleId); return styleId }
    window.__mcpGetStyle = () => selectedStyleRefId
    window.__mcpRefreshAudioReviews = () => refreshReviews()
    window.__mcpGetAudioReviews = () => audioReviews
    window.__mcpImportAudio = async (folderPath) => {
      const pkg = await importByPath(folderPath)
      if (!pkg) return { success: false, error: 'Failed to import audio' }
      return { success: true, summary: pkg.summary }
    }
    window.__mcpExportCapcut = async (options = {}) => {
      try {
        // 0. audioPackage가 없으면 자동 로드
        if (!audioPackage && options.audioFolderPath) {
          const pkg = await importByPath(options.audioFolderPath)
          if (!pkg) console.warn('[MCP Export] Audio import failed, continuing without audio')
        }
        // 1. CapCut 경로 자동 감지
        let capcutProjectNumber = options.capcutProjectNumber
        if (!capcutProjectNumber) {
          const pathResult = await window.electronAPI?.detectCapcutPath?.()
          if (!pathResult?.success) return { success: false, error: 'CapCut path not detected' }
          const numResult = await window.electronAPI?.getNextProjectNumber?.({ basePath: pathResult.basePath })
          if (!numResult?.success) return { success: false, error: 'Cannot determine project number' }
          const info = await window.electronAPI?.getSystemInfo?.()
          const sep = info?.platform === 'darwin' ? '/' : '\\'
          capcutProjectNumber = `${pathResult.basePath}${sep}${numResult.folderName}`
        }
        // 2. 저장된 export 설정 읽기
        let saved = {}
        try { saved = JSON.parse(localStorage.getItem('exportSettings') || '{}') } catch {}
        const exportOptions = {
          capcutProjectNumber,
          scaleMode: options.scaleMode || saved.scaleMode || 'none',
          kenBurns: options.kenBurns ?? saved.kenBurns ?? true,
          kenBurnsMode: options.kenBurnsMode || saved.kenBurnsMode || 'random',
          kenBurnsCycle: options.kenBurnsCycle || saved.kenBurnsCycle || 5,
          kenBurnsScaleMin: (options.kenBurnsScaleMin || saved.kenBurnsScaleMin || 100) / 100,
          kenBurnsScaleMax: (options.kenBurnsScaleMax || saved.kenBurnsScaleMax || 130) / 100,
          subtitleOption: options.subtitleOption || (saved.includeSubtitle !== false ? 'ko' : 'none'),
          subtitleFontSize: options.subtitleFontSize || saved.subtitleFontSize || 8
        }
        // 3. handleExportConfirm 호출
        await handleExportConfirm(exportOptions)
        return { success: true, path: capcutProjectNumber }
      } catch (e) {
        return { success: false, error: e.message }
      }
    }
    return () => {
      delete window.__mcpGetReferences
      delete window.__mcpGetScenes
      delete window.__mcpGenerateRef
      delete window.__mcpGenerateScene
      delete window.__mcpSetStyle
      delete window.__mcpGetStyle
      delete window.__mcpRefreshAudioReviews
      delete window.__mcpGetAudioReviews
      delete window.__mcpImportAudio
      delete window.__mcpExportCapcut
    }
  }, [references, scenes, handleGenerateRef, handleGenerateScene, selectedStyleRefId, refreshReviews, audioReviews, handleExportConfirm, importByPath, audioPackage])

  // MCP HTTP 서버에서 오는 데이터 업데이트 수신
  useEffect(() => {
    const cleanup = window.electronAPI?.onMcpUpdate?.((data) => {
      if (data.type === 'update-references') {
        setReferences(data.references)
        console.log('[MCP] References updated via HTTP:', data.references.length)
      } else if (data.type === 'update-reference') {
        setReferences(prev => prev.map((ref, i) => i === data.index ? { ...prev[i], ...data.fields } : ref))
        console.log('[MCP] Reference', data.index, 'updated via HTTP')
      } else if (data.type === 'remove-reference') {
        setReferences(prev => prev.filter((_, i) => i !== data.index))
        console.log('[MCP] Reference', data.index, 'removed via HTTP')
      } else if (data.type === 'clear-reference-image') {
        setReferences(prev => prev.map((ref, i) => i === data.index ? { ...ref, data: null, filePath: null, mediaId: null, caption: null, dataStorage: null } : ref))
        console.log('[MCP] Reference', data.index, 'image cleared via HTTP')
      } else if (data.type === 'clear-all-reference-images') {
        setReferences(prev => prev.map(ref => ({ ...ref, data: null, filePath: null, mediaId: null, caption: null, dataStorage: null })))
        console.log('[MCP] All reference images cleared via HTTP')
      } else if (data.type === 'update-scenes') {
        const scenesWithIds = (data.scenes || []).map((s, i) => ({
          ...s,
          id: s.id || `scene_${i + 1}`,
          status: s.status || 'pending',
        }))
        setScenes(scenesWithIds)
        console.log('[MCP] Scenes updated via HTTP:', scenesWithIds.length)
      } else if (data.type === 'update-scene') {
        setScenes(prev => prev.map((s, i) => i === data.index ? { ...prev[i], ...data.fields } : s))
        console.log('[MCP] Scene', data.index, 'updated via HTTP')
      } else if (data.type === 'generate-reference') {
        console.log('[MCP] Generate reference requested:', data.index, 'style:', data.styleId)
        if (data.styleId && window.__mcpSetStyle) {
          window.__mcpSetStyle(data.styleId)
          setTimeout(() => window.__mcpGenerateRef?.(data.index), 500)
        } else {
          window.__mcpGenerateRef?.(data.index)
        }
      } else if (data.type === 'generate-scene') {
        console.log('[MCP] Generate scene requested:', data.sceneId)
        window.__mcpGenerateScene?.(data.sceneId)
      } else if (data.type === 'open-project') {
        console.log('[MCP] Open project requested:', data.projectName)
        window.__mcpOpenProject?.(data.projectName)
      } else if (data.type === 'start-scene-batch') {
        console.log('[MCP] Scene batch generation start requested, styleId:', data.styleId)
        window.__mcpStartBatch?.(data.styleId)
      } else if (data.type === 'start-ref-batch') {
        console.log('[MCP] Reference batch generation start requested, styleId:', data.styleId)
        window.__mcpStartRefBatch?.(data.styleId)
      } else if (data.type === 'reload-project') {
        // 프로젝트 전체 리로드 트리거
        console.log('[MCP] Project reload requested')
      }
    })
    return cleanup
  }, [])

  // Save bottom panel height
  useEffect(() => {
    localStorage.setItem('flow2capcut_bottomPanelHeight', String(bottomPanelHeight))
  }, [bottomPanelHeight])

  // Load saved prompts — 프로젝트가 있으면 auto-restore가 처리하므로 스킵
  useEffect(() => {
    // 작업 폴더 + 프로젝트가 모두 설정되어 있으면 auto-restore가 scenes를 로드함
    // savedPrompts를 parseFromText하면 이미지/자막 없는 text-only scenes로 덮어쓰게 됨
    const workFolder = localStorage.getItem('workFolderPath')
    const settingsSaved = localStorage.getItem('flow2capcut_settings')
    if (workFolder && settingsSaved) {
      try {
        const parsed = JSON.parse(settingsSaved)
        if (parsed.projectName && parsed.saveMode === 'folder') {
          console.log('[App] Skipping savedPrompts load — auto-restore will handle scenes for project:', parsed.projectName)
          return
        }
      } catch (e) { /* ignore */ }
    }

    const saved = localStorage.getItem('flow2capcut_savedPrompts')
    if (saved) {
      console.log('[App] Loading savedPrompts from localStorage (no project folder configured)')
      parseFromText(saved, settings.defaultDuration)
    }

    // Video prompts도 localStorage에서 복원
    const savedVideo = localStorage.getItem('flow2capcut_savedVideoPrompts')
    if (savedVideo) {
      console.log('[App] Loading savedVideoPrompts from localStorage')
      videoScenesHook.parseFromText(savedVideo, settings.defaultDuration)
    }
  }, [])

  // Handle text input change
  const handleTextChange = (text) => {
    parseFromText(text, settings.defaultDuration)
    localStorage.setItem('flow2capcut_savedPrompts', text)
  }

  // Handle video text input change (T2V 독립 프롬프트)
  const handleVideoTextChange = (text) => {
    videoScenesHook.parseFromText(text, settings.defaultDuration)
    localStorage.setItem('flow2capcut_savedVideoPrompts', text)
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
  const handleStart = async (overrideStyleId = null) => {
    // 이미 실행 중이면 무시 (중지는 별도 버튼)
    if (isRunning || videoAutomation.isRunning) return

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

    const projectName = settings.projectName || generateProjectName()

    switch (activeTab) {
      case 'text':
      case 'list': {
        // 이미지 생성 — 태그 매칭 검증 후 시작
        const startOptions = {
          projectName,
          saveMode: settings.saveMode,
          concurrency: settings.concurrency || 2,
          imageBatchCount: settings.imageBatchCount || 1,
          imageUpscale: settings.imageUpscale || 'off',
          selectedStyleRefId: overrideStyleId || selectedStyleRefId,
        }

        const errors = collectTagErrors(scenes, scenesHook.references)
        if (errors.length > 0) {
          setTagValidationErrors(errors)
          setPendingStartOptions(startOptions)
          return
        }

        start(startOptions)
        break
      }

      case 'video-text': {
        // Text to Video — 선택된 videoScenes만 실행 (선택 검증은 상단에서 처리)
        const selectedVideoScenes = videoScenes.filter(s => s.selected !== false)
        videoAutomation.start({
          mode: 't2v',
          scenes: selectedVideoScenes,
          projectName,
          saveMode: settings.saveMode,
          videoResolution: settings.videoResolution || '1080p',
          videoBatchCount: settings.videoBatchCount || 1,
          onItemUpdate: (id, newStatus, result) => {
            videoScenesHook.updateVideoScene(id, {
              status: newStatus,
              ...(newStatus === 'generating' ? { generatingStartedAt: Date.now() } : {}),
              ...(result?.base64 ? { video: result.base64 } : {}),
              ...(result?.mediaId ? { mediaId: result.mediaId } : {}),
              ...(result?.videoPath ? { videoPath: result.videoPath } : {}),
              ...(result?.videoSaveId ? { videoSaveId: result.videoSaveId } : {}),
              ...(result?.error ? { error: result.error } : {}),
            })

            // ── T2V 완료 → 번호 매칭으로 씬에 videoT2V 동기화 ──
            if (newStatus === 'complete' && result?.base64) {
              const sceneId = id.replace('vscene_', 'scene_')
              scenesHook.updateScene(sceneId, {
                videoT2V: result.base64,
                videoT2VPath: result.videoPath || null,
              })
            }
          },
        })
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
        videoAutomation.start({
          mode: 'i2v',
          framePairs: resolvedPairs,
          projectName,
          saveMode: settings.saveMode,
          videoResolution: settings.videoResolution || '1080p',
          videoBatchCount: settings.videoBatchCount || 1,
          onItemUpdate: (id, newStatus, result) => {
            setFramePairs(prev => {
              const updated = prev.map(p =>
                p.id === id ? {
                  ...p, status: newStatus,
                  ...(newStatus === 'generating' ? { generatingStartedAt: Date.now() } : {}),
                  ...(result?.base64 ? { video: result.base64, base64: result.base64 } : {}),
                  ...(result?.mediaId ? { mediaId: result.mediaId } : {}),
                  ...(result?.generationId ? { generationId: result.generationId } : {}),
                  ...(result?.videoPath ? { videoPath: result.videoPath } : {}),
                  ...(result?.videoSaveId ? { videoSaveId: result.videoSaveId } : {}),
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
                  })
                }
              }

              return updated
            })
          },
        })
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
      start(pendingStartOptions)
      setPendingStartOptions(null)
    }
  }
  const handleTagValidationCancel = () => {
    setTagValidationErrors(null)
    setPendingStartOptions(null)
  }

  // Handle stop — 활성 자동화 중지
  const handleStop = () => {
    if (isRunning) stop()
    if (videoAutomation.isRunning) videoAutomation.stop()
  }

  // MCP: handleStart/handleStop/batchStatus 글로벌 등록 (정의 이후에 등록해야 함)
  useEffect(() => {
    window.__mcpStartBatch = (styleId) => {
      const fullId = styleId ? `preset:${styleId}` : null
      if (fullId) setSelectedStyleRefId(fullId)
      handleStart(fullId)
    }
    window.__mcpStartRefBatch = (styleId) => {
      const fullId = styleId ? `preset:${styleId}` : null
      if (fullId) setSelectedStyleRefId(fullId)
      handleGenerateAllRefs(fullId)
    }
    window.__mcpStopBatch = () => handleStop()
    window.__mcpBatchStatus = () => {
      const total = scenes.length
      const done = scenes.filter(s => s.image || s.imagePath).length
      const pending = scenes.filter(s => s.status === 'pending').length
      const generating = scenes.filter(s => s.status === 'generating').length
      const error = scenes.filter(s => s.status === 'error').length
      return {
        isRunning: isRunning || videoAutomation.isRunning,
        isPaused: isPaused || videoAutomation.isPaused,
        progress: isRunning ? progress : videoAutomation.progress,
        total, done, pending, generating, error,
        status: isRunning ? status : videoAutomation.status,
        statusMessage: isRunning ? statusMessage : videoAutomation.statusMessage
      }
    }
    return () => {
      delete window.__mcpStartBatch
      delete window.__mcpStartRefBatch
      delete window.__mcpStopBatch
      delete window.__mcpBatchStatus
    }
  }, [handleStart, handleStop, handleGenerateAllRefs, scenes, isRunning, isPaused, progress, status, statusMessage, videoAutomation])

  // 어느 자동화든 실행 중이면 true
  const anyRunning = isRunning || videoAutomation.isRunning
  const isVideoTab = activeTab === 'video-text' || activeTab === 'frame-to-video'
  const currentProgress = isVideoTab ? videoAutomation.progress : progress
  const currentStatus = isVideoTab ? videoAutomation.status : status
  const currentStatusMessage = isVideoTab ? videoAutomation.statusMessage : statusMessage

  return (
    <div className="app">
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
            />
          )}
          {activeTab === 'video-text' && (
            <PromptInput
              value={videoScenes.map(s => s.prompt).join('\n')}
              onChange={handleVideoTextChange}
              disabled={anyRunning}
              placeholder={t('prompt.videoPlaceholder')}
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
              disabled={anyRunning}
              t={t}
              galleryItems={galleryItems}
              galleryLoading={galleryLoading}
              onLoadGallery={loadGallery}
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
              projectName={settings.projectName || generateProjectName()}
              onGenerate={handleGenerateScene}
              generatingSceneId={generatingSceneId}
              references={references}
            />
          )}
          {activeTab === 'audio' && (
            <AudioPanel
              audioPackage={audioPackage}
              audioReviews={audioReviews}
              onSaveReview={saveReview}
              onBulkReview={saveBulkReviews}
              onRefresh={refreshReviews}
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

            return (
              <>
                {anyRunning ? (
                  <button
                    className={`btn-danger ${canExport ? 'half' : ''}`}
                    onClick={handleStop}
                    disabled={isStopping}
                  >
                    {isStopping ? `⏳ ${t('status.stopping')}` : `⏹️ ${t('actions.stop')}`}
                  </button>
                ) : (
                  <button
                    className={`btn-primary ${canExport ? 'half' : ''}`}
                    onClick={handleStart}
                    disabled={
                      ((activeTab === 'text' || activeTab === 'list') && scenes.length === 0) ||
                      (activeTab === 'video-text' && videoScenes.length === 0) ||
                      (activeTab === 'frame-to-video' && framePairs.length === 0)
                    }
                  >
                    {(activeTab === 'text' || activeTab === 'list') ? `✨ ${t('actions.start')}` : `🎬 ${t('actions.start')}`}
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
            <button className="btn-secondary" onClick={retryErrors}>
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
            onRetry={(id) => automation.retryScene(id, {
              projectName: settings.projectName || generateProjectName(),
              saveMode: settings.saveMode
            })}
            onShowDetail={(scene) => setSelectedScene(scene)}
            onClearMedia={(id) => scenesHook.updateScene(id, { image: null, imagePath: null, filePath: null, data: null, status: 'pending' })}
          />
        )}
        {activeTab === 'video-text' && (
          <ResultsTable
            items={videoScenes}
            mediaType="video"
            onShowDetail={(item) => setSelectedVideo(item)}
            selectable={true}
            onToggle={videoScenesHook.toggleSelect}
            onToggleAll={videoScenesHook.toggleSelectAll}
            onPromptEdit={(id, newPrompt) => videoScenesHook.updateVideoScene(id, { prompt: newPrompt })}
            onClearMedia={(id) => videoScenesHook.updateVideoScene(id, { video: null, status: 'pending' })}
            disabled={anyRunning}
          />
        )}
        {activeTab === 'frame-to-video' && (
          <ResultsTable items={framePairs} mediaType="frame-pair" onShowDetail={(item) => setSelectedVideo(item)} onClearMedia={(id) => setFramePairs(prev => prev.map(fp => fp.id === id ? { ...fp, base64: null, status: 'pending' } : fp))} />
        )}
        {activeTab === 'list' && (
          <ResultsTable
            items={scenes}
            mediaType="image"
            onRetry={(id) => automation.retryScene(id, {
              projectName: settings.projectName || generateProjectName(),
              saveMode: settings.saveMode
            })}
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
          projectName={settings.projectName || generateProjectName()}
        />
      )}

      {/* 비디오 상세 모달 (ResultsTable에서 열림) */}
      {selectedVideo && (
        <VideoDetailModal
          video={selectedVideo}
          onClose={() => setSelectedVideo(null)}
          t={t}
          projectName={settings.projectName || generateProjectName()}
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
        projectName={settings.projectName || generateProjectName()}
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
