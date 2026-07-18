/**
 * 생성형 모델 카탈로그 — 설정의 모델 선택 UI 가 쓰는 단일 소스.
 * 각 항목: { id(API 모델명), label, cost(중립 표기), descKey(locale 키) }
 *
 * 이미지(T2I): 전부 generateContent + 레퍼런스 지원(drop-in). Imagen 은 별도 API 라 제외.
 * 비디오(T2V/F2V): 전부 Veo predictLongRunning(drop-in). Veo 3.1 세대만.
 */

// 공식 문서/가격 URL. cost 는 중립 근사치 — 정확한 티어/해상도별 가격은 PRICING_URL 참고.
import { FLOW_MODELS } from '../engine/flowModels'
import { VEO_RES_HD, VEO_RES_HD_4K } from '../utils/videoModels'

const IMAGE_DOCS_URL = 'https://ai.google.dev/gemini-api/docs/image-generation'
const VIDEO_DOCS_URL = 'https://ai.google.dev/gemini-api/docs/video'
export const PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing'
// Flow 모드는 종량제 API 과금이 아니라 Gemini 구독(Google AI Plus/Pro/Ultra) 기반 →
// 구독 안내 페이지로 연결한다(API pricing 아님).
export const FLOW_PRICING_URL = 'https://one.google.com/about/google-ai-plans/'

// cost 는 가격만(ASCII), 단위(장/sec 등)는 unit 필드 → ModelSelector 가 locale 로 표시.
export const IMAGE_MODELS = [
  { id: 'gemini-2.5-flash-image', label: 'Nano Banana', cost: '$0.039', unit: 'image', provider: 'google', aspectCapability: 'exact', descKey: 'settings.modelImgNb', url: IMAGE_DOCS_URL },
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2', cost: '$0.067~', unit: 'image', provider: 'google', aspectCapability: 'exact', descKey: 'settings.modelImgNb2', url: IMAGE_DOCS_URL },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro', cost: '$0.134~', unit: 'image', provider: 'google', aspectCapability: 'exact', descKey: 'settings.modelImgNbPro', url: IMAGE_DOCS_URL },
  // OpenAI gpt-image-1. 드롭다운은 imageModelsForProvider 로 선택 provider 만 필터하므로
  // google 사용자에겐 노출되지 않는다(누출 방지, Fable M1-T5a 리뷰). cost 는 PROVISIONAL —
  // 실제 가격은 §5.13 / T6 실키 게이트에서 확정.
  { id: 'gpt-image-1', label: 'GPT Image', cost: '$0.04~', unit: 'image', provider: 'openai', aspectCapability: 'approx', descKey: 'settings.modelImgGptImage', url: 'https://platform.openai.com/docs/guides/images' },
]

// allowedResolutions: 낮은→높은 순. 공식 Veo 3.1 Lite 는 4K 미지원(720p/1080p),
// Fast/Quality 는 4K 지원. coerceResolution 이 미허용 해상도를 허용 최대로 강등.
export const VIDEO_MODELS = [
  { id: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite', cost: '$0.05~', unit: 'sec', provider: 'google', descKey: 'settings.modelVidLite', url: VIDEO_DOCS_URL, allowedResolutions: VEO_RES_HD },
  { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast', cost: '$0.10~', unit: 'sec', provider: 'google', descKey: 'settings.modelVidFast', url: VIDEO_DOCS_URL, allowedResolutions: VEO_RES_HD_4K },
  { id: 'veo-3.1-generate-preview', label: 'Veo 3.1 Quality', cost: '$0.40~', unit: 'sec', provider: 'google', descKey: 'settings.modelVidQuality', url: VIDEO_DOCS_URL, allowedResolutions: VEO_RES_HD_4K },
]

export const DEFAULT_IMAGE_MODEL_ID = 'gemini-3.1-flash-image'  // Nano Banana 2
export const DEFAULT_VIDEO_MODEL_ID = 'veo-3.1-fast-generate-preview'
// Veo 3.1 은 Gemini API(generativelanguage)에서 preview 로만 제공된다 (deprecated 아님).
// GA(-001)는 Vertex AI 전용(다른 엔드포인트·인증)이라 BYOK 키 경로에선 호출 불가 → 제외.
export const VIDEO_REFERENCE_IMAGE_MODEL_IDS = [
  'veo-3.1-fast-generate-preview',
  'veo-3.1-generate-preview',
]
export const VIDEO_REFERENCE_IMAGE_LIMIT = 3
export const VIDEO_REFERENCE_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/**
 * 선택된 image provider 의 모델 목록만 반환 (§5.12 드롭다운 provider 필터 — 누출 방지).
 *
 * - google: 라이브/정적 목록을 그대로 쓰되 비-google 카탈로그 항목(gpt-image 등)만 제외한다.
 *   라이브 /models 의 dynamic extra 는 provider 필드가 없다 → google 로 간주(Google /models 산출물).
 * - 비-google(openai 등): 라이브 목록은 Google 전용이라 무관 → 정적 카탈로그의 해당 provider 항목.
 *
 * @param {string} providerId - 선택된 image provider (미지정→google)
 * @param {Array<{id,provider?}>} availableImageModels - useAvailableModels.imageModels(동적 or 정적)
 * @returns {Array} 드롭다운에 노출할 모델 목록
 */
export function imageModelsForProvider(providerId, availableImageModels) {
  const provider = providerId || 'google'
  if (provider === 'google') {
    return (availableImageModels || []).filter((m) => (m.provider ?? 'google') === 'google')
  }
  return IMAGE_MODELS.filter((m) => m.provider === provider)
}

/** API 모델 id → 사람이 읽는 라벨. 카탈로그에 없으면 id 그대로, falsy 면 null.
 *  ResultsTable / 상세 모달의 모델 표시에 사용. */
export function modelLabel(id) {
  if (!id) return null
  const all = [...IMAGE_MODELS, ...VIDEO_MODELS]
  return all.find(m => m.id === id)?.label || id
}

/**
 * 라이브 /models 목록(raw: {id, displayName, description, methods})을 T2I/T2V·F2V 카테고리로 분류.
 * - 이미지: generateContent + id 에 'image' (Imagen=predict, 텍스트 모델 제외 — drop-in 만)
 * - 비디오: predictLongRunning (Veo)
 * 각 카테고리는 [큐레이션 카탈로그에 있고 실제 사용 가능한 것(카탈로그 순서, 라벨/비용/설명/링크/해상도 유지)]
 * + [그 외 사용 가능한 모델(raw, displayName 라벨)] 순.
 */
function pickCategory(rawModels, curated, predicate) {
  const available = (rawModels || []).filter(predicate)
  const availIds = new Set(available.map(m => m.id))
  const knownIds = new Set(curated.map(c => c.id))
  const known = curated.filter(c => availIds.has(c.id)) // 카탈로그 순서, 메타데이터 유지
  const extras = available
    .filter(m => !knownIds.has(m.id))
    .map(m => ({ id: m.id, label: m.displayName || m.id, desc: m.description || '' }))
  return [...known, ...extras]
}

export function categorizeApiModels(rawModels) {
  // 명시적 kind 필드(Flow raw 모델)는 술어보다 우선 — Flow id 는 표시 이름('Nano Banana Pro')이라
  //   /image/ 술어로는 못 거른다. API raw 모델은 kind 가 없어 기존 regex 술어로 분류.
  const isImage = (m) => m.kind === 'image' || ((m.methods || []).includes('generateContent') && /image/i.test(m.id || '') && !/imagen/i.test(m.id || ''))
  const isVideo = (m) => m.kind === 'video' || (m.methods || []).includes('predictLongRunning') || /^veo/i.test(m.id || '')
  return {
    imageModels: pickCategory(rawModels, IMAGE_MODELS, isImage),
    videoModels: pickCategory(rawModels, VIDEO_MODELS, isVideo),
  }
}

/**
 * 권위 있는(authoritative) 모델 목록 기준으로 유효한 모델 id 선택.
 * 저장값이 목록에 있으면 그대로, 없으면 defaultId(목록에 있을 때), 그것도 없으면 첫 항목.
 * 빈 목록(권위 없음/로딩·실패)이면 치유하지 않고 id 보존.
 * → /models 성공 목록으로 stale 저장값을 치유하되, 목록을 모를 땐 보존(리뷰 P2).
 */
export function pickValidModel(list, id, defaultId) {
  const ids = (list || []).map(m => m.id)
  if (!ids.length) return id
  if (id && ids.includes(id)) return id
  if (defaultId && ids.includes(defaultId)) return defaultId
  return ids[0]
}

/**
 * 권위 있는 동적 목록(/models 성공)으로 저장된 모델 id 를 치유. 변경이 필요한 키만 담은
 * 객체를 반환(없으면 {}).
 * - 목록이 정적 카탈로그 *참조 그대로*(IMAGE_MODELS/VIDEO_MODELS)면 = 폴백/로딩/실패 →
 *   권위 없음 → 치유 안 함(보존). (useAvailableModels 가 폴백 시 같은 참조를 돌려줌)
 * - availableModels.source 가 'dynamic'이 아니면(=정적 폴백) 치유 안 함(보존). Flow 정적
 *   폴백(FLOW_STATIC)은 IMAGE_MODELS/VIDEO_MODELS 와 다른 배열이라 참조비교로는 못 거른다 →
 *   transient Flow scrape 실패가 저장된 동적 모델을 폴백 id로 덮어쓰는 회귀 방지(리뷰 R19).
 *   (source 미지정 호출은 하위호환 — 참조비교 가드만 적용.)
 * - availableModels.loading === true 이면 치유 안 함(stale 카탈로그 transient guard).
 * - 동적 목록에 없는 저장값만 pickValidModel 로 치유(기본/첫 사용가능). 유효한 값은 유지.
 * - mode === 'flow' 일 때 videoModelF2V 는 I2V-capable 모델(id에 'i2v' 포함)을 기본으로 선택.
 *   I2V 모델이 목록에 없으면 기존 fallback(첫 항목)으로 수렴.
 * - mode !== 'flow' (또는 미지정) 이면 API 모드 동작 그대로 (DEFAULT_VIDEO_MODEL_ID).
 *
 * @param {object} availableModels - { imageModels, videoModels, loading? }
 * @param {object} settings
 * @param {string} [mode] - 현재 앱 모드 ('api' | 'flow'). 미지정이면 api 모드처럼 동작.
 */
export function computeModelHeal(availableModels, settings, mode) {
  // stale-catalog guard: 카탈로그가 로딩 중이면 heal 건너뜀 (Fix B)
  if (availableModels?.loading) return {}

  // source guard (리뷰 R19): source 가 명시됐고 'dynamic'이 아니면 = 정적 폴백 → 치유 안 함.
  //   Flow 정적 폴백(FLOW_STATIC)은 IMAGE_MODELS/VIDEO_MODELS 참조와 다른 배열이라 아래
  //   참조비교만으론 못 걸러진다. source 미지정(undefined)이면 하위호환 — 참조비교 가드로 위임.
  // 'flow-static' = Flow 정적 목록(동적 스크랩 제거 후 권위 목록) → heal 수행. 'static' = API 동적
  //   조회의 일시 폴백(권위 없음) → 보존. 'dynamic' = 라이브 조회 성공 → heal.
  //   단, 'flow-static' 은 mode === 'flow' 일 때만 권위로 인정한다(R9): Flow→API 전환 중
  //   useAvailableModels 가 아직 mode 변경을 반영하지 못한 렌더에서 heal effect 가 mode='api' +
  //   직전 flow-static(stale) 카탈로그로 실행될 수 있다 → 이때 권위로 보면 복원된 API 스냅샷을
  //   Flow id 로 덮어쓴다. mode 불일치면 보존.
  const source = availableModels?.source
  const flowStaticAuthoritative = source === 'flow-static' && mode === 'flow'
  if (source && source !== 'dynamic' && !flowStaticAuthoritative) return {}

  // §5.12 heal 경계: 선택된 image provider 목록으로만 그 provider 모델을 heal.
  // Google 동적 /models 는 google 모델만 권위 — 비-google(openai) 선택 시 image heal 스킵(카탈로그 권위).
  // 단 Flow 모드는 google 전용이라 provider 설정과 무관하게 heal 유지(mode 우선).
  const imageProvider = settings?.generation?.image?.provider ?? 'google'
  const healImageModel = mode === 'flow' || imageProvider === 'google'
  const out = {}
  const { imageModels, videoModels } = availableModels || {}
  if (healImageModel && imageModels && imageModels !== IMAGE_MODELS) {
    // Flow 모드 이미지 기본값 = 'Nano Banana 2' (라벨 매칭 — 스크랩 id 'Nano Banana 2'/정적
    //   id 'flow_image_generate' 둘 다 라벨로 잡힌다). 목록에 없으면 API 기본/첫 항목으로 수렴.
    let imgDefaultId = DEFAULT_IMAGE_MODEL_ID
    if (mode === 'flow') {
      // 'Nano Banana 2' 를 id(스크랩 value) 또는 label 로 찾는다. 라벨엔 '🍌 ' 이모지 prefix 가
      //   붙어 정확매칭(=== 'nano banana 2')이 실패했다 → 재시작 heal 이 첫 항목(Pro)으로 떨어졌다.
      //   \b 로 'Nano Banana 25' 같은 오매칭은 막고, Pro/무관 항목은 '2' 없어 안 걸린다.
      const isNB2 = (m) => /nano\s*banana\s*2\b/i.test((m && m.id) || '') || /nano\s*banana\s*2\b/i.test((m && m.label) || '')
      const nb2 = imageModels.find(isNB2)
      if (nb2) imgDefaultId = nb2.id
    }
    const next = pickValidModel(imageModels, settings.imageModel, imgDefaultId)
    if (next !== settings.imageModel) out.imageModel = next
  }
  if (videoModels && videoModels !== VIDEO_MODELS) {
    const t2v = pickValidModel(videoModels, settings.videoModelT2V, DEFAULT_VIDEO_MODEL_ID)
    if (t2v !== settings.videoModelT2V) out.videoModelT2V = t2v

    // Flow 비디오 모델은 패밀리 단위(Omni Flash / Veo Lite·Fast·Quality)라 t2v/i2v 구분이 없다 —
    //   T2V/F2V 둘 다 같은 4개 패밀리에서 고른다. F2V 기본값은 목록 첫 패밀리(저장값 무효 시).
    let f2vDefaultId = DEFAULT_VIDEO_MODEL_ID
    if (mode === 'flow' && videoModels.length > 0) {
      f2vDefaultId = videoModels[0].id
    }
    const f2v = pickValidModel(videoModels, settings.videoModelF2V, f2vDefaultId)
    if (f2v !== settings.videoModelF2V) out.videoModelF2V = f2v
  }
  return out
}

/**
 * 모드 전환 시 per-mode 모델 선택을 스냅샷하고 복원하는 순수 헬퍼.
 *
 * 반환값: settings에 병합할 패치 객체.
 * - `modelsByMode[prevMode]`에 현재 활성 {imageModel, videoModelT2V, videoModelF2V} 저장.
 * - `modelsByMode[nextMode]`에 기억된 값이 있으면 활성 필드에 복원(패치에 포함).
 * - 기억이 없으면 활성 필드는 패치에 포함하지 않음(heal이 이후 유효성 보정).
 * - prevMode === nextMode 면 {} 반환 (noop).
 * - 기존 modelsByMode 의 다른 키는 그대로 유지.
 */
export function computeModeSwitch(settings, prevMode, nextMode) {
  if (prevMode === nextMode) return {}
  const { imageModel, videoModelT2V, videoModelF2V, modelsByMode } = settings
  const prevSnapshot = { imageModel, videoModelT2V, videoModelF2V }
  const updatedByMode = {
    ...(modelsByMode || {}),
    [prevMode]: prevSnapshot,
  }
  const patch = { modelsByMode: updatedByMode }
  const memory = updatedByMode[nextMode]
  if (memory) {
    if (memory.imageModel !== undefined) patch.imageModel = memory.imageModel
    if (memory.videoModelT2V !== undefined) patch.videoModelT2V = memory.videoModelT2V
    if (memory.videoModelF2V !== undefined) patch.videoModelF2V = memory.videoModelF2V
  }
  return patch
}

/** id 가 카탈로그에 있으면 그대로, 없으면 기본값으로. (저장된 stale/legacy id 방어) */
export function coerceImageModel(id) {
  return IMAGE_MODELS.some(m => m.id === id) ? id : DEFAULT_IMAGE_MODEL_ID
}
export function coerceVideoModel(id) {
  return VIDEO_MODELS.some(m => m.id === id) ? id : DEFAULT_VIDEO_MODEL_ID
}

/** Veo referenceImages 는 Veo 3.1 Fast/Quality T2V 에서만 지원한다. */
export function supportsVideoReferenceImages(modelId) {
  if (!modelId) return false
  return VIDEO_REFERENCE_IMAGE_MODEL_IDS.includes(String(modelId))
}

/** Veo referenceImages.image 가 받는 이미지 MIME. */
export function supportsVideoReferenceMimeType(mimeType) {
  if (!mimeType) return false
  return VIDEO_REFERENCE_IMAGE_MIME_TYPES.includes(String(mimeType).toLowerCase())
}

/** 앱이 지원하는 비디오 해상도 known set. */
export const VIDEO_RESOLUTIONS = ['720p', '1080p', '4k']

/** 모델이 지원하지 않는 해상도면 허용 최대로 강등(예: Veo Lite + 4K → 1080p).
 *  - falsy → passthrough (엔진 기본 위임)
 *  - known set 밖(stale/오타) → undefined (무단 상향 금지, 엔진 기본 720p)
 *  - 모르는 모델 id → known 값 그대로 (제약 모르면 건드리지 않음)
 *  - known-but-disallowed (Lite+4k) → 허용 최대 */
export function coerceResolution(modelId, resolution) {
  if (!resolution) return resolution
  if (!VIDEO_RESOLUTIONS.includes(resolution)) return undefined
  // #R29-7: Flow underscore 모델(veo_3_1_*)도 allowedResolutions 제약을 적용한다 — API 카탈로그
  //   (VIDEO_MODELS)에만 있으면 stale/global 4k 가 Flow i2v(720p/1080p 제한)에서 안 내려간다.
  const m = VIDEO_MODELS.find(v => v.id === modelId) || FLOW_MODELS.find(v => v.id === modelId)
  if (!m?.allowedResolutions) return resolution
  if (m.allowedResolutions.includes(resolution)) return resolution
  return m.allowedResolutions[m.allowedResolutions.length - 1]
}
