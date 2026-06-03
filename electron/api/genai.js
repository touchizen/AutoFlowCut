/**
 * genai.js — Google Generative AI (Gemini image + Veo video) REST client.
 *
 * 순수 main-process 모듈. Electron import 없음 → 단위 테스트 가능
 * (formatGoogleApiError 만 import, 이 헬퍼도 순수 함수).
 *
 * Flow 웹 역공학(DOM 자동화)을 대체하는 공식 BYOK API 호출부.
 *
 * 인증: 사용자 자기 Gemini Developer API 키(BYOK) → ?key= 쿼리 파라미터.
 * 이미지 모델: gemini-2.5-flash-image (Nano Banana).
 *   레퍼런스 이미지(캐릭터 일관성)를 inline base64 parts 로 지원 — 이게 핵심.
 *   Imagen API 는 multi-reference 캐릭터 일관성을 제대로 못 하므로 Gemini 이미지 모델을 쓴다.
 *   (SRT-Video-Studio 에서 검증된 경로)
 * 비디오 모델: veo-3.1-fast-generate-preview, :predictLongRunning + 폴링.
 *
 * 스타일/품질 프롬프트는 앱(styleService)이 이미 적용해서 넘긴다 — 이 모듈은
 * style-agnostic. 레퍼런스가 있을 때만 "character consistency" 지시문을 앞에 붙인다.
 *
 * fetch / sleep 은 주입 가능 → 실제 네트워크·키·타이머 없이 테스트.
 */
import { formatGoogleApiError } from '../ipc/googleApiError.js'

export const GENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
export const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image'
export const DEFAULT_VIDEO_MODEL = 'veo-3.1-fast-generate-preview'
export const DEFAULT_ASPECT_RATIO = '16:9'
export const DEFAULT_VIDEO_DURATION = 8

// 비디오 long-running operation 폴링 기본값 (단일 호출 기준은 아님 — submit/poll 분리)
export const VIDEO_POLL_INTERVAL_MS = 10000
export const VIDEO_POLL_MAX_ATTEMPTS = 30

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * fetch 응답을 안전하게 JSON 으로 파싱. 비-JSON 응답(HTML 에러 페이지 등)도 죽지 않게.
 */
async function safeJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * 레퍼런스 이미지 배열을 Gemini parts 로 변환.
 * @param {Array<{mimeType:string, data:string}>} referenceImages - data 는 base64 (data: 프리픽스 없음)
 * @returns {Array<{inlineData:{mimeType:string,data:string}}>}
 */
function buildReferenceParts(referenceImages = []) {
  return (referenceImages || [])
    .filter((ref) => ref && ref.data)
    .map((ref) => ({
      inlineData: {
        mimeType: ref.mimeType || 'image/jpeg',
        data: ref.data,
      },
    }))
}

// 일시적 과부하 후 재시도 대기 (attempt 0, 1). 길이 = 최대 재시도 횟수.
export const RETRY_BACKOFF_MS = [1000, 3000]

// 429(RPM/IPM 순간초과) 재시도 시 존중할 서버 retryDelay 상한.
// 이보다 길거나(=일일소진/billing) retryDelay 가 없으면 재시도하지 않고 그대로 반환 →
// downstream quota-stop(모달) 이 처리. 짧은 burst 만 흡수.
export const MAX_429_RETRY_DELAY_MS = 30000
// retryDelay 위에 더하는 소량 jitter — 다중 클라이언트 동시 재시도(thundering herd) 완화.
const RETRY_JITTER_MS = 500

/** 일시적 과부하 응답인지 — 503 / UNAVAILABLE / "overloaded". 429(quota)는 제외(아래 별도 처리). */
function isTransientOverload(response, data) {
  if (response?.status === 503) return true
  if (data?.error?.status === 'UNAVAILABLE') return true
  return /overloaded|temporarily unavailable|try again later/i.test(data?.error?.message || '')
}

/**
 * 429 응답의 google.rpc.RetryInfo.retryDelay(예: "5s", "1.5s") → ms. 없으면 null.
 * Gemini 는 RPM/IPM 순간초과 시 짧은 retryDelay 를 주고, 일일소진/billing 차단 시엔
 * retryDelay 가 없거나(또는 매우 김) 다른 detail 만 준다 — 그 차이로 "흡수 vs quota-stop" 을 가른다.
 */
export function parseRetryDelayMs(data) {
  const details = data?.error?.details
  if (!Array.isArray(details)) return null
  for (const d of details) {
    if (typeof d?.['@type'] === 'string' && d['@type'].endsWith('RetryInfo')) {
      const rd = d.retryDelay
      if (typeof rd === 'string') {
        const m = /^([\d.]+)s$/.exec(rd.trim())
        if (m) { const v = Number(m[1]); if (Number.isFinite(v)) return Math.round(v * 1000) }
      }
    }
  }
  return null
}

/**
 * 공통 JSON 요청 헬퍼.
 *   - API 키를 `x-goog-api-key` 헤더로 전달 (URL ?key= 노출 회피 — 로그/Sentry
 *     breadcrumb 으로 키가 새는 것을 막음).
 *   - 503/UNAVAILABLE/"overloaded" 일시 오류는 백오프 재시도 (Gemini 이미지/Veo 는
 *     부하 시 503 을 흔히 뱉음 — 단발 blip 으로 씬 전체를 실패시키지 않게).
 * fetch/sleep 주입 가능 → 실제 네트워크·타이머 없이 테스트.
 *
 * @returns {Promise<{response:any, data:any}>}
 */
async function genaiFetch(
  url,
  { apiKey, method = 'GET', body = null } = {},
  { fetchImpl = fetch, sleepImpl = defaultSleep, maxRetries = RETRY_BACKOFF_MS.length, random = Math.random } = {}
) {
  const init = { method, headers: { 'x-goog-api-key': apiKey } }
  if (body != null) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let attempt = 0
  for (;;) {
    let response
    try {
      response = await fetchImpl(url, init)
    } catch (e) {
      if (attempt < maxRetries) { await sleepImpl(RETRY_BACKOFF_MS[attempt]); attempt += 1; continue }
      throw e
    }
    const data = await safeJson(response)
    if (isTransientOverload(response, data) && attempt < maxRetries) {
      await sleepImpl(RETRY_BACKOFF_MS[attempt]); attempt += 1; continue
    }
    // 429 RPM/IPM 순간초과 — RetryInfo.retryDelay 가 짧을 때만 그 지연만큼 재시도.
    // retryDelay 없음/김(=일일소진·billing) 은 재시도 없이 그대로 반환 → downstream quota-stop.
    if (response?.status === 429 && attempt < maxRetries) {
      const serverDelay = parseRetryDelayMs(data)
      if (serverDelay != null && serverDelay <= MAX_429_RETRY_DELAY_MS) {
        await sleepImpl(serverDelay + Math.floor(random() * RETRY_JITTER_MS)); attempt += 1; continue
      }
    }
    return { response, data }
  }
}

/**
 * 이미지 생성 (gemini-2.5-flash-image).
 *
 * @param {object} params
 * @param {string} params.apiKey - 사용자 Gemini API 키 (BYOK)
 * @param {string} params.prompt - 이미 스타일이 적용된 최종 프롬프트 (앱에서 빌드)
 * @param {Array<{mimeType:string,data:string}>} [params.referenceImages] - inline base64 레퍼런스
 * @param {string} [params.aspectRatio] - '16:9' | '9:16' | '1:1' 등
 * @param {string} [params.model]
 * @param {object} [deps]
 * @param {Function} [deps.fetchImpl] - 주입용 fetch (테스트)
 * @returns {Promise<{success:boolean, images?:Array<{base64:string,mimeType:string,dataUrl:string}>, error?:string}>}
 */
export async function generateImage(
  { apiKey, prompt, referenceImages = [], aspectRatio = DEFAULT_ASPECT_RATIO, model = DEFAULT_IMAGE_MODEL } = {},
  deps = {}
) {
  if (!apiKey) return { success: false, error: 'No API key' }

  const refParts = buildReferenceParts(referenceImages)
  const refCount = refParts.length

  // 레퍼런스가 있으면 캐릭터 일관성 지시문을 앞에 붙임 (SRT 에서 검증된 프롬프트 형태)
  const textPrompt = refCount > 0
    ? `Using the provided ${refCount} reference image(s) for character consistency and style, generate: ${prompt || ''}`
    : (prompt || '')

  const parts = [...refParts, { text: textPrompt }]

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: aspectRatio || DEFAULT_ASPECT_RATIO },
    },
  }

  try {
    const { response, data } = await genaiFetch(
      `${GENAI_BASE}/models/${model}:generateContent`,
      { apiKey, method: 'POST', body },
      deps
    )

    if (data?.error) {
      return { success: false, error: formatGoogleApiError(data.error) }
    }
    if (!data) {
      return { success: false, error: `HTTP ${response?.status ?? '?'} :: empty response` }
    }

    const candidate = data.candidates?.[0]
    const responseParts = candidate?.content?.parts || []
    const imagePart = responseParts.find((p) => p.inlineData)

    if (imagePart) {
      const mimeType = imagePart.inlineData.mimeType || 'image/png'
      const base64 = imagePart.inlineData.data
      return {
        success: true,
        images: [{ base64, mimeType, dataUrl: `data:${mimeType};base64,${base64}` }],
      }
    }

    // 이미지가 없는 경우 — 사유를 최대한 구체적으로 표면화해 사용자가 안전필터 차단인지
    // 일시 오류인지 구분하고 재시도 여부를 판단할 수 있게 한다.
    const textPart = responseParts.find((p) => p.text)
    if (textPart?.text) return { success: false, error: textPart.text }
    const blockReason = data.promptFeedback?.blockReason
    if (blockReason) return { success: false, error: `Blocked by safety filter: ${blockReason}` }
    const finishReason = candidate?.finishReason
    if (finishReason && finishReason !== 'STOP') {
      return { success: false, error: `No image generated (finishReason: ${finishReason})` }
    }
    return { success: false, error: 'No image was generated' }
  } catch (error) {
    return { success: false, error: error?.message || String(error) }
  }
}

/**
 * 비디오 생성 제출 (Veo long-running operation 시작). fire-and-forget.
 *
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.prompt
 * @param {{mimeType:string,data:string}} [params.image] - I2V 시작 프레임 (inline base64). 없으면 T2V.
 * @param {{mimeType:string,data:string}} [params.endImage] - F2V 끝 프레임 (lastFrame). image 와 함께 주면 첫/끝 보간.
 * @param {string} [params.aspectRatio]
 * @param {number} [params.durationSeconds]
 * @param {string} [params.model]
 * @param {object} [deps]
 * @returns {Promise<{success:boolean, operationName?:string, error?:string}>}
 *   operationName 은 이후 checkVideoOperation 에 넘기는 generationId 역할.
 *
 * Veo predictLongRunning 의 instances[].image 는 `{ imageBytes: <base64>, mimeType }`.
 * (google-genai SDK 의 types.Image(image_bytes=…) 직렬화 형식 = imageBytes.)
 * 주의: REST 문서 예시의 `inlineData` 와 Vertex 의 `bytesBase64Encoded` 는 둘 다
 * veo-3.1 모델에서 "isn't supported by this model" (400) 으로 거부된다(2026-06 확인).
 * lastFrame(끝 프레임 보간)도 동일 형태.
 */
export async function submitVideo(
  {
    apiKey,
    prompt,
    image = null,
    endImage = null,
    aspectRatio = DEFAULT_ASPECT_RATIO,
    durationSeconds = DEFAULT_VIDEO_DURATION,
    model = DEFAULT_VIDEO_MODEL,
    seed = null,
    resolution = null,
  } = {},
  deps = {}
) {
  if (!apiKey) return { success: false, error: 'No API key' }

  const instance = { prompt: prompt || '' }
  if (image && image.data) {
    instance.image = { imageBytes: image.data, mimeType: image.mimeType || 'image/png' }
  }
  if (endImage && endImage.data) {
    instance.lastFrame = { imageBytes: endImage.data, mimeType: endImage.mimeType || 'image/png' }
  }

  const parameters = { aspectRatio: aspectRatio || DEFAULT_ASPECT_RATIO }

  // 해상도: 지정 시 전달 (720p/1080p/4k). 미지정이면 API 기본(720p).
  const res = resolution || null
  if (res) parameters.resolution = res

  // 길이: {4,6,8} 로 보정. reference 이미지(I2V/F2V) 또는 1080p/4k 면 8초 강제(공식 Veo 제약).
  const hasImage = !!((image && image.data) || (endImage && endImage.data))
  let dur = Math.round(Number(durationSeconds))
  if (!Number.isFinite(dur) || dur <= 0) dur = DEFAULT_VIDEO_DURATION
  if (dur <= 4) dur = 4
  else if (dur <= 6) dur = 6
  else dur = 8
  if (hasImage || res === '1080p' || res === '4k') dur = 8
  parameters.durationSeconds = String(dur)

  // seed 는 Veo 가 지원 — 숫자일 때만 전달(재현성). 이미지(Gemini)는 미지원이라 안 보냄.
  if (Number.isFinite(seed)) parameters.seed = seed

  const body = { instances: [instance], parameters }

  try {
    const { data } = await genaiFetch(
      `${GENAI_BASE}/models/${model}:predictLongRunning`,
      { apiKey, method: 'POST', body },
      deps
    )

    if (data?.error) {
      return { success: false, error: formatGoogleApiError(data.error) }
    }
    if (!data?.name) {
      return { success: false, error: 'Operation name not returned' }
    }

    return { success: true, operationName: data.name }
  } catch (error) {
    return { success: false, error: error?.message || String(error) }
  }
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

    const videoUri = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
    if (!videoUri) {
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
 * API 키 유효성 검증. 생성 quota 를 소비하지 않는 가벼운 호출(models 목록 조회).
 *
 * @returns {Promise<{valid:boolean, error?:string}>}
 */
export async function validateApiKey({ apiKey } = {}, deps = {}) {
  if (!apiKey) return { valid: false, error: 'No API key' }

  try {
    const { response, data } = await genaiFetch(`${GENAI_BASE}/models`, { apiKey }, deps)

    if (data?.error) {
      return { valid: false, error: formatGoogleApiError(data.error) }
    }
    if (response.ok && Array.isArray(data?.models)) {
      return { valid: true }
    }
    return { valid: false, error: `HTTP ${response?.status ?? '?'} :: unexpected response` }
  } catch (error) {
    return { valid: false, error: error?.message || String(error) }
  }
}
