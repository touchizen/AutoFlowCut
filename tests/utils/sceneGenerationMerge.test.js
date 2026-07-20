import { describe, expect, it } from 'vitest'
import { mergeSceneGeneration } from '../../src/utils/sceneGenerationMerge'

describe('mergeSceneGeneration — model-only effective provider validation', () => {
  it('G1: accepts a catalog model-only patch using the effective global image provider without storing provider', () => {
    const result = mergeSceneGeneration(undefined, {
      image: { model: 'gemini-3-pro-image' },
    }, {
      generation: { image: { provider: 'google' } },
    })

    expect(result).toEqual({
      generation: { image: { model: 'gemini-3-pro-image' } },
      warnings: [],
    })
  })

  it('G1: accepts a model-only patch from the effective video provider memory slot', () => {
    const result = mergeSceneGeneration(undefined, {
      video: { i2v: { model: 'custom-google-i2v-model' } },
    }, {
      generation: { video: { i2v: { provider: 'google' } } },
      modelsByProviderVideo: {
        i2v: { google: 'custom-google-i2v-model' },
      },
    })

    expect(result).toEqual({
      generation: { video: { i2v: { model: 'custom-google-i2v-model' } } },
      warnings: [],
    })
  })

  it('G1: accepts a model-only patch from the effective image provider memory slot', () => {
    const result = mergeSceneGeneration(undefined, {
      image: { model: 'custom-openai-image-model' },
    }, {
      generation: { image: { provider: 'openai' } },
      modelsByProvider: { openai: 'custom-openai-image-model' },
    })

    expect(result).toEqual({
      generation: { image: { model: 'custom-openai-image-model' } },
      warnings: [],
    })
  })

  it('G1: rejects a model-only patch invalid under the effective global provider', () => {
    const result = mergeSceneGeneration(undefined, {
      video: { t2v: { model: 'veo-3.1-fast-generate-preview' } },
    }, {
      generation: { video: { t2v: { provider: 'grok' } } },
    })

    expect(result.generation).toBeUndefined()
    expect(result.warnings).toEqual([
      "Rejected invalid model 'veo-3.1-fast-generate-preview' at generation.video.t2v.",
    ])
  })

  it('G1: existing override provider wins over the effective global provider for model-only validation', () => {
    const result = mergeSceneGeneration({
      video: { t2v: { provider: 'grok', model: 'old-grok-model' } },
    }, {
      video: { t2v: { model: 'grok-imagine-video-1.5' } },
    }, {
      generation: { video: { t2v: { provider: 'google' } } },
    })

    expect(result).toEqual({
      generation: {
        video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } },
      },
      warnings: [],
    })
  })
})
