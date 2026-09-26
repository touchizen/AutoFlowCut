import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  defaultImageModelForProvider,
  defaultVideoModelForProvider,
} from '../config/genModels'

const IMAGE_PROVIDER_IDS = new Set(IMAGE_MODELS.map(model => model.provider))
const VIDEO_PROVIDER_IDS = new Set(VIDEO_MODELS.map(model => model.provider))

export function isKnownImageProvider(provider) {
  return typeof provider === 'string' && IMAGE_PROVIDER_IDS.has(provider)
}

export function isKnownVideoProvider(provider) {
  return typeof provider === 'string' && VIDEO_PROVIDER_IDS.has(provider)
}

export function getGlobalImageProvider(settings = {}) {
  return settings?.generation?.image?.provider ?? 'google'
}

export function getGlobalVideoProvider(settings = {}, stage = 't2v') {
  return settings?.generation?.video?.[stage]?.provider ?? 'google'
}

function sceneLabel(scene) {
  return scene?.id ?? scene?._sceneNum ?? 'unknown'
}

function resolveProvider({ scene, sceneProvider, globalProvider, kind, isKnown }) {
  const safeGlobal = isKnown(globalProvider) ? globalProvider : 'google'
  if (sceneProvider == null || isKnown(sceneProvider)) {
    return { provider: sceneProvider ?? safeGlobal }
  }
  return {
    provider: safeGlobal,
    warning: `Unknown ${kind} provider '${sceneProvider}' on scene '${sceneLabel(scene)}'; using global provider '${safeGlobal}'.`,
  }
}

// main 병합(리뷰 A F1): Flow 모드는 씬 override(scene.generation)를 쓰지 않는다 — Flow 는 google(Flow 컴포저) 하나이고, 모델은 설정의
//   Flow 모델 이름이어야 Flow 설정 패널 드라이버의 정확 일치(electron/flow-composer-settings.js)에 맞는다. override 의 API 모델 id 가
//   드라이버로 가면 이미지는 flow-image-model-mismatch 로 거부되고, 영상은 배치 전체 거부로 번져 override 없는 씬까지 닫힌다.
//   API 모드는 아래 규칙 그대로(options 생략 = API).
export function resolveSceneImageProvider(scene, settings = {}, { appMode } = {}) {
  if (appMode === 'flow') return { provider: 'google', model: settings?.imageModel }
  const sceneStage = scene?.generation?.image
  const globalProvider = getGlobalImageProvider(settings)
  const resolved = resolveProvider({
    scene,
    sceneProvider: sceneStage?.provider,
    globalProvider,
    kind: 'image',
    isKnown: isKnownImageProvider,
  })
  // F1(Fable): global provider 면 활성 선택 imageModel 을 modelsByProvider 슬롯보다 우선한다 —
  // 슬롯은 provider-전환 메모리라 imageModel 과 어긋날 수 있다(flow 슬롯 오염·heal 불일치). override
  // 없는 씬은 pre-M3 처럼 정확히 settings.imageModel 로 제출돼야(하위호환). 비-global provider 만 슬롯 사용.
  const model = (resolved.warning ? undefined : sceneStage?.model)
    ?? (resolved.provider === globalProvider ? settings?.imageModel : undefined)
    ?? settings?.modelsByProvider?.[resolved.provider]
    ?? defaultImageModelForProvider(resolved.provider)

  return resolved.warning
    ? { provider: resolved.provider, model, warning: resolved.warning }
    : { provider: resolved.provider, model }
}

export function resolveSceneVideoProvider(scene, settings = {}, stage = 't2v', { appMode } = {}) {
  if (appMode === 'flow') return { provider: 'google', model: stage === 'i2v' ? settings?.videoModelF2V : settings?.videoModelT2V }   // 위 F1 과 같은 규칙
  const sceneStage = scene?.generation?.video?.[stage]
  const globalProvider = getGlobalVideoProvider(settings, stage)
  const resolved = resolveProvider({
    scene,
    sceneProvider: sceneStage?.provider,
    globalProvider,
    kind: `video.${stage}`,
    isKnown: isKnownVideoProvider,
  })
  // F1(Fable): global provider 면 활성 선택(videoModelT2V/F2V)을 슬롯 메모리보다 우선(하위호환).
  const model = (resolved.warning ? undefined : sceneStage?.model)
    ?? (resolved.provider === globalProvider
      ? (stage === 'i2v' ? settings?.videoModelF2V : settings?.videoModelT2V)
      : undefined)
    ?? settings?.modelsByProviderVideo?.[stage]?.[resolved.provider]
    ?? defaultVideoModelForProvider(resolved.provider)

  return resolved.warning
    ? { provider: resolved.provider, model, warning: resolved.warning }
    : { provider: resolved.provider, model }
}
