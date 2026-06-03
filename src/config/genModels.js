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

export const IMAGE_MODELS = [
  { id: 'gemini-2.5-flash-image', label: 'Nano Banana', cost: '$0.039/장', descKey: 'settings.modelImgNb', url: IMAGE_DOCS_URL },
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2', cost: '$0.045~/장', descKey: 'settings.modelImgNb2', url: IMAGE_DOCS_URL },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro', cost: '$0.134~/장', descKey: 'settings.modelImgNbPro', url: IMAGE_DOCS_URL },
]

// allowedResolutions: 낮은→높은 순. 공식 Veo 3.1 Lite 는 4K 미지원(720p/1080p),
// Fast/Quality 는 4K 지원. coerceResolution 이 미허용 해상도를 허용 최대로 강등.
export const VIDEO_MODELS = [
  { id: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite', cost: '$0.05~/초', descKey: 'settings.modelVidLite', url: VIDEO_DOCS_URL, allowedResolutions: ['720p', '1080p'] },
  { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast', cost: '$0.10~/초', descKey: 'settings.modelVidFast', url: VIDEO_DOCS_URL, allowedResolutions: ['720p', '1080p', '4k'] },
  { id: 'veo-3.1-generate-preview', label: 'Veo 3.1 Quality', cost: '$0.40~/초', descKey: 'settings.modelVidQuality', url: VIDEO_DOCS_URL, allowedResolutions: ['720p', '1080p', '4k'] },
]

export const DEFAULT_IMAGE_MODEL_ID = 'gemini-2.5-flash-image'
export const DEFAULT_VIDEO_MODEL_ID = 'veo-3.1-fast-generate-preview'

/** API 모델 id → 사람이 읽는 라벨. 카탈로그에 없으면 id 그대로, falsy 면 null.
 *  ResultsTable / 상세 모달의 모델 표시에 사용. */
export function modelLabel(id) {
  if (!id) return null
  const all = [...IMAGE_MODELS, ...VIDEO_MODELS]
  return all.find(m => m.id === id)?.label || id
}

/** id 가 카탈로그에 있으면 그대로, 없으면 기본값으로. (저장된 stale/legacy id 방어) */
export function coerceImageModel(id) {
  return IMAGE_MODELS.some(m => m.id === id) ? id : DEFAULT_IMAGE_MODEL_ID
}
export function coerceVideoModel(id) {
  return VIDEO_MODELS.some(m => m.id === id) ? id : DEFAULT_VIDEO_MODEL_ID
}

/** 모델이 지원하지 않는 해상도면 허용 최대로 강등(예: Veo Lite + 4K → 1080p).
 *  falsy 해상도(엔진 기본 위임)나 모르는 모델 id 는 건드리지 않음. */
export function coerceResolution(modelId, resolution) {
  if (!resolution) return resolution
  const m = VIDEO_MODELS.find(v => v.id === modelId)
  if (!m?.allowedResolutions) return resolution
  if (m.allowedResolutions.includes(resolution)) return resolution
  return m.allowedResolutions[m.allowedResolutions.length - 1]
}
