import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../hooks/useI18n'
import { useAuth } from '../contexts/AuthContext'
import { useExportSettingsContext } from '../contexts/ExportSettingsContext'
import { useModalVisibility } from '../hooks/useModalVisibility'
import { fileSystemAPI } from '../hooks/useFileSystem'
import { normalizeExportFormat } from '../utils/exportFormat'
import { formatExpiryDate, formatElapsedMs } from '../utils/formatters'
import { toKenBurnsRatios } from '../utils/kenBurnsPreview'
import './ExportModal.css'

// 경로 프리셋 정의
const PATH_PRESETS = {
  mac: [
    { value: 'capcut', label: 'CapCut', template: (u, p) => `/Users/${u}/Movies/CapCut/User Data/Projects/com.lveditor.draft/${p}` },
    { value: 'custom', label: 'Custom' }
  ],
  windows: [
    { value: 'capcut', label: 'CapCut', template: (u, p) => `C:\\Users\\${u}\\AppData\\Local\\CapCut\\User Data\\Projects\\com.lveditor.draft\\${p}` },
    { value: 'capcutpro', label: 'CapCut Pro', template: (u, p) => `C:\\Users\\${u}\\AppData\\Local\\CapCutPro\\User Data\\Projects\\com.lveditor.draft\\${p}` },
    { value: 'capcut_docs', label: 'Documents', template: (u, p) => `C:\\Users\\${u}\\Documents\\CapCut\\Projects\\${p}` },
    { value: 'custom', label: 'Custom' }
  ]
}

// 포맷 카드 — CapCut / Premiere 공통 프리젠테이셔널. details(children)만 포맷별로 다름.
function FormatCard({ icon, title, description, children }) {
  return (
    <div className="export-format-card selected">
      <div className="format-header">
        <span className="format-icon">{icon}</span>
        <div className="format-info">
          <h3>{title}</h3>
          <p className="format-description">{description}</p>
        </div>
      </div>
      <div className="format-details">{children}</div>
    </div>
  )
}

export const ExportModal = ({
  isOpen,
  onClose,
  onExport,
  onExportPremiere,
  onExportVrew,
  onExportRender,
  onCancelRender,
  renderProgress,
  renderStartedAt,
  initialFormat = 'capcut',
  projectName,
  loading,
  exportPhase,
  hasSubtitles,
  onUpgradeClick,
}) => {
  const { t, lang } = useI18n()
  const { isAuthenticated, subscription } = useAuth()
  const { settings, isLoaded, saveSettings, updateSetting } = useExportSettingsContext()
  const {
    scaleMode,
    renderMode,
    kenBurns,
    kenBurnsMode,
    kenBurnsScaleMin,
    kenBurnsScaleMax,
  } = settings

  // OS 감지 (기본값 결정용)
  const detectedMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

  // 내보내기 포맷 — 'capcut'(기본) | 'premiere' | 'vrew' | 'render'.
  // CapCut 은 draft 폴더 경로 + 설치확인 + 앱 실행, Premiere 는 프로젝트 폴더에
  // .prproj 자동 저장(경로 UI 불필요). Scale/KenBurns/자막 옵션은 공유.
  const [format, setFormat] = useState(() => normalizeExportFormat(initialFormat))

  // Premiere 출력 폴더 — localStorage 가 비어도 ensurePermission(config 복원/기본폴더)
  // 으로 해소될 수 있으므로 resolver 결과를 state 로 들고 표시/가드에 사용.
  const [premiereWorkFolder, setPremiereWorkFolder] = useState(() => localStorage.getItem('workFolderPath') || '')

  const [username, setUsername] = useState('')
  const [projectNumber, setProjectNumber] = useState('')
  const [fullPath, setFullPath] = useState('')
  const [pathPreset, setPathPreset] = useState('capcut')
  const [pathManuallyEdited, setPathManuallyEdited] = useState(false)
  const [pathCopied, setPathCopied] = useState(false)
  const [includeSubtitle, setIncludeSubtitle] = useState(true)
  const [renderBurnSubtitle, setRenderBurnSubtitle] = useState(true)
  const [kenBurnsCycle, setKenBurnsCycle] = useState(5)
  const [selectedOS, setSelectedOS] = useState(detectedMac ? 'mac' : 'windows')
  const [detectedBasePath, setDetectedBasePath] = useState('')  // 감지된 CapCut basePath

  // 현재 OS에 해당하는 프리셋 목록
  const currentPresets = PATH_PRESETS[selectedOS] || PATH_PRESETS.windows
  const didInitRef = useRef(false)

  // 저장된 설정 로드
  useEffect(() => {
    if (!isLoaded || didInitRef.current) return
    didInitRef.current = true
    setIncludeSubtitle(settings.includeSubtitle !== false)
    setRenderBurnSubtitle(settings.renderBurnSubtitle !== false)
    setKenBurnsCycle(settings.kenBurnsCycle || 5)
    // pathPreset 로드
    setPathPreset(settings.pathPreset || 'capcut')
  }, [isLoaded, settings])

  // 모달 열릴 때 진입에서 고른 포맷으로 초기화 (모달은 unmount 안 되므로 useState 초기값만으론 부족).
  // useLayoutEffect — paint 전 동기 적용해 "이전 탭이 한 프레임 보이는" 깜빡임 방지.
  useLayoutEffect(() => {
    if (isOpen) setFormat(normalizeExportFormat(initialFormat))
  }, [isOpen, initialFormat])

  // 모달 열릴 때 시스템 정보 자동 감지
  useEffect(() => {
    if (!isOpen) return

    async function autoDetect() {
      try {
        // 0. Premiere 출력 폴더 확보 — localStorage 가 비어도 config/기본폴더에서 복원.
        //    (CapCut 도 미디어 경로에 workFolder 를 쓰므로 무해)
        try {
          await fileSystemAPI.ensurePermission()
        } catch (e) {
          console.warn('[ExportModal] ensurePermission failed:', e?.message)
        }
        setPremiereWorkFolder(localStorage.getItem('workFolderPath') || '')

        // 1. 시스템 정보 (username, platform)
        if (window.electronAPI?.getSystemInfo) {
          const info = await window.electronAPI.getSystemInfo()
          if (info.success) {
            setUsername(info.username)
            setSelectedOS(info.platform === 'darwin' ? 'mac' : 'windows')
          }
        }

        // 2. CapCut 경로 자동 감지
        if (window.electronAPI?.detectCapcutPath) {
          const pathResult = await window.electronAPI.detectCapcutPath()
          if (pathResult.success && pathResult.basePath) {
            setDetectedBasePath(pathResult.basePath)

            // 3. 다음 프로젝트 번호 자동 계산
            if (window.electronAPI?.getNextProjectNumber) {
              const numResult = await window.electronAPI.getNextProjectNumber({ basePath: pathResult.basePath })
              if (numResult.success && numResult.folderName) {
                setProjectNumber(numResult.folderName)
              }
            }
          }
        }
      } catch (error) {
        console.warn('[ExportModal] Auto-detect failed:', error)
      }
    }

    autoDetect()
  }, [isOpen])

  // 전체 경로 자동 생성: detectedBasePath 기반 또는 프리셋 기반
  const generatePath = () => {
    if (!projectNumber) return ''

    // detectedBasePath가 있으면 그것 기반으로 생성
    if (detectedBasePath && pathPreset === 'capcut') {
      const sep = selectedOS === 'mac' ? '/' : '\\'
      return `${detectedBasePath}${sep}${projectNumber}`
    }

    // 프리셋 템플릿 기반 생성
    if (!username) return ''
    const preset = currentPresets.find(p => p.value === pathPreset)
    if (preset?.template) {
      return preset.template(username, projectNumber)
    }
    return '' // custom은 빈 문자열 (사용자 직접 입력)
  }

  // username, projectNumber, OS, pathPreset 변경 시 자동 경로 업데이트
  useEffect(() => {
    if (pathPreset !== 'custom' && !pathManuallyEdited) {
      setFullPath(generatePath())
    }
  }, [username, projectNumber, selectedOS, pathPreset, detectedBasePath])

  // OS 변경 시 해당 OS에 없는 프리셋이면 capcut으로 리셋
  useEffect(() => {
    const presets = PATH_PRESETS[selectedOS] || PATH_PRESETS.windows
    const exists = presets.some(p => p.value === pathPreset)
    if (!exists) {
      setPathPreset('capcut')
      setPathManuallyEdited(false)
    }
  }, [selectedOS])

  // 모달 열릴 때 Flow 뷰 숨기기 (네이티브 레이어는 CSS z-index로 가릴 수 없음)
  useModalVisibility(isOpen)

  // 렌더 중 경과 시간 실시간 갱신(1초 tick). early return 앞 — hook 순서 고정.
  const renderBusyForTick = format === 'render' && (loading || exportPhase === 'rendering')
  const [renderNowTick, setRenderNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!renderBusyForTick || !renderStartedAt) return undefined
    setRenderNowTick(Date.now())
    const id = setInterval(() => setRenderNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [renderBusyForTick, renderStartedAt])

  if (!isOpen) return null

  // Premiere 출력 — 프로젝트 폴더(`${workFolder}/${projectName}`)에 `${projectName}.prproj` 자동 저장.
  // 작업 폴더는 이미지 생성 시점에 강제되므로 export 시점엔 항상 존재(방어용으로만 빈값 처리).
  const safeProjectName = projectName || 'untitled'
  const premiereOutputFolder = `${premiereWorkFolder}/${safeProjectName}`
  const premiereTargetPath = `${premiereOutputFolder}/${safeProjectName}.prproj`
  const vrewOutputFolder = `${premiereWorkFolder}/${safeProjectName}`
  const vrewTargetPath = `${vrewOutputFolder}/${safeProjectName}.vrew`

  // 포맷 공통 옵션 — CapCut/Premiere 콜백에 동일하게 전달.
  const buildExportOptions = () => {
    const { mode, scaleMin, scaleMax } = toKenBurnsRatios({
      kenBurnsMode,
      kenBurnsScaleMin,
      kenBurnsScaleMax,
    })

    return {
      scaleMode,  // 'fill' | 'fit' | 'none'
      kenBurns,
      kenBurnsMode: mode,
      kenBurnsScaleMin: scaleMin,
      kenBurnsScaleMax: scaleMax,
      kenBurnsCycle: Number(kenBurnsCycle) || 5,
      subtitleOption: hasSubtitles && includeSubtitle ? 'ko' : 'none',
      renderMode,
      renderBurnSubtitle,
    }
  }

  const persistOptions = () => {
    saveSettings({
      pathPreset,
      includeSubtitle,
      renderBurnSubtitle,
      kenBurnsCycle: Number(kenBurnsCycle) || 5,
    })
  }

  // Premiere — 프로젝트 폴더에 .prproj 자동 저장. 경로 검증/설치확인/앱실행 단계 없음.
  // CapCut 은 폴더 번호 자동증가라 충돌이 없지만, Premiere 는 파일명이 고정이라
  // 기존 .prproj 가 있으면 덮어쓰기 전에 확인 (Premiere 에서 손본 내용 보호).
  const handleExportPremiere = async () => {
    if (!premiereWorkFolder) {
      alert(t('exportModal.premiereWorkFolderRequired'))
      return
    }
    // Premiere Pro 설치 확인 — 미설치 시 다운로드 페이지 안내 (CapCut/Vrew 패턴).
    // Premiere 는 MS Store 미등재라 store 딥링크 없음 → appx 빌드는 외부링크 금지(정책)라
    // 안내 텍스트만, 그 외(nsis/mac)는 confirm 후 다운로드 페이지 열기.
    if (window.electronAPI?.checkPremiereInstalled) {
      const inst = await window.electronAPI.checkPremiereInstalled()
      if (!inst?.installed) {
        if (__BUILD_TARGET__ === 'appx') {
          alert(t('exportModalExtra.premiereNotInstalled'))
        } else if (window.confirm(t('exportModalExtra.premiereNotInstalledConfirm'))) {
          window.electronAPI.openExternal?.('https://www.adobe.com/products/premiere.html')
        }
        return
      }
    }
    // checkFolderExists 는 내부적으로 fs.access(pathExists) 라 파일에도 동작 — .prproj 존재 확인에 재사용.
    const existing = await window.electronAPI?.checkFolderExists?.({ folderPath: premiereTargetPath })
    if (existing?.exists && !window.confirm(t('exportModal.premiereOverwriteConfirm'))) {
      return
    }
    persistOptions()
    onExportPremiere({
      capcutProjectNumber: premiereOutputFolder,  // .prproj 를 쓸 출력 폴더
      ...buildExportOptions()
    })
  }

  const handleExportVrew = async () => {
    // Vrew 미설치 시 다운로드 안내 (CapCut 설치확인 패턴 미러). MS Store 미배포 → 다운로드 페이지.
    if (window.electronAPI?.checkVrewInstalled) {
      try {
        const result = await window.electronAPI.checkVrewInstalled()
        if (!result.installed) {
          if (__BUILD_TARGET__ === 'appx') {
            // MS Store(appx) 빌드: 외부 다운로드 링크 유도 금지(스토어 정책) → 안내 텍스트만.
            // Vrew 는 MS Store 미배포라 CapCut 처럼 store 딥링크도 못 줌.
            alert(t('exportModalExtra.vrewNotInstalledStore'))
          } else if (window.confirm(t('exportModalExtra.vrewNotInstalled'))) {
            window.electronAPI.openExternal?.('https://vrew.voyagerx.com/')
          }
          return
        }
      } catch (err) {
        console.warn('[ExportModal] Vrew install check failed:', err)
        // 체크 실패 시 export 막지 않음
      }
    }

    if (!premiereWorkFolder) {
      alert(t('exportModal.premiereWorkFolderRequired'))
      return
    }
    const existing = await window.electronAPI?.checkFolderExists?.({ folderPath: vrewTargetPath })
    if (existing?.exists && !window.confirm(t('exportModal.vrewOverwriteConfirm'))) {
      return
    }
    persistOptions()
    onExportVrew?.({
      capcutProjectNumber: vrewOutputFolder,
      ...buildExportOptions()
    })
  }

  const handleExport = async () => {
    if (format === 'render') {
      persistOptions()
      await onExportRender?.(buildExportOptions())
      return
    }
    if (format === 'premiere') {
      await handleExportPremiere()
      return
    }
    if (format === 'vrew') {
      await handleExportVrew()
      return
    }

    // 필수 입력 검증
    if (!fullPath.trim()) {
      alert(t('exportModalExtra.pathRequired'))
      return
    }

    // CapCut 설치 확인 (Custom 경로가 아닌 경우에만)
    if (pathPreset !== 'custom' && window.electronAPI?.checkCapcutInstalled) {
      try {
        const result = await window.electronAPI.checkCapcutInstalled()
        if (!result.installed) {
          const wantDownload = window.confirm(t('exportModalExtra.capcutNotInstalled'))
          if (wantDownload) {
            const url = __BUILD_TARGET__ === 'appx'
              ? 'ms-windows-store://pdp/?ProductId=XP9KN75RRB9NHS'
              : 'https://www.capcut.com/download'
            window.electronAPI.openExternal(url)
          }
          return
        }
      } catch (err) {
        console.warn('[ExportModal] CapCut install check failed:', err)
        // Don't block export on check failure
      }
    }

    // 설정 저장
    persistOptions()

    onExport({
      capcutProjectNumber: fullPath,  // 전체 경로 (자동 생성 또는 수동 편집)
      ...buildExportOptions()
    })
  }

  const isRenderBusy = format === 'render' && (loading || exportPhase === 'rendering')
  const renderElapsedMs = isRenderBusy && renderStartedAt ? Math.max(0, renderNowTick - renderStartedAt) : 0
  const progressNumber = Number(renderProgress?.percent)
  const renderPercent = Number.isFinite(progressNumber)
    ? Math.min(100, Math.max(0, Math.round(progressNumber)))
    : 0

  return createPortal(
    <div className="export-modal-overlay" onClick={loading || isRenderBusy ? undefined : onClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        {/* 로딩 오버레이 */}
        {(loading || isRenderBusy) && (
          <div className="export-loading-overlay">
            <div className="export-loading-content">
              {isRenderBusy ? (
                <>
                  <p>{t('exportModal.renderProgress')}</p>
                  <div
                    className="render-progress-bar"
                    role="progressbar"
                    aria-label={t('exportModal.renderProgress')}
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={renderPercent}
                  >
                    <div className="render-progress-fill" style={{ width: `${renderPercent}%` }} />
                  </div>
                  <span className="render-progress-percent">
                    {renderPercent}%
                    {renderStartedAt != null && <span className="render-progress-elapsed"> · {t('exportModal.renderElapsed', { time: formatElapsedMs(renderElapsedMs) })}</span>}
                  </span>
                  <button
                    type="button"
                    className="export-btn export-btn-cancel render-cancel-btn"
                    onClick={onCancelRender}
                  >
                    {t('exportModal.renderCancel')}
                  </button>
                </>
              ) : (
                <>
                  <div className="export-loading-spinner"></div>
                  <p>{exportPhase === 'launching'
                    ? (format === 'premiere'
                      ? t('exportModal.premiereLaunching')
                      : format === 'vrew'
                        ? t('exportModal.vrewLaunching')
                        : t('exportModal.launchingCapcut'))
                    : (format === 'premiere'
                      ? t('exportModal.premiereExporting')
                      : format === 'vrew'
                        ? t('exportModal.vrewExporting')
                        : t('exportModal.preparingPackage'))
                  }</p>
                  <span className="export-loading-hint">{exportPhase === 'launching'
                    ? (format === 'premiere'
                      ? t('exportModal.premiereLaunchingHint')
                      : format === 'vrew'
                        ? t('exportModal.vrewLaunchingHint')
                        : t('exportModal.launchingHint'))
                    : t('exportModal.pleaseWait')
                  }</span>
                </>
              )}
            </div>
          </div>
        )}
        <div className="export-modal-header">
          <div className="header-title-wrap">
            <h2>📦 {format === 'premiere'
              ? t('exportModal.premiereTitle')
              : format === 'vrew'
                ? t('exportModal.vrewTitle')
                : format === 'render'
                  ? t('exportModal.renderTitle')
                  : t('exportModal.title')}</h2>
            {/* 'loading' 상태에서 0/0 garbage 가 새는 걸 막기 위해 trial/expired 만 명시.
                useExport gateway 가 loading 윈도우엔 모달을 안 열지만, defense in depth. */}
            {format !== 'render' && isAuthenticated && (subscription.status === 'trial' || subscription.status === 'expired') && (
              <span className="header-trial-badge">
                🎁 {t('exportModal.trialBadge', { exports: subscription.exportsRemaining, days: subscription.daysRemaining })}
              </span>
            )}
            {isAuthenticated && subscription.status === 'active' && subscription.expiresAt && (
              <span className="header-pro-badge">
                {subscription.plan === 'yearly' ? '👑' : '💎'} Pro ~{formatExpiryDate(subscription.expiresAt, lang)}
              </span>
            )}
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="export-modal-content">
          {/* 포맷 선택 세그먼트 — 가능한 내보내기 포맷을 항상 노출 (발견성) */}
          <div className="export-format-tabs" role="group" aria-label={t('exportModal.formatSelectLabel')}>
            <button
              type="button"
              className={`export-format-tab ${format === 'capcut' ? 'active' : ''}`}
              aria-pressed={format === 'capcut'}
              onClick={() => setFormat('capcut')}
            >
              ✂️ CapCut
            </button>
            <button
              type="button"
              className={`export-format-tab ${format === 'premiere' ? 'active' : ''}`}
              aria-pressed={format === 'premiere'}
              onClick={() => setFormat('premiere')}
            >
              🎬 Premiere
            </button>
            <button
              type="button"
              className={`export-format-tab ${format === 'vrew' ? 'active' : ''}`}
              aria-pressed={format === 'vrew'}
              onClick={() => setFormat('vrew')}
            >
              📝 Vrew
            </button>
            <button
              type="button"
              className={`export-format-tab ${format === 'render' ? 'active' : ''}`}
              aria-pressed={format === 'render'}
              onClick={() => setFormat('render')}
            >
              🎞️ {t('exportModal.renderTab')}
            </button>
          </div>

          {format === 'capcut' ? (
            <FormatCard icon="✂️" title={t('exportModal.capcutPackage')} description={t('exportModal.capcutPackageDesc')}>
              <p>{t('exportModal.zipDesc')}</p>
              <div className="format-output">
                <span className="output-label">{t('exportModal.output')}</span>
                <code>{projectName || 'untitled'}_capcut.zip</code>
              </div>
            </FormatCard>
          ) : format === 'premiere' ? (
            <FormatCard icon="🎬" title={t('exportModal.premierePackage')} description={t('exportModal.premierePackageDesc')}>
              <p>{t('exportModal.premiereSaveDesc')}</p>
              {premiereWorkFolder ? (
                <div className="format-output">
                  <span className="output-label">📁 {t('exportModal.premiereSaveLocation')}</span>
                  <code style={{ wordBreak: 'break-all' }}>{premiereTargetPath}</code>
                </div>
              ) : (
                // 작업 폴더 미설정 — 가짜 경로 대신 안내. Export 버튼도 비활성(사후 alert 보다 사전 차단).
                <p className="option-hint">📁 {t('exportModal.premiereWorkFolderRequired')}</p>
              )}
            </FormatCard>
          ) : format === 'render' ? (
            <FormatCard icon="🎞️" title={t('exportModal.renderPackage')} description={t('exportModal.renderPackageDesc')}>
              <fieldset className="render-mode-options">
                <legend>{t('exportModal.renderMode')}</legend>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="render-mode"
                    value="preview"
                    checked={renderMode === 'preview'}
                    onChange={(e) => updateSetting('renderMode', e.target.value)}
                  />
                  <span>{t('exportModal.renderModePreview')}</span>
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="render-mode"
                    value="final"
                    checked={renderMode === 'final'}
                    onChange={(e) => updateSetting('renderMode', e.target.value)}
                  />
                  <span>{t('exportModal.renderModeFinal')}</span>
                </label>
              </fieldset>
              <label className="checkbox-label render-subtitle-option">
                <input
                  type="checkbox"
                  checked={renderBurnSubtitle}
                  onChange={(e) => setRenderBurnSubtitle(e.target.checked)}
                />
                <span>{t('exportModal.renderBurnSubtitle')}</span>
              </label>
              <p className="option-hint">{t('exportModal.renderBurnSubtitleHint')}</p>
            </FormatCard>
          ) : (
            <FormatCard icon="📝" title={t('exportModal.vrewPackage')} description={t('exportModal.vrewPackageDesc')}>
              <p>{t('exportModal.vrewSaveDesc')}</p>
              {premiereWorkFolder ? (
                <div className="format-output">
                  <span className="output-label">📁 {t('exportModal.premiereSaveLocation')}</span>
                  <code style={{ wordBreak: 'break-all' }}>{vrewTargetPath}</code>
                </div>
              ) : (
                <p className="option-hint">📁 {t('exportModal.premiereWorkFolderRequired')}</p>
              )}
            </FormatCard>
          )}

          {/* ── CapCut 전용: 경로/번호/프리셋 (Premiere/Vrew 는 프로젝트 폴더 자동 저장) ── */}
          {format === 'capcut' && (<>
          {/* 자동 감지된 설정 (사용자명 + 프로젝트 번호) */}
          <div className="export-option-section">
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.85em', color: '#888' }}>
                {selectedOS === 'mac' ? '🍎 macOS' : '🪟 Windows'} • 👤 {username || '...'}
              </span>
            </div>

            {/* CapCut 프로젝트 번호 (자동 감지, 수정 가능) */}
            <label className="option-label">
              📁 {t('exportModal.projectNumber')}
            </label>
            <input
              type="text"
              placeholder={t('exportModal.projectNumberPlaceholder')}
              value={projectNumber}
              onChange={(e) => setProjectNumber(e.target.value)}
              className="folder-input"
            />
            <p className="option-hint">
              💡 {t('exportModal.projectNumberHint')} ({t('exportModalExtra.autoDetected')})
            </p>
          </div>

          {/* 생성될 경로 미리보기 + 프리셋 선택 */}
          {fullPath && (
            <div className="export-option-section" style={{ background: pathPreset === 'custom' || pathManuallyEdited ? '#e8eaf6' : '#e8f4e8', padding: '10px 12px', borderRadius: '6px', border: `1px solid ${pathPreset === 'custom' || pathManuallyEdited ? '#5c6bc0' : '#4caf50'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="option-label" style={{ fontSize: '0.85em', color: pathPreset === 'custom' || pathManuallyEdited ? '#303f9f' : '#2e7d32', fontWeight: 'bold' }}>
                  📂 {t('exportModal.generatedPath')} {pathManuallyEdited && '✏️'}
                </label>
                {pathManuallyEdited && pathPreset !== 'custom' && (
                  <button
                    type="button"
                    onClick={() => { setPathManuallyEdited(false); setFullPath(generatePath()) }}
                    style={{ fontSize: '0.75em', padding: '2px 8px', border: '1px solid #999', borderRadius: '4px', background: '#fff', cursor: 'pointer', color: '#666' }}
                  >
                    ↺ Reset
                  </button>
                )}
              </div>
              {/* 프리셋 선택 버튼 */}
              <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                {currentPresets.map(preset => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      setPathPreset(preset.value)
                      setPathManuallyEdited(false)
                      if (preset.template) {
                        setFullPath(preset.template(username, projectNumber))
                      }
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.78em',
                      border: pathPreset === preset.value ? '2px solid #1976d2' : '1px solid #bbb',
                      borderRadius: '14px',
                      background: pathPreset === preset.value ? '#e3f2fd' : '#fff',
                      color: pathPreset === preset.value ? '#1565c0' : '#555',
                      cursor: 'pointer',
                      fontWeight: pathPreset === preset.value ? '600' : '400',
                      transition: 'all 0.15s'
                    }}
                  >
                    {preset.value === 'custom' ? (t('exportModal.pathPresetCustom') || preset.label) : preset.label}
                  </button>
                ))}
              </div>
              {/* 경로 입력 */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' }}>
                <input
                  type="text"
                  value={fullPath}
                  onChange={(e) => { setFullPath(e.target.value); setPathManuallyEdited(true) }}
                  placeholder={pathPreset === 'custom' ? t('exportModal.customPathPlaceholder') : ''}
                  className="folder-input"
                  style={{ flex: 1, fontSize: '0.85em', wordBreak: 'break-all', color: '#1a1a1a', fontWeight: '500', background: '#fff', border: '1px solid #ccc' }}
                />
                <button
                  type="button"
                  data-tooltip-top={t('exportModal.copyPathTooltip')}
                  onClick={() => {
                    const parentPath = fullPath.split(/[/\\]/).slice(0, -1).join(selectedOS === 'mac' ? '/' : '\\')
                    navigator.clipboard.writeText(parentPath)
                    setPathCopied(true)
                    setTimeout(() => setPathCopied(false), 2000)
                  }}
                  style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', cursor: 'pointer', fontSize: '0.9em', whiteSpace: 'nowrap' }}
                >
                  {pathCopied ? '✅' : '📋'}
                </button>
              </div>
            </div>
          )}

          {/* 경로 가이드 — 프리셋에 없는 경로 검색용 (custom일 때만 표시) */}
          {pathPreset === 'custom' && (
            <div className="export-option-section" style={{ background: '#f5f5f5', padding: '10px 12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.8em', color: '#666' }}>
              <p style={{ margin: '0 0 6px 0', fontSize: '0.9em', color: '#795548' }}>
                💡 {selectedOS === 'mac' ? t('exportModal.macPathSearch') : t('exportModal.winPathSearch')}
              </p>
              <code style={{ display: 'block', background: '#fff', padding: '6px 8px', borderRadius: '4px', fontSize: '0.9em', wordBreak: 'break-all', color: '#333', userSelect: 'all', cursor: 'text' }}>
                {selectedOS === 'mac' ? t('exportModal.macSearchCmd') : t('exportModal.winSearchCmd')}
              </code>
            </div>
          )}
          </>)}

          {/* Scale Mode 옵션 */}
          <div className="export-option-section">
            <label className="option-label">
              🔍 {t('exportModal.scaleMode')}
            </label>
            <select
              value={scaleMode}
              onChange={(e) => updateSetting('scaleMode', e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #444', background: '#1a1a1a', color: '#fff', fontSize: '0.9rem' }}
            >
              <option value="fill">📐 Fill - {t('exportModal.scaleFill')}</option>
              <option value="fit">📏 Fit - {t('exportModal.scaleFit')}</option>
              <option value="none">🖼️ None - {t('exportModal.scaleNone')}</option>
            </select>
            <p className="option-hint">
              {scaleMode === 'fill' && t('exportModal.scaleFillHint')}
              {scaleMode === 'fit' && t('exportModal.scaleFitHint')}
              {scaleMode === 'none' && t('exportModal.scaleNoneHint')}
            </p>
          </div>

          {/* Ken Burns 효과 옵션 */}
          <div className="export-option-section">
            <label className="checkbox-label" title={t('exportModal.kenBurnsTooltip')}>
              <input
                type="checkbox"
                checked={kenBurns}
                onChange={(e) => updateSetting('kenBurns', e.target.checked)}
              />
              <span>🎬 {t('exportModal.kenBurns')}</span>
            </label>
            <p className="option-hint" style={{ marginLeft: '24px' }}>
              {t('exportModal.kenBurnsHint')}
            </p>
            {kenBurns && (
              <div style={{ marginLeft: '24px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={kenBurnsMode}
                    onChange={(e) => updateSetting('kenBurnsMode', e.target.value)}
                    style={{ padding: '4px 8px', borderRadius: '4px' }}
                    title={t('exportModal.kenBurnsModeTooltip')}
                  >
                    <option value="random">🎲 {t('exportModal.kenBurnsModeRandom')}</option>
                    <option value="pattern">🎯 {t('exportModal.kenBurnsModePattern')}</option>
                  </select>
                  {format !== 'render' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={t('exportModal.kenBurnsCycleTooltip')}>
                      <span>{t('exportModal.kenBurnsCycle')}</span>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={kenBurnsCycle}
                        onChange={(e) => setKenBurnsCycle(e.target.value)}
                        style={{ width: '50px', padding: '4px', borderRadius: '4px', border: '1px solid #ccc' }}
                      />
                      <span>{t('exportModal.kenBurnsCycleUnit')}</span>
                    </div>
                  )}
                </div>
                {/* 스케일 범위 입력 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }} title={t('exportModal.kenBurnsScaleTooltip')}>
                  <span>🔍 {t('exportModal.kenBurnsScale')}</span>
                  <input
                    type="number"
                    min="100"
                    max="150"
                    value={kenBurnsScaleMin}
                    onChange={(e) => updateSetting('kenBurnsScaleMin', e.target.value)}
                    style={{ width: '55px', padding: '4px', borderRadius: '4px', border: '1px solid #ccc', textAlign: 'center' }}
                  />
                  <span>~</span>
                  <input
                    type="number"
                    min="100"
                    max="150"
                    value={kenBurnsScaleMax}
                    onChange={(e) => updateSetting('kenBurnsScaleMax', e.target.value)}
                    style={{ width: '55px', padding: '4px', borderRadius: '4px', border: '1px solid #ccc', textAlign: 'center' }}
                  />
                  <span>%</span>
                </div>
              </div>
            )}
          </div>

          {/* 자막 옵션 - 자막이 있을 때만 표시 */}
          {hasSubtitles && format !== 'render' && (
            <div className="export-option-section">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={includeSubtitle}
                  onChange={(e) => setIncludeSubtitle(e.target.checked)}
                />
                <span>💬 {t('exportModal.includeSubtitle')}</span>
              </label>
              <p className="option-hint" style={{ marginLeft: '24px' }}>
                {t('exportModal.includeSubtitleHint')}
              </p>
            </div>
          )}

          {/* Info — CapCut import 가이드 (Premiere 는 카드의 저장 위치 안내로 충분) */}
          {format === 'capcut' && (
          <div className="export-info">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 style={{ margin: 0 }}>📊 {t('exportModal.importGuide')}</h4>
              <button
                type="button"
                onClick={() => window.open('https://touchizen.github.io/guide/ko/autoflowcut/capcut-export.html', '_blank')}
                style={{
                  padding: '4px 10px',
                  fontSize: '0.8em',
                  background: '#007AFF',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                📖 {t('exportModal.guideBtn')}
              </button>
            </div>
            <ul>
              <li>✅ {t('exportModal.importStep1')}</li>
              <li>✅ {t('exportModal.importStep2')}</li>
              <li style={{ fontSize: '0.85em', color: '#333', fontWeight: '500' }}>
                {selectedOS === 'mac' ? '🍎' : '🪟'} {t('exportModal.importStep3Path')}
              </li>
              <li>✅ {t('exportModal.importStep4')}</li>
            </ul>
            <p className="export-tip" style={{ marginTop: '10px', fontSize: '0.8em', color: '#666', background: '#f5f5f5', padding: '8px 10px', borderRadius: '4px' }}>
              💡 <strong>Tip:</strong> {t('exportModal.autoDownloadTip')}
            </p>
          </div>
          )}
        </div>

        <div className="export-modal-footer">
          <div className="export-actions">
            {/* 왼쪽: 구독 정보 및 업그레이드 버튼 */}
            <div className="export-actions-left">
              {/* 'loading' 윈도우엔 upgrade 버튼도 노출 금지 — 다른 사용자 권한 잔상 차단 */}
              {isAuthenticated && (subscription.status === 'trial' || subscription.status === 'expired') && (
              <button
                className="export-btn export-btn-upgrade"
                onClick={onUpgradeClick}
              >
                ⭐ {t('exportModal.upgradeBtn')}
              </button>
            )}
            </div>

            {/* 오른쪽: 취소/내보내기 버튼 */}
            <div className="export-actions-right">
              <button className="export-btn export-btn-cancel" onClick={onClose}>
                {t('exportModal.cancel')}
              </button>
              <button
                className="export-btn export-btn-export"
                onClick={handleExport}
                disabled={loading || isRenderBusy || ((format === 'premiere' || format === 'vrew') && !premiereWorkFolder)}
              >
                {loading
                  ? `⏳ ${t('exportModal.exporting')}`
                  : format === 'render'
                    ? `🎞️ ${t('actions.exportRender')}`
                    : `📦 ${t('exportModal.export')}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
