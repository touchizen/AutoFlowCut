/**
 * 생성형 모델 카탈로그 — 설정의 모델 선택 UI 가 쓰는 단일 소스.
 * 각 항목: { id(API 모델명), label, cost(중립 표기), descKey(locale 키) }
 *
 * 이미지(T2I): 전부 generateContent + 레퍼런스 지원(drop-in). Imagen 은 별도 API 라 제외.
 * 비디오(T2V/F2V): 전부 Veo predictLongRunning(drop-in). Veo 3.1 세대만.
 */

export const IMAGE_MODELS = [
  { id: 'gemini-2.5-flash-image', label: 'Nano Banana', cost: '$0.039/장', descKey: 'settings.modelImgNb' },
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2', cost: '$0.045~/장', descKey: 'settings.modelImgNb2' },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro', cost: '$0.134~/장', descKey: 'settings.modelImgNbPro' },
]

export const VIDEO_MODELS = [
  { id: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite', cost: '$0.05~/초', descKey: 'settings.modelVidLite' },
  { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast', cost: '$0.10~/초', descKey: 'settings.modelVidFast' },
  { id: 'veo-3.1-generate-preview', label: 'Veo 3.1 Quality', cost: '$0.40~/초', descKey: 'settings.modelVidQuality' },
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
