import { describe, it, expect } from 'vitest'
import { computeVideoProviderSwitch } from '../../src/utils/videoProviderSwitch'

// 리뷰 B R2 F4: SceneTab 에서 옮겨 온 뒤 이 두 규칙(기억 모델 복원 · 다른 stage 기억 보존)을 묶는 테스트가 없었다.
describe('computeVideoProviderSwitch (영상 stage provider 전환)', () => {
  const base = {
    videoModelT2V: 'veo-3.1-fast-generate-preview',
    videoModelF2V: 'veo-3.1-generate-preview',
    generation: { image: { provider: 'openai' }, video: { t2v: { provider: 'google' }, i2v: { provider: 'google' } } },
    modelsByProviderVideo: { t2v: { fal: 'fal-ai/kling-video/v2/master/text-to-video', grok: 'grok-imagine-video-1.5' }, i2v: { fal: 'fal-ai/kling-video/v2/master/image-to-video' } },
  }

  it('google→fal(t2v): 기억된 fal 모델을 복원하고 현재 google 모델은 t2v 슬롯에 기억한다 — 같은 stage 의 다른 기억(grok)은 남는다', () => {
    const patch = computeVideoProviderSwitch(base, 't2v', 'fal')
    expect(patch.videoModelT2V).toBe('fal-ai/kling-video/v2/master/text-to-video')
    expect(patch.generation.video.t2v.provider).toBe('fal')
    expect(patch.modelsByProviderVideo.t2v).toEqual({ google: 'veo-3.1-fast-generate-preview', fal: 'fal-ai/kling-video/v2/master/text-to-video', grok: 'grok-imagine-video-1.5' })
  })

  it('t2v 전환은 i2v 의 provider·기억 모델과 image provider 를 건드리지 않는다', () => {
    const patch = computeVideoProviderSwitch(base, 't2v', 'fal')
    expect(patch.generation.video.i2v).toEqual({ provider: 'google' })
    expect(patch.generation.image).toEqual({ provider: 'openai' })
    expect(patch.modelsByProviderVideo.i2v).toEqual({ fal: 'fal-ai/kling-video/v2/master/image-to-video' })
    expect('videoModelF2V' in patch).toBe(false)
  })

  it('stage provider 가 비어 있으면 현재 모델을 google 슬롯에 기억한다', () => {
    const patch = computeVideoProviderSwitch({ videoModelT2V: 'veo-3.1-fast-generate-preview' }, 't2v', 'fal')
    expect(patch.modelsByProviderVideo.t2v).toEqual({ google: 'veo-3.1-fast-generate-preview' })
  })
})
