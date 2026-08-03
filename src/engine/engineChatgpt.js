const DEFAULT_RESULT_TIMEOUT_MS = 135_000
const DEFAULT_POLL_MS = 1_500

const api = () => globalThis.window?.electronAPI

const unavailable = (operation) => ({
  success: false,
  errorKind: 'chatgpt-operation-unavailable',
  error: `ChatGPT ${operation} is unavailable on the measured image-only route.`,
})

const referenceRefusal = () => ({
  success: false,
  errorKind: 'chatgpt-reference-images-unmeasured',
  error: 'ChatGPT reference image upload is not measured and remains unavailable.',
})

const optionRefusal = (errorKind, option) => ({
  success: false,
  errorKind,
  error: `ChatGPT ${option} control is not measured, so this request was not submitted.`,
})

// C1: every scene/reference caller forwards the project-level aspectRatio unconditionally
// (useAppSettings defaults it to '16:9', so it is ALWAYS a string). That is settings/display
// plumbing, not an explicit per-request opt-in — refusing it killed every real generation.
// The engine drops it from the IPC payload instead, and announces the limitation so the app
// can surface ONCE that the ChatGPT target does not control aspect ratio (the spike measured
// square output only — we must not pretend a 9:16 project produced a 9:16 image).
const defaultAspectRatioNotice = () => {
  try {
    globalThis.window?.dispatchEvent?.(new CustomEvent('chatgpt-aspect-ratio-ignored'))
  } catch { /* no window / no CustomEvent — nothing to surface to */ }
}

export function createChatgptEngine({
  electronAPI = api(),
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  resultTimeoutMs = DEFAULT_RESULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  onAspectRatioIgnored = defaultAspectRatioNotice,
} = {}) {
  const submitGeneration = async (prompt, referenceImages = [], options = {}) => {
    if (referenceImages != null && (!Array.isArray(referenceImages) || referenceImages.length > 0)) {
      return referenceRefusal()
    }
    // seed/batchCount defaults (null / 1) pass, so these refusals fire only on explicit opt-in.
    if (options.batchCount != null && options.batchCount !== 1) {
      return optionRefusal('chatgpt-batch-count-unmeasured', 'batch count')
    }
    if (options.seed != null) {
      return optionRefusal('chatgpt-seed-unmeasured', 'seed')
    }
    if (options.aspectRatio != null) onAspectRatioIgnored()
    if (typeof electronAPI?.chatgptSubmitGeneration !== 'function') return unavailable('generation')
    // aspectRatio/provider/model are intentionally omitted — unmeasured on this target.
    return electronAPI.chatgptSubmitGeneration({
      prompt,
      referenceImages: [],
      batchCount: options.batchCount ?? 1,
      purpose: options.purpose,
    })
  }

  const checkGeneration = async (generationId) => {
    if (typeof electronAPI?.chatgptObserveGeneration !== 'function') return unavailable('observation')
    return electronAPI.chatgptObserveGeneration(generationId)
  }

  const collectGeneration = async (generationId) => {
    if (typeof electronAPI?.chatgptCollectGeneration !== 'function') return unavailable('collection')
    return electronAPI.chatgptCollectGeneration(generationId)
  }

  const generateImage = async (prompt, referenceImages = [], options = {}) => {
    const submitted = await submitGeneration(prompt, referenceImages, options)
    if (!submitted?.success || !submitted.generationId) return submitted
    const deadline = now() + resultTimeoutMs
    while (now() < deadline) {
      const observed = await checkGeneration(submitted.generationId)
      if (observed?.completed) return collectGeneration(submitted.generationId)
      if (observed?.success === false) return observed
      await sleep(Math.min(pollMs, Math.max(0, deadline - now())))
    }
    return {
      success: false,
      errorKind: 'chatgpt-generation-timeout',
      error: 'ChatGPT image generation timed out.',
    }
  }

  return {
    accessToken: null,
    projectId: null,
    getAccessToken: async () => {
      const status = await electronAPI?.getSessionTargetStatus?.('chatgpt')
      return status?.ready === true ? 'chatgpt-session-ready' : null
    },
    clearTokenCache: () => {},
    listModels: async () => ({ success: true, models: [] }),
    generateImage,
    submitGeneration,
    checkGeneration,
    collectGeneration,
    clearGenerations: async () => electronAPI?.chatgptClearGenerations?.() || { success: true },
    uploadReference: async () => referenceRefusal(),
    fetchMedia: async () => unavailable('media fetch'),
    generateVideoT2V: async () => unavailable('text-to-video'),
    generateVideoI2V: async () => unavailable('image-to-video'),
    checkVideoStatus: async () => unavailable('video observation'),
    downloadVideo: async () => unavailable('video download'),
    upscaleVideo: async () => unavailable('video upscale'),
    upscaleImage: async () => unavailable('image upscale'),
    fetchGallery: async () => unavailable('gallery'),
    listFlowProjects: async () => unavailable('Flow projects'),
    cancelsActiveOnStop: true,
    setStopRequested: async (value) => {
      if (value !== true) return { success: true }
      if (typeof electronAPI?.chatgptCancelGenerations !== 'function') return unavailable('cancellation')
      return electronAPI.chatgptCancelGenerations()
    },
  }
}

export default createChatgptEngine
