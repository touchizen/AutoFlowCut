import { describe, expect, it } from 'vitest'
import {
  resolveSceneImageProvider,
  resolveSceneVideoProvider,
} from '../../src/utils/sceneProviderResolution'

describe('sceneProviderResolution', () => {
  const settings = {
    generation: {
      image: { provider: 'google' },
      video: {
        t2v: { provider: 'grok' },
        i2v: { provider: 'google' },
      },
    },
    modelsByProvider: {
      google: 'gemini-3-pro-image',
      openai: 'gpt-image-1',
    },
    modelsByProviderVideo: {
      t2v: {
        google: 'veo-3.1-fast-generate-preview',
        grok: 'grok-imagine-video-1.5',
      },
      i2v: {
        google: 'veo-3.1-generate-preview',
        grok: 'grok-imagine-video-1.5',
      },
    },
  }

  it('resolves an image override before the global provider and provider model memory', () => {
    const scene = {
      generation: { image: { provider: 'openai', model: 'gpt-image-custom' } },
    }

    expect(resolveSceneImageProvider(scene, settings)).toEqual({
      provider: 'openai',
      model: 'gpt-image-custom',
    })
  })

  it('uses the selected scene provider model memory when its model is omitted', () => {
    const scene = { generation: { image: { provider: 'openai' } } }

    expect(resolveSceneImageProvider(scene, settings)).toEqual({
      provider: 'openai',
      model: 'gpt-image-1',
    })
  })

  it('F1: override 없는 씬은 활성 imageModel 을 modelsByProvider 슬롯보다 우선 (슬롯 divergence 방어)', () => {
    // modelsByProvider.google 이 stale/flow 로 오염돼도(imageModel 과 다름) 활성 선택이 이겨야
    // — 안 그러면 override 없는 씬이 엉뚱한 모델로 제출돼 배치 전패.
    const diverged = {
      generation: { image: { provider: 'google' } },
      imageModel: 'gemini-3.1-flash-image',          // 활성 선택(진실)
      modelsByProvider: { google: 'flow_stale_model' }, // 오염된 슬롯
    }
    expect(resolveSceneImageProvider({ id: 's1' }, diverged)).toEqual({
      provider: 'google', model: 'gemini-3.1-flash-image',
    })
    // t2v/i2v 도 동일: videoModelT2V/F2V 우선
    const dv = {
      generation: { video: { t2v: { provider: 'google' }, i2v: { provider: 'google' } } },
      videoModelT2V: 'veo-3.1-fast-generate-preview',
      videoModelF2V: 'veo-3.1-generate-preview',
      modelsByProviderVideo: { t2v: { google: 'stale-t2v' }, i2v: { google: 'stale-i2v' } },
    }
    expect(resolveSceneVideoProvider({ id: 's1' }, dv, 't2v').model).toBe('veo-3.1-fast-generate-preview')
    expect(resolveSceneVideoProvider({ id: 's1' }, dv, 'i2v').model).toBe('veo-3.1-generate-preview')
  })

  it('keeps legacy scenes on the global image provider and model', () => {
    expect(resolveSceneImageProvider({ id: 'legacy' }, settings)).toEqual({
      provider: 'google',
      model: 'gemini-3-pro-image',
    })
  })

  it('resolves t2v and i2v independently', () => {
    const scene = {
      generation: {
        video: {
          t2v: { provider: 'google', model: 'veo-scene-t2v' },
          i2v: { provider: 'grok' },
        },
      },
    }

    expect(resolveSceneVideoProvider(scene, settings, 't2v')).toEqual({
      provider: 'google',
      model: 'veo-scene-t2v',
    })
    expect(resolveSceneVideoProvider(scene, settings, 'i2v')).toEqual({
      provider: 'grok',
      model: 'grok-imagine-video-1.5',
    })
  })

  it('uses the provider catalog default when no remembered model exists', () => {
    const scene = { generation: { image: { provider: 'fal' } } }

    expect(resolveSceneImageProvider(scene, settings)).toEqual({
      provider: 'fal',
      model: 'fal-ai/flux-pro/v1.1',
    })
  })

  it('falls an unknown scene provider back to the global provider with a warning payload', () => {
    const scene = {
      id: 'scene_bad',
      generation: { image: { provider: 'not-a-provider', model: 'stale-model' } },
    }

    expect(resolveSceneImageProvider(scene, settings)).toEqual({
      provider: 'google',
      model: 'gemini-3-pro-image',
      warning: "Unknown image provider 'not-a-provider' on scene 'scene_bad'; using global provider 'google'.",
    })
  })
})
