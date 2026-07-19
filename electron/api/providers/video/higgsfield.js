/**
 * video/higgsfield.js — Higgsfield raw-REST async video adapter.
 *
 * Model, payload, paths, statuses, result shape, and CDN policy are PROVISIONAL
 * until a real-key submit→poll→download smoke passes.
 */
import {
  downloadPolicy,
  fetchHiggsfieldAsset,
  higgsfieldFailure,
  pollHiggsfieldTask,
  submitHiggsfieldTask,
  validateHiggsfieldKey,
} from '../higgsfieldClient.js'

// PROVISIONAL — verify exact model id with a real Higgsfield key pair.
export const DEFAULT_HIGGSFIELD_VIDEO_MODEL = 'higgsfield-ai/dop-turbo'
export const DEFAULT_HIGGSFIELD_ASPECT_RATIO = '16:9'
export const DEFAULT_HIGGSFIELD_DURATION_SECONDS = 5

// PROVISIONAL — re-pin exact queue status values with a real-key smoke.
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

// PROVISIONAL — exact completed-result nesting requires a real-key smoke.
function completedVideoUrl(data) {
  const resultFirst = Array.isArray(data?.result?.urls) ? data.result.urls[0] : null
  if (typeof resultFirst === 'string' && resultFirst) return resultFirst
  const outputFirst = Array.isArray(data?.outputs) ? data.outputs[0] : null
  if (typeof outputFirst === 'string' && outputFirst) return outputFirst
  if (typeof outputFirst?.url === 'string' && outputFirst.url) return outputFirst.url
  return data?.output?.video_url || data?.video_url || null
}

export async function submitVideo(
  {
    apiKey,
    prompt,
    image = null,
    endImage = null,
    referenceImages = [],
    aspectRatio = DEFAULT_HIGGSFIELD_ASPECT_RATIO,
    durationSeconds = DEFAULT_HIGGSFIELD_DURATION_SECONDS,
    model = DEFAULT_HIGGSFIELD_VIDEO_MODEL,
    seed = null,
    resolution = null,
  } = {},
  { fetchImpl } = {},
) {
  const selectedModel = model || DEFAULT_HIGGSFIELD_VIDEO_MODEL
  const selectedAspectRatio = aspectRatio || DEFAULT_HIGGSFIELD_ASPECT_RATIO
  const selectedDuration = Number.isFinite(Number(durationSeconds))
    ? Number(durationSeconds)
    : DEFAULT_HIGGSFIELD_DURATION_SECONDS
  const selectedResolution = resolution || null

  // PROVISIONAL — every field name and value mapping requires a real-key smoke.
  const input = {
    model: selectedModel,
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

  const submitted = await submitHiggsfieldTask({ apiKey, input }, { fetchImpl })
  if (!submitted.success) return submitted

  // PROVISIONAL — accept only a string id even if the exact nesting changes at real-key smoke.
  const data = responseData(submitted.payload)
  const rawId = typeof data === 'string'
    ? data
    : data?.id ?? data?.job_id ?? data?.task_id
  if (typeof rawId !== 'string' || rawId.length === 0) {
    return { success: false, error: 'Higgsfield job ID not returned', errorKind: 'other' }
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
export async function checkVideo(
  { apiKey, operationName } = {},
  { fetchImpl } = {},
) {
  if (!operationName) {
    return { success: false, done: false, error: 'No operation name', errorKind: 'other' }
  }

  const polled = await pollHiggsfieldTask({
    apiKey,
    taskId: operationName,
  }, { fetchImpl })
  if (!polled.success) return { ...polled, done: false }

  const data = responseData(polled.payload)
  const status = String(data?.status ?? '').toLowerCase()
  if (PENDING_STATUSES.has(status)) return { success: true, done: false }

  if (FAILED_STATUSES.has(status)) {
    return higgsfieldFailure(200, data, { done: true })
  }

  if (COMPLETED_STATUSES.has(status)) {
    const videoUri = completedVideoUrl(data)
    if (!videoUri) {
      return {
        success: false,
        done: true,
        error: 'Video URL not found in completed Higgsfield job',
        errorKind: 'other',
      }
    }
    return { success: true, done: true, videoUri }
  }

  return {
    success: false,
    done: false,
    error: `Unknown Higgsfield job status: ${status || '(missing)'}`,
    errorKind: 'other',
  }
}
export async function fetchVideoBase64(
  { apiKey, videoUri } = {},
  { fetchImpl } = {},
) {
  if (!videoUri) return { success: false, error: 'No video URI', errorKind: 'other' }
  return fetchHiggsfieldAsset({ apiKey, assetUrl: videoUri }, {
    fetchImpl,
    defaultMimeType: 'video/mp4',
  })
}
export async function validateKey(
  { apiKey } = {},
  { fetchImpl } = {},
) {
  return validateHiggsfieldKey({ apiKey }, { fetchImpl })
}

export { downloadPolicy }

export const higgsfieldVideoProvider = {
  id: 'higgsfield',
  kind: 'video',
  submitVideo,
  checkVideo,
  fetchVideoBase64,
  validateKey,
  downloadPolicy,
  catalogModel: DEFAULT_HIGGSFIELD_VIDEO_MODEL,
}
