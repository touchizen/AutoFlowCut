/**
 * SceneTab - 씬 설정 탭
 */

import AspectRatioSelector from './AspectRatioSelector'

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
        배치 카운트(이미지/비디오) · 이미지 업스케일(2k/4k) · 비디오 다운로드 해상도
        컨트롤은 공식 API(BYOK) 전환으로 동작하지 않아 제거했다:
          - Gemini 이미지: 호출당 1장 (batchCount 무효)
          - Veo: operation 당 1개, 모델 고정 해상도 (videoBatchCount/해상도 무효)
          - 이미지 업스케일: Flow DOM 전용 기능 (공식 API 대응물 없음 → no-op)
        잘못된 기대를 주지 않도록 UI 에서 노출하지 않는다.
      */}
    </div>
  )
}
