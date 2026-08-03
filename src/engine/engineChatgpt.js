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

export function createChatgptEngine({
  electronAPI = api(),
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  resultTimeoutMs = DEFAULT_RESULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
} = {}) {
  const submitGeneration = async (prompt, referenceImages = [], options = {}) => {
    if (Array.isArray(referenceImages) && referenceImages.length > 0) return referenceRefusal()
    if (typeof electronAPI?.chatgptSubmitGeneration !== 'function') return unavailable('generation')
    return electronAPI.chatgptSubmitGeneration({
      prompt,
      referenceImages: [],
      batchCount: options.batchCount ?? 1,
      aspectRatio: options.aspectRatio,
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
    setStopRequested: () => {},
  }
}

export default createChatgptEngine
