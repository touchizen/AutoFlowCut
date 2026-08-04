/** fal.ai image adapter — bounded SDK queue run-to-completion. */
import {
  classifyFalError,
  configureFalClient,
  downloadPolicy,
  falFailure,
  fetchFalAsset,
  isFalCompletedStatus,
  isFalDeadlineError,
  isFalPendingStatus,
  isValidFalEndpointId,
  validateKey,
  withAbortSignal,
  withFalDeadline,
} from '../falClient.js'
import { DEFAULT_FAL_IMAGE_TIMEOUT_MS as FAL_IMAGE_TIMEOUT_MS } from '../../../../src/config/imageGenerationTimeouts.js'

// PROVISIONAL — verify model id and endpoint behavior with a real fal key (M4 real-key gate).
export const DEFAULT_FAL_IMAGE_MODEL = 'fal-ai/flux-pro/v1.1'
export const DEFAULT_FAL_IMAGE_POLL_INTERVAL_MS = 1000
export const DEFAULT_FAL_IMAGE_TIMEOUT_MS = FAL_IMAGE_TIMEOUT_MS
export const DEFAULT_FAL_IMAGE_MAX_ATTEMPTS = Math.ceil(
  DEFAULT_FAL_IMAGE_TIMEOUT_MS / DEFAULT_FAL_IMAGE_POLL_INTERVAL_MS,
) + 1
const FAL_IMAGE_TIMEOUT_ERROR = 'fal image polling timed out'
const FAL_CANCEL_TIMEOUT_MS = 5000

const IMAGE_SIZE_BY_ASPECT = Object.freeze({
  // PROVISIONAL — verify fal image_size mapping with a real fal key (M4 real-key gate).
  '1:1': 'square_hd',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
  '4:3': 'landscape_4_3',
  '3:4': 'portrait_4_3',
})

function abortFailure() {
  return {
    success: false,
    error: 'Operation aborted',
    errorKind: 'aborted',
    aborted: true,
  }
}

function legacyAbortFailure() {
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
    maxAttempts,
    pollIntervalMs = DEFAULT_FAL_IMAGE_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_FAL_IMAGE_TIMEOUT_MS,
  } = {}
) {
  let sdk
  let requestId
  let cancelPromise = null

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
  if (!isValidFalEndpointId(selectedModel)) {
    return { success: false, error: 'Invalid fal endpoint ID', errorKind: 'invalid-config' }
  }
  const numericTimeoutMs = Number(timeoutMs)
  const timeoutLimit = Math.max(
    1,
    Number.isFinite(numericTimeoutMs) && numericTimeoutMs !== 0
      ? numericTimeoutMs
      : DEFAULT_FAL_IMAGE_TIMEOUT_MS,
  )
  const numericPollIntervalMs = Number(pollIntervalMs)
  const effectivePollIntervalMs = Math.max(
    1,
    Number.isFinite(numericPollIntervalMs)
      ? numericPollIntervalMs
      : DEFAULT_FAL_IMAGE_POLL_INTERVAL_MS,
  )
  // deadline is authoritative. The derived count is only a runaway-loop backstop;
  // callers can still provide a smaller explicit maxAttempts for tests/diagnostics.
  const derivedAttemptsLimit = Math.ceil(
    timeoutLimit / effectivePollIntervalMs,
  ) + 1
  const attemptsLimit = maxAttempts == null
    ? derivedAttemptsLimit
    : Math.max(1, Math.floor(Number(maxAttempts) || DEFAULT_FAL_IMAGE_MAX_ATTEMPTS))
  const startedAt = Date.now()
  const deadline = startedAt + timeoutLimit
  // PROVISIONAL — whitelist and input field names require the M4 real-key smoke.
  const input = {
    prompt: prompt || '',
    image_size: IMAGE_SIZE_BY_ASPECT[aspectRatio] || IMAGE_SIZE_BY_ASPECT['1:1'],
    num_images: 1,
    output_format: 'png',
  }

  const cancelServerOnce = () => {
    if (cancelPromise) return cancelPromise
    cancelPromise = (async () => {
      if (!sdk || !requestId) return

      const controller = new AbortController()
      let timeoutId
      let onAbort
      const deadline = new Promise((resolve) => {
        onAbort = resolve
        controller.signal.addEventListener('abort', onAbort, { once: true })
        timeoutId = setTimeout(() => controller.abort(), FAL_CANCEL_TIMEOUT_MS)
      })
      const transport = Promise.resolve()
        .then(() => sdk.queue.cancel(selectedModel, {
          requestId,
          abortSignal: controller.signal,
        }))
        .catch(() => undefined)
      try {
        await Promise.race([transport, deadline])
      } finally {
        clearTimeout(timeoutId)
        controller.signal.removeEventListener('abort', onAbort)
      }
    })()
    return cancelPromise
  }

  const abortWithServerCancel = async () => {
    await cancelServerOnce()
    return abortFailure()
  }

  try {
    sdk = configureFalClient(apiKey, client)
    const submitted = await withFalDeadline(
      () => sdk.queue.submit(
        selectedModel,
        withAbortSignal({ input }, signal),
      ),
      { deadline, signal, timeoutMessage: FAL_IMAGE_TIMEOUT_ERROR },
    )
    requestId = submitted?.request_id
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return { success: false, error: 'fal request ID not returned', errorKind: 'other' }
    }

    let attempt = 0
    while (Date.now() < deadline && attempt < attemptsLimit) {
      attempt += 1
      if (signal?.aborted) return abortWithServerCancel()

      try {
        const status = await withFalDeadline(
          () => sdk.queue.status(
            selectedModel,
            withAbortSignal({ requestId }, signal),
          ),
          { deadline, signal, timeoutMessage: FAL_IMAGE_TIMEOUT_ERROR },
        )
        if (signal?.aborted) return abortWithServerCancel()

        if (isFalCompletedStatus(status?.status)) {
          const result = await withFalDeadline(
            () => sdk.queue.result(
              selectedModel,
              withAbortSignal({ requestId }, signal),
            ),
            { deadline, signal, timeoutMessage: FAL_IMAGE_TIMEOUT_ERROR },
          )
          if (signal?.aborted) return abortWithServerCancel()
          const image = firstImageFromResult(result)
          if (!image.url) {
            return { success: false, error: 'Image URL not found in fal result', errorKind: 'other' }
          }
          const downloaded = await withFalDeadline(
            () => fetchFalAsset(image.url, {
              fetchImpl,
              defaultMimeType: image.contentType || 'image/png',
              ...(signal ? { signal } : {}),
            }),
            { deadline, signal, timeoutMessage: FAL_IMAGE_TIMEOUT_ERROR },
          )
          if (signal?.aborted) return abortWithServerCancel()
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
      } catch (error) {
        if (signal?.aborted) return abortWithServerCancel()
        if (error?.name === 'AbortError') return legacyAbortFailure()
        if (isFalDeadlineError(error)) throw error
        if (classifyFalError(error) !== 'transient') throw error
      }
      if (attempt < attemptsLimit && Date.now() < deadline) {
        await withFalDeadline(
          () => delay(effectivePollIntervalMs, signal),
          { deadline, signal, timeoutMessage: FAL_IMAGE_TIMEOUT_ERROR },
        )
      }
    }

    if (Date.now() >= deadline) {
      return { success: false, error: FAL_IMAGE_TIMEOUT_ERROR, errorKind: 'transient' }
    }

    return {
      success: false,
      error: `fal image polling timed out after ${attemptsLimit} attempts`,
      errorKind: 'transient',
    }
  } catch (error) {
    if (signal?.aborted) return abortWithServerCancel()
    if (error?.name === 'AbortError') return legacyAbortFailure()
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
