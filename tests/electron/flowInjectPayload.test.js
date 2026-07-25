import { describe, it, expect } from 'vitest'
import { buildFlowInjectPayload, flowInjectClearPayload, toVideoAspectEnum } from '../../electron/flow-inject-payload.js'

describe('buildFlowInjectPayload', () => {
  it('top-level duration/videoModel 을 보존한다 (T2V OmniFlash 강제 누락 회귀)', () => {
    const p = buildFlowInjectPayload({ seed: 42, duration: 6, videoModel: 'Omni Flash' })
    expect(p.duration).toBe(6)
    expect(p.videoModel).toBe('Omni Flash')
    expect(p.seed).toBe(42)
  })

  it('누락 필드는 null 로 채운다', () => {
    const p = buildFlowInjectPayload({ seed: 1 })
    expect(p).toEqual({ seed: 1, aspectRatio: null, videoAspectRatio: null, references: null, i2v: null, duration: null, videoModel: null, genTag: null })
  })

  it('인자 없이 호출해도 모든 필드 null', () => {
    expect(buildFlowInjectPayload()).toEqual({
      seed: null, aspectRatio: null, videoAspectRatio: null, references: null, i2v: null, duration: null, videoModel: null, genTag: null,
    })
  })

  it('#R35: genTag 를 보존한다(seed 무관 correlation 태그)', () => {
    expect(buildFlowInjectPayload({ seed: 5, genTag: 'scene-async-1' }).genTag).toBe('scene-async-1')
  })

  // 회귀: 비디오 화면비를 요청 body(requests[].aspectRatio)로 주입하기 위한 필드. Flow 가 설정
  //   패널을 통합 탭 UI 로 바꿔 DOM 세터가 비디오에 안 걸려도, 이 값으로 화면비를 강제한다.
  it('videoAspectRatio 를 보존한다(비디오 요청 aspect 직접 주입용)', () => {
    expect(buildFlowInjectPayload({ videoAspectRatio: 'VIDEO_ASPECT_RATIO_PORTRAIT' }).videoAspectRatio)
      .toBe('VIDEO_ASPECT_RATIO_PORTRAIT')
  })
})

describe('toVideoAspectEnum', () => {
  it("'9:16' → VIDEO_ASPECT_RATIO_PORTRAIT, '16:9' → VIDEO_ASPECT_RATIO_LANDSCAPE", () => {
    expect(toVideoAspectEnum('9:16')).toBe('VIDEO_ASPECT_RATIO_PORTRAIT')
    expect(toVideoAspectEnum('16:9')).toBe('VIDEO_ASPECT_RATIO_LANDSCAPE')
  })

  it('이미 VIDEO_ASPECT_RATIO_* enum 이면 그대로 통과', () => {
    expect(toVideoAspectEnum('VIDEO_ASPECT_RATIO_PORTRAIT')).toBe('VIDEO_ASPECT_RATIO_PORTRAIT')
    expect(toVideoAspectEnum('VIDEO_ASPECT_RATIO_LANDSCAPE')).toBe('VIDEO_ASPECT_RATIO_LANDSCAPE')
  })

  it('PORTRAIT/LANDSCAPE 키워드도 매핑', () => {
    expect(toVideoAspectEnum('PORTRAIT')).toBe('VIDEO_ASPECT_RATIO_PORTRAIT')
    expect(toVideoAspectEnum('LANDSCAPE')).toBe('VIDEO_ASPECT_RATIO_LANDSCAPE')
  })

  it('빈 값·미지정·형식 불명은 null(요청 미수정 → Flow 기본값 유지)', () => {
    expect(toVideoAspectEnum('')).toBeNull()
    expect(toVideoAspectEnum(null)).toBeNull()
    expect(toVideoAspectEnum(undefined)).toBeNull()
    expect(toVideoAspectEnum('1:1')).toBeNull()
  })
})

describe('flowInjectClearPayload', () => {
  it('arm 과 동일한 키 집합을 reset 한다 (set/clear 드리프트 가드)', () => {
    const armKeys = Object.keys(buildFlowInjectPayload({ seed: 1, duration: 8 })).sort()
    const clearKeys = Object.keys(flowInjectClearPayload()).sort()
    expect(clearKeys).toEqual(armKeys)
  })

  it('모든 필드가 null', () => {
    const p = flowInjectClearPayload()
    expect(Object.values(p).every((v) => v === null)).toBe(true)
  })
})
