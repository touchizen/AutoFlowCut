/**
 * videoModels — Veo 모델 식별자 정규화.
 *
 * 구 Flow(역공학 v2 API)는 비디오 모델을 underscore 키
 * (예: 'veo_3_1_t2v_fast_ultra_relaxed')로 식별했다. 공식
 * generativelanguage(Veo) API 는 hyphen 모델명
 * (예: 'veo-3.1-fast-generate-preview')을 요구한다.
 *
 * 영속된 프로젝트/설정에는 구 키가 남아 있을 수 있으므로, 호출 시점에
 * 항상 이 함수로 정규화해 잘못된 모델명이 API 로 새어 나가지 않게 한다.
 * 알 수 없는 값은 undefined → 엔진이 DEFAULT_VIDEO_MODEL 을 쓴다.
 */

// 공식 Veo(generativelanguage) 모델명.
export const VIDEO_MODEL_FAST = 'veo-3.1-fast-generate-preview'
export const VIDEO_MODEL_QUALITY = 'veo-3.1-generate-preview'

// 구 Flow underscore 키 → 공식 모델명.
const LEGACY_VIDEO_MODEL_MAP = {
  veo_3_1_t2v_fast_ultra_relaxed: VIDEO_MODEL_FAST,
  veo_3_1_t2v_quality_ultra_relaxed: VIDEO_MODEL_QUALITY,
  veo_3_1_i2v_fast_ultra_relaxed: VIDEO_MODEL_FAST,
  veo_3_1_i2v_quality_ultra_relaxed: VIDEO_MODEL_QUALITY,
}

/**
 * 모델 식별자를 공식 Veo 모델명으로 정규화.
 * @param {string|undefined} model
 * @returns {string|undefined} 공식 hyphen 모델명, 또는 알 수 없으면 undefined.
 */
export function normalizeVideoModel(model) {
  if (!model) return undefined
  const s = String(model)
  if (LEGACY_VIDEO_MODEL_MAP[s]) return LEGACY_VIDEO_MODEL_MAP[s]
  // 이미 공식 hyphen 모델명(veo-...)이면 그대로 통과.
  if (/^veo-/.test(s)) return s
  // 매핑되지 않은 underscore 구 키 / 비-veo 값 → 엔진 기본값으로.
  return undefined
}

// Veo 3.x 가 허용하는 비디오 길이(초). 4k/1080p · reference 이미지 사용 시엔 8 강제(API 제약).
export const VEO_DURATIONS = [4, 6, 8]

/**
 * 씬 길이(초)를 Veo 허용값 {4,6,8} 으로 스냅. 씬을 "덮는" 가장 짧은 값(>= 길이),
 * 8 초과면 8(단일 클립 최대). 0/누락/비정상 → 8(기본).
 * @param {number} seconds
 * @returns {4|6|8}
 */
export function snapVeoDuration(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return 8
  return VEO_DURATIONS.find((d) => d >= s) ?? 8
}
