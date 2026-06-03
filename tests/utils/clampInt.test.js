import { describe, it, expect } from 'vitest'
import { clampInt } from '../../src/utils/clampInt'

describe('clampInt(value, min, max, fallback)', () => {
  it('범위 내 정수는 그대로', () => {
    expect(clampInt(5, 1, 10, 5)).toBe(5)
    expect(clampInt(1, 1, 10, 5)).toBe(1)
    expect(clampInt(10, 1, 10, 5)).toBe(10)
  })

  it('max 초과는 max 로 clamp', () => {
    expect(clampInt(50, 1, 10, 5)).toBe(10)
  })

  it('0/음수/NaN/문자열 → fallback (무한대기 방지)', () => {
    expect(clampInt(0, 1, 10, 5)).toBe(5)
    expect(clampInt(-1, 1, 10, 5)).toBe(5)
    expect(clampInt(NaN, 1, 10, 5)).toBe(5)
    expect(clampInt('x', 1, 10, 5)).toBe(5)
    expect(clampInt(null, 1, 10, 5)).toBe(5)
    expect(clampInt(undefined, 1, 10, 5)).toBe(5)
  })

  it('숫자 문자열은 파싱', () => {
    expect(clampInt('5', 1, 10, 5)).toBe(5)
    expect(clampInt('7', 1, 10, 5)).toBe(7)
  })

  it('소수는 반올림', () => {
    expect(clampInt(2.4, 1, 10, 5)).toBe(2)
    expect(clampInt(2.6, 1, 10, 5)).toBe(3)
  })
})
