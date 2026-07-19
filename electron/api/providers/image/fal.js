/** fal.ai image adapter — bounded SDK queue run-to-completion. */
import {
  configureFalClient,
  downloadPolicy,
  falFailure,
  fetchFalAsset,
  isFalCompletedStatus,
  isFalPendingStatus,
  validateKey,
  withAbortSignal,
} from '../falClient.js'

// PROVISIONAL — verify model id and endpoint behavior with a real fal key (M4 real-key gate).
export const DEFAULT_FAL_IMAGE_MODEL = 'fal-ai/flux-pro/v1.1'
export const DEFAULT_FAL_IMAGE_MAX_ATTEMPTS = 120
export const DEFAULT_FAL_IMAGE_POLL_INTERVAL_MS = 1000
export const DEFAULT_FAL_IMAGE_TIMEOUT_MS = 5 * 60 * 1000

const IMAGE_SIZE_BY_ASPECT = Object.freeze({
  // PROVISIONAL — verify fal image_size mapping with a real fal key (M4 real-key gate).
  '1:1': 'square_hd',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
  '4:3': 'landscape_4_3',
  '3:4': 'portrait_4_3',
})

function abortFailure() {
  return { success: false, error: 'Operation aborted', errorKind: 'transient' }
}

function delay(ms, signal) {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', done)
      resolve()
    }
    signal?.addEventListener?.('abort', done, { once: true })
  })
}

// PROVISIONAL — verify result data shape with a real fal key (M4 real-key gate).
function firstImageFromResult(result) {
  const image = result?.data?.images?.[0] || result?.data?.image || null
  if (typeof image === 'string') return { url: image, contentType: null }
  return { url: image?.url || null, contentType: image?.content_type || null }
}

export async function generateImage(
  {
    apiKey,
    prompt,
    referenceImages = [],
    aspectRatio = '1:1',
    model = DEFAULT_FAL_IMAGE_MODEL,
    signal,
  } = {},
  {
    client = null,
    fetchImpl,
    maxAttempts = DEFAULT_FAL_IMAGE_MAX_ATTEMPTS,
    pollIntervalMs = DEFAULT_FAL_IMAGE_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_FAL_IMAGE_TIMEOUT_MS,
  } = {}
) {
  if (!apiKey) return { success: false, error: 'No API key', errorKind: 'auth' }
  if (signal?.aborted) return abortFailure()
  if (!Array.isArray(referenceImages)) {
    return { success: false, error: 'referenceImages must be an array', errorKind: 'invalid-input' }
  }
  if (referenceImages.length > 0) {
    return {
      success: false,
      error: 'fal image model does not support reference images',
      errorKind: 'invalid-config',
    }
  }

  const selectedModel = model || DEFAULT_FAL_IMAGE_MODEL
  const attemptsLimit = Math.max(1, Math.floor(Number(maxAttempts) || DEFAULT_FAL_IMAGE_MAX_ATTEMPTS))
  const timeoutLimit = Math.max(1, Number(timeoutMs) || DEFAULT_FAL_IMAGE_TIMEOUT_MS)
  const startedAt = Date.now()
  // PROVISIONAL — whitelist and input field names require the M4 real-key smoke.
  const input = {
    prompt: prompt || '',
    image_size: IMAGE_SIZE_BY_ASPECT[aspectRatio] || IMAGE_SIZE_BY_ASPECT['1:1'],
    num_images: 1,
    output_format: 'png',
  }

  try {
    const sdk = configureFalClient(apiKey, client)
    const submitted = await sdk.queue.submit(
      selectedModel,
      withAbortSignal({ input }, signal),
    )
    const requestId = submitted?.request_id
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return { success: false, error: 'fal request ID not returned', errorKind: 'other' }
    }

    for (let attempt = 0; attempt < attemptsLimit; attempt += 1) {
      if (signal?.aborted) return abortFailure()
      if (Date.now() - startedAt >= timeoutLimit) {
        return { success: false, error: 'fal image polling timed out', errorKind: 'transient' }
      }

      const status = await sdk.queue.status(
        selectedModel,
        withAbortSignal({ requestId }, signal),
      )
      if (signal?.aborted) return abortFailure()

      if (isFalCompletedStatus(status?.status)) {
        const result = await sdk.queue.result(
          selectedModel,
          withAbortSignal({ requestId }, signal),
        )
        if (signal?.aborted) return abortFailure()
        const image = firstImageFromResult(result)
        if (!image.url) {
          return { success: false, error: 'Image URL not found in fal result', errorKind: 'other' }
        }
        const downloaded = await fetchFalAsset(image.url, {
          fetchImpl,
          defaultMimeType: image.contentType || 'image/png',
        })
        if (!downloaded.success) return downloaded
        return {
          success: true,
          images: [{
            base64: downloaded.base64,
            mimeType: downloaded.mimeType,
            dataUrl: `data:${downloaded.mimeType};base64,${downloaded.base64}`,
          }],
          actualAspectRatio: null,
        }
      }

      if (!isFalPendingStatus(status?.status)) {
        return {
          success: false,
          error: `Unknown fal queue status: ${status?.status || '(missing)'}`,
          errorKind: 'other',
        }
      }
      if (attempt + 1 < attemptsLimit) await delay(pollIntervalMs, signal)
    }

    return {
      success: false,
      error: `fal image polling timed out after ${attemptsLimit} attempts`,
      errorKind: 'transient',
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') return abortFailure()
    return falFailure(error)
  }
}

export const falImageProvider = {
  id: 'fal',
  kind: 'image',
  generateImage,
  validateKey,
  downloadPolicy,
  catalogModel: DEFAULT_FAL_IMAGE_MODEL,
}
