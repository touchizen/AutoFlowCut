import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_ITEM_TIMEOUT_MS,
  IMAGE_GENERATION_TIMEOUT_MARGIN_MS,
  imageGenerationItemTimeoutMs,
  providerRunToCompletionCapMs,
} from '../../src/config/imageGenerationTimeouts'
import { DEFAULT_FAL_IMAGE_TIMEOUT_MS } from '../../electron/api/providers/image/fal.js'

describe('image generation provider timeout policy', () => {
  it('L2: fal item budget includes the adapter run-to-completion cap', () => {
    expect(DEFAULT_FAL_IMAGE_TIMEOUT_MS).toBe(300000)
    expect(providerRunToCompletionCapMs('fal')).toBe(DEFAULT_FAL_IMAGE_TIMEOUT_MS)
    expect(IMAGE_GENERATION_TIMEOUT_MARGIN_MS).toBe(15000)
    expect(imageGenerationItemTimeoutMs('fal')).toBe(315000)
    expect(imageGenerationItemTimeoutMs('fal', 180000)).toBe(315000)
  })

  it.each(['google', 'openai', undefined])(
    'L2: %s keeps the legacy 120-second item timeout',
    provider => {
      expect(providerRunToCompletionCapMs(provider)).toBe(0)
      expect(imageGenerationItemTimeoutMs(provider)).toBe(DEFAULT_IMAGE_ITEM_TIMEOUT_MS)
      expect(imageGenerationItemTimeoutMs(provider)).toBe(120000)
    },
  )
})
