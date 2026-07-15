// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { frameTimes } from '../../src/utils/videoFrames.js'

// M3 I7 (D12): 다중 프레임 시각의 순수 산출. 실제 decode 는 [P](Chromium video+canvas).
// n개 프레임을 균등 간격 (i+1)/(n+1)*duration 에 배치한다 (양끝 검은 프레임 회피).

describe('frameTimes', () => {
  it('duration 12, n 3 → [3, 6, 9]', () => {
    expect(frameTimes(12, 3)).toEqual([3, 6, 9])
  })

  it('n 1 → 중앙 한 장', () => {
    expect(frameTimes(10, 1)).toEqual([5])
  })

  it('n <= 0 → 빈 배열', () => {
    expect(frameTimes(10, 0)).toEqual([])
    expect(frameTimes(10, -2)).toEqual([])
  })

  it('duration 유한하지 않으면 빈 배열 (fail-safe)', () => {
    expect(frameTimes(NaN, 3)).toEqual([])
    expect(frameTimes(Infinity, 3)).toEqual([])
    expect(frameTimes(0, 3)).toEqual([])
  })
})
