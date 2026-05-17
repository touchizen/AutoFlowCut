/**
 * balloonPosition — hover 미리보기 풍선 배치 스타일 계산 순수 함수 단위 테스트
 *
 * 새 시그니처: computeBalloonPosition({ anchor, viewport, gap })
 *   → { left|right, top|bottom, maxWidth, maxHeight }
 *
 * 검증:
 *   - 오른쪽 공간 넓음 → 오른쪽 배치 + maxWidth 제한
 *   - 우측 가장자리 썸네일 → 왼쪽 배치(right 키 사용)
 *   - maxWidth 가 큰 프리뷰를 가용 폭으로 제한해 썸네일을 덮지 않음
 *   - 아래 공간 좁음 → 위쪽 배치(bottom 키 사용)
 *   - 위 공간 좁음 → 아래쪽 배치(top 키 사용)
 *   - custom gap 반영
 *   - 마우스 지점(0-크기 앵커) 배치
 */

import { describe, it, expect } from 'vitest'
import { computeBalloonPosition } from '../../src/utils/balloonPosition'

describe('computeBalloonPosition', () => {
  it('오른쪽 공간 넓음 → 오른쪽에 배치하고 maxWidth 제한', () => {
    const r = computeBalloonPosition({
      anchor: { left: 100, right: 150, top: 100, bottom: 150 },
      viewport: { width: 1000, height: 800 },
    })
    expect(r.left).toBe(158)
    expect(r.maxWidth).toBe(842) // 1000 - 150 - 8
    expect(r.right).toBeUndefined()
  })

  it('우측 가장자리 썸네일 → 왼쪽에 배치(right 키 사용)', () => {
    const r = computeBalloonPosition({
      anchor: { left: 900, right: 960, top: 100, bottom: 150 },
      viewport: { width: 1000, height: 800 },
    })
    expect(r.right).toBe(108) // 1000 - 900 + 8
    expect(r.maxWidth).toBe(892) // 900 - 8
    expect(r.left).toBeUndefined()
  })

  it('maxWidth 가 큰 프리뷰를 가용 폭으로 제한해 썸네일을 덮지 않는다', () => {
    const r = computeBalloonPosition({
      anchor: { left: 900, right: 960, top: 100, bottom: 150 },
      viewport: { width: 1000, height: 800 },
    })
    // right:108 + maxWidth:892 배치 시 풍선 오른쪽 끝 = 1000-108 = 892 = anchor.left - gap
    expect(r.maxWidth).toBeLessThanOrEqual(900 - 8)
  })

  it('아래 공간 좁음 → 위쪽에 배치(bottom 키 사용)', () => {
    const r = computeBalloonPosition({
      anchor: { left: 100, right: 150, top: 700, bottom: 740 },
      viewport: { width: 1000, height: 800 },
    })
    expect(r.bottom).toBe(60) // 800 - 740
    expect(r.maxHeight).toBe(732) // 740 - 8
    expect(r.top).toBeUndefined()
  })

  it('위 공간 좁음 → 아래쪽에 배치(top 키 사용)', () => {
    const r = computeBalloonPosition({
      anchor: { left: 100, right: 150, top: 60, bottom: 100 },
      viewport: { width: 1000, height: 800 },
    })
    expect(r.top).toBe(60)
    expect(r.maxHeight).toBe(732) // 800 - 60 - 8
    expect(r.bottom).toBeUndefined()
  })

  it('custom gap 반영', () => {
    const r = computeBalloonPosition({
      anchor: { left: 100, right: 150, top: 100, bottom: 150 },
      viewport: { width: 1000, height: 800 },
      gap: 20,
    })
    expect(r.left).toBe(170) // 150 + 20
    expect(r.maxWidth).toBe(830) // 1000 - 150 - 20
  })

  it('마우스 지점(0-크기 앵커) 배치', () => {
    const r = computeBalloonPosition({
      anchor: { left: 500, right: 500, top: 400, bottom: 400 },
      viewport: { width: 1000, height: 800 },
    })
    expect(r.left).toBe(508) // spaceRight 492 >= spaceLeft 492
    expect(r.top).toBe(400) // spaceBelow 392 >= spaceAbove 392
  })
})
