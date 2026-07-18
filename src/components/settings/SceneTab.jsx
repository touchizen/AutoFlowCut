/**
 * SceneTab - 씬 설정 탭
 */

import AspectRatioSelector from './AspectRatioSelector'
import ModelSelector from './ModelSelector'
import { IMAGE_MODELS, VIDEO_MODELS, DEFAULT_IMAGE_MODEL_ID, DEFAULT_VIDEO_MODEL_ID, PRICING_URL, FLOW_PRICING_URL } from '../../config/genModels'
import { computeImageProviderSwitch } from '../../utils/imageProviderSwitch'

// 전역 image provider 선택지(§5.8). video provider(grok 등)는 M2, 씬별 override 는 M3.
const IMAGE_PROVIDERS = ['google', 'openai']

// Flow 배치 카운트 옵션(x1~x4). Flow 컴포즈가 한 요청에 여러 장/개를 생성한다.
const BATCH_OPTIONS = [1, 2, 3, 4]

// 공식 Veo 지원 해상도. 1080p/4k 는 8초 고정(공식 제약), 720p 는 씬 길이에 맞춰 4/6/8초.
const VIDEO_RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
]

// imageModels/videoModels: 라이브 /models 로 채운 동적 목록(상위에서 주입). 없으면 정적 카탈로그.
export default function SceneTab({ localSettings, setLocalSettings, t, imageModels = IMAGE_MODELS, videoModels = VIDEO_MODELS, appMode }) {
  // 모델 출처 구분 배지 — Flow 모드면 Flow 패널(동적), 그 외 API(BYOK) 모델임을 타이틀에 표시.
  const modeBadge = appMode
    ? <span className={`model-mode-badge model-mode-${appMode}`}>{appMode === 'flow' ? 'Flow' : 'API'}</span>
    : null
  // Flow 모드는 Gemini 구독 기반 → 구독 페이지. API(BYOK) 모드는 종량제 → API 과금 페이지.
  const priceUrl = appMode === 'flow' ? FLOW_PRICING_URL : PRICING_URL
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

      {/* 이미지/비디오 동시 생성 수 — API 모드 전용. Flow 는 20~40초 안티봇 페이싱이 throttle 이라
          동시성 설정이 무의미해 숨긴다. */}
      {appMode !== 'flow' && (
        <>
          {/* 이미지 동시 생성 수 (1~15) */}
          <div className="setting-row">
            <label className="setting-label">{t('settings.concurrency')}</label>
            <div className="threshold-input-group">
              <input
                type="range"
                min="1" max="15" step="1"
                aria-label={t('settings.concurrency')}
                value={localSettings.concurrency || 5}
                onChange={(e) => { const v = parseInt(e.target.value); setLocalSettings(s => ({ ...s, concurrency: v })) }}
              />
              <span className="threshold-value">{localSettings.concurrency || 5}</span>
            </div>
            <span className="setting-sublabel">{t('settings.concurrencyHint')}</span>
          </div>

          {/* 비디오 동시 생성 수 (1~10) */}
          <div className="setting-row">
            <label className="setting-label">{t('settings.videoConcurrency')}</label>
            <div className="threshold-input-group">
              <input
                type="range"
                min="1" max="10" step="1"
                aria-label={t('settings.videoConcurrency')}
                value={localSettings.videoConcurrency || 4}
                onChange={(e) => { const v = parseInt(e.target.value); setLocalSettings(s => ({ ...s, videoConcurrency: v })) }}
              />
              <span className="threshold-value">{localSettings.videoConcurrency || 4}</span>
            </div>
            <span className="setting-sublabel">{t('settings.videoConcurrencyHint')}</span>
          </div>
        </>
      )}

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

      {/* Flow Agent (Maps 그라운딩) — Flow 모드 전용. ON 이면 Agent ON 경로(주소 기반 생성). */}
      {appMode === 'flow' && (
        <div className="setting-row">
          <label className="setting-label">{t('settings.flowAgentMode')} {modeBadge}</label>
          <div className="batch-selector">
            <button
              data-testid="flow-agent-off"
              className={`batch-btn ${!localSettings.flowAgentOn ? 'active' : ''}`}
              onClick={() => setLocalSettings(s => ({ ...s, flowAgentOn: false }))}
            >
              OFF
            </button>
            <button
              data-testid="flow-agent-on"
              className={`batch-btn ${localSettings.flowAgentOn ? 'active' : ''}`}
              onClick={() => setLocalSettings(s => ({ ...s, flowAgentOn: true }))}
            >
              ON
            </button>
          </div>
          <span className="setting-sublabel">{t('settings.flowAgentModeHint')}</span>
        </div>
      )}

      {/* 배치 카운트(이미지/비디오) — Flow 모드 전용. Flow 컴포즈는 한 요청에 x1~x4 를
          생성하고 Flow 경로(useSceneGeneration/engineFlow/useReferenceGeneration)가
          settings.imageBatchCount/videoBatchCount 를 그대로 사용한다. API(BYOK)에선
          Gemini=호출당 1장 / Veo=operation당 1개라 무의미 → 숨김. 회귀 가드: SceneTab.test.jsx
          (#5d8a349 에서 API-only 시절 통째 삭제됐다가 dual-mode 로 복원된 이력). */}
      {appMode === 'flow' && (
        <div className="settings-section">
          <h3>{t('settings.batchSettings')} {modeBadge}</h3>

          <div className="setting-row">
            <label className="setting-label">{t('settings.imageBatchCount')}</label>
            <div className="batch-selector">
              {BATCH_OPTIONS.map(n => (
                <button
                  key={`img-${n}`}
                  data-testid={`image-batch-${n}`}
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
                  data-testid={`video-batch-${n}`}
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
      )}

      {/* 생성 모델 선택 — T2I / T2V / F2V 각각 (옵션마다 특징·비용 표시) */}
      <div className="settings-section">
        <h3>{t('settings.modelImageTitle')} {modeBadge}</h3>
        {/* 전역 image provider 선택(§5.8) — API 모드에서만(Flow 는 google 전용). 전환 시 provider별 기억 모델 복원 */}
        {appMode !== 'flow' && (
          <div className="batch-count-buttons" role="group" aria-label={t('settings.imageProviderTitle')}>
            {IMAGE_PROVIDERS.map((p) => {
              const active = (localSettings.generation?.image?.provider ?? 'google') === p
              return (
                <button
                  key={p}
                  type="button"
                  className={`batch-btn ${active ? 'active' : ''}`}
                  onClick={() => setLocalSettings(s => ({ ...s, ...computeImageProviderSwitch(s, p) }))}
                >
                  {t(`settings.imageProvider_${p}`)}
                </button>
              )
            })}
          </div>
        )}
        <ModelSelector
          options={imageModels}
          value={localSettings.imageModel}
          defaultValue={DEFAULT_IMAGE_MODEL_ID}
          onChange={(id) => setLocalSettings(s => ({
            ...s,
            imageModel: id,
            // provider별 모델 기억을 항상 최신으로 (전환 시 복원용)
            modelsByProvider: { ...s.modelsByProvider, [s.generation?.image?.provider ?? 'google']: id },
          }))}
          t={t}
          priceUrl={priceUrl}
        />
      </div>
      <div className="settings-section">
        <h3>{t('settings.modelVideoT2VTitle')} {modeBadge}</h3>
        <ModelSelector
          options={videoModels}
          value={localSettings.videoModelT2V}
          defaultValue={DEFAULT_VIDEO_MODEL_ID}
          onChange={(id) => setLocalSettings(s => ({ ...s, videoModelT2V: id }))}
          t={t}
          priceUrl={priceUrl}
        />
      </div>
      <div className="settings-section">
        <h3>{t('settings.modelVideoF2VTitle')} {modeBadge}</h3>
        <ModelSelector
          options={videoModels}
          value={localSettings.videoModelF2V}
          defaultValue={DEFAULT_VIDEO_MODEL_ID}
          onChange={(id) => setLocalSettings(s => ({ ...s, videoModelF2V: id }))}
          t={t}
          priceUrl={priceUrl}
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
