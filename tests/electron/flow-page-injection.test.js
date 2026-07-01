/**
 * flow-page-injection — i2v 모델키 변환 + OmniFlash 길이 접미사 (순수 로직).
 *
 * injectI2VBody/t2v 주입은 FLOW_PAGE_INJECTION 템플릿 문자열 안에서 동작하지만,
 * 변환 규칙은 순수함수로 추출해 단위테스트로 고정한다(템플릿엔 serialize 주입).
 *
 * 라이브 캡처(2026-06-27):
 *   t2v: videoModelKey "abra_t2v_8s"
 *   i2v: videoModelKey "abra_i2v_8s" (startImage 만, endImage 미지원)
 */
import { describe, it, expect } from 'vitest'
import { toI2VModelKey, applyOmniDuration, omniFlashKey } from '../../electron/flow-page-injection.js'
import { isOmniFlashModel } from '../../electron/video-model-rules.js'

describe('isOmniFlashModel — 앱 모델이 OmniFlash 인지', () => {
  it('OmniFlash 표시 이름/키 감지', () => {
    expect(isOmniFlashModel('Omni Flash')).toBe(true)
    expect(isOmniFlashModel('omniflash')).toBe(true)
    expect(isOmniFlashModel('abra_t2v_8s')).toBe(true)
  })
  it('Veo/기타는 false', () => {
    expect(isOmniFlashModel('Veo 3.1 - Fast')).toBe(false)
    expect(isOmniFlashModel('veo_3_1_t2v')).toBe(false)
    expect(isOmniFlashModel('')).toBe(false)
    expect(isOmniFlashModel(null)).toBe(false)
  })
})

describe('omniFlashKey — OmniFlash 강제 videoModelKey (패널 우회)', () => {
  it('mode + 길이로 abra 키 생성', () => {
    expect(omniFlashKey('t2v', 4)).toBe('abra_t2v_4s')
    expect(omniFlashKey('i2v', 6)).toBe('abra_i2v_6s')
    expect(omniFlashKey('i2v', 10)).toBe('abra_i2v_10s')
  })
  it('길이 없으면 8초 기본', () => {
    expect(omniFlashKey('t2v', undefined)).toBe('abra_t2v_8s')
    expect(omniFlashKey('i2v', NaN)).toBe('abra_i2v_8s')
  })
  it('#R36-ref: r2v(@멘션 reference-to-video) 모드 키 생성 — abra_r2v_Ns', () => {
    expect(omniFlashKey('r2v', 4)).toBe('abra_r2v_4s')
    expect(omniFlashKey('r2v', 10)).toBe('abra_r2v_10s')
    expect(omniFlashKey('r2v', undefined)).toBe('abra_r2v_8s')
  })
})

describe('toI2VModelKey — t2v 모델키 → i2v 모델키', () => {
  it('OmniFlash(abra): _t2v_ → _i2v_ 스왑, 길이 접미사 유지', () => {
    expect(toI2VModelKey('abra_t2v_8s')).toBe('abra_i2v_8s')
    expect(toI2VModelKey('abra_t2v_4s')).toBe('abra_i2v_4s')
  })

  it('Veo: 명시 맵으로 변환', () => {
    expect(toI2VModelKey('veo_3_1_t2v_fast')).toBe('veo_3_1_i2v_s_fast_fl')
    expect(toI2VModelKey('veo_3_1_t2v_quality')).toBe('veo_3_1_i2v_quality')
  })

  it('미지의 키는 veo i2v fast 로 폴백 (기존 동작 보존)', () => {
    expect(toI2VModelKey('unknown_model')).toBe('veo_3_1_i2v_s_fast_fl')
    expect(toI2VModelKey('')).toBe('veo_3_1_i2v_s_fast_fl')
  })
})

describe('applyOmniDuration — OmniFlash 길이 접미사 최적화', () => {
  it('OmniFlash(abra): _Ns 접미사를 목표 길이로 교체', () => {
    expect(applyOmniDuration('abra_t2v_8s', 4)).toBe('abra_t2v_4s')
    expect(applyOmniDuration('abra_i2v_8s', 6)).toBe('abra_i2v_6s')
    expect(applyOmniDuration('abra_t2v_8s', 10)).toBe('abra_t2v_10s')
    // #R36-ref: @멘션 reference-to-video 키(abra_r2v_8s)도 길이 접미사 최적화 대상 — 8초 고정 회귀 방지
    expect(applyOmniDuration('abra_r2v_8s', 4)).toBe('abra_r2v_4s')
  })

  it('Veo 등 abra 가 아니면 그대로 (8초 고정, 접미사 없음)', () => {
    expect(applyOmniDuration('veo_3_1_i2v_s_fast_fl', 4)).toBe('veo_3_1_i2v_s_fast_fl')
  })

  it('duration 이 유효한 수가 아니면 그대로', () => {
    expect(applyOmniDuration('abra_t2v_8s', undefined)).toBe('abra_t2v_8s')
    expect(applyOmniDuration('abra_t2v_8s', null)).toBe('abra_t2v_8s')
    expect(applyOmniDuration('abra_t2v_8s', NaN)).toBe('abra_t2v_8s')
  })
})
