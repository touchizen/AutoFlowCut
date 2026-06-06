/**
 * SceneTab - 씬 설정 탭
 */

import AspectRatioSelector from './AspectRatioSelector'
import ModelSelector from './ModelSelector'
import { IMAGE_MODELS, VIDEO_MODELS, DEFAULT_IMAGE_MODEL_ID, DEFAULT_VIDEO_MODEL_ID, PRICING_URL } from '../../config/genModels'

// 공식 Veo 지원 해상도. 1080p/4k 는 8초 고정(공식 제약), 720p 는 씬 길이에 맞춰 4/6/8초.
const VIDEO_RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
]

// imageModels/videoModels: 라이브 /models 로 채운 동적 목록(상위에서 주입). 없으면 정적 카탈로그.
export default function SceneTab({ localSettings, setLocalSettings, t, imageModels = IMAGE_MODELS, videoModels = VIDEO_MODELS }) {
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

      {/* 이미지 동시 생성 수 (3~10) */}
      <div className="setting-row">
        <label className="setting-label">{t('settings.concurrency')}</label>
        <div className="threshold-input-group">
          <input
            type="range"
            min="3" max="10" step="1"
            aria-label={t('settings.concurrency')}
            value={localSettings.concurrency || 5}
            onChange={(e) => { const v = parseInt(e.target.value); setLocalSettings(s => ({ ...s, concurrency: v })) }}
          />
          <span className="threshold-value">{localSettings.concurrency || 5}</span>
        </div>
        <span className="setting-sublabel">{t('settings.concurrencyHint')}</span>
      </div>

      {/* 비디오 동시 생성 수 (2~5) */}
      <div className="setting-row">
        <label className="setting-label">{t('settings.videoConcurrency')}</label>
        <div className="threshold-input-group">
          <input
            type="range"
            min="2" max="5" step="1"
            aria-label={t('settings.videoConcurrency')}
            value={localSettings.videoConcurrency || 3}
            onChange={(e) => { const v = parseInt(e.target.value); setLocalSettings(s => ({ ...s, videoConcurrency: v })) }}
          />
          <span className="threshold-value">{localSettings.videoConcurrency || 3}</span>
        </div>
        <span className="setting-sublabel">{t('settings.videoConcurrencyHint')}</span>
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

      {/* 생성 모델 선택 — T2I / T2V / F2V 각각 (옵션마다 특징·비용 표시) */}
      <div className="settings-section">
        <h3>{t('settings.modelImageTitle')}</h3>
        <ModelSelector
          options={imageModels}
          value={localSettings.imageModel}
          defaultValue={DEFAULT_IMAGE_MODEL_ID}
          onChange={(id) => setLocalSettings(s => ({ ...s, imageModel: id }))}
          t={t}
          priceUrl={PRICING_URL}
        />
      </div>
      <div className="settings-section">
        <h3>{t('settings.modelVideoT2VTitle')}</h3>
        <ModelSelector
          options={videoModels}
          value={localSettings.videoModelT2V}
          defaultValue={DEFAULT_VIDEO_MODEL_ID}
          onChange={(id) => setLocalSettings(s => ({ ...s, videoModelT2V: id }))}
          t={t}
          priceUrl={PRICING_URL}
        />
      </div>
      <div className="settings-section">
        <h3>{t('settings.modelVideoF2VTitle')}</h3>
        <ModelSelector
          options={videoModels}
          value={localSettings.videoModelF2V}
          defaultValue={DEFAULT_VIDEO_MODEL_ID}
          onChange={(id) => setLocalSettings(s => ({ ...s, videoModelF2V: id }))}
          t={t}
          priceUrl={PRICING_URL}
        />
      </div>

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
