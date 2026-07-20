/** fal.ai video adapter — SDK submit/status/result plus signed-CDN download. */
import {
  classifyFalError,
  configureFalClient,
  downloadPolicy,
  falFailure,
  fetchFalAsset,
  isFalCompletedStatus,
  isFalPendingStatus,
  isValidFalEndpointId,
  validateKey,
  withAbortSignal,
} from '../falClient.js'

// PROVISIONAL — verify model id and endpoint behavior with a real fal key (M4 real-key gate).
export const DEFAULT_FAL_VIDEO_MODEL = 'fal-ai/kling-video/v2.1/standard/image-to-video'
export const DEFAULT_FAL_VIDEO_DURATION_SECONDS = 5

function dataUrl(image) {
  if (!image?.data) return null
  return `data:${image.mimeType || 'image/png'};base64,${image.data}`
}

function durationForFal(value) {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 8 ? 10 : 5
}

function invalidInput(error, errorKind = 'invalid-input') {
  return { success: false, error, errorKind }
}

// PROVISIONAL — verify result data shape with a real fal key (M4 real-key gate).
function videoUrlFromResult(result) {
  return result?.data?.video?.url
    || result?.data?.video_url
    || result?.data?.output?.video_url
    || null
}

export async function submitVideo(
  {
    apiKey,
    prompt,
    image = null,
    endImage = null,
    referenceImages = [],
    aspectRatio = null,
    durationSeconds = DEFAULT_FAL_VIDEO_DURATION_SECONDS,
    model = DEFAULT_FAL_VIDEO_MODEL,
    seed = null,
    resolution = null,
    signal,
  } = {},
  { client = null } = {}
) {
  if (!apiKey) return { success: false, error: 'No API key', errorKind: 'auth' }
  const startImageUrl = dataUrl(image)
  if (!startImageUrl) return invalidInput('fal video model requires a start image')
  if (endImage || (Array.isArray(referenceImages) && referenceImages.length > 0)) {
    return invalidInput('fal video model does not support end/reference images', 'invalid-config')
  }

  const selectedModel = model || DEFAULT_FAL_VIDEO_MODEL
  if (!isValidFalEndpointId(selectedModel)) {
    return invalidInput('Invalid fal endpoint ID', 'invalid-config')
  }
  const selectedDuration = durationForFal(durationSeconds)
  // PROVISIONAL — whitelist and input field names require the M4 real-key smoke.
  const input = {
    prompt: prompt || '',
    image_url: startImageUrl,
    duration: String(selectedDuration),
  }

  try {
    const sdk = configureFalClient(apiKey, client)
    const submitted = await sdk.queue.submit(
      selectedModel,
      withAbortSignal({ input }, signal),
    )
    // PROVISIONAL — queue.submit request_id shape requires the M4 real-key smoke.
    const requestId = submitted?.request_id
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return { success: false, error: 'fal request ID not returned', errorKind: 'other' }
    }
    return {
      success: true,
      rawId: { model_id: selectedModel, request_id: requestId },
      appliedInputs: {
        model: selectedModel,
        aspectRatio: null,
        durationSeconds: selectedDuration,
        resolution: null,
      },
    }
  } catch (error) {
    return falFailure(error)
  }
}

export async function checkVideo(
  { apiKey, operationName, signal } = {},
  { client = null } = {}
) {
  if (!apiKey) return { success: false, done: false, error: 'No API key', errorKind: 'auth' }
  const modelId = operationName?.model_id
  const requestId = operationName?.request_id
  if (!modelId || !requestId) {
    return { success: false, done: false, error: 'Invalid fal operation handle', errorKind: 'invalid-input' }
  }
  if (!isValidFalEndpointId(modelId)) {
    return { success: false, done: false, error: 'Invalid fal endpoint ID', errorKind: 'invalid-config' }
  }

  let completed = false
  try {
    const sdk = configureFalClient(apiKey, client)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const status = await sdk.queue.status(
          modelId,
          withAbortSignal({ requestId }, signal),
        )
        if (isFalPendingStatus(status?.status)) return { success: true, done: false }
        if (!isFalCompletedStatus(status?.status)) {
          return {
            success: false,
            done: false,
            error: `Unknown fal queue status: ${status?.status || '(missing)'}`,
            errorKind: 'other',
          }
        }

        completed = true
        // Status metadata is not the output. result() is required after COMPLETED.
        const result = await sdk.queue.result(
          modelId,
          withAbortSignal({ requestId }, signal),
        )
        const videoUri = videoUrlFromResult(result)
        if (!videoUri) {
          return {
            success: false,
            done: true,
            error: 'Video URL not found in fal result',
            errorKind: 'other',
          }
        }
        return { success: true, done: true, videoUri }
      } catch (error) {
        if (attempt === 0 && error?.name !== 'AbortError' && classifyFalError(error) === 'transient') {
          continue
        }
        return falFailure(error, { done: completed })
      }
    }
  } catch (error) {
    return falFailure(error, { done: completed })
  }
}

export async function fetchVideoBase64(
  { apiKey, videoUri } = {},
  { fetchImpl } = {}
) {
  if (!apiKey) return { success: false, error: 'No API key', errorKind: 'auth' }
  if (!videoUri) return { success: false, error: 'No video URI', errorKind: 'invalid-input' }
  return fetchFalAsset(videoUri, { fetchImpl, defaultMimeType: 'video/mp4' })
}

export { downloadPolicy, validateKey }

export const falVideoProvider = {
  id: 'fal',
  kind: 'video',
  submitVideo,
  checkVideo,
  fetchVideoBase64,
  validateKey,
  downloadPolicy,
  catalogModel: DEFAULT_FAL_VIDEO_MODEL,
}
