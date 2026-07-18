/**
 * genai.js — Google GenAI provider 배럴(re-export).
 *
 * 실제 로직은 electron/api/providers/ 하위 Google provider 모듈에 있다.
 * 이 파일은 기존 소비자(genai-api.js, genai.test.js)의 import 경로를 보존하는
 * 하위호환 배럴이다 — 새 코드는 providers/* 를 직접 import할 것.
 * (멀티 provider 리팩터 M0a: 무동작 이동)
 */
export { GENAI_BASE, DEFAULT_ASPECT_RATIO, RETRY_BACKOFF_MS, MAX_429_RETRY_DELAY_MS, parseRetryDelayMs } from './providers/http.js'
export { DEFAULT_IMAGE_MODEL, generateImage } from './providers/image/google.js'
export {
  DEFAULT_VIDEO_MODEL,
  DEFAULT_VIDEO_DURATION,
  VIDEO_REFERENCE_IMAGE_MODELS,
  VIDEO_POLL_INTERVAL_MS,
  VIDEO_POLL_MAX_ATTEMPTS,
  submitVideo,
  summarizeVeoOperation,
  checkVideoOperation,
  fetchVideoBase64,
  generateVideo,
} from './providers/video/google.js'
export { validateApiKey, listModels } from './providers/google/models.js'
