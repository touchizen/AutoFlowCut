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
export const VIDEO_MODEL_LITE = 'veo-3.1-lite-generate-preview'
export const VIDEO_MODEL_FAST = 'veo-3.1-fast-generate-preview'
export const VIDEO_MODEL_QUALITY = 'veo-3.1-generate-preview'

// 구 Flow underscore 키 / 이전 short 키 → 공식 모델명.
const LEGACY_VIDEO_MODEL_MAP = {
  'veo-3.1-lite': VIDEO_MODEL_LITE,
  'veo-3.1-fast': VIDEO_MODEL_FAST,
  'veo-3.1-quality': VIDEO_MODEL_QUALITY,
  // Vertex AI 전용 GA id 는 generativelanguage(Veo) endpoint 에선 유효하지 않다.
  // 저장된 설정/프로젝트에서 새어 나오면 같은 계열 preview 모델로 치유한다.
  'veo-3.1-fast-generate-001': VIDEO_MODEL_FAST,
  'veo-3.1-generate-001': VIDEO_MODEL_QUALITY,
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
  // 공식 hyphen 모델명은 `generate` 를 포함한다. `veo-3.1-fast` 같은 short
  // legacy id 는 위 map 에 없으면 엔진 기본값으로 보내 잘못된 endpoint 를 막는다.
  if (/^veo-.*generate/i.test(s)) return s
  // 매핑되지 않은 underscore 구 키 / 비-veo 값 → 엔진 기본값으로.
  return undefined
}

// Veo 패밀리 허용 해상도 — FLOW_MODELS(표시이름 카탈로그)와 VIDEO_MODELS(API 카탈로그)가 공유한다.
//   coerceResolution 이 두 카탈로그를 모두 참조하므로 한 곳에서 정의해 드리프트를 막는다.
//   Lite 는 4k 미지원(720p/1080p), Fast/Quality 는 4k 지원. (이 모듈은 leaf — config/engine 이
//   여기서 import 해도 순환 안 생긴다.)
export const VEO_RES_HD = ['720p', '1080p']
export const VEO_RES_HD_4K = ['720p', '1080p', '4k']

// Veo 3.x 가 허용하는 비디오 길이(초). 4k/1080p · reference 이미지 사용 시엔 8 강제(API 제약).
export const VEO_DURATIONS = [4, 6, 8]
// Gemini Omni Flash 는 10초 클립까지 지원(실측·공식 문서 확인) → {4,6,8,10}.
export const OMNIFLASH_DURATIONS = [4, 6, 8, 10]

/**
 * 모델 id 로 허용 길이 그리드를 선택. OmniFlash(Gemini Omni Flash)만 10초를 추가로 허용하고,
 * 그 외(Veo 등)는 {4,6,8}. 모델 id 형태가 다양(예: 'gemini-omni-flash', 'omni-flash-preview',
 * 'Omni Flash')하므로 관대하게 매칭한다(이미지 모델 lenient 매칭과 동일 정책).
 * @param {string|undefined} model
 * @returns {number[]}
 */
/**
 * 모델이 OmniFlash(Gemini Omni Flash)인지 — 표시 이름('Omni Flash')/내부 변형 lenient 매칭.
 *   OmniFlash 만 {4,6,8,10} 길이를 쓰고 i2v 종료프레임을 미지원한다(UI/주입 분기에 사용).
 * @param {string|undefined|null} model
 * @returns {boolean}
 */
export function isOmniFlashModel(model) {
  // 표시 이름('Omni Flash') + 내부 videoModelKey('abra_*') 둘 다 감지 —
  //   electron/flow-page-injection.js 의 주입측 판별과 일치시켜 renderer(길이그리드·종료프레임)와
  //   IPC/주입(endImage 생략·키 강제)이 같은 모델을 OmniFlash 로 보게 한다.
  if (!model) return false
  const s = String(model)
  return /omni.?flash/i.test(s) || /^abra/i.test(s)
}

export function videoDurationGrid(model) {
  return isOmniFlashModel(model) ? OMNIFLASH_DURATIONS : VEO_DURATIONS
}

/**
 * 씬 길이(초)를 모델 허용값으로 스냅. 씬을 "덮는" 가장 짧은 값(>= 길이), 그리드 최대 초과면
 * 그리드 최대(단일 클립 최대). 0/누락/비정상 → 그리드 최대(기본).
 * @param {string|undefined} model
 * @param {number} seconds
 * @returns {number}
 */
export function snapVideoDuration(model, seconds) {
  const grid = videoDurationGrid(model)
  const max = grid[grid.length - 1]
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return max
  return grid.find((d) => d >= s) ?? max
}

/**
 * 씬 길이(초)를 Veo 허용값 {4,6,8} 으로 스냅(모델 무관 — Veo 전용 하위호환 래퍼).
 * @param {number} seconds
 * @returns {4|6|8}
 */
export function snapVeoDuration(seconds) {
  return snapVideoDuration(null, seconds)
}
