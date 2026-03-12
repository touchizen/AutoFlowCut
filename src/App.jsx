/**
 * Flow2CapCut - Main App (AutoCraft Studio)
 */

import { useState, useEffect } from 'react'
import { DEFAULTS, UI, TIMING } from './config/defaults'
import { useFlowAPI } from './hooks/useFlowAPI'
import { useScenes } from './hooks/useScenes'
import { useAutomation } from './hooks/useAutomation'
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
import ReferencePanel from './components/ReferencePanel'
import SettingsModal from './components/SettingsModal'
import ImportModal from './components/ImportModal'
import StatusBar from './components/StatusBar'
import ResultsTable from './components/ResultsTable'
import SceneDetailModal from './components/SceneDetailModal'
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
  const [activeTab, setActiveTab] = useState('text') // 'text' | 'list'
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState(null) // 설정 모달 초기 탭
  const [showImport, setShowImport] = useState(false)
  const [showReferences, setShowReferences] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [selectedScene, setSelectedScene] = useState(null) // 상세 모달용 선택된 씬
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

  const { scenes, references, parseFromText, parseFromCSV, parseFromSRT, parseReferencesFromCSV, updateReferences, setScenes, setReferences } = scenesHook
  const { isRunning, isPaused, isStopping, progress, status, statusMessage, start, togglePause, stop, retryErrors } = automation

  // Project Data 관리
  const { addPendingSave, handleProjectChange, saveCurrentProject, isRestoringRef } = useProjectData({
    settings, setSettings, scenes, references, setScenes, setReferences, openSettings
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
    settings, scenes, openSettings,
    isAuthenticated,
    subscription,
    onLoginRequired: () => setShowAuthModal(true),
    onPaywallRequired: (reason) => {
      setPaywallReason(reason)
      setShowPaywallModal(true)
    }
  })

  // Auto-save project data when scenes/references change (생성 중 또는 복원 중 아닐 때만)
  useEffect(() => {
    if (generatingRefs.length > 0 || isRunning) return
    if (isRestoringRef?.current) return  // ← 복원 중에는 auto-save 스킵 (project.json 오염 방지)
    if (scenes.length === 0 && references.length === 0) return  // ← 빈 데이터로 덮어쓰기 방지
    if (settings.saveMode === 'folder' && settings.projectName) {
      const timer = setTimeout(async () => {
        if (isRestoringRef?.current) return  // ← 타이머 실행 시점에도 재확인
        await saveCurrentProject()
        console.log('[App] Auto-saved project data')
      }, TIMING.AUTO_SAVE_DEBOUNCE)
      return () => clearTimeout(timer)
    }
  }, [scenes, references, settings.projectName, settings.saveMode, generatingRefs.length, isRunning])

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
  }, [])

  // Handle text input change
  const handleTextChange = (text) => {
    parseFromText(text, settings.defaultDuration)
    localStorage.setItem('flow2capcut_savedPrompts', text)
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

  // Handle start
  const handleStart = async () => {
    if (isRunning) {
      togglePause()
    } else {
      // 모든 씬이 이미 생성된 경우 먼저 체크 (권한 체크 전에!)
      const hasUngenerated = scenes.some(s => !s.image && !s.imagePath)
      if (!hasUngenerated && scenes.length > 0) {
        toast.warning(t('toast.allScenesGenerated'))
        return
      }

      // 폴더 설정 확인만 (권한은 저장 시 체크)
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

      start({
        projectName: settings.projectName || generateProjectName(),
        saveMode: settings.saveMode,
        concurrency: settings.concurrency || 2,
      })
    }
  }

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
        disabled={isRunning || generatingRefs.length > 0}
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
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'text' ? 'active' : ''}`}
              onClick={() => setActiveTab('text')}
            >
              📝 {t('tabs.text')}
            </button>
            <button
              className={`tab ${activeTab === 'list' ? 'active' : ''}`}
              onClick={() => setActiveTab('list')}
            >
              📋 {t('tabs.list')} ({scenes.length})
            </button>
          </div>

          <div className="tabs-actions">
            <button
              className="btn-icon"
              onClick={() => setShowReferences(!showReferences)}
              title={t('tabs.references')}
            >
              🖼️ Ref ({references.length})
            </button>
            <button
              className="btn-icon"
              onClick={() => setShowImport(true)}
              title={t('tabs.import')}
              disabled={isRunning || generatingRefs.length > 0}
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
          {activeTab === 'text' ? (
            <PromptInput
              value={scenes.map(s => s.prompt).join('\n')}
              onChange={handleTextChange}
              disabled={isRunning}
            />
          ) : (
            <SceneList
              scenes={scenes}
              onUpdate={scenesHook.updateScene}
              onDelete={scenesHook.deleteScene}
              onAdd={scenesHook.addScene}
              onClearAll={scenesHook.clearScenes}
              defaultDuration={settings.defaultDuration}
              disabled={isRunning}
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
          {subscription?.status === 'expired' && !isRunning && (
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
            const canExport = hasScenes && hasRun && !isRunning && doneCount >= requiredCount

            return (
              <>
                <button
                  className={`btn-primary ${isRunning ? (isPaused ? 'paused' : 'running') : ''} ${canExport ? 'half' : ''}`}
                  onClick={handleStart}
                  disabled={!hasScenes}
                >
                  {isRunning
                    ? (isPaused ? `▶️ ${t('actions.resume')}` : `⏸️ ${t('actions.pause')}`)
                    : `✨ ${t('actions.start')}`
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

          {isRunning && (
            <button className="btn-danger" onClick={stop} disabled={isStopping}>
              ⏹️ {isStopping ? t('status.stopping') : t('actions.stop')}
            </button>
          )}

          {!isRunning && scenes.some(s => s.status === 'error') && (
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
          progress={progress}
          status={status}
          message={statusMessage}
        />

        <ResultsTable
          scenes={scenes}
          onRetry={(id) => automation.retryScene(id, {
            projectName: settings.projectName || generateProjectName(),
            saveMode: settings.saveMode
          })}
          onShowDetail={(scene) => setSelectedScene(scene)}
        />
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
