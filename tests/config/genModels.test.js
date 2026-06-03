/**
 * genModels — 모델 카탈로그 헬퍼 테스트
 *
 * modelLabel(id): ResultsTable / 상세 모달이 API 모델 id 를 사람이 읽는 라벨로
 * 변환할 때 쓰는 단일 소스. 카탈로그에 없으면 id 그대로(미래 모델/legacy 방어),
 * falsy 면 null.
 */
import { describe, it, expect } from 'vitest'
import { modelLabel, coerceResolution } from '../../src/config/genModels'

describe('genModels — modelLabel', () => {
  it('이미지 모델 id → 라벨', () => {
    expect(modelLabel('gemini-2.5-flash-image')).toBe('Nano Banana')
    expect(modelLabel('gemini-3.1-flash-image')).toBe('Nano Banana 2')
    expect(modelLabel('gemini-3-pro-image')).toBe('Nano Banana Pro')
  })

  it('비디오 모델 id → 라벨', () => {
    expect(modelLabel('veo-3.1-lite-generate-preview')).toBe('Veo 3.1 Lite')
    expect(modelLabel('veo-3.1-fast-generate-preview')).toBe('Veo 3.1 Fast')
    expect(modelLabel('veo-3.1-generate-preview')).toBe('Veo 3.1 Quality')
  })

  it('카탈로그에 없는 id 는 그대로 통과 (legacy/미래 모델 방어)', () => {
    expect(modelLabel('some-unknown-model-2027')).toBe('some-unknown-model-2027')
  })

  it('falsy 값은 null', () => {
    expect(modelLabel(null)).toBeNull()
    expect(modelLabel(undefined)).toBeNull()
    expect(modelLabel('')).toBeNull()
  })
})

describe('genModels — coerceResolution (모델별 해상도 가드)', () => {
  // 공식: Veo 3.1 Lite 는 4K 미지원(720p/1080p). Fast/Quality 는 4K 지원.
  // 전역 resolution + 타입별 모델 조합에서 Lite+4K 가 API 로 새어나가 실패하는 걸 막는다.
  it('Lite + 4k → 허용 최대(1080p)로 강등', () => {
    expect(coerceResolution('veo-3.1-lite-generate-preview', '4k')).toBe('1080p')
  })

  it('Fast/Quality + 4k → 그대로 유지', () => {
    expect(coerceResolution('veo-3.1-fast-generate-preview', '4k')).toBe('4k')
    expect(coerceResolution('veo-3.1-generate-preview', '4k')).toBe('4k')
  })

  it('Lite + 허용 해상도(720p/1080p)는 그대로', () => {
    expect(coerceResolution('veo-3.1-lite-generate-preview', '720p')).toBe('720p')
    expect(coerceResolution('veo-3.1-lite-generate-preview', '1080p')).toBe('1080p')
  })

  it('falsy resolution 은 그대로 통과(엔진 기본값 위임)', () => {
    expect(coerceResolution('veo-3.1-lite-generate-preview', null)).toBeNull()
    expect(coerceResolution('veo-3.1-lite-generate-preview', undefined)).toBeUndefined()
  })

  it('알 수 없는 모델 id 는 해상도를 건드리지 않음', () => {
    expect(coerceResolution('veo-3.1-fast', '4k')).toBe('4k')
    expect(coerceResolution(undefined, '4k')).toBe('4k')
  })
})
