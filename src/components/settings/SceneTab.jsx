/**
 * SceneTab - 씬 설정 탭
 */

import AspectRatioSelector from './AspectRatioSelector'
import ModelSelector from './ModelSelector'
import { IMAGE_MODELS, VIDEO_MODELS, DEFAULT_IMAGE_MODEL_ID, DEFAULT_VIDEO_MODEL_ID, PRICING_URL, FLOW_PRICING_URL, defaultImageModelForProvider, defaultVideoModelForProvider, imageModelsForProvider, listSupportedImageProviders, listSupportedVideoProviders, videoModelsForProvider } from '../../config/genModels'
import { DEFAULTS } from '../../config/defaults'
import { isFlowTarget, sourceForStage } from '../../config/appRoute.js'
import { computeImageProviderSwitch } from '../../utils/imageProviderSwitch'
import { targetLabelKey } from '../modeInfo.js'

// provider 선택 UI는 catalog provisional flag가 단일 권위다. Registry에는 fal이 양쪽에
// 등록돼 persisted 설정이 라우팅되지만 real-key smoke 전에는 supported 목록에서 제외된다.
const SUPPORTED_IMAGE_PROVIDERS = listSupportedImageProviders()
const SUPPORTED_IMAGE_PROVIDER_IDS = new Set(SUPPORTED_IMAGE_PROVIDERS)
// video provider 선택 UI는 카탈로그 provisional flag가 단일 권위다. Registry에는 Grok이
// 등록돼 persisted 설정이 라우팅되지만 real-key smoke 전에는 이 목록에서 제외된다.
const SUPPORTED_VIDEO_PROVIDERS = listSupportedVideoProviders()
const SUPPORTED_VIDEO_PROVIDER_IDS = new Set(SUPPORTED_VIDEO_PROVIDERS)

const priceUrlForSource = (source) => {
  if (source === 'flow') return FLOW_PRICING_URL
  if (source === 'api') return PRICING_URL
  return null
}

const priceForSelection = (source, models, selected, fallback) => {
  if (source === 'chatgpt') return 'ChatGPT plan'
  const list = models || []
  const selectedModel = list.find((model) => model.id === selected)
  const fallbackModel = list.find((model) => model.id === fallback)
  return (selectedModel || fallbackModel)?.cost || ''
}

function computeVideoProviderSwitch(settings, stage, newProvider) {
  const modelKey = stage === 't2v' ? 'videoModelT2V' : 'videoModelF2V'
  const currentProvider = settings?.generation?.video?.[stage]?.provider ?? 'google'
  const stageMemory = settings?.modelsByProviderVideo?.[stage] || {}
  const remembered = stageMemory[newProvider]
  const nextModel = remembered ?? defaultVideoModelForProvider(newProvider) ?? undefined

  return {
    [modelKey]: nextModel,
    generation: {
      ...settings?.generation,
      video: {
        ...settings?.generation?.video,
        [stage]: {
          ...settings?.generation?.video?.[stage],
          provider: newProvider,
        },
      },
    },
    modelsByProviderVideo: {
      ...settings?.modelsByProviderVideo,
      [stage]: {
        ...stageMemory,
        [currentProvider]: settings?.[modelKey],
      },
    },
  }
}

// Flow 배치 카운트 옵션(x1~x4). Flow 컴포즈가 한 요청에 여러 장/개를 생성한다.
const BATCH_OPTIONS = [1, 2, 3, 4]

// 공식 Veo 지원 해상도. 1080p/4k 는 8초 고정(공식 제약), 720p 는 씬 길이에 맞춰 4/6/8초.
const VIDEO_RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
]

// imageModels/videoModels: 라이브 /models 로 채운 동적 목록(상위에서 주입). 없으면 정적 카탈로그.
export default function SceneTab({
  localSettings, setLocalSettings, t,
  imageModels = IMAGE_MODELS, videoModels = VIDEO_MODELS,
  imageProviders = SUPPORTED_IMAGE_PROVIDERS, videoProviders = SUPPORTED_VIDEO_PROVIDERS,
  appMode, sessionTarget = 'flow',
}) {
  const route = { mode: appMode, sessionTarget }
  const flowTargetActive = isFlowTarget(route)
  const stageSources = {
    image: sourceForStage(route, 'image'),
    t2v: sourceForStage(route, 't2v'),
    i2v: sourceForStage(route, 'i2v'),
  }
  const providerLabel = (source) => {
    if (source === 'flow') return t(targetLabelKey('flow'))
    if (source === 'chatgpt') return t(targetLabelKey('chatgpt'))
    if (source === 'api') return t('modeInfo.api.name')
    return ''
  }
  const providerBadge = (stage, includeTestId = true) => {
    const source = stageSources[stage]
    if (!source) return null
    return (
      <span
        className={`model-mode-badge model-mode-${source === 'chatgpt' ? 'flow' : source}`}
        data-testid={includeTestId ? `${stage}-provider-badge` : undefined}
      >
        {providerLabel(source)}
      </span>
    )
  }
  const visibleImageProviders = (imageProviders || []).filter((provider) => SUPPORTED_IMAGE_PROVIDER_IDS.has(provider))
  const visibleVideoProviders = (videoProviders || []).filter((provider) => SUPPORTED_VIDEO_PROVIDER_IDS.has(provider))
  const imageProvider = flowTargetActive ? 'google' : (localSettings.generation?.image?.provider ?? 'google')
  const visibleImageModels = imageModelsForProvider(imageProvider, imageModels)
  const imageDefaultModel = defaultImageModelForProvider(imageProvider) ?? DEFAULT_IMAGE_MODEL_ID
  const t2vProvider = flowTargetActive ? 'google' : (localSettings.generation?.video?.t2v?.provider ?? 'google')
  const i2vProvider = flowTargetActive ? 'google' : (localSettings.generation?.video?.i2v?.provider ?? 'google')
  const effectiveVideoModels = (
    (stageSources.t2v === 'api' || stageSources.i2v === 'api') && !(videoModels || []).length
  ) ? VIDEO_MODELS : videoModels
  const t2vModels = videoModelsForProvider(t2vProvider, effectiveVideoModels)
  const i2vModels = videoModelsForProvider(i2vProvider, effectiveVideoModels)
  const t2vDefaultModel = defaultVideoModelForProvider(t2vProvider) ?? DEFAULT_VIDEO_MODEL_ID
  const i2vDefaultModel = defaultVideoModelForProvider(i2vProvider) ?? DEFAULT_VIDEO_MODEL_ID
  const stagePrices = {
    image: priceForSelection(stageSources.image, visibleImageModels, localSettings.imageModel, imageDefaultModel),
    t2v: priceForSelection(stageSources.t2v, t2vModels, localSettings.videoModelT2V, t2vDefaultModel),
    i2v: priceForSelection(stageSources.i2v, i2vModels, localSettings.videoModelF2V, i2vDefaultModel),
  }
  const providerPrice = (stage) => {
    const price = stagePrices[stage]
    if (!price) return null
    return (
      <span className="model-provider-price" data-testid={`${stage}-provider-price`}>
        {price}
      </span>
    )
  }
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

      {/* 이미지/비디오 동시 생성 수 — API 모드 전용. Flow 는 안티봇 페이싱(아래)이 throttle 이라
          동시성 설정이 무의미해 숨긴다. */}
      {!flowTargetActive && (
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

      {/* Flow 안티봇 페이싱 — Flow 모드 전용. 제출 사이 랜덤 대기 min~max(초). 값은 ms 로 저장. */}
      {flowTargetActive && (
        <div className="setting-row">
          <label className="setting-label">{t('settings.flowPacing')}</label>
          <div className="threshold-input-group">
            <input
              type="number"
              min="1" max="60" step="1"
              aria-label={t('settings.flowPacingMin')}
              value={Math.round((localSettings.flowPacingMinMs ?? DEFAULTS.generation.flowPacingMinMs) / 1000)}
              onChange={(e) => {
                const sec = parseInt(e.target.value)
                if (!Number.isFinite(sec)) return
                setLocalSettings(s => ({ ...s, flowPacingMinMs: Math.min(60, Math.max(1, sec)) * 1000 }))
              }}
            />
            <span className="setting-unit">~</span>
            <input
              type="number"
              min="1" max="60" step="1"
              aria-label={t('settings.flowPacingMax')}
              value={Math.round((localSettings.flowPacingMaxMs ?? DEFAULTS.generation.flowPacingMaxMs) / 1000)}
              onChange={(e) => {
                const sec = parseInt(e.target.value)
                if (!Number.isFinite(sec)) return
                setLocalSettings(s => ({ ...s, flowPacingMaxMs: Math.min(60, Math.max(1, sec)) * 1000 }))
              }}
            />
            <span className="setting-unit">{t('settings.seconds')}</span>
          </div>
          <span className="setting-sublabel">{t('settings.flowPacingHint')}</span>
        </div>
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
      {flowTargetActive && (
        <div className="setting-row">
          <label className="setting-label">{t('settings.flowAgentMode')} {providerBadge('image', false)}</label>
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
      {flowTargetActive && (
        <div className="settings-section">
          <h3>{t('settings.batchSettings')} {providerBadge('image', false)}</h3>

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
        <h3>{t('settings.modelImageTitle')} {providerBadge('image')} {providerPrice('image')}</h3>
        {/* 전역 image provider 선택(§5.8) — API 모드에서만(Flow 는 google 전용). 전환 시 provider별 기억 모델 복원 */}
        {appMode !== 'flow' && visibleImageProviders.length > 1 && (
          <div className="batch-count-buttons" role="group" aria-label={t('settings.imageProviderTitle')}>
            {visibleImageProviders.map((p) => {
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
          options={visibleImageModels}
          value={localSettings.imageModel}
          defaultValue={imageDefaultModel}
          onChange={(id) => setLocalSettings(s => ({
            ...s,
            imageModel: id,
            // provider별 모델 기억을 항상 최신으로 (전환 시 복원용)
            modelsByProvider: { ...s.modelsByProvider, [s.generation?.image?.provider ?? 'google']: id },
          }))}
          t={t}
          priceUrl={priceUrlForSource(stageSources.image)}
        />
      </div>
      <div className="settings-section">
        <h3>{t('settings.modelVideoT2VTitle')} {providerBadge('t2v')} {providerPrice('t2v')}</h3>
        {!flowTargetActive && visibleVideoProviders.length > 1 && (
          <div className="batch-count-buttons" role="group" aria-label={t('settings.videoProviderT2VTitle')}>
            {visibleVideoProviders.map((provider) => (
              <button
                key={provider}
                type="button"
                className={`batch-btn ${(localSettings.generation?.video?.t2v?.provider ?? 'google') === provider ? 'active' : ''}`}
                onClick={() => setLocalSettings(s => ({ ...s, ...computeVideoProviderSwitch(s, 't2v', provider) }))}
              >
                {t(`settings.videoProvider_${provider}`)}
              </button>
            ))}
          </div>
        )}
        <ModelSelector
          options={t2vModels}
          value={localSettings.videoModelT2V}
          defaultValue={t2vDefaultModel}
          onChange={(id) => setLocalSettings(s => ({
            ...s,
            videoModelT2V: id,
            modelsByProviderVideo: {
              ...s.modelsByProviderVideo,
              t2v: {
                ...s.modelsByProviderVideo?.t2v,
                [s.generation?.video?.t2v?.provider ?? 'google']: id,
              },
            },
          }))}
          t={t}
          priceUrl={priceUrlForSource(stageSources.t2v)}
        />
      </div>
      <div className="settings-section">
        <h3>{t('settings.modelVideoF2VTitle')} {providerBadge('i2v')} {providerPrice('i2v')}</h3>
        {!flowTargetActive && visibleVideoProviders.length > 1 && (
          <div className="batch-count-buttons" role="group" aria-label={t('settings.videoProviderI2VTitle')}>
            {visibleVideoProviders.map((provider) => (
              <button
                key={provider}
                type="button"
                className={`batch-btn ${(localSettings.generation?.video?.i2v?.provider ?? 'google') === provider ? 'active' : ''}`}
                onClick={() => setLocalSettings(s => ({ ...s, ...computeVideoProviderSwitch(s, 'i2v', provider) }))}
              >
                {t(`settings.videoProvider_${provider}`)}
              </button>
            ))}
          </div>
        )}
        <ModelSelector
          options={i2vModels}
          value={localSettings.videoModelF2V}
          defaultValue={i2vDefaultModel}
          onChange={(id) => setLocalSettings(s => ({
            ...s,
            videoModelF2V: id,
            modelsByProviderVideo: {
              ...s.modelsByProviderVideo,
              i2v: {
                ...s.modelsByProviderVideo?.i2v,
                [s.generation?.video?.i2v?.provider ?? 'google']: id,
              },
            },
          }))}
          t={t}
          priceUrl={priceUrlForSource(stageSources.i2v)}
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
