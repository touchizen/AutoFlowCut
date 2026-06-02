import { describe, it, expect } from 'vitest'
import {
  normalizeVideoModel,
  VIDEO_MODEL_FAST,
  VIDEO_MODEL_QUALITY,
} from '../../src/utils/videoModels'

describe('normalizeVideoModel', () => {
  it('구 Flow t2v fast 키 → 공식 fast 모델명', () => {
    expect(normalizeVideoModel('veo_3_1_t2v_fast_ultra_relaxed')).toBe(VIDEO_MODEL_FAST)
  })

  it('구 Flow t2v quality 키 → 공식 quality 모델명', () => {
    expect(normalizeVideoModel('veo_3_1_t2v_quality_ultra_relaxed')).toBe(VIDEO_MODEL_QUALITY)
  })

  it('구 Flow i2v 키도 매핑', () => {
    expect(normalizeVideoModel('veo_3_1_i2v_fast_ultra_relaxed')).toBe(VIDEO_MODEL_FAST)
  })

  it('이미 공식 hyphen 모델명은 그대로 통과', () => {
    expect(normalizeVideoModel('veo-3.1-fast-generate-preview')).toBe('veo-3.1-fast-generate-preview')
    expect(normalizeVideoModel('veo-3.1-generate-preview')).toBe('veo-3.1-generate-preview')
  })

  it('매핑 안 되는 underscore 구 키 → undefined (엔진 기본값)', () => {
    // 'veo' 로 시작하지만 hyphen 공식명도 매핑 대상도 아님 → 잘못된 모델명 새어나감 방지
    expect(normalizeVideoModel('veo_9_9_unknown')).toBeUndefined()
  })

  it('비-veo / falsy 값 → undefined', () => {
    expect(normalizeVideoModel('flow-legacy')).toBeUndefined()
    expect(normalizeVideoModel('')).toBeUndefined()
    expect(normalizeVideoModel(null)).toBeUndefined()
    expect(normalizeVideoModel(undefined)).toBeUndefined()
  })
})
