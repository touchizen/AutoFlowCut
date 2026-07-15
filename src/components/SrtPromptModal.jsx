import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../hooks/useI18n'
import Modal from './Modal'
import './SrtPromptModal.css'

const ENGINES = ['gemini', 'claude', 'codex']

function isRunningStatus(status) {
  return status === 'running' || status === 'cancelling'
}

export default function SrtPromptModal({
  open,
  onClose,
  onGenerate,
  onCancel,
  onRetryFailed,
  onRefreshCapabilities,
  capabilities = {},
  capabilitiesLoading = false,
  targetCount = 0,
  modeATargetCount,
  modeBTargetCount,
  overwriteImpactCount = 0,
  modeBBlocked = false,
  hasExistingImages = false,
  isFolderProject = false,
  styles = [],
  report = {},
}) {
  const { t } = useI18n()
  const [mode, setMode] = useState('A')
  const [engine, setEngine] = useState('gemini')
  const [style, setStyle] = useState('')
  const [onlyEmpty, setOnlyEmpty] = useState(true)
  const [confirmingModeB, setConfirmingModeB] = useState(false)

  const firstAvailableEngine = useMemo(
    () => ENGINES.find((name) => capabilities[name]?.available) || '',
    [capabilities],
  )

  useEffect(() => {
    if (!open) return
    setMode('A')
    setOnlyEmpty(true)
    setConfirmingModeB(false)
  }, [open])

  useEffect(() => {
    if (firstAvailableEngine && !capabilities[engine]?.available) setEngine(firstAvailableEngine)
  }, [capabilities, engine, firstAvailableEngine])

  if (!open) return null

  const running = isRunningStatus(report.status)
  const activeTargetCount = mode === 'B'
    ? (modeBTargetCount ?? targetCount)
    : (modeATargetCount ?? targetCount)
  const modeBUnavailable = modeBBlocked || (modeBTargetCount ?? targetCount) <= 0
  const canGenerate = activeTargetCount > 0
    && Boolean(engine)
    && capabilities[engine]?.available
    && !(mode === 'B' && modeBBlocked)
    && !running

  const submit = () => {
    if (!canGenerate) return
    if (mode === 'B' && !confirmingModeB) {
      setConfirmingModeB(true)
      return
    }
    onGenerate?.({ mode, engine, style, onlyEmpty })
    setConfirmingModeB(false)
  }

  const footer = confirmingModeB ? (
    <>
      <button type="button" onClick={() => setConfirmingModeB(false)}>{t('common.cancel')}</button>
      <button type="button" className="btn-primary" onClick={submit}>{t('srtPrompt.confirm.proceed')}</button>
    </>
  ) : (
    <>
      {!running && (report.failures || []).length > 0 && (
        <button type="button" onClick={onRetryFailed}>{t('srtPrompt.retryFailed')}</button>
      )}
      {running ? (
        <button type="button" className="btn-danger" onClick={onCancel}>{t('srtPrompt.cancelRun')}</button>
      ) : (
        <button type="button" onClick={onClose}>{t('common.cancel')}</button>
      )}
      <button type="button" className="btn-primary" onClick={submit} disabled={!canGenerate}>
        {t('srtPrompt.generate')}
      </button>
    </>
  )

  return (
    <Modal
      isOpen={open}
      onClose={running ? () => {} : onClose}
      title={t('srtPrompt.title')}
      className="srt-prompt-modal"
      footer={footer}
    >
      {confirmingModeB ? (
        <section className="srt-prompt-confirm" role="alert">
          <h4>{t('srtPrompt.confirm.title')}</h4>
          <p>{t('srtPrompt.confirm.description')}</p>
          {hasExistingImages && <p className="warning">{t('srtPrompt.confirm.imageRecommendation')}</p>}
          {!isFolderProject && <p className="warning">{t('srtPrompt.confirm.nonFolderWarning')}</p>}
        </section>
      ) : (
        <div className="srt-prompt-form">
          <fieldset disabled={running}>
            <legend>{t('srtPrompt.mode')}</legend>
            <label>
              <input type="radio" name="srt-prompt-mode" checked={mode === 'A'} onChange={() => setMode('A')} />
              <span>{t('srtPrompt.modeA')}</span>
            </label>
            <small>{t('srtPrompt.modeADescription')}</small>
            <label>
              <input
                type="radio"
                name="srt-prompt-mode"
                checked={mode === 'B'}
                disabled={modeBUnavailable}
                onChange={() => setMode('B')}
              />
              <span>{t('srtPrompt.modeB')}</span>
            </label>
            <small>{modeBUnavailable ? t('srtPrompt.modeBBlocked') : t('srtPrompt.modeBDescription')}</small>
          </fieldset>

          <fieldset disabled={running || capabilitiesLoading}>
            <legend>{t('srtPrompt.engine.title')}</legend>
            {ENGINES.map((name) => {
              const capability = capabilities[name] || { available: false, reason: 'probe_failed' }
              return (
                <div className="srt-prompt-engine" key={name}>
                  <label>
                    <input
                      type="radio"
                      name="srt-prompt-engine"
                      checked={engine === name}
                      disabled={!capability.available}
                      onChange={() => setEngine(name)}
                    />
                    <span>{t(`srtPrompt.engine.${name}`)}</span>
                  </label>
                  {capability.model && <code>{capability.model}</code>}
                  {!capability.available && <small>{t(`srtPrompt.capability.${capability.reason || 'probe_failed'}`)}</small>}
                </div>
              )
            })}
            <button type="button" className="btn-link" onClick={() => onRefreshCapabilities?.(true)} disabled={capabilitiesLoading}>
              {capabilitiesLoading ? t('srtPrompt.capabilitiesLoading') : t('srtPrompt.refreshCapabilities')}
            </button>
          </fieldset>

          <label className="srt-prompt-select">
            <span>{t('srtPrompt.style')}</span>
            <select value={style} onChange={(event) => setStyle(event.target.value)} disabled={running}>
              <option value="">{t('srtPrompt.styleNone')}</option>
              {styles.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
            </select>
          </label>

          <fieldset disabled={running}>
            <legend>{t('srtPrompt.overwrite')}</legend>
            <label>
              <input type="radio" name="srt-prompt-overwrite" checked={onlyEmpty} onChange={() => setOnlyEmpty(true)} />
              <span>{t('srtPrompt.emptyOnly')}</span>
            </label>
            <label>
              <input type="radio" name="srt-prompt-overwrite" checked={!onlyEmpty} onChange={() => setOnlyEmpty(false)} />
              <span>{t('srtPrompt.overwriteAll')}</span>
            </label>
            {!onlyEmpty && <small>{t('srtPrompt.overwriteImpact', { count: overwriteImpactCount })}</small>}
          </fieldset>

          <p className="srt-prompt-targets">{t('srtPrompt.targets', { count: activeTargetCount })}</p>

          {isRunningStatus(report.status) && report.currentChunk != null && (
            <p role="status" className="srt-prompt-progress">
              {t('srtPrompt.progress', {
                current: report.currentChunk + 1,
                total: report.totalChunks,
                from: report.currentSceneRange?.from ?? '?',
                to: report.currentSceneRange?.to ?? '?',
              })}
            </p>
          )}
          {(report.failures || []).length > 0 && (
            <div className="srt-prompt-report srt-prompt-failures" role="alert">
              <strong>{t('srtPrompt.report.failures')}</strong>
              <ul>{report.failures.map((failure, index) => <li key={`${failure.chunkIndex}-${index}`}>{failure.error}</li>)}</ul>
            </div>
          )}
          {['stale', 'blocked'].includes(report.status) && (
            <p className="srt-prompt-report warning" role="alert">
              {t(`srtPrompt.report.${report.status}`)}
            </p>
          )}
          {report.unsaved && <p className="srt-prompt-report warning">{t('srtPrompt.report.unsaved')}</p>}
          {report.error && <p className="srt-prompt-report warning">{report.error}</p>}
          {report.skipped > 0 && <p className="srt-prompt-report">{t('srtPrompt.skipped', { count: report.skipped })}</p>}
        </div>
      )}
    </Modal>
  )
}
