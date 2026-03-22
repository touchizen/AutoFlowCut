import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../hooks/useI18n'
import { useAuth } from '../contexts/AuthContext'
import { useExportSettings } from '../hooks/useExportSettings'
import { formatExpiryDate } from '../utils/formatters'
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

export const ExportModal = ({ isOpen, onClose, onExport, projectName, loading, exportPhase, hasSubtitles, onUpgradeClick }) => {
  const { t, lang } = useI18n()
  const { isAuthenticated, subscription } = useAuth()
  const { settings: savedSettings, isLoaded, saveSettings } = useExportSettings()

  // OS 감지 (기본값 결정용)
  const detectedMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

  const [username, setUsername] = useState('')
  const [projectNumber, setProjectNumber] = useState('')
  const [fullPath, setFullPath] = useState('')
  const [pathPreset, setPathPreset] = useState('capcut')
  const [pathManuallyEdited, setPathManuallyEdited] = useState(false)
  const [pathCopied, setPathCopied] = useState(false)
  const [scaleMode, setScaleMode] = useState('none')
  const [includeSubtitle, setIncludeSubtitle] = useState(true)
  const [kenBurns, setKenBurns] = useState(true)
  const [kenBurnsMode, setKenBurnsMode] = useState('random')
  const [kenBurnsCycle, setKenBurnsCycle] = useState(5)
  const [kenBurnsScaleMin, setKenBurnsScaleMin] = useState(100)
  const [kenBurnsScaleMax, setKenBurnsScaleMax] = useState(130)
  const [selectedOS, setSelectedOS] = useState(detectedMac ? 'mac' : 'windows')
  const [detectedBasePath, setDetectedBasePath] = useState('')  // 감지된 CapCut basePath

  // 현재 OS에 해당하는 프리셋 목록
  const currentPresets = PATH_PRESETS[selectedOS] || PATH_PRESETS.windows

  // 저장된 설정 로드
  useEffect(() => {
    if (isLoaded) {
      setScaleMode(savedSettings.scaleMode || 'none')
      setIncludeSubtitle(savedSettings.includeSubtitle !== false)
      setKenBurns(savedSettings.kenBurns !== false)
      setKenBurnsMode(savedSettings.kenBurnsMode || 'random')
      setKenBurnsCycle(savedSettings.kenBurnsCycle || 5)
      setKenBurnsScaleMin(savedSettings.kenBurnsScaleMin || 100)
      setKenBurnsScaleMax(savedSettings.kenBurnsScaleMax || 130)
      // pathPreset 로드
      setPathPreset(savedSettings.pathPreset || 'capcut')
    }
  }, [isLoaded, savedSettings])

  // 모달 열릴 때 시스템 정보 자동 감지
  useEffect(() => {
    if (!isOpen) return

    async function autoDetect() {
      try {
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
  useEffect(() => {
    if (!isOpen) return
    window.electronAPI?.setModalVisible?.({ visible: true })
    return () => {
      window.electronAPI?.setModalVisible?.({ visible: false })
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleExport = async () => {
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
            window.electronAPI.openExternal('https://www.capcut.com/download')
          }
          return
        }
      } catch (err) {
        console.warn('[ExportModal] CapCut install check failed:', err)
        // Don't block export on check failure
      }
    }

    // 설정 저장
    saveSettings({
      pathPreset,
      scaleMode,
      includeSubtitle,
      kenBurns,
      kenBurnsMode,
      kenBurnsCycle: Number(kenBurnsCycle) || 5,
      kenBurnsScaleMin: Number(kenBurnsScaleMin) || 100,
      kenBurnsScaleMax: Number(kenBurnsScaleMax) || 130,
    })

    onExport({
      capcutProjectNumber: fullPath,  // 전체 경로 (자동 생성 또는 수동 편집)
      scaleMode,  // 'fill' | 'fit' | 'none'
      kenBurns,
      kenBurnsMode,
      kenBurnsCycle: Number(kenBurnsCycle) || 5,
      kenBurnsScaleMin: Number(kenBurnsScaleMin) / 100 || 1.0,  // % → 비율
      kenBurnsScaleMax: Number(kenBurnsScaleMax) / 100 || 1.15,  // % → 비율
      subtitleOption: hasSubtitles && includeSubtitle ? 'ko' : 'none'
    })
  }

  return createPortal(
    <div className="export-modal-overlay" onClick={loading ? undefined : onClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        {/* 로딩 오버레이 */}
        {loading && (
          <div className="export-loading-overlay">
            <div className="export-loading-content">
              <div className="export-loading-spinner"></div>
              <p>{exportPhase === 'launching'
                ? t('exportModal.launchingCapcut')
                : t('exportModal.preparingPackage')
              }</p>
              <span className="export-loading-hint">{exportPhase === 'launching'
                ? t('exportModal.launchingHint')
                : t('exportModal.pleaseWait')
              }</span>
            </div>
          </div>
        )}
        <div className="export-modal-header">
          <div className="header-title-wrap">
            <h2>📦 {t('exportModal.title')}</h2>
            {isAuthenticated && subscription.status !== 'active' && (
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
          <div className="export-format-card selected">
            <div className="format-header">
              <span className="format-icon">✂️</span>
              <div className="format-info">
                <h3>{t('exportModal.capcutPackage')}</h3>
                <p className="format-description">{t('exportModal.capcutPackageDesc')}</p>
              </div>
            </div>
            <div className="format-details">
              <p>{t('exportModal.zipDesc')}</p>
              <div className="format-output">
                <span className="output-label">{t('exportModal.output')}</span>
                <code>{projectName || 'untitled'}_capcut.zip</code>
              </div>
            </div>
          </div>

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

          {/* Scale Mode 옵션 */}
          <div className="export-option-section">
            <label className="option-label">
              🔍 {t('exportModal.scaleMode')}
            </label>
            <select
              value={scaleMode}
              onChange={(e) => setScaleMode(e.target.value)}
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
                onChange={(e) => setKenBurns(e.target.checked)}
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
                    onChange={(e) => setKenBurnsMode(e.target.value)}
                    style={{ padding: '4px 8px', borderRadius: '4px' }}
                    title={t('exportModal.kenBurnsModeTooltip')}
                  >
                    <option value="random">🎲 {t('exportModal.kenBurnsModeRandom')}</option>
                    <option value="pattern">🎯 {t('exportModal.kenBurnsModePattern')}</option>
                  </select>
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
                </div>
                {/* 스케일 범위 입력 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }} title={t('exportModal.kenBurnsScaleTooltip')}>
                  <span>🔍 {t('exportModal.kenBurnsScale')}</span>
                  <input
                    type="number"
                    min="100"
                    max="150"
                    value={kenBurnsScaleMin}
                    onChange={(e) => setKenBurnsScaleMin(e.target.value)}
                    style={{ width: '55px', padding: '4px', borderRadius: '4px', border: '1px solid #ccc', textAlign: 'center' }}
                  />
                  <span>~</span>
                  <input
                    type="number"
                    min="100"
                    max="150"
                    value={kenBurnsScaleMax}
                    onChange={(e) => setKenBurnsScaleMax(e.target.value)}
                    style={{ width: '55px', padding: '4px', borderRadius: '4px', border: '1px solid #ccc', textAlign: 'center' }}
                  />
                  <span>%</span>
                </div>
              </div>
            )}
          </div>

          {/* 자막 옵션 - 자막이 있을 때만 표시 */}
          {hasSubtitles && (
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

          {/* Info */}
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
        </div>

        <div className="export-modal-footer">
          <div className="export-actions">
            {/* 왼쪽: 구독 정보 및 업그레이드 버튼 */}
            <div className="export-actions-left">
              {isAuthenticated && subscription.status !== 'active' && (
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
                disabled={loading}
              >
                {loading ? `⏳ ${t('exportModal.exporting')}` : `📦 ${t('exportModal.export')}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
