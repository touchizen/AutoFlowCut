import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../hooks/useI18n'
import { computeUpscaylTargets } from '../utils/imagePatch'
import Modal from './Modal'
import './UpscaylDialog.css'

const OPTIONS_KEY = 'upscaylOptions'
const DEFAULT_OPTIONS = { model: 'ultrasharp-4x', scale: 4 }

function loadOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY))
    return {
      model: typeof saved?.model === 'string' ? saved.model : DEFAULT_OPTIONS.model,
      scale: saved?.scale === 2 || saved?.scale === 4 ? saved.scale : DEFAULT_OPTIONS.scale,
    }
  } catch {
    return DEFAULT_OPTIONS
  }
}

function rendererPlatform(detectState) {
  if (detectState?.platform) return detectState.platform
  const nav = globalThis.navigator
  const value = `${nav?.platform || ''} ${nav?.userAgent || ''}`.toLowerCase()
  if (value.includes('mac')) return 'darwin'
  if (value.includes('win')) return 'win32'
  return 'linux'
}

export default function UpscaylDialog({
  isOpen,
  onClose,
  targetSceneIds,
  upscayl,
  detectState,
  onDetect,
  onLocate,
}) {
  const { t } = useI18n()
  const [options, setOptions] = useState(loadOptions)
  const [started, setStarted] = useState(false)
  const models = detectState?.ok ? (detectState.models || []) : []
  const hasDetectedModels = !!detectState?.ok && models.length > 0
  const effectiveModel = !hasDetectedModels || models.includes(options.model)
    ? options.model
    : (models.includes(DEFAULT_OPTIONS.model) ? DEFAULT_OPTIONS.model : models[0])
  const targetInfo = useMemo(
    () => computeUpscaylTargets(upscayl?.scenes, targetSceneIds),
    [upscayl?.scenes, targetSceneIds],
  )

  useEffect(() => {
    if (isOpen) setStarted(false)
  }, [isOpen])

  useEffect(() => {
    if (!hasDetectedModels) return
    if (effectiveModel === options.model) return
    setOptions((previous) => ({ ...previous, model: effectiveModel }))
  }, [hasDetectedModels, effectiveModel, options.model])

  useEffect(() => {
    if (!hasDetectedModels) return
    localStorage.setItem(OPTIONS_KEY, JSON.stringify({ ...options, model: effectiveModel }))
  }, [hasDetectedModels, effectiveModel, options])

  if (!isOpen) return null

  const running = !!upscayl?.running
  const done = started && !running
  const failed = upscayl?.failures?.length || 0
  const completed = upscayl?.completed || 0
  const unprocessed = Math.max(0, (upscayl?.total || 0) - completed - failed)

  const handleStart = () => {
    const selected = { model: effectiveModel, scale: options.scale }
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(selected))
    setStarted(true)
    void upscayl?.startBatch?.(targetSceneIds, selected)
  }

  let body
  let footer

  if (running) {
    body = (
      <div className="upscayl-running" role="status">
        <div className="upscayl-progress-value">{upscayl.current} / {upscayl.total}</div>
        <progress value={upscayl.current} max={Math.max(1, upscayl.total)} />
        <p>{t('upscayl.current', { scene: upscayl.currentSceneId || upscayl.current })}</p>
      </div>
    )
    footer = <button className="btn-danger" onClick={() => upscayl?.cancel?.()}>{t('upscayl.cancel')}</button>
  } else if (done) {
    body = (
      <div className="upscayl-done" role="status">
        <h4>{t('upscayl.done')}</h4>
        <p>{t('upscayl.doneSummary', { completed, fail: failed, skipped: upscayl?.skipped || 0 })}</p>
        {upscayl?.cancelled && <p>{t('upscayl.cancelledSummary', { count: unprocessed })}</p>}
        {upscayl?.stopped && <p>{t('upscayl.stoppedSummary', { count: unprocessed })}</p>}
        {failed > 0 && (
          <ul>
            {upscayl.failures.map((failure) => (
              <li key={failure.sceneId}>{failure.sceneId}: {failure.error}</li>
            ))}
          </ul>
        )}
      </div>
    )
    footer = <button className="btn-primary" onClick={onClose}>{t('common.close')}</button>
  } else if (!detectState || detectState.loading) {
    body = <div className="upscayl-checking" role="status">{t('upscayl.checking')}</div>
    footer = <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
  } else if (!detectState.ok) {
    const reasonKey = detectState.reason === 'no-models' ? 'noModels' : 'notInstalled'
    const platform = rendererPlatform(detectState)
    const hintKey = platform === 'darwin' ? 'installHintMac' : platform === 'win32' ? 'installHintWindows' : 'installHintLinux'
    body = (
      <div className="upscayl-missing">
        <p className="upscayl-state-message">{t(`upscayl.${reasonKey}`)}</p>
        <p>{t(`upscayl.${hintKey}`)}</p>
        <div className="upscayl-missing-actions">
          <button className="btn-primary" onClick={() => window.electronAPI?.openExternal?.('https://upscayl.org')}>
            {t('upscayl.openWebsite')}
          </button>
          <button className="btn-secondary" onClick={onLocate}>{t('upscayl.locate')}</button>
          <button className="btn-secondary" onClick={onDetect}>{t('upscayl.recheck')}</button>
        </div>
      </div>
    )
    footer = <button className="btn-secondary" onClick={onClose}>{t('common.close')}</button>
  } else {
    const targetLabel = t(targetInfo.targets.length === 1 ? 'upscayl.targetOne' : 'upscayl.targetMany', {
      count: targetInfo.targets.length,
    })
    body = (
      <div className="upscayl-options">
        <label>
          <span>{t('upscayl.model')}</span>
          <select
            aria-label={t('upscayl.model')}
            value={effectiveModel}
            onChange={(event) => setOptions((previous) => ({ ...previous, model: event.target.value }))}
          >
            {models.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>
        <fieldset>
          <legend>{t('upscayl.scale')}</legend>
          {[2, 4].map((scale) => (
            <label key={scale}>
              <input
                type="radio"
                name="upscayl-scale"
                value={scale}
                checked={options.scale === scale}
                onChange={() => setOptions((previous) => ({ ...previous, scale }))}
              />
              {scale}x
            </label>
          ))}
        </fieldset>
        <p className="upscayl-target-summary">
          {targetLabel} · {t('upscayl.alreadyUpscaled', { count: targetInfo.alreadyUpscaled })} · {t('upscayl.skippedNoFile', { count: targetInfo.skippedNoFile })}
        </p>
      </div>
    )
    footer = (
      <>
        <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn-primary" onClick={handleStart} disabled={targetInfo.targets.length === 0 || models.length === 0}>
          {t('upscayl.start')}
        </button>
      </>
    )
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={running ? undefined : onClose}
      title={t('upscayl.title')}
      footer={footer}
      className="upscayl-dialog"
    >
      {body}
    </Modal>
  )
}
