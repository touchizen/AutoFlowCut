/**
 * Flow2CapCut - Main App (AutoCraft Studio)
 */

import { useState, useEffect } from 'react'
import { DEFAULTS, UI, TIMING } from './config/defaults'
import { useFlowAPI } from './hooks/useFlowAPI'
import { useScenes } from './hooks/useScenes'
import { useAutomation } from './hooks/useAutomation'
import { useVideoAutomation } from './hooks/useVideoAutomation'
import { useVideoScenes } from './hooks/useVideoScenes'
import { useI18n } from './hooks/useI18n'
import { useProjectData } from './hooks/useProjectData'
import { useReferenceGeneration } from './hooks/useReferenceGeneration'
import { useSceneGeneration } from './hooks/useSceneGeneration'
import { useExport } from './hooks/useExport'
import { generateProjectName } from './utils/formatters'
import { detectFileType, detectCSVType } from './utils/parsers'
import { checkFolderPermission } from './utils/guards'
import { toast } from './components/Toast'

// Components
import Header from './components/Header'
import WelcomeScreen from './components/WelcomeScreen'
import PromptInput from './components/PromptInput'
import SceneList from './components/SceneList'
import FrameToVideoPanel from './components/FrameToVideoPanel'
import RefToVideoPanel from './components/RefToVideoPanel'
import ReferencePanel from './components/ReferencePanel'
import SettingsModal from './components/SettingsModal'
import ImportModal from './components/ImportModal'
import StatusBar from './components/StatusBar'
import ResultsTable from './components/ResultsTable'
import SelectablePromptList from './components/SelectablePromptList'
import SceneDetailModal from './components/SceneDetailModal'
import VideoDetailModal from './components/VideoDetailModal'
import ResizeHandle from './components/ResizeHandle'
import { ExportModal } from './components/ExportModal'
import { AuthModal } from './components/AuthModal'
import { PaywallModal } from './components/PaywallModal'
import { SubscriptionBanner } from './components/SubscriptionBanner'
import { useAuth } from './contexts/AuthContext'

function App() {
  const { t } = useI18n()
  const { isAuthenticated, subscription } = useAuth()

  // Auth/Payment Modals
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showPaywallModal, setShowPaywallModal] = useState(false)
  const [paywallReason, setPaywallReason] = useState('trial_expired')

  // Settings
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('flow2capcut_settings')
    const defaults = {
      defaultDuration: DEFAULTS.scene.duration,
      projectName: DEFAULTS.project.defaultName,
      saveMode: 'folder',      // 'folder' | 'none'
      concurrency: DEFAULTS.generation.concurrency,
      exportThreshold: UI.EXPORT_THRESHOLD      // 내보내기 버튼 표시 완료율 (%)
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
  const [activeTab, setActiveTab] = useState('text') // 'text' | 'video-text' | 'frame-to-video' | 'ref-to-video' | 'list'
  const [framePairs, setFramePairs] = useState([])   // Frame to Video 매핑
  const [refPairs, setRefPairs] = useState([])         // Refs to Video 매핑
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState(null) // 설정 모달 초기 탭
  const [showImport, setShowImport] = useState(false)
  const [showReferences, setShowReferences] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [selectedScene, setSelectedScene] = useState(null) // 상세 모달용 선택된 씬
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
      toast.error(t('status.authErrorStopped'), TIMING.AUTH_ERROR_TOAST)
    }
  )

  const videoAutomation = useVideoAutomation(flowAPI, t)
  const videoScenesHook = useVideoScenes()
  const { videoScenes, setVideoScenes } = videoScenesHook

  const { scenes, references, parseFromText, parseFromCSV, parseFromSRT, parseReferencesFromCSV, updateReferences, setScenes, setReferences } = scenesHook
  const { isRunning, isPaused, isStopping, progress, status, statusMessage, start, togglePause, stop, retryErrors } = automation

  // Project Data 관리
  const { addPendingSave, handleProjectChange, saveCurrentProject, isRestoringRef } = useProjectData({
    settings, setSettings, scenes, references, setScenes, setReferences,
    videoScenes, setVideoScenes,
    framePairs, setFramePairs,
    refPairs, setRefPairs,
    openSettings
  })

  // Reference 생성
  const { generatingRefs, handleGenerateRef, handleGenerateAllRefs } = useReferenceGeneration({
    settings, references, setReferences, flowAPI, addPendingSave, openSettings, t
  })

  // Scene 재생성
  const { generatingSceneId, handleGenerateScene } = useSceneGeneration({
    settings, scenes, scenesHook, flowAPI, openSettings, setSelectedScene, t
  })

  // Export
  const { showExportModal, setShowExportModal, exporting, exportPhase, handleExportClick, handleExportConfirm } = useExport({
    settings, scenes, videoScenes, framePairs, refPairs, openSettings,
    isAuthenticated,
    subscription,
    onLoginRequired: () => setShowAuthModal(true),
    onPaywallRequired: (reason) => {
      setPaywallReason(reason)
      setShowPaywallModal(true)
    }
  })

  // Auto-save project data when scenes/references/videoScenes/framePairs/refPairs change (생성 중 또는 복원 중 아닐 때만)
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
  }, [scenes, references, videoScenes, framePairs, refPairs, settings.projectName, settings.saveMode, generatingRefs.length, isRunning])

  // Save settings
  useEffect(() => {
    localStorage.setItem('flow2capcut_settings', JSON.stringify(settings))
  }, [settings])

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
  const handleImport = async (type, content) => {
    const detectedType = detectFileType(content)
    const projectName = settings.projectName

    // 타입별 실행 액션
    const actions = {
      text: () => parseFromText(content, settings.defaultDuration),
      csv: () => parseFromCSV(content, settings.defaultDuration),
      srt: () => parseFromSRT(content),
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
      return
    }

    // 정상 처리
    await actions[type]?.()
    setShowImport(false)
  }

  // Handle start — 활성 탭에 따라 이미지/비디오 생성 모드 분기
  const handleStart = async () => {
    // 이미지 자동화 또는 비디오 자동화 중이면 일시정지/재개
    if (isRunning) {
      togglePause()
      return
    }
    if (videoAutomation.isRunning) {
      videoAutomation.togglePause()
      return
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
      case 'text': {
        // 이미지 생성 (기존)
        const hasUngenerated = scenes.some(s => !s.image && !s.imagePath)
        if (!hasUngenerated && scenes.length > 0) {
          toast.warning(t('toast.allScenesGenerated'))
          return
        }
        start({
          projectName,
          saveMode: settings.saveMode,
          concurrency: settings.concurrency || 2,
        })
        break
      }

      case 'video-text': {
        // Text to Video — 선택된 videoScenes만 실행
        const selectedVideoScenes = videoScenes.filter(s => s.selected !== false)
        if (selectedVideoScenes.length === 0) {
          toast.warning(t('videoSelection.noneSelected'))
          return
        }
        videoAutomation.start({
          mode: 't2v',
          scenes: selectedVideoScenes,
          projectName,
          saveMode: settings.saveMode,
          onItemUpdate: (id, newStatus, result) => {
            videoScenesHook.updateVideoScene(id, {
              status: newStatus,
              ...(newStatus === 'generating' ? { generatingStartedAt: Date.now() } : {}),
              ...(result?.base64 ? { video: result.base64 } : {}),
              ...(result?.mediaId ? { mediaId: result.mediaId } : {}),
              ...(result?.videoPath ? { videoPath: result.videoPath } : {}),
              ...(result?.error ? { error: result.error } : {}),
            })
          },
        })
        break
      }

      case 'frame-to-video': {
        // Frame to Video — 선택된 framePairs만 실행
        const selectedFramePairs = framePairs.filter(p => p.selected !== false)
        if (selectedFramePairs.length === 0) {
          toast.warning(t('videoSelection.noneSelected'))
          return
        }
        const resolvedPairs = selectedFramePairs.map(p => {
          const startScene = scenes.find(s => s.id === p.startSceneId)
          const endScene = scenes.find(s => s.id === p.endSceneId)
          return {
            ...p,
            _startMediaId: startScene?.mediaId || null,
            _endMediaId: endScene?.mediaId || null,
          }
        })
        videoAutomation.start({
          mode: 'i2v',
          framePairs: resolvedPairs,
          projectName,
          saveMode: settings.saveMode,
          onItemUpdate: (id, newStatus, result) => {
            setFramePairs(prev => prev.map(p =>
              p.id === id ? {
                ...p, status: newStatus,
                ...(newStatus === 'generating' ? { generatingStartedAt: Date.now() } : {}),
                ...(result || {}),
              } : p
            ))
          },
        })
        break
      }

      case 'ref-to-video': {
        // Refs to Video — 선택된 refPairs만 실행
        const selectedRefPairs = refPairs.filter(p => p.selected !== false)
        if (selectedRefPairs.length === 0) {
          toast.warning(t('videoSelection.noneSelected'))
          return
        }
        const resolvedRefPairs = selectedRefPairs.map(p => ({
          ...p,
          _refMediaIds: (p.refIds || []).map(refId => {
            const ref = references.find(r => r.id === refId || r.name === refId)
            return ref?.mediaId || null
          }).filter(Boolean),
        }))
        videoAutomation.start({
          mode: 'r2v',
          refPairs: resolvedRefPairs,
          projectName,
          saveMode: settings.saveMode,
          onItemUpdate: (id, newStatus, result) => {
            setRefPairs(prev => prev.map(p =>
              p.id === id ? {
                ...p, status: newStatus,
                ...(newStatus === 'generating' ? { generatingStartedAt: Date.now() } : {}),
                ...(result || {}),
              } : p
            ))
          },
        })
        break
      }

      default:
        break
    }
  }

  // Handle stop — 활성 자동화 중지
  const handleStop = () => {
    if (isRunning) stop()
    if (videoAutomation.isRunning) videoAutomation.stop()
  }

  // 어느 자동화든 실행 중이면 true
  const anyRunning = isRunning || videoAutomation.isRunning
  const anyPaused = isPaused || videoAutomation.isPaused
  const currentProgress = videoAutomation.isRunning ? videoAutomation.progress : progress
  const currentStatus = videoAutomation.isRunning ? videoAutomation.status : status
  const currentStatusMessage = videoAutomation.isRunning ? videoAutomation.statusMessage : statusMessage

  return (
    <div className="app">
      <Header
        onSettings={() => openSettings()}
        onExport={handleExportClick}
        hasImages={scenes.some(s => s.image)}
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
            <button
              className={`tab tab-icon ${activeTab === 'ref-to-video' ? 'active' : ''}`}
              onClick={() => setActiveTab('ref-to-video')}
              title={t('tabs.refToVideo')}
            >
              🔗 <span className="tab-label">{t('tabs.refToVideo')}</span>
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
            onClearAll={() => setReferences([])}
            generatingRefs={generatingRefs}
            projectName={settings.projectName}
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
            <>
              <PromptInput
                value={videoScenes.map(s => s.prompt).join('\n')}
                onChange={handleVideoTextChange}
                disabled={anyRunning}
                placeholder={t('prompt.videoPlaceholder')}
              />
              {videoScenes.length > 0 && (
                <SelectablePromptList
                  items={videoScenes}
                  onToggle={videoScenesHook.toggleSelect}
                  onToggleAll={videoScenesHook.toggleSelectAll}
                  disabled={anyRunning}
                />
              )}
            </>
          )}
          {activeTab === 'frame-to-video' && (
            <FrameToVideoPanel
              scenes={scenes}
              framePairs={framePairs}
              onUpdate={setFramePairs}
              disabled={anyRunning}
              t={t}
            />
          )}
          {activeTab === 'ref-to-video' && (
            <RefToVideoPanel
              references={references}
              refPairs={refPairs}
              onUpdate={setRefPairs}
              disabled={anyRunning}
              t={t}
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
                <button
                  className={`btn-primary ${anyRunning ? (anyPaused ? 'paused' : 'running') : ''} ${canExport ? 'half' : ''}`}
                  onClick={handleStart}
                  disabled={
                    (activeTab === 'text' && scenes.length === 0) ||
                    (activeTab === 'video-text' && videoScenes.length === 0) ||
                    (activeTab === 'frame-to-video' && framePairs.length === 0) ||
                    (activeTab === 'ref-to-video' && refPairs.length === 0) ||
                    (activeTab === 'list')
                  }
                >
                  {anyRunning
                    ? (anyPaused ? `▶️ ${t('actions.resume')}` : `⏸️ ${t('actions.pause')}`)
                    : activeTab === 'text' ? `✨ ${t('actions.start')}` : `🎬 ${t('actions.start')}`
                  }
                </button>

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

          {anyRunning && (
            <button className="btn-danger" onClick={handleStop} disabled={isStopping}>
              ⏹️ {isStopping ? t('status.stopping') : t('actions.stop')}
            </button>
          )}

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
          />
        )}
        {activeTab === 'video-text' && (
          <ResultsTable items={videoScenes} mediaType="video" onShowDetail={(item) => setSelectedVideo(item)} />
        )}
        {activeTab === 'frame-to-video' && (
          <ResultsTable items={framePairs} mediaType="frame-pair" onShowDetail={(item) => setSelectedVideo(item)} />
        )}
        {activeTab === 'ref-to-video' && (
          <ResultsTable items={refPairs} mediaType="ref-pair" onShowDetail={(item) => setSelectedVideo(item)} />
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
    </div>
  )
}

export default App
