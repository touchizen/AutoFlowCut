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

  it.each([
    {
      label: 'image',
      model: 'dynamic-openai-image-model',
      patch: { image: { model: 'dynamic-openai-image-model' } },
      settings: {
        generation: { image: { provider: 'openai' } },
        imageModel: 'dynamic-openai-image-model',
        modelsByProvider: { openai: 'stale-openai-image-model' },
      },
      expected: { image: { model: 'dynamic-openai-image-model' } },
    },
    {
      label: 't2v',
      model: 'dynamic-grok-t2v-model',
      patch: { video: { t2v: { model: 'dynamic-grok-t2v-model' } } },
      settings: {
        generation: { video: { t2v: { provider: 'grok' }, i2v: { provider: 'google' } } },
        videoModelT2V: 'dynamic-grok-t2v-model',
        modelsByProviderVideo: { t2v: { grok: 'stale-grok-t2v-model' } },
      },
      expected: { video: { t2v: { model: 'dynamic-grok-t2v-model' } } },
    },
    {
      label: 'i2v',
      model: 'dynamic-grok-i2v-model',
      patch: { video: { i2v: { model: 'dynamic-grok-i2v-model' } } },
      settings: {
        generation: { video: { t2v: { provider: 'google' }, i2v: { provider: 'grok' } } },
        videoModelF2V: 'dynamic-grok-i2v-model',
        modelsByProviderVideo: { i2v: { grok: 'stale-grok-i2v-model' } },
      },
      expected: { video: { i2v: { model: 'dynamic-grok-i2v-model' } } },
    },
  ])('H4: accepts the active non-catalog $label flat selector for its global provider', ({
    patch, settings, expected,
  }) => {
    expect(mergeSceneGeneration(undefined, patch, settings)).toEqual({
      generation: expected,
      warnings: [],
    })
  })

  it.each([
    {
      label: 'image',
      model: 'dynamic-google-image-model',
      provider: 'openai',
      path: 'generation.image',
      patch: { image: { provider: 'openai', model: 'dynamic-google-image-model' } },
      settings: {
        generation: { image: { provider: 'google' } },
        imageModel: 'dynamic-google-image-model',
        modelsByProvider: { google: 'stale-google-image-model' },
      },
    },
    {
      label: 't2v',
      model: 'dynamic-google-t2v-model',
      provider: 'grok',
      path: 'generation.video.t2v',
      patch: { video: { t2v: { provider: 'grok', model: 'dynamic-google-t2v-model' } } },
      settings: {
        generation: { video: { t2v: { provider: 'google' } } },
        videoModelT2V: 'dynamic-google-t2v-model',
        modelsByProviderVideo: { t2v: { google: 'stale-google-t2v-model' } },
      },
    },
    {
      label: 'i2v',
      model: 'dynamic-google-i2v-model',
      provider: 'grok',
      path: 'generation.video.i2v',
      patch: { video: { i2v: { provider: 'grok', model: 'dynamic-google-i2v-model' } } },
      settings: {
        generation: { video: { i2v: { provider: 'google' } } },
        videoModelF2V: 'dynamic-google-i2v-model',
        modelsByProviderVideo: { i2v: { google: 'stale-google-i2v-model' } },
      },
    },
  ])('H4: rejects the global $label flat selector for a non-global provider pair', ({
    model, provider, path, patch, settings,
  }) => {
    const result = mergeSceneGeneration(undefined, patch, settings)

    expect(result.generation).toBeUndefined()
    expect(result.warnings).toEqual([
      `Rejected invalid provider/model pair '${provider}/${model}' at ${path}.`,
    ])
  })
})
