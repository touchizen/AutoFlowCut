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
  { fetchImpl = fetch } = {}
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
    const response = await fetchImpl(
      `${GENAI_BASE}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )

    const data = await safeJson(response)

    if (data?.error) {
      return { success: false, error: formatGoogleApiError(data.error) }
    }
    if (!data) {
      return { success: false, error: `HTTP ${response?.status ?? '?'} :: empty response` }
    }

    const responseParts = data.candidates?.[0]?.content?.parts || []
    const imagePart = responseParts.find((p) => p.inlineData)

    if (imagePart) {
      const mimeType = imagePart.inlineData.mimeType || 'image/png'
      const base64 = imagePart.inlineData.data
      return {
        success: true,
        images: [{ base64, mimeType, dataUrl: `data:${mimeType};base64,${base64}` }],
      }
    }

    // 이미지가 없으면 모델이 텍스트로 거부 사유를 줬을 수 있음 (안전필터 등)
    const textPart = responseParts.find((p) => p.text)
    return { success: false, error: textPart?.text || 'No image was generated' }
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
 * Veo(generativelanguage) 는 이미지를 `inlineData: { mimeType, data }` 로 받는다
 * (Vertex 의 bytesBase64Encoded 아님 — 공식 문서/포럼 확인). lastFrame 도 동일 형태.
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
  } = {},
  { fetchImpl = fetch } = {}
) {
  if (!apiKey) return { success: false, error: 'No API key' }

  const instance = { prompt: prompt || '' }
  if (image && image.data) {
    instance.image = {
      inlineData: { mimeType: image.mimeType || 'image/png', data: image.data },
    }
  }
  if (endImage && endImage.data) {
    instance.lastFrame = {
      inlineData: { mimeType: endImage.mimeType || 'image/png', data: endImage.data },
    }
  }

  const body = {
    instances: [instance],
    parameters: {
      aspectRatio: aspectRatio || DEFAULT_ASPECT_RATIO,
      durationSeconds: String(durationSeconds),
    },
  }

  try {
    const response = await fetchImpl(
      `${GENAI_BASE}/models/${model}:predictLongRunning?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )

    const data = await safeJson(response)

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
  { fetchImpl = fetch } = {}
) {
  if (!apiKey) return { success: false, done: false, error: 'No API key' }
  if (!operationName) return { success: false, done: false, error: 'No operation name' }

  try {
    const response = await fetchImpl(`${GENAI_BASE}/${operationName}?key=${apiKey}`, {
      headers: { 'Content-Type': 'application/json' },
    })

    const data = await safeJson(response)

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
 * Veo 의 video.uri 는 key 쿼리를 붙여야 다운로드 가능.
 *
 * @returns {Promise<{success:boolean, base64?:string, mimeType?:string, error?:string}>}
 */
export async function fetchVideoBase64(
  { apiKey, videoUri } = {},
  { fetchImpl = fetch } = {}
) {
  if (!apiKey) return { success: false, error: 'No API key' }
  if (!videoUri) return { success: false, error: 'No video URI' }

  const separator = videoUri.includes('?') ? '&' : '?'
  const url = `${videoUri}${separator}key=${apiKey}`

  try {
    const response = await fetchImpl(url)
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status} :: video download failed` }
    }
    const buf = await response.arrayBuffer()
    const base64 = Buffer.from(buf).toString('base64')
    const mimeType = response.headers?.get?.('content-type') || 'video/mp4'
    return { success: true, base64, mimeType }
  } catch (error) {
    return { success: false, error: error?.message || String(error) }
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
  const submitted = await submitVideo(params, { fetchImpl })
  if (!submitted.success) return submitted

  const { operationName } = submitted

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleepImpl(pollIntervalMs)
    const status = await checkVideoOperation({ apiKey: params.apiKey, operationName }, { fetchImpl })
    if (!status.success) return { ...status, operationName }
    if (status.done) {
      const dl = await fetchVideoBase64({ apiKey: params.apiKey, videoUri: status.videoUri }, { fetchImpl })
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
export async function validateApiKey({ apiKey } = {}, { fetchImpl = fetch } = {}) {
  if (!apiKey) return { valid: false, error: 'No API key' }

  try {
    const response = await fetchImpl(`${GENAI_BASE}/models?key=${apiKey}`)
    const data = await safeJson(response)

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
