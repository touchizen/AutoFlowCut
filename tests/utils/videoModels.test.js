import { describe, it, expect } from 'vitest'
import {
  normalizeVideoModel,
  snapVeoDuration,
  snapVideoDuration,
  isOmniFlashModel,
  VIDEO_MODEL_LITE,
  VIDEO_MODEL_FAST,
  VIDEO_MODEL_QUALITY,
} from '../../src/utils/videoModels'

describe('isOmniFlashModel', () => {
  it('OmniFlash 변형 감지 (표시 이름/내부 변형)', () => {
    expect(isOmniFlashModel('Omni Flash')).toBe(true)
    expect(isOmniFlashModel('omni-flash-preview')).toBe(true)
    expect(isOmniFlashModel('gemini-omni-flash')).toBe(true)
  })
  it('내부 abra_* videoModelKey 도 OmniFlash 로 감지 (electron 주입측과 일치)', () => {
    expect(isOmniFlashModel('abra_t2v_8s')).toBe(true)
    expect(isOmniFlashModel('abra_i2v_8s')).toBe(true)
  })
  it('Veo/기타/빈값은 false', () => {
    expect(isOmniFlashModel('Veo 3.1 - Fast')).toBe(false)
    expect(isOmniFlashModel('')).toBe(false)
    expect(isOmniFlashModel(null)).toBe(false)
    expect(isOmniFlashModel(undefined)).toBe(false)
  })
})

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

  it('이전 short hyphen 키도 공식 모델명으로 매핑', () => {
    expect(normalizeVideoModel('veo-3.1-lite')).toBe(VIDEO_MODEL_LITE)
    expect(normalizeVideoModel('veo-3.1-fast')).toBe(VIDEO_MODEL_FAST)
    expect(normalizeVideoModel('veo-3.1-quality')).toBe(VIDEO_MODEL_QUALITY)
  })

  it('Vertex AI 전용 Veo 3.1 GA id 는 Gemini API preview 모델로 치유', () => {
    expect(normalizeVideoModel('veo-3.1-fast-generate-001')).toBe(VIDEO_MODEL_FAST)
    expect(normalizeVideoModel('veo-3.1-generate-001')).toBe(VIDEO_MODEL_QUALITY)
  })

  it('이미 공식 hyphen 모델명은 그대로 통과', () => {
    expect(normalizeVideoModel('veo-3.1-lite-generate-preview')).toBe('veo-3.1-lite-generate-preview')
    expect(normalizeVideoModel('veo-3.1-fast-generate-preview')).toBe('veo-3.1-fast-generate-preview')
    expect(normalizeVideoModel('veo-3.1-generate-preview')).toBe('veo-3.1-generate-preview')
    expect(normalizeVideoModel('veo-2.0-generate-001')).toBe('veo-2.0-generate-001')
  })

  it('매핑 안 되는 underscore 구 키 → undefined (엔진 기본값)', () => {
    // 'veo' 로 시작하지만 hyphen 공식명도 매핑 대상도 아님 → 잘못된 모델명 새어나감 방지
    expect(normalizeVideoModel('veo_9_9_unknown')).toBeUndefined()
  })

  it('매핑 안 되는 short hyphen 키 → undefined (잘못된 endpoint 방지)', () => {
    expect(normalizeVideoModel('veo-3.1-fast-preview')).toBeUndefined()
  })

  it('비-veo / falsy 값 → undefined', () => {
    expect(normalizeVideoModel('flow-legacy')).toBeUndefined()
    expect(normalizeVideoModel('')).toBeUndefined()
    expect(normalizeVideoModel(null)).toBeUndefined()
    expect(normalizeVideoModel(undefined)).toBeUndefined()
  })
})

describe('snapVeoDuration', () => {
  it('씬 길이를 덮는 최소 허용값으로 스냅', () => {
    expect(snapVeoDuration(2)).toBe(4)
    expect(snapVeoDuration(4)).toBe(4)
    expect(snapVeoDuration(4.5)).toBe(6)
    expect(snapVeoDuration(6)).toBe(6)
    expect(snapVeoDuration(6.1)).toBe(8)
    expect(snapVeoDuration(8)).toBe(8)
  })

  it('8 초과는 8(단일 클립 최대)', () => {
    expect(snapVeoDuration(10)).toBe(8)
    expect(snapVeoDuration(12)).toBe(8)
    expect(snapVeoDuration(30)).toBe(8)
  })

  it('0/누락/비정상 → 8(기본)', () => {
    expect(snapVeoDuration(0)).toBe(8)
    expect(snapVeoDuration(-3)).toBe(8)
    expect(snapVeoDuration(NaN)).toBe(8)
    expect(snapVeoDuration(undefined)).toBe(8)
    expect(snapVeoDuration(null)).toBe(8)
  })
})

describe('snapVideoDuration (모델별 허용 길이)', () => {
  it('Veo 모델/null 은 {4,6,8} — snapVeoDuration 과 동일', () => {
    expect(snapVideoDuration(VIDEO_MODEL_FAST, 5)).toBe(6)
    expect(snapVideoDuration(VIDEO_MODEL_FAST, 8)).toBe(8)
    expect(snapVideoDuration(VIDEO_MODEL_FAST, 10)).toBe(8)  // 8 캡
    expect(snapVideoDuration(null, 10)).toBe(8)
  })

  it('OmniFlash 는 {4,6,8,10} — 10초까지 활용', () => {
    expect(snapVideoDuration('gemini-omni-flash', 5)).toBe(6)
    expect(snapVideoDuration('gemini-omni-flash', 8)).toBe(8)
    expect(snapVideoDuration('gemini-omni-flash', 8.5)).toBe(10)  // 8 초과 → 10
    expect(snapVideoDuration('gemini-omni-flash', 10)).toBe(10)
  })

  it('OmniFlash 도 그리드 최대(10) 초과는 10 으로 캡', () => {
    expect(snapVideoDuration('gemini-omni-flash', 12)).toBe(10)
    expect(snapVideoDuration('gemini-omni-flash', 30)).toBe(10)
  })

  it('OmniFlash 식별은 id 형태에 관대 (Omni Flash / omni-flash / omniflash)', () => {
    expect(snapVideoDuration('Omni Flash', 9)).toBe(10)
    expect(snapVideoDuration('omni-flash-preview', 9)).toBe(10)
    expect(snapVideoDuration('omniflash', 9)).toBe(10)
  })

  it('OmniFlash 0/누락 → 그리드 최대(10)', () => {
    expect(snapVideoDuration('gemini-omni-flash', 0)).toBe(10)
    expect(snapVideoDuration('gemini-omni-flash', undefined)).toBe(10)
  })
})
