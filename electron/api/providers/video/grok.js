/**
 * video/grok.js — xAI Grok Imagine 비디오 생성 adapter.
 *
 * submit/poll/download 3-phase 계약만 fixture로 고정한다. 실제 인증 권한, 모델 id,
 * polling 상태 전이, 결과 CDN은 real-key smoke 전까지 supported로 승격하지 않는다.
 */

export const DEFAULT_GROK_VIDEO_MODEL = 'grok-imagine-video-1.5'
export const DEFAULT_GROK_ASPECT_RATIO = '16:9'
export const DEFAULT_GROK_DURATION_SECONDS = 8

// PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
const XAI_BASE = 'https://api.x.ai'
// PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
const VIDEO_GENERATIONS_PATH = '/v1/videos/generations'

// PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
const POLL_PENDING_STATUSES = new Set(['queued', 'pending', 'processing'])
// PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
const POLL_DONE_STATUSES = new Set(['completed', 'succeeded'])
// PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
const POLL_FAILED_STATUSES = new Set(['failed', 'cancelled'])

async function safeJson(response) {
  try {
    return await response?.json?.()
  } catch {
    return null
  }
}

function errorMessage(httpStatus, payload) {
  const nested = payload?.error?.message
  if (nested) return String(nested)
  if (payload?.message) return String(payload.message)
  return `HTTP ${httpStatus ?? '?'}`
}

/** xAI raw 오류를 공통 taxonomy로 네이티브 분류한다(Google 문자열 classifier 미사용). */
function classifyGrokError(httpStatus, payload) {
  const error = payload?.error || payload || {}
  const code = String(error.code ?? '').toLowerCase()
  const type = String(error.type ?? '').toLowerCase()
  const message = String(error.message ?? payload?.message ?? '').toLowerCase()
  const signal = `${code} ${type} ${message}`

  // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
  if (httpStatus === 403 || /\b(?:forbidden|entitlement)\b/.test(signal)) return 'forbidden'
  // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
  if (httpStatus === 401 || code === 'invalid_api_key') return 'auth'
  if (httpStatus === 429) {
    // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
    if (/insufficient[ _-]?quota|quota (?:exceeded|exhausted)|billing hard limit/.test(signal)) return 'quota'
    // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
    return 'transient'
  }
  // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
  if (Number.isInteger(httpStatus) && httpStatus >= 500 && httpStatus <= 599) return 'transient'
  // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
  if (/content[ _-]?(?:filter|policy)|\bsafety\b|moderation/.test(signal)) return 'safety'
  return 'other'
}

function failureFromResponse(response, payload, extras = {}) {
  return {
    success: false,
    ...extras,
    error: errorMessage(response?.status, payload),
    errorKind: classifyGrokError(response?.status, payload),
  }
}

function networkFailure(error, extras = {}) {
  return {
    success: false,
    ...extras,
    error: error?.message || String(error),
    errorKind: 'transient',
  }
}

function imagePayload(image) {
  if (!image?.data) return null
  // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
  return { mime_type: image.mimeType || 'image/png', data: image.data }
}

/**
 * Grok 비디오 생성 제출.
 * @returns {Promise<{success:boolean,rawId?:string,appliedInputs?:object,error?:string,errorKind?:string}>}
 */
export async function submitVideo(
  {
    apiKey,
    prompt,
    image = null,
    endImage = null,
    referenceImages = [],
    aspectRatio = DEFAULT_GROK_ASPECT_RATIO,
    durationSeconds = DEFAULT_GROK_DURATION_SECONDS,
    model = DEFAULT_GROK_VIDEO_MODEL,
    seed = null,
    resolution = null,
  } = {},
  { fetchImpl } = {}
) {
  if (!apiKey) return { success: false, error: 'No API key', errorKind: 'auth' }

  const doFetch = fetchImpl ?? fetch
  const selectedModel = model || DEFAULT_GROK_VIDEO_MODEL
  const selectedAspectRatio = aspectRatio || DEFAULT_GROK_ASPECT_RATIO
  const selectedDuration = Number.isFinite(Number(durationSeconds))
    ? Number(durationSeconds)
    : DEFAULT_GROK_DURATION_SECONDS
  const selectedResolution = resolution || null

  // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
  // Every payload field name in this explicit whitelist must be checked against the real API.
  const body = {
    model: selectedModel,
    prompt: prompt || '',
    aspect_ratio: selectedAspectRatio,
    duration: selectedDuration,
  }
  const start = imagePayload(image)
  const end = imagePayload(endImage)
  const refs = Array.isArray(referenceImages)
    ? referenceImages.map(imagePayload).filter(Boolean)
    : []
  if (start) body.image = start
  if (end) body.end_image = end
  if (refs.length > 0) body.reference_images = refs
  if (selectedResolution) body.resolution = selectedResolution
  if (Number.isFinite(seed)) body.seed = seed

  try {
    // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
    const response = await doFetch(`${XAI_BASE}${VIDEO_GENERATIONS_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const data = await safeJson(response)
    if (!response?.ok || data?.error) return failureFromResponse(response, data)

    // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
    const rawId = data?.id
    if (typeof rawId !== 'string' || rawId.length === 0) {
      return { success: false, error: 'Generation ID not returned', errorKind: 'other' }
    }

    const result = { success: true, rawId }
    Object.defineProperty(result, 'appliedInputs', {
      enumerable: false,
      value: {
        model: selectedModel,
        aspectRatio: selectedAspectRatio,
        durationSeconds: selectedDuration,
        resolution: selectedResolution,
      },
    })
    return result
  } catch (error) {
    return networkFailure(error)
  }
}

/** Grok 비디오 generation 상태 1회 조회. operationName은 decoded rawId다. */
export async function checkVideo(
  { apiKey, operationName } = {},
  { fetchImpl } = {}
) {
  if (!apiKey) return { success: false, done: false, error: 'No API key', errorKind: 'auth' }
  if (!operationName) return { success: false, done: false, error: 'No operation name', errorKind: 'other' }

  const doFetch = fetchImpl ?? fetch
  try {
    // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
    const url = `${XAI_BASE}${VIDEO_GENERATIONS_PATH}/${encodeURIComponent(operationName)}`
    const response = await doFetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const data = await safeJson(response)
    if (!response?.ok) return failureFromResponse(response, data, { done: false })

    // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
    const status = String(data?.status ?? '').toLowerCase()
    if (POLL_PENDING_STATUSES.has(status)) return { success: true, done: false }

    if (POLL_FAILED_STATUSES.has(status)) {
      return failureFromResponse(response, data, { done: true })
    }

    if (POLL_DONE_STATUSES.has(status)) {
      // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
      const videoUri = data?.output?.video_url
      if (!videoUri) {
        return {
          success: false,
          done: true,
          error: 'Video URL not found in completed generation',
          errorKind: 'other',
        }
      }
      return { success: true, done: true, videoUri }
    }

    if (data?.error) return failureFromResponse(response, data, { done: false })
    return {
      success: false,
      done: false,
      error: `Unknown generation status: ${status || '(missing)'}`,
      errorKind: 'other',
    }
  } catch (error) {
    return networkFailure(error, { done: false })
  }
}

/** 완료된 Grok video URI를 base64로 다운로드한다. */
export async function fetchVideoBase64(
  { apiKey, videoUri } = {},
  { fetchImpl } = {}
) {
  if (!apiKey) return { success: false, error: 'No API key', errorKind: 'auth' }
  if (!videoUri) return { success: false, error: 'No video URI', errorKind: 'other' }

  const doFetch = fetchImpl ?? fetch
  try {
    // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
    const response = await doFetch(videoUri, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!response?.ok) {
      const data = await safeJson(response)
      return failureFromResponse(response, data)
    }
    const buf = await response.arrayBuffer()
    // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
    const mimeType = response.headers?.get?.('content-type') || 'video/mp4'
    return { success: true, base64: Buffer.from(buf).toString('base64'), mimeType }
  } catch (error) {
    return networkFailure(error)
  }
}

/**
 * xAI 키를 가볍게 검증(§5.7 — 없으면 ApiKeyTab 저장이 막힌다). real-key smoke 전엔 provisional.
 * @returns {Promise<{valid:boolean, error?:string, errorKind?:string}>}
 */
export async function validateKey({ apiKey } = {}, { fetchImpl } = {}) {
  if (!apiKey) return { valid: false, error: 'No API key', errorKind: 'auth' }
  const doFetch = fetchImpl ?? fetch
  try {
    // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
    const response = await doFetch(`${XAI_BASE}/v1/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (response?.ok) return { valid: true }
    const data = await safeJson(response)
    return {
      valid: false,
      error: errorMessage(response?.status, data),
      errorKind: classifyGrokError(response?.status, data),
    }
  } catch (error) {
    return { valid: false, error: error?.message || String(error), errorKind: 'transient' }
  }
}

export const downloadPolicy = {
  origins: [{
    // PROVISIONAL — verify against real xAI API + key (M2 real-key gate)
    // The real result CDN may use a different exact origin.
    origin: XAI_BASE,
    authMode: 'provider-key',
  }],
  buildAuthHeaders(creds) {
    return { Authorization: `Bearer ${creds}` }
  },
}

export const grokVideoProvider = {
  id: 'grok',
  kind: 'video',
  submitVideo,
  checkVideo,
  fetchVideoBase64,
  validateKey,
  downloadPolicy,
  catalogModel: DEFAULT_GROK_VIDEO_MODEL,
}
