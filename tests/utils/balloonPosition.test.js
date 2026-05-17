/**
 * balloonPosition — hover 미리보기 풍선 좌표 계산 순수 함수 단위 테스트
 *
 * 검증:
 *   - 오른쪽 공간 충분 → 오른쪽 배치
 *   - 오른쪽 부족 → 왼쪽으로 flip
 *   - 양쪽 다 부족 → 화면 안으로만 clamp
 *   - 아래로 넘침 → 위로 shift
 *   - 풍선이 화면보다 큼 → top을 gap으로 clamp
 *   - custom gap 반영
 */

import { describe, it, expect } from 'vitest'
import { computeBalloonPosition } from '../../src/utils/balloonPosition'

describe('computeBalloonPosition', () => {
  it('오른쪽 공간 충분 → 풍선을 오른쪽에 배치', () => {
    const pos = computeBalloonPosition({
      anchor: { left: 100, right: 150, top: 100, bottom: 150 },
      balloon: { width: 200, height: 200 },
      viewport: { width: 1000, height: 800 },
    })
    expect(pos).toEqual({ left: 158, top: 100 })
  })

  it('오른쪽 공간 부족 → 왼쪽으로 flip', () => {
    const pos = computeBalloonPosition({
      anchor: { left: 900, right: 960, top: 100, bottom: 150 },
      balloon: { width: 200, height: 200 },
      viewport: { width: 1000, height: 800 },
    })
    expect(pos.left).toBe(900 - 8 - 200) // 692
    expect(pos.top).toBe(100)
  })

  it('양쪽 다 공간 부족 → 화면 안으로만 clamp', () => {
    const pos = computeBalloonPosition({
      anchor: { left: 50, right: 120, top: 100, bottom: 150 },
      balloon: { width: 980, height: 200 },
      viewport: { width: 1000, height: 800 },
    })
    expect(pos.left).toBe(Math.max(0, 1000 - 980)) // 20
  })

  it('아래로 넘침 → 위로 shift', () => {
    const pos = computeBalloonPosition({
      anchor: { left: 100, right: 150, top: 700, bottom: 740 },
      balloon: { width: 200, height: 200 },
      viewport: { width: 1000, height: 800 },
    })
    expect(pos.top).toBe(800 - 200 - 8) // 592
  })

  it('풍선이 화면보다 큼 → top을 gap으로 clamp', () => {
    const pos = computeBalloonPosition({
      anchor: { left: 100, right: 150, top: 10, bottom: 50 },
      balloon: { width: 200, height: 900 },
      viewport: { width: 1000, height: 800 },
    })
    expect(pos.top).toBe(8) // gap
  })

  it('custom gap 반영', () => {
    const pos = computeBalloonPosition({
      anchor: { left: 100, right: 150, top: 100, bottom: 150 },
      balloon: { width: 200, height: 200 },
      viewport: { width: 1000, height: 800 },
      gap: 20,
    })
    expect(pos.left).toBe(150 + 20) // 170
  })
})
