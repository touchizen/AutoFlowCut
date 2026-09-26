/**
 * alignMcpModelProviders — MCP update-settings 의 모델 키를 provider 와 맞춘다(main 병합 리뷰 A F3).
 */
import { describe, expect, it } from 'vitest'
import { alignMcpModelProviders } from '../../src/utils/mcpModelProviderAlign'

const base = {
  imageModel: 'gpt-image-1', videoModelT2V: 'veo-3.1-fast-generate-preview', videoModelF2V: 'veo-3.1-generate-preview',
  generation: { image: { provider: 'openai' }, video: { t2v: { provider: 'google' }, i2v: { provider: 'google' } } },
  modelsByProvider: { openai: 'gpt-image-1' }, modelsByProviderVideo: { t2v: {}, i2v: {} },
}

describe('alignMcpModelProviders', () => {
  it('image: 다른 provider 의 카탈로그 모델 → provider 전환 + 이전 모델 슬롯 기억 + 모델은 요청값', () => {
    const next = alignMcpModelProviders(base, { imageModel: 'gemini-3-pro-image' })
    expect(next).toMatchObject({ imageModel: 'gemini-3-pro-image', generation: { image: { provider: 'google' } }, modelsByProvider: { openai: 'gpt-image-1' } })
  })
  it('video: t2v·i2v 를 각자 — grok 모델은 그 stage 만 grok 으로, 다른 stage 는 그대로', () => {
    const next = alignMcpModelProviders(base, { videoModelF2V: 'grok-imagine-video-1.5' })
    expect(next.generation.video).toEqual({ t2v: { provider: 'google' }, i2v: { provider: 'grok' } })
    expect(next.videoModelF2V).toBe('grok-imagine-video-1.5')
    expect(next.modelsByProviderVideo.i2v.google).toBe('veo-3.1-generate-preview')
    expect(next.videoModelT2V).toBe('veo-3.1-fast-generate-preview')
  })
  it('같은 provider 의 모델·카탈로그 밖 이름(Flow 모델)은 provider·슬롯을 건드리지 않고 값만 병합', () => {
    expect(alignMcpModelProviders(base, { imageModel: 'Nano Banana Pro', videoModelT2V: 'veo-3.1-lite-generate-preview' }))
      .toEqual({ ...base, imageModel: 'Nano Banana Pro', videoModelT2V: 'veo-3.1-lite-generate-preview' })
  })
  it('모델 키가 없으면 그대로 병합(다른 키만)', () => {
    expect(alignMcpModelProviders(base, { aspectRatio: '9:16' })).toEqual({ ...base, aspectRatio: '9:16' })
  })
})
