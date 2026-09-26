/**
 * video/wavespeed.js — WaveSpeed raw-REST async video adapter.
 *
 * submit → poll → download 계약만 fixture로 고정한다. 모델/input/status/result shape와
 * CDN 정책은 real-key smoke 전까지 전부 PROVISIONAL이며 선택 UI에서는 숨긴다.
 */
import {
  downloadPolicy,
  fetchWaveSpeedAsset,
  pollWaveSpeedTask,
  submitWaveSpeedTask,
  validateWaveSpeedKey,
  waveSpeedFailure,
} from '../wavespeedClient.js'

// PROVISIONAL — verify the model id and supported inputs with a real WaveSpeed key.
export const DEFAULT_WAVESPEED_VIDEO_MODEL = 'wavespeed-ai/wan-2.1/t2v-480p'
export const DEFAULT_WAVESPEED_ASPECT_RATIO = '16:9'
export const DEFAULT_WAVESPEED_DURATION_SECONDS = 5

// PROVISIONAL — re-pin exact queue statuses from real submit→poll transitions.
const PENDING_STATUSES = new Set(['created', 'queued', 'pending', 'processing'])
const COMPLETED_STATUSES = new Set(['completed', 'succeeded'])
const FAILED_STATUSES = new Set(['failed', 'cancelled'])

function dataUrl(image) {
  if (!image?.data) return null
  return `data:${image.mimeType || 'image/png'};base64,${image.data}`
}

function responseData(payload) {
  return payload?.data ?? payload ?? {}
}

// PROVISIONAL — exact completed result shape requires the real-key smoke.
function completedVideoUrl(data) {
  const first = Array.isArray(data?.outputs) ? data.outputs[0] : null
  if (typeof first === 'string' && first) return first
  if (typeof first?.url === 'string' && first.url) return first.url
  const resultFirst = Array.isArray(data?.result?.urls) ? data.result.urls[0] : null
  if (typeof resultFirst === 'string' && resultFirst) return resultFirst
  return data?.output?.video_url || data?.video_url || null
}

export async function submitVideo(
  {
    apiKey,
    prompt,
    image = null,
    endImage = null,
    referenceImages = [],
    aspectRatio = DEFAULT_WAVESPEED_ASPECT_RATIO,
    durationSeconds = DEFAULT_WAVESPEED_DURATION_SECONDS,
    model = DEFAULT_WAVESPEED_VIDEO_MODEL,
    seed = null,
    resolution = null,
  } = {},
  { fetchImpl } = {},
) {
  if (!apiKey) return { success: false, error: 'No API key', errorKind: 'auth' }

  const selectedModel = model || DEFAULT_WAVESPEED_VIDEO_MODEL
  const selectedAspectRatio = aspectRatio || DEFAULT_WAVESPEED_ASPECT_RATIO
  const selectedDuration = Number.isFinite(Number(durationSeconds))
    ? Number(durationSeconds)
    : DEFAULT_WAVESPEED_DURATION_SECONDS
  const selectedResolution = resolution || null

  // PROVISIONAL — explicit whitelist only; every field name/value mapping needs a real-key smoke.
  // The model id deliberately stays out of this body because WaveSpeed places it in the URL path.
  const input = {
    prompt: prompt || '',
    aspect_ratio: selectedAspectRatio,
    duration: selectedDuration,
  }
  const start = dataUrl(image)
  const end = dataUrl(endImage)
  const refs = Array.isArray(referenceImages)
    ? referenceImages.map(dataUrl).filter(Boolean)
    : []
  if (start) input.image = start
  if (end) input.end_image = end
  if (refs.length > 0) input.reference_images = refs
  if (selectedResolution) input.resolution = selectedResolution
  if (Number.isFinite(seed)) input.seed = seed

  const submitted = await submitWaveSpeedTask({
    apiKey,
    modelId: selectedModel,
    input,
  }, { fetchImpl })
  if (!submitted.success) return submitted

  // PROVISIONAL — exact task_id nesting requires the real-key smoke.
  const rawId = responseData(submitted.payload)?.task_id
  if (typeof rawId !== 'string' || rawId.length === 0) {
    return { success: false, error: 'WaveSpeed task ID not returned', errorKind: 'other' }
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
}

/** WaveSpeed task status 1회 조회. operationName은 handle에서 decode한 raw task_id string이다. */
export async function checkVideo(
  { apiKey, operationName } = {},
  { fetchImpl } = {},
) {
  if (!apiKey) return { success: false, done: false, error: 'No API key', errorKind: 'auth' }
  if (!operationName) {
    return { success: false, done: false, error: 'No operation name', errorKind: 'other' }
  }

  const polled = await pollWaveSpeedTask({
    apiKey,
    taskId: operationName,
  }, { fetchImpl })
  if (!polled.success) return { ...polled, done: false }

  const data = responseData(polled.payload)
  // PROVISIONAL — exact status casing and nesting require the real-key smoke.
  const status = String(data?.status ?? '').toLowerCase()
  if (PENDING_STATUSES.has(status)) {
    // Ordering is load-bearing: never consume a stale/partial output before completed.
    return { success: true, done: false }
  }

  if (FAILED_STATUSES.has(status)) {
    return waveSpeedFailure(200, data, { done: true })
  }

  if (COMPLETED_STATUSES.has(status)) {
    const videoUri = completedVideoUrl(data)
    if (!videoUri) {
      return {
        success: false,
        done: true,
        error: 'Video URL not found in completed WaveSpeed task',
        errorKind: 'other',
      }
    }
    return { success: true, done: true, videoUri }
  }

  return {
    success: false,
    done: false,
    error: `Unknown WaveSpeed task status: ${status || '(missing)'}`,
    errorKind: 'other',
  }
}

export async function fetchVideoBase64(
  { apiKey, videoUri } = {},
  { fetchImpl } = {},
) {
  if (!apiKey) return { success: false, error: 'No API key', errorKind: 'auth' }
  if (!videoUri) return { success: false, error: 'No video URI', errorKind: 'other' }
  return fetchWaveSpeedAsset({ apiKey, assetUrl: videoUri }, {
    fetchImpl,
    defaultMimeType: 'video/mp4',
  })
}

export async function validateKey(
  { apiKey } = {},
  { fetchImpl } = {},
) {
  return validateWaveSpeedKey({ apiKey }, { fetchImpl })
}

export { downloadPolicy }

export const wavespeedVideoProvider = {
  id: 'wavespeed',
  kind: 'video',
  submitVideo,
  checkVideo,
  fetchVideoBase64,
  validateKey,
  downloadPolicy,
  catalogModel: DEFAULT_WAVESPEED_VIDEO_MODEL,
}
