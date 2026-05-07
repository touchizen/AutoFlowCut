/**
 * pickVideoMetadata — 모델/seed 우선순위 결정 단위 테스트
 *
 * 회귀 방지 — in-flight resume 항목이 현재 옵션으로 메타를 덮어쓰는 버그 차단.
 * 핵심 규칙:
 *   - model: item.model > options.videoModel > 'flow-video'
 *   - seed:  item.seed  >> options.seed       >> null   (>> 는 nullish, seed=0 보존)
 */

import { describe, it, expect } from 'vitest'
import { pickVideoMetadata, buildVideoMetaPatch } from '../../src/utils/videoMetadata'

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

// ─────────────────────────────────────────────────────────────────────────────
// buildVideoMetaPatch — error/incomplete state patch 단편 생성
//
// 회귀 방지 — useVideoAutomation 의 download 실패 / generation 실패 patch 가
//   start() 의 현재 옵션 (seed, videoModel) 을 그대로 stamp 하던 버그.
//   in-flight resume 항목이 원래 갖고 있던 model/seed 가 한 번의 실패로 덮여,
//   이후 download-only retry 가 잘못된 history metadata 를 저장하던 문제.
//
// helper 의 책임:
//   - pickVideoMetadata 와 같은 우선순위로 model/seed 결정
//   - state patch 의미상 "값이 없으면 키 자체를 빼서" 기존 state 를 보존
// ─────────────────────────────────────────────────────────────────────────────
describe('buildVideoMetaPatch — meta-preserving state patch', () => {
  it('item 에 model/seed 가 있으면 그대로 patch 에 담는다 (회귀 방지)', () => {
    // 핵심 케이스: in-flight resume 후 다운로드 실패 시 — item 의 원래 model/seed 가
    // 현재 UI 옵션(다른 모델/seed) 으로 덮이면 안 됨.
    const patch = buildVideoMetaPatch(
      { model: 'veo-3.1-fast', seed: 12345 },
      { videoModel: 'veo-3.1-quality', seed: 99 }
    )
    expect(patch).toEqual({ model: 'veo-3.1-fast', seed: 12345 })
  })

  it('item 에 model/seed 가 없으면 options 의 값을 사용', () => {
    const patch = buildVideoMetaPatch(
      { /* no meta */ },
      { videoModel: 'veo-3.1-quality', seed: 99 }
    )
    expect(patch).toEqual({ model: 'veo-3.1-quality', seed: 99 })
  })

  it('item 자체가 undefined 일 때도 throw 없이 options 사용 (items.find() 미스 케이스)', () => {
    // useVideoAutomation 의 items.find(...) 가 itemId 못 찾으면 undefined 반환.
    const patch = buildVideoMetaPatch(undefined, {
      videoModel: 'veo-3.1-quality',
      seed: 99,
    })
    expect(patch).toEqual({ model: 'veo-3.1-quality', seed: 99 })
  })

  it('item.seed = 0 도 보존 (?? semantics — || 였으면 99 로 덮였을 것)', () => {
    const patch = buildVideoMetaPatch({ seed: 0 }, { seed: 99 })
    expect(patch.seed).toBe(0)
  })

  it('seed 가 null 이면 patch 에서 seed 키를 빼서 기존 state 보존', () => {
    // patch 에 seed 가 들어가면 setState 가 seed: null 로 덮어 씀 → 기존 seed 유실.
    // patch 단편에는 키 자체가 없어야 한다.
    const patch = buildVideoMetaPatch({}, {})
    expect(patch).not.toHaveProperty('seed')
  })

  it('item 의 seed 만 있고 model 은 없는 경우 — model 은 options/fallback 사용', () => {
    const patch = buildVideoMetaPatch(
      { seed: 7 },
      { videoModel: 'veo-3.1-quality' }
    )
    expect(patch).toEqual({ model: 'veo-3.1-quality', seed: 7 })
  })

  it('item 의 model 만 있고 seed 는 없는 경우', () => {
    const patch = buildVideoMetaPatch(
      { model: 'veo-3.1-fast' },
      { videoModel: 'veo-3.1-quality', seed: 99 }
    )
    expect(patch).toEqual({ model: 'veo-3.1-fast', seed: 99 })
  })
})
