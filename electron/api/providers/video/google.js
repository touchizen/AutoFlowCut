/**
 * video/google.js — Google Veo 비디오 생성 (predictLongRunning + 폴링).
 *
 * genai.js 에서 무동작 이동(M0a). submit/check/fetch 3-phase 분리 —
 * 앱의 async 배치 파이프라인과 매칭. fetch/sleep 주입으로 테스트 가능.
 */
import { formatGoogleApiError } from '../../../ipc/googleApiError.js'
import { normalizeVideoModel } from '../../../../src/utils/videoModels.js'
import {
  VIDEO_REFERENCE_IMAGE_MODEL_IDS,
  VIDEO_REFERENCE_IMAGE_LIMIT,
  coerceResolution,
  supportsVideoReferenceMimeType,
} from '../../../../src/config/genModels.js'
import { GENAI_BASE, DEFAULT_ASPECT_RATIO, RETRY_BACKOFF_MS, genaiFetch, defaultSleep } from '../http.js'

export const DEFAULT_VIDEO_MODEL = 'veo-3.1-fast-generate-preview'
export const DEFAULT_VIDEO_DURATION = 8
export const VIDEO_REFERENCE_IMAGE_MODELS = new Set([
  ...VIDEO_REFERENCE_IMAGE_MODEL_IDS,
])

// 비디오 long-running operation 폴링 기본값 (단일 호출 기준은 아님 — submit/poll 분리)
export const VIDEO_POLL_INTERVAL_MS = 10000
export const VIDEO_POLL_MAX_ATTEMPTS = 30

function supportsVideoReferenceImages(model) {
  return VIDEO_REFERENCE_IMAGE_MODELS.has(model)
}

function isInvalidVideoAssetReference(ref) {
  if (!ref) return false
  const referenceType = String(ref.referenceType || 'asset').toLowerCase()
  const type = String(ref.type || '').toLowerCase()
  const category = String(ref.category || '').toLowerCase()
  return referenceType !== 'asset' || type === 'style' || category === 'style' || category === 'media_category_style'
}

/**
 * Veo 3.1 video reference image payload. referenceImages 는 REST 에서
 * `{ image: { inlineData: { mimeType, data } }, referenceType }` 형태로 보낸다.
 * 모델 제약상 최대 VIDEO_REFERENCE_IMAGE_LIMIT개만 전달한다.
 * @param {Array<{mimeType:string, data:string}>} referenceImages
 * @returns {Array<{image:{inlineData:{mimeType:string,data:string}},referenceType:string}>}
 */
function buildVideoReferenceImages(referenceImages = []) {
  return (referenceImages || [])
    .filter((ref) => ref && ref.data)
    .slice(0, VIDEO_REFERENCE_IMAGE_LIMIT)
    .map((ref) => ({
      image: {
        inlineData: {
          mimeType: String(ref.mimeType).toLowerCase(),
          data: ref.data,
        },
      },
      referenceType: 'asset',
    }))
}

/**
 * 비디오 생성 제출 (Veo long-running operation 시작). fire-and-forget.
 *
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.prompt
 * @param {{mimeType:string,data:string}} [params.image] - I2V 시작 프레임 base64. 없으면 T2V.
 * @param {{mimeType:string,data:string}} [params.endImage] - F2V 끝 프레임 (lastFrame). image 와 함께 주면 첫/끝 보간.
 * @param {Array<{mimeType:string,data:string}>} [params.referenceImages] - Veo 3.1 T2V reference images, max 3.
 * @param {string} [params.aspectRatio]
 * @param {number} [params.durationSeconds]
 * @param {string} [params.model]
 * @param {object} [deps]
 * @returns {Promise<{success:boolean, operationName?:string, error?:string}>}
 *   operationName 은 이후 checkVideoOperation 에 넘기는 generationId 역할.
 *
 * Veo REST payload 는 입력 타입별 이미지 wrapper 가 다르다:
 *   - T2V referenceImages: `{ image: { inlineData: { mimeType, data } }, referenceType: 'asset' }`
 *   - I2V/F2V image/lastFrame: `{ bytesBase64Encoded: <base64>, mimeType }`
 * 시행착오(2026-06): `inlineData`(REST 문서 예시)·`imageBytes`(SDK 필드)는 둘 다
 * I2V/F2V image/lastFrame 에서 "isn't supported by this model"(400, 스키마 거부).
 * 해당 필드는 `bytesBase64Encoded`(Vertex 형식)만 스키마 통과했다.
 */
export async function submitVideo(
  {
    apiKey,
    prompt,
    image = null,
    endImage = null,
    referenceImages = [],
    aspectRatio = DEFAULT_ASPECT_RATIO,
    durationSeconds = DEFAULT_VIDEO_DURATION,
    model = DEFAULT_VIDEO_MODEL,
    seed = null,
    resolution = null,
  } = {},
  deps = {}
) {
  if (!apiKey) return { success: false, error: 'No API key' }

  const effectiveModel = normalizeVideoModel(model) || DEFAULT_VIDEO_MODEL
  const instance = { prompt: prompt || '' }
  const videoReferenceInputs = (referenceImages || []).slice(0, VIDEO_REFERENCE_IMAGE_LIMIT)
  const invalidVideoReferenceType = videoReferenceInputs
    .filter((ref) => ref && ref.data)
    .find(isInvalidVideoAssetReference)
  if (invalidVideoReferenceType) {
    return {
      success: false,
      error: 'Veo referenceImages only support asset references.',
    }
  }
  const invalidVideoReference = videoReferenceInputs
    .filter((ref) => ref && ref.data)
    .find((ref) => !supportsVideoReferenceMimeType(ref.mimeType))
  if (invalidVideoReference) {
    return {
      success: false,
      error: 'Veo reference images support PNG, JPEG, or WebP.',
    }
  }
  const videoReferenceImages = buildVideoReferenceImages(videoReferenceInputs)
  const hasFrameImage = !!((image && image.data) || (endImage && endImage.data))
  if (videoReferenceImages.length > 0 && !supportsVideoReferenceImages(effectiveModel)) {
    return {
      success: false,
      error: 'Veo reference images require Veo 3.1 Fast/Quality.',
    }
  }
  if (videoReferenceImages.length > 0 && hasFrameImage) {
    return {
      success: false,
      error: 'Veo referenceImages cannot be combined with image/lastFrame.',
    }
  }
  if (image && image.data) {
    instance.image = { bytesBase64Encoded: image.data, mimeType: image.mimeType || 'image/png' }
  }
  if (endImage && endImage.data) {
    instance.lastFrame = { bytesBase64Encoded: endImage.data, mimeType: endImage.mimeType || 'image/png' }
  }
  if (videoReferenceImages.length > 0) {
    instance.referenceImages = videoReferenceImages
  }

  const parameters = { aspectRatio: aspectRatio || DEFAULT_ASPECT_RATIO }

  // 해상도: 지정 시 전달 (720p/1080p/4k). 미지정이면 API 기본(720p).
  const res = coerceResolution(effectiveModel, resolution) || null
  if (res) parameters.resolution = res

  // 길이: {4,6,8} 로 보정. referenceImages 또는 1080p/4k 면 8초 강제(공식 Veo 제약).
  let dur = Math.round(Number(durationSeconds))
  if (!Number.isFinite(dur) || dur <= 0) dur = DEFAULT_VIDEO_DURATION
  if (dur <= 4) dur = 4
  else if (dur <= 6) dur = 6
  else dur = 8
  if (videoReferenceImages.length > 0 || res === '1080p' || res === '4k') dur = 8
  parameters.durationSeconds = dur  // 숫자로 — API 는 string 거부('needs to be a number')

  // seed 는 Veo 가 지원 — 숫자일 때만 전달(재현성). 이미지(Gemini)는 미지원이라 안 보냄.
  if (Number.isFinite(seed)) parameters.seed = seed

  const body = { instances: [instance], parameters }

  try {
    const { data } = await genaiFetch(
      `${GENAI_BASE}/models/${effectiveModel}:predictLongRunning`,
      { apiKey, method: 'POST', body },
      deps
    )

    if (data?.error) {
      return { success: false, error: formatGoogleApiError(data.error) }
    }
    if (!data?.name) {
      return { success: false, error: 'Operation name not returned' }
    }

    const result = { success: true, operationName: data.name }
    // Legacy genai.test.js 가 provider 직접 반환의 enumerable shape를 exact pin 한다.
    // appliedInputs는 adapter/dispatcher 계약으로 읽을 수 있는 own property로 두되,
    // dispatcher가 enumerable IPC 응답으로 명시 복사해 기존 계약과 새 계약을 모두 유지한다.
    Object.defineProperty(result, 'appliedInputs', {
      enumerable: false,
      value: {
        model: effectiveModel,
        aspectRatio: parameters.aspectRatio,
        durationSeconds: dur,
        resolution: res,
      },
    })
    return result
  } catch (error) {
    return { success: false, error: error?.message || String(error) }
  }
}

/**
 * Veo operation 완료 응답을 로그/진단용으로 요약 (민감 데이터·base64 제외).
 * referenceImages 가 silent-ignore 되는지 추적할 때, 응답에 실제로 무엇이 들어있는지
 * (responseKeys)와 안전 필터링 흔적(raiMediaFiltered*)을 드러낸다.
 *
 * @param {object} data - checkVideoOperation 의 operation 응답 raw data
 * @returns {{done:boolean, sampleCount:number, hasVideoUri:boolean, raiFilteredCount?:number, raiFilteredReasons?:*, responseKeys:string[]}}
 */
export function summarizeVeoOperation(data) {
  const d = data || {}
  const gvr = d.response?.generateVideoResponse || {}
  const samples = Array.isArray(gvr.generatedSamples) ? gvr.generatedSamples : []
  return {
    done: !!d.done,
    sampleCount: samples.length,
    hasVideoUri: !!samples[0]?.video?.uri,
    raiFilteredCount: gvr.raiMediaFilteredCount,
    raiFilteredReasons: gvr.raiMediaFilteredReasons,
    responseKeys: Object.keys(gvr),
  }
}

function formatVeoSafetyFilterError(opDiag) {
  const count = Number(opDiag?.raiFilteredCount) || 0
  const reasons = opDiag?.raiFilteredReasons
  let reasonText = ''
  if (Array.isArray(reasons) && reasons.length > 0) {
    reasonText = reasons
      .map((r) => (typeof r === 'string' ? r : (r?.reason || r?.message || JSON.stringify(r))))
      .filter(Boolean)
      .join(', ')
  } else if (typeof reasons === 'string' && reasons.trim()) {
    reasonText = reasons.trim()
  }
  const suffix = reasonText ? ` (${reasonText})` : ''
  return `Veo media was blocked by the safety filter${count ? ` (${count} item${count === 1 ? '' : 's'})` : ''}${suffix}`
}

/**
 * 비디오 operation 상태 1회 조회 (폴링용).
 *
 * @returns {Promise<{success:boolean, done:boolean, videoUri?:string, error?:string}>}
 */
export async function checkVideoOperation(
  { apiKey, operationName } = {},
  deps = {}
) {
  if (!apiKey) return { success: false, done: false, error: 'No API key' }
  if (!operationName) return { success: false, done: false, error: 'No operation name' }

  try {
    const { response, data } = await genaiFetch(`${GENAI_BASE}/${operationName}`, { apiKey }, deps)

    if (data?.error) {
      return { success: false, done: false, error: formatGoogleApiError(data.error) }
    }
    if (!data) {
      return { success: false, done: false, error: `HTTP ${response?.status ?? '?'} :: empty response` }
    }

    if (!data.done) {
      return { success: true, done: false }
    }

    // Veo 미디어 안전필터가 reference/출력을 막으면 영상이 비거나 이상하게 나온다 —
    // silent-fail 안전망으로 그 단서만 경고로 남긴다(정상이면 조용히).
    const opDiag = summarizeVeoOperation(data)
    if (opDiag.raiFilteredCount) {
      console.warn('[VeoRef] Veo media safety filter applied', {
        raiFilteredCount: opDiag.raiFilteredCount,
        raiFilteredReasons: opDiag.raiFilteredReasons,
      })
    }

    const videoUri = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
    if (!videoUri) {
      if (opDiag.raiFilteredCount) {
        return { success: false, done: true, error: formatVeoSafetyFilterError(opDiag) }
      }
      return { success: false, done: true, error: 'Video URI not found in completed operation' }
    }

    return { success: true, done: true, videoUri }
  } catch (error) {
    return { success: false, done: false, error: error?.message || String(error) }
  }
}

/**
 * 완료된 비디오 URI 를 base64 로 다운로드.
 * Veo 의 video.uri 는 인증이 필요 — API 키를 x-goog-api-key 헤더로 전달(URL ?key= 노출 회피).
 * 503/네트워크 일시 오류는 백오프 재시도.
 *
 * @returns {Promise<{success:boolean, base64?:string, mimeType?:string, error?:string}>}
 */
export async function fetchVideoBase64(
  { apiKey, videoUri } = {},
  { fetchImpl = fetch, sleepImpl = defaultSleep, maxRetries = RETRY_BACKOFF_MS.length } = {}
) {
  if (!apiKey) return { success: false, error: 'No API key' }
  if (!videoUri) return { success: false, error: 'No video URI' }

  let attempt = 0
  for (;;) {
    try {
      const response = await fetchImpl(videoUri, { headers: { 'x-goog-api-key': apiKey } })
      if (!response.ok) {
        if (response.status === 503 && attempt < maxRetries) {
          await sleepImpl(RETRY_BACKOFF_MS[attempt]); attempt += 1; continue
        }
        return { success: false, error: `HTTP ${response.status} :: video download failed` }
      }
      const buf = await response.arrayBuffer()
      const base64 = Buffer.from(buf).toString('base64')
      const mimeType = response.headers?.get?.('content-type') || 'video/mp4'
      return { success: true, base64, mimeType }
    } catch (error) {
      if (attempt < maxRetries) { await sleepImpl(RETRY_BACKOFF_MS[attempt]); attempt += 1; continue }
      return { success: false, error: error?.message || String(error) }
    }
  }
}

/**
 * 비디오 생성 전체 흐름(제출→폴링→다운로드)을 한 번에. 간단한 사용/테스트용 편의 함수.
 * 앱의 실제 배치 파이프라인은 submit/check/fetch 조각을 직접 쓴다.
 *
 * @returns {Promise<{success:boolean, base64?:string, mimeType?:string, operationName?:string, error?:string}>}
 */
export async function generateVideo(
  params = {},
  {
    fetchImpl = fetch,
    sleepImpl = defaultSleep,
    pollIntervalMs = VIDEO_POLL_INTERVAL_MS,
    maxAttempts = VIDEO_POLL_MAX_ATTEMPTS,
  } = {}
) {
  const submitted = await submitVideo(params, { fetchImpl, sleepImpl })
  if (!submitted.success) return submitted

  const { operationName } = submitted

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleepImpl(pollIntervalMs)
    const status = await checkVideoOperation({ apiKey: params.apiKey, operationName }, { fetchImpl, sleepImpl })
    if (!status.success) return { ...status, operationName }
    if (status.done) {
      const dl = await fetchVideoBase64({ apiKey: params.apiKey, videoUri: status.videoUri }, { fetchImpl, sleepImpl })
      return { ...dl, operationName }
    }
  }

  return { success: false, error: 'Video generation timed out', operationName }
}

/**
 * Provider 객체 형태(레지스트리 §5.10용). 기존 함수를 참조만 — 로직 이동 없음(무동작).
 * dispatcher 가 submitVideo/checkVideo/fetchVideoBase64 로 소비한다. google 은 handle 인코딩
 * 안 함(operationName === generationId === rawId).
 */
export const googleVideoProvider = {
  id: 'google',
  kind: 'video',
  submitVideo,
  checkVideo: checkVideoOperation,
  fetchVideoBase64,
  catalogModel: DEFAULT_VIDEO_MODEL,
}
