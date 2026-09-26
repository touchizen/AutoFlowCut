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
  it('같은 provider 의 카탈로그 모델은 provider·슬롯을 건드리지 않고 값만 병합', () => {
    expect(alignMcpModelProviders(base, { imageModel: 'gpt-image-1', videoModelT2V: 'veo-3.1-lite-generate-preview' }))
      .toEqual({ ...base, imageModel: 'gpt-image-1', videoModelT2V: 'veo-3.1-lite-generate-preview' })
  })
  // 리뷰 A R3-1: 카탈로그 밖 이름(라벨·Flow 이름·동적 모델)은 google 모델로 본다(imageModelsForProvider 와 같은 규칙) — 비-google provider 에
  //   남기면 {openai, 'Nano Banana Pro'} 가 되어 heal 도 못 고치고(비-google 은 heal 대상 아님) 모든 생성이 실패한다. google 로 맞추면 heal 이 google 목록으로 고친다.
  it('API 모드: 카탈로그 밖 이름은 google 모델로 본다 — 비-google provider 면 google 로 전환하고 이전 모델은 슬롯에 기억', () => {
    const next = alignMcpModelProviders(base, { imageModel: 'Nano Banana Pro' })
    expect(next).toMatchObject({ imageModel: 'Nano Banana Pro', generation: { image: { provider: 'google' } }, modelsByProvider: { openai: 'gpt-image-1' } })
    const grokT2v = { ...base, videoModelT2V: 'grok-imagine-video-1.5', generation: { ...base.generation, video: { t2v: { provider: 'grok' }, i2v: { provider: 'google' } } } }
    const nextV = alignMcpModelProviders(grokT2v, { videoModelT2V: 'Omni Flash' })
    expect(nextV.generation.video).toEqual({ t2v: { provider: 'google' }, i2v: { provider: 'google' } })
    expect(nextV.videoModelT2V).toBe('Omni Flash')
    expect(nextV.modelsByProviderVideo.t2v.grok).toBe('grok-imagine-video-1.5')
  })
  // 리뷰 A R2-2: Flow 는 provider 축이 없다(설정 화면이 숨긴다) — Flow 모드에서 정렬하면 API 로 돌아왔을 때 {openai, gemini-…} 불일치가 생긴다
  it("appMode 'flow' 면 정렬하지 않고 그대로 병합", () => {
    expect(alignMcpModelProviders(base, { imageModel: 'gemini-3-pro-image' }, { appMode: 'flow' })).toEqual({ ...base, imageModel: 'gemini-3-pro-image' })
  })
  it('모델 키가 없으면 그대로 병합(다른 키만)', () => {
    expect(alignMcpModelProviders(base, { aspectRatio: '9:16' })).toEqual({ ...base, aspectRatio: '9:16' })
  })
})
