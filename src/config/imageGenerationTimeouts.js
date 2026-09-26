export const DEFAULT_FAL_IMAGE_TIMEOUT_MS = 5 * 60 * 1000
export const DEFAULT_IMAGE_ITEM_TIMEOUT_MS = 120000
export const IMAGE_GENERATION_TIMEOUT_MARGIN_MS = 15000

export function providerRunToCompletionCapMs(provider) {
  return provider === 'fal' ? DEFAULT_FAL_IMAGE_TIMEOUT_MS : 0
}

export function imageGenerationItemTimeoutMs(
  provider,
  baseTimeoutMs = DEFAULT_IMAGE_ITEM_TIMEOUT_MS,
) {
  const providerCapMs = providerRunToCompletionCapMs(provider)
  if (providerCapMs === 0) return baseTimeoutMs
  return Math.max(
    baseTimeoutMs,
    providerCapMs + IMAGE_GENERATION_TIMEOUT_MARGIN_MS,
  )
}
