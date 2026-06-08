/**
 * 생성형 모델 카탈로그 — 설정의 모델 선택 UI 가 쓰는 단일 소스.
 * 각 항목: { id(API 모델명), label, cost(중립 표기), descKey(locale 키) }
 *
 * 이미지(T2I): 전부 generateContent + 레퍼런스 지원(drop-in). Imagen 은 별도 API 라 제외.
 * 비디오(T2V/F2V): 전부 Veo predictLongRunning(drop-in). Veo 3.1 세대만.
 */

// 공식 문서/가격 URL. cost 는 중립 근사치 — 정확한 티어/해상도별 가격은 PRICING_URL 참고.
const IMAGE_DOCS_URL = 'https://ai.google.dev/gemini-api/docs/image-generation'
const VIDEO_DOCS_URL = 'https://ai.google.dev/gemini-api/docs/video'
export const PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing'

// cost 는 가격만(ASCII), 단위(장/sec 등)는 unit 필드 → ModelSelector 가 locale 로 표시.
export const IMAGE_MODELS = [
  { id: 'gemini-2.5-flash-image', label: 'Nano Banana', cost: '$0.039', unit: 'image', descKey: 'settings.modelImgNb', url: IMAGE_DOCS_URL },
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2', cost: '$0.045~', unit: 'image', descKey: 'settings.modelImgNb2', url: IMAGE_DOCS_URL },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro', cost: '$0.134~', unit: 'image', descKey: 'settings.modelImgNbPro', url: IMAGE_DOCS_URL },
]

// allowedResolutions: 낮은→높은 순. 공식 Veo 3.1 Lite 는 4K 미지원(720p/1080p),
// Fast/Quality 는 4K 지원. coerceResolution 이 미허용 해상도를 허용 최대로 강등.
export const VIDEO_MODELS = [
  { id: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite', cost: '$0.05~', unit: 'sec', descKey: 'settings.modelVidLite', url: VIDEO_DOCS_URL, allowedResolutions: ['720p', '1080p'] },
  { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast', cost: '$0.10~', unit: 'sec', descKey: 'settings.modelVidFast', url: VIDEO_DOCS_URL, allowedResolutions: ['720p', '1080p', '4k'] },
  { id: 'veo-3.1-generate-preview', label: 'Veo 3.1 Quality', cost: '$0.40~', unit: 'sec', descKey: 'settings.modelVidQuality', url: VIDEO_DOCS_URL, allowedResolutions: ['720p', '1080p', '4k'] },
]

export const DEFAULT_IMAGE_MODEL_ID = 'gemini-3.1-flash-image'  // Nano Banana 2
export const DEFAULT_VIDEO_MODEL_ID = 'veo-3.1-fast-generate-preview'
export const VIDEO_REFERENCE_IMAGE_MODEL_IDS = [
  'veo-3.1-fast-generate-preview',
  'veo-3.1-generate-preview',
  'veo-3.1-fast-generate-001',
  'veo-3.1-generate-001',
]
export const VIDEO_REFERENCE_IMAGE_LIMIT = 3
export const VIDEO_REFERENCE_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']

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
  const isImage = (m) => (m.methods || []).includes('generateContent') && /image/i.test(m.id || '') && !/imagen/i.test(m.id || '')
  const isVideo = (m) => (m.methods || []).includes('predictLongRunning') || /^veo/i.test(m.id || '')
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
 * - 동적 목록에 없는 저장값만 pickValidModel 로 치유(기본/첫 사용가능). 유효한 값은 유지.
 */
export function computeModelHeal(availableModels, settings) {
  const out = {}
  const { imageModels, videoModels } = availableModels || {}
  if (imageModels && imageModels !== IMAGE_MODELS) {
    const next = pickValidModel(imageModels, settings.imageModel, DEFAULT_IMAGE_MODEL_ID)
    if (next !== settings.imageModel) out.imageModel = next
  }
  if (videoModels && videoModels !== VIDEO_MODELS) {
    const t2v = pickValidModel(videoModels, settings.videoModelT2V, DEFAULT_VIDEO_MODEL_ID)
    if (t2v !== settings.videoModelT2V) out.videoModelT2V = t2v
    const f2v = pickValidModel(videoModels, settings.videoModelF2V, DEFAULT_VIDEO_MODEL_ID)
    if (f2v !== settings.videoModelF2V) out.videoModelF2V = f2v
  }
  return out
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
  const m = VIDEO_MODELS.find(v => v.id === modelId)
  if (!m?.allowedResolutions) return resolution
  if (m.allowedResolutions.includes(resolution)) return resolution
  return m.allowedResolutions[m.allowedResolutions.length - 1]
}
