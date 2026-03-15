/**
 * SceneTab - 씬 설정 탭
 */

const BATCH_OPTIONS = [1, 2, 3, 4]
const RESOLUTION_OPTIONS = [
  { value: '270p', label: '270p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p (HD)' },
  { value: '4k', label: '4K' },
]
const IMAGE_UPSCALE_OPTIONS = [
  { value: 'off', labelKey: 'settings.imageUpscaleOff' },
  { value: '2k', labelKey: 'settings.imageUpscale2k' },
  { value: '4k', labelKey: 'settings.imageUpscale4k' },
]

export default function SceneTab({ localSettings, setLocalSettings, t }) {
  return (
    <div className="tab-panel">
      <div className="setting-row">
        <label className="setting-label">{t('settings.defaultDuration')}</label>
        <input
          type="number"
          value={localSettings.defaultDuration}
          onChange={(e) => setLocalSettings(s => ({ ...s, defaultDuration: parseFloat(e.target.value) || 3 }))}
          min="1" max="30" step="0.5"
        />
        <span className="setting-unit">{t('settings.seconds')}</span>
      </div>

      <div className="setting-row">
        <label className="setting-label">{t('settings.exportThreshold')}</label>
        <div className="threshold-input-group">
          <input
            type="range"
            min="10"
            max="100"
            step="10"
            value={localSettings.exportThreshold || 50}
            onChange={(e) => setLocalSettings(s => ({ ...s, exportThreshold: parseInt(e.target.value) }))}
          />
          <span className="threshold-value">{localSettings.exportThreshold || 50}%</span>
        </div>
        <span className="setting-sublabel">{t('settings.exportThresholdHint')}</span>
      </div>

      {/* 배치 카운트 설정 */}
      <div className="settings-section">
        <h3>{t('settings.batchSettings')}</h3>

        <div className="setting-row">
          <label className="setting-label">{t('settings.imageBatchCount')}</label>
          <div className="batch-selector">
            {BATCH_OPTIONS.map(n => (
              <button
                key={`img-${n}`}
                className={`batch-btn ${(localSettings.imageBatchCount || 1) === n ? 'active' : ''}`}
                onClick={() => setLocalSettings(s => ({ ...s, imageBatchCount: n }))}
              >
                x{n}
              </button>
            ))}
          </div>
          <span className="setting-sublabel">{t('settings.imageBatchHint')}</span>
        </div>

        <div className="setting-row">
          <label className="setting-label">{t('settings.videoBatchCount')}</label>
          <div className="batch-selector">
            {BATCH_OPTIONS.map(n => (
              <button
                key={`vid-${n}`}
                className={`batch-btn ${(localSettings.videoBatchCount || 1) === n ? 'active' : ''}`}
                onClick={() => setLocalSettings(s => ({ ...s, videoBatchCount: n }))}
              >
                x{n}
              </button>
            ))}
          </div>
          <span className="setting-sublabel">{t('settings.videoBatchHint')}</span>
        </div>
      </div>

      {/* 이미지 업스케일 */}
      <div className="settings-section">
        <h3>{t('settings.imageUpscaleSettings')}</h3>

        <div className="setting-row">
          <label className="setting-label">{t('settings.imageUpscale')}</label>
          <div className="batch-selector">
            {IMAGE_UPSCALE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`batch-btn ${(localSettings.imageUpscale || '2k') === opt.value ? 'active' : ''}`}
                onClick={() => setLocalSettings(s => ({ ...s, imageUpscale: opt.value }))}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
          <span className="setting-sublabel">{t('settings.imageUpscaleHint')}</span>
        </div>
      </div>

      {/* 비디오 다운로드 해상도 */}
      <div className="settings-section">
        <h3>{t('settings.videoDownloadSettings')}</h3>

        <div className="setting-row">
          <label className="setting-label">{t('settings.videoResolution')}</label>
          <select
            value={localSettings.videoResolution || '1080p'}
            onChange={(e) => setLocalSettings(s => ({ ...s, videoResolution: e.target.value }))}
          >
            {RESOLUTION_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <span className="setting-sublabel">{t('settings.videoResolutionHint')}</span>
        </div>
      </div>

    </div>
  )
}
