import { describe, expect, it } from 'vitest'
import { mergeSceneGenerationForMcp } from '../../src/hooks/useMcpServer'

const existing = {
  id: 'scene_1',
  generation: {
    image: { provider: 'openai', model: 'gpt-image-1' },
    video: {
      t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' },
      i2v: { provider: 'google', model: 'veo-3.1-fast-generate-preview' },
    },
  },
}

describe('useMcpServer update-scenes generation deep merge', () => {
  it('incoming generation omitted preserves the existing override', () => {
    expect(mergeSceneGenerationForMcp(existing, { id: 'scene_1', prompt: 'new' })).toEqual({
      generation: existing.generation,
      warnings: [],
    })
  })

  it('an image-only patch preserves both video stages', () => {
    const result = mergeSceneGenerationForMcp(existing, {
      generation: { image: { provider: 'fal', model: 'fal-ai/flux-pro/v1.1' } },
    })

    expect(result.generation).toEqual({
      image: { provider: 'fal', model: 'fal-ai/flux-pro/v1.1' },
      video: existing.generation.video,
    })
  })

  it('stage null deletes only that override so it inherits global', () => {
    const result = mergeSceneGenerationForMcp(existing, {
      generation: { video: { t2v: null } },
    })

    expect(result.generation.video.t2v).toBeUndefined()
    expect(result.generation.video.i2v).toEqual(existing.generation.video.i2v)
    expect(result.generation.image).toEqual(existing.generation.image)
  })

  it('provider-only patch nulls the stale model', () => {
    const result = mergeSceneGenerationForMcp(existing, {
      generation: { image: { provider: 'google' } },
    })

    expect(result.generation.image).toEqual({ provider: 'google', model: null })
  })

  it('rejects only an invalid provider leaf while applying a valid sibling leaf', () => {
    const result = mergeSceneGenerationForMcp(existing, {
      generation: {
        image: { provider: 'unknown-provider', model: 'x' },
        video: { t2v: { provider: 'wavespeed', model: 'wavespeed-ai/wan-2.1/t2v-480p' } },
      },
    })

    expect(result.generation.image).toEqual(existing.generation.image)
    expect(result.generation.video.t2v).toEqual({
      provider: 'wavespeed', model: 'wavespeed-ai/wan-2.1/t2v-480p',
    })
    expect(result.warnings).toEqual([
      "Rejected unknown provider 'unknown-provider' at generation.image.",
    ])
  })

  it('rejects an invalid provider/model pair without disturbing the old leaf', () => {
    const result = mergeSceneGenerationForMcp(existing, {
      generation: { image: { provider: 'openai', model: 'not-an-openai-model' } },
    })

    expect(result.generation.image).toEqual(existing.generation.image)
    expect(result.warnings).toHaveLength(1)
  })
})
