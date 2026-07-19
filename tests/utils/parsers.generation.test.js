import { describe, expect, it } from 'vitest'
import {
  SCENE_GENERATION_CSV_COLUMNS,
  mergeCSVIntoScenes,
  parseCSVToScenes,
  parseSceneCSVToTracks,
  serializeScenesToCSV,
} from '../../src/utils/parsers'

describe('scene generation CSV columns', () => {
  it('round-trips N distinct overrides and asserts exactly N overrides survived', () => {
    const input = [
      {
        id: 'scene_1', prompt: 'one', subtitle: 's1', startTime: 0, endTime: 3,
        generation: {
          image: { provider: 'openai', model: 'gpt-image-1' },
          video: {
            t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' },
            i2v: { provider: 'fal', model: 'fal-ai/kling-video/v2.1/standard/image-to-video' },
          },
        },
      },
      {
        id: 'scene_2', prompt: 'two', subtitle: 's2', startTime: 3, endTime: 6,
        generation: {
          image: { provider: 'fal', model: 'fal-ai/flux-pro/v1.1' },
        },
      },
      {
        id: 'scene_3', prompt: 'three', subtitle: 's3', startTime: 6, endTime: 9,
        generation: {
          video: {
            t2v: { provider: 'wavespeed', model: 'wavespeed-ai/wan-2.1/t2v-480p' },
            i2v: { provider: 'higgsfield', model: 'higgsfield-ai/dop-turbo' },
          },
        },
      },
    ]
    const N = input.length

    const csv = serializeScenesToCSV(input)
    const { scenes: output } = parseSceneCSVToTracks(csv)
    const survivedOverrideCount = output.filter(scene => scene.generation != null).length

    expect(SCENE_GENERATION_CSV_COLUMNS).toEqual([
      'image_provider', 'image_model',
      't2v_provider', 't2v_model',
      'i2v_provider', 'i2v_model',
    ])
    expect(csv.split('\n')[0].split(',')).toEqual(expect.arrayContaining(SCENE_GENERATION_CSV_COLUMNS))
    // CRITICAL: catches a parser+serializer change that silently drops every override.
    expect(survivedOverrideCount).toBe(N)
    expect(output.map(scene => scene.generation)).toEqual(input.map(scene => scene.generation))
  })

  it('parses the six generation columns in legacy row-per-scene CSV too', () => {
    const [scene] = parseCSVToScenes(
      'prompt,image_provider,image_model,t2v_provider,t2v_model,i2v_provider,i2v_model\n' +
      'p,openai,gpt-image-1,grok,grok-imagine-video-1.5,google,veo-3.1-fast-generate-preview'
    )

    expect(scene.generation).toEqual({
      image: { provider: 'openai', model: 'gpt-image-1' },
      video: {
        t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' },
        i2v: { provider: 'google', model: 'veo-3.1-fast-generate-preview' },
      },
    })
  })

  it('empty generation cells preserve existing overrides during CSV merge', () => {
    const existing = [{
      id: 'scene_1', prompt: 'old',
      generation: {
        image: { provider: 'openai', model: 'gpt-image-1' },
        video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } },
      },
    }]

    const [merged] = mergeCSVIntoScenes(
      existing,
      'prompt,image_provider,image_model,t2v_provider,t2v_model,i2v_provider,i2v_model\n' +
      'new,,,,,,'
    )

    expect(merged.prompt).toBe('new')
    expect(merged.generation).toEqual(existing[0].generation)
  })

  it('provider-only CSV patch changes provider and nulls stale model', () => {
    const existing = [{
      id: 'scene_1', prompt: 'old',
      generation: { image: { provider: 'openai', model: 'gpt-image-1' } },
    }]

    const [merged] = mergeCSVIntoScenes(
      existing,
      'prompt,image_provider,image_model\nnew,google,'
    )

    expect(merged.generation.image).toEqual({ provider: 'google', model: null })
  })

  it('__inherit__ provider sentinel deletes that stage override', () => {
    const existing = [{
      id: 'scene_1', prompt: 'old',
      generation: {
        image: { provider: 'openai', model: 'gpt-image-1' },
        video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } },
      },
    }]

    const [merged] = mergeCSVIntoScenes(
      existing,
      'prompt,image_provider,image_model\nnew,__inherit__,'
    )

    expect(merged.generation.image).toBeUndefined()
    expect(merged.generation.video.t2v).toEqual(existing[0].generation.video.t2v)
  })
})
