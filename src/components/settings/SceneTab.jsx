/**
 * SceneTab - 씬 설정 탭
 */

import AspectRatioSelector from './AspectRatioSelector'

// 공식 Veo 지원 해상도. 1080p/4k 는 8초 고정(공식 제약), 720p 는 씬 길이에 맞춰 4/6/8초.
const VIDEO_RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
]

export default function SceneTab({ localSettings, setLocalSettings, t }) {
  return (
    <div className="tab-panel">
      {/* 프로젝트 화면비: 롱폼(16:9) / 숏폼(9:16) — 생성·카드·CapCut export 에 반영 */}
      <div className="setting-row">
        <label className="setting-label">{t('settings.aspectRatio')}</label>
        <AspectRatioSelector
          value={localSettings.aspectRatio}
          onChange={(ratio) => setLocalSettings(s => ({ ...s, aspectRatio: ratio }))}
          t={t}
        />
        <span className="setting-sublabel">{t('settings.aspectRatioHint')}</span>
      </div>

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

      {/* 스타일 필수 설정 */}
      <div className="setting-row">
        <label className="setting-label">{t('settings.requireStyle')}</label>
        <div className="batch-selector">
          <button
            className={`batch-btn ${!localSettings.requireStyle ? 'active' : ''}`}
            onClick={() => setLocalSettings(s => ({ ...s, requireStyle: false }))}
          >
            OFF
          </button>
          <button
            className={`batch-btn ${localSettings.requireStyle ? 'active' : ''}`}
            onClick={() => setLocalSettings(s => ({ ...s, requireStyle: true }))}
          >
            ON
          </button>
        </div>
        <span className="setting-sublabel">{t('settings.requireStyleHint')}</span>
      </div>

      {/*
        배치 카운트(이미지/비디오) · 이미지 업스케일(2k/4k) 컨트롤은 공식 API(BYOK)
        에서 동작하지 않아 제거: Gemini 이미지는 호출당 1장(batchCount 무효), 이미지
        업스케일은 Flow DOM 전용(공식 API 대응물 없음). 비디오 해상도는 공식 Veo 가
        지원하므로 아래에 유지·연결한다.
      */}

      {/* 비디오 해상도 (공식 Veo: 720p/1080p/4k) */}
      <div className="settings-section">
        <h3>{t('settings.videoResolution')}</h3>
        <div className="setting-row">
          <div className="batch-selector">
            {VIDEO_RESOLUTION_OPTIONS.map(r => (
              <button
                key={r.value}
                className={`batch-btn ${(localSettings.videoResolution || '720p') === r.value ? 'active' : ''}`}
                onClick={() => setLocalSettings(s => ({ ...s, videoResolution: r.value }))}
              >
                {r.label}
              </button>
            ))}
          </div>
          <span className="setting-sublabel">{t('settings.videoResolutionHint')}</span>
        </div>
      </div>
    </div>
  )
}
