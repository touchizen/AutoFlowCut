/**
 * pickVideoMetadata — 모델/seed 우선순위 결정 단위 테스트
 *
 * 회귀 방지 — in-flight resume 항목이 현재 옵션으로 메타를 덮어쓰는 버그 차단.
 * 핵심 규칙:
 *   - model: item.model > options.videoModel > 'flow-video'
 *   - seed:  item.seed  >> options.seed       >> null   (>> 는 nullish, seed=0 보존)
 */

import { describe, it, expect } from 'vitest'
import { pickVideoMetadata } from '../../src/utils/videoMetadata'

describe('pickVideoMetadata — model 우선순위', () => {
  it('item.model 이 있으면 options.videoModel 보다 우선', () => {
    const result = pickVideoMetadata(
      { model: 'veo-3.1-fast' },
      { videoModel: 'veo-3.1-quality' }
    )
    expect(result.model).toBe('veo-3.1-fast')
  })

  it('item.model 없을 때 options.videoModel 사용', () => {
    const result = pickVideoMetadata(
      { /* no model */ },
      { videoModel: 'veo-3.1-quality' }
    )
    expect(result.model).toBe('veo-3.1-quality')
  })

  it('item / options 둘 다 model 없으면 폴백 "flow-video"', () => {
    const result = pickVideoMetadata({}, {})
    expect(result.model).toBe('flow-video')
  })

  it('item 자체가 null 이면 options 사용', () => {
    const result = pickVideoMetadata(null, { videoModel: 'veo-3.1' })
    expect(result.model).toBe('veo-3.1')
  })

  it('item / options 둘 다 null/undefined 면 폴백', () => {
    expect(pickVideoMetadata(null, null).model).toBe('flow-video')
    expect(pickVideoMetadata(undefined, undefined).model).toBe('flow-video')
  })

  it('item.model 이 빈 문자열이면 falsy 로 떨어져 options 가 사용된다', () => {
    // 정책 결정: 빈 모델 ID 는 의미 없음 → || 로 다음 후보로 넘김.
    // (이 테스트는 정책의 의도를 못박는 가드.)
    const result = pickVideoMetadata(
      { model: '' },
      { videoModel: 'veo-3.1-quality' }
    )
    expect(result.model).toBe('veo-3.1-quality')
  })
})

describe('pickVideoMetadata — seed 우선순위 (nullish 보존)', () => {
  it('item.seed 가 있으면 options.seed 보다 우선', () => {
    const result = pickVideoMetadata({ seed: 42 }, { seed: 7 })
    expect(result.seed).toBe(42)
  })

  it('item.seed = 0 도 유효한 값으로 보존되어야 한다 (?? 의 핵심 가드)', () => {
    // 회귀 방지 — `||` 였으면 0 이 falsy 로 떨어져 options.seed=99 가 잘못 채택됨.
    const result = pickVideoMetadata({ seed: 0 }, { seed: 99 })
    expect(result.seed).toBe(0)
  })

  it('item.seed 가 undefined 면 options.seed 사용', () => {
    const result = pickVideoMetadata({ /* no seed */ }, { seed: 99 })
    expect(result.seed).toBe(99)
  })

  it('item.seed 가 null 이면 options.seed 사용 (?? semantics)', () => {
    const result = pickVideoMetadata({ seed: null }, { seed: 99 })
    expect(result.seed).toBe(99)
  })

  it('options.seed = 0 도 유효한 값으로 보존', () => {
    const result = pickVideoMetadata({ /* no seed */ }, { seed: 0 })
    expect(result.seed).toBe(0)
  })

  it('item / options 둘 다 seed 없으면 null', () => {
    expect(pickVideoMetadata({}, {}).seed).toBeNull()
  })

  it('item / options 둘 다 null/undefined 이어도 seed 는 null', () => {
    expect(pickVideoMetadata(null, null).seed).toBeNull()
    expect(pickVideoMetadata(undefined, undefined).seed).toBeNull()
  })
})

describe('pickVideoMetadata — model 과 seed 조합', () => {
  it('대표 케이스 1: in-flight resume — item 메타 보존', () => {
    const result = pickVideoMetadata(
      { model: 'veo-3.1-fast', seed: 12345 },
      { videoModel: 'veo-3.1-quality', seed: 99 } // 현재 UI 옵션 — 덮어쓰면 안 됨
    )
    expect(result).toEqual({ model: 'veo-3.1-fast', seed: 12345 })
  })

  it('대표 케이스 2: fresh 생성 — options 메타 사용', () => {
    const result = pickVideoMetadata(
      { /* item 에 메타 없음 */ },
      { videoModel: 'veo-3.1-quality', seed: 99 }
    )
    expect(result).toEqual({ model: 'veo-3.1-quality', seed: 99 })
  })

  it('대표 케이스 3: 어디에도 없음 — 폴백', () => {
    const result = pickVideoMetadata({}, {})
    expect(result).toEqual({ model: 'flow-video', seed: null })
  })
})
