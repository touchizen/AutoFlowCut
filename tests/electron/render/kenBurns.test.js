import { describe, it, expect } from 'vitest'
import { computeKenBurns, mulberry32 } from '../../../electron/render/kenBurns.js'

const base = { mode: 'random', scaleMin: 1.0, scaleMax: 1.3 }

describe('mulberry32', () => {
  it('is deterministic for same seed', () => {
    const a = mulberry32(5), b = mulberry32(5)
    expect(a()).toBe(b())
    expect(a()).toBe(b())
  })
  it('returns values in [0,1)', () => {
    const r = mulberry32(1)
    for (let i = 0; i < 100; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
  })
})

describe('computeKenBurns', () => {
  it('is deterministic by index (same index → same output)', () => {
    const a = computeKenBurns({}, 3, base)
    const b = computeKenBurns({}, 3, base)
    expect(a).toEqual(b)
  })
  it('differs across indices', () => {
    const a = computeKenBurns({}, 1, base)
    const b = computeKenBurns({}, 2, base)
    expect(a).not.toEqual(b)
  })
  it('keeps scales within [scaleMin, scaleMax]', () => {
    for (let i = 0; i < 20; i++) {
      const k = computeKenBurns({}, i, base)
      expect(k.startScale).toBeGreaterThanOrEqual(1.0)
      expect(k.startScale).toBeLessThanOrEqual(1.3)
      expect(k.endScale).toBeGreaterThanOrEqual(1.0)
      expect(k.endScale).toBeLessThanOrEqual(1.3)
    }
  })
  it('keeps anchors within [0,1]', () => {
    for (let i = 0; i < 20; i++) {
      const k = computeKenBurns({}, i, base)
      for (const a of [k.startAnchor, k.endAnchor]) {
        expect(a.x).toBeGreaterThanOrEqual(0); expect(a.x).toBeLessThanOrEqual(1)
        expect(a.y).toBeGreaterThanOrEqual(0); expect(a.y).toBeLessThanOrEqual(1)
      }
    }
  })
  it('swaps when scaleMin > scaleMax', () => {
    const k = computeKenBurns({}, 0, { ...base, scaleMin: 1.3, scaleMax: 1.0 })
    expect(k.startScale).toBeLessThanOrEqual(1.3)
    expect(k.startScale).toBeGreaterThanOrEqual(1.0)
  })
  it('clamps sub-1.0 scale to 1.0 and defaults NaN', () => {
    const k = computeKenBurns({}, 0, { ...base, scaleMin: 0.5, scaleMax: NaN })
    expect(k.startScale).toBeGreaterThanOrEqual(1.0)
    expect(Number.isFinite(k.endScale)).toBe(true)
  })
  it('pattern mode is deterministic without randomness (even index zoom-in)', () => {
    const even = computeKenBurns({}, 2, { ...base, mode: 'pattern' })
    expect(even.endScale).toBeGreaterThanOrEqual(even.startScale) // zoom-in
    const odd = computeKenBurns({}, 3, { ...base, mode: 'pattern' })
    expect(odd.endScale).toBeLessThanOrEqual(odd.startScale) // zoom-out
  })
})
