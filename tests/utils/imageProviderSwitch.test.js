import { describe, it, expect } from 'vitest'
import { computeImageProviderSwitch } from '../../src/utils/imageProviderSwitch'
import { DEFAULT_IMAGE_MODEL_ID } from '../../src/config/genModels'

const base = {
  imageModel: 'gemini-3.1-flash-image',
  generation: { image: { provider: 'google' } },
  modelsByProvider: { google: 'gemini-3.1-flash-image' },
}

describe('computeImageProviderSwitch (전역 image provider 전환)', () => {
  it('같은 provider 로 전환 → noop({})', () => {
    expect(computeImageProviderSwitch(base, 'google')).toEqual({})
  })

  it('google→openai: 기억 모델 없으면 openai 기본(gpt-image-1)으로, 현재 모델은 google 슬롯에 저장', () => {
    const patch = computeImageProviderSwitch(base, 'openai')
    expect(patch.generation.image.provider).toBe('openai')
    expect(patch.imageModel).toBe('gpt-image-1')
    expect(patch.modelsByProvider.google).toBe('gemini-3.1-flash-image') // 현재 모델 저장
  })

  it('google→openai: 기억된 openai 모델이 있으면 그걸 복원', () => {
    const s = { ...base, modelsByProvider: { google: 'gemini-3.1-flash-image', openai: 'gpt-image-1' } }
    const patch = computeImageProviderSwitch(s, 'openai')
    expect(patch.imageModel).toBe('gpt-image-1')
  })

  it('openai→google: google 기억 모델 복원', () => {
    const s = {
      imageModel: 'gpt-image-1',
      generation: { image: { provider: 'openai' } },
      modelsByProvider: { google: 'gemini-3-pro-image', openai: 'gpt-image-1' },
    }
    const patch = computeImageProviderSwitch(s, 'google')
    expect(patch.generation.image.provider).toBe('google')
    expect(patch.imageModel).toBe('gemini-3-pro-image')
    expect(patch.modelsByProvider.openai).toBe('gpt-image-1') // 현재 모델 저장
  })

  it('google 기억 모델도 없으면 google 기본으로', () => {
    const s = { imageModel: 'gpt-image-1', generation: { image: { provider: 'openai' } }, modelsByProvider: { openai: 'gpt-image-1' } }
    const patch = computeImageProviderSwitch(s, 'google')
    expect(patch.imageModel).toBe(DEFAULT_IMAGE_MODEL_ID)
  })

  it('기존 generation 의 다른 키/모델 슬롯 보존', () => {
    const s = {
      imageModel: 'gemini-3.1-flash-image',
      generation: { image: { provider: 'google' }, video: { t2v: { provider: 'google' } } },
      modelsByProvider: { google: 'gemini-3.1-flash-image', fal: 'some-fal' },
    }
    const patch = computeImageProviderSwitch(s, 'openai')
    expect(patch.generation.video).toEqual({ t2v: { provider: 'google' } }) // 비디오 축 보존
    expect(patch.modelsByProvider.fal).toBe('some-fal')
  })
})
