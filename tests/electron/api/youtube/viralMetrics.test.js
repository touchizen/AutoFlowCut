import { describe, it, expect } from 'vitest'
import {
  daysSinceUpload,
  viralTier,
  computeViralMetrics,
} from '../../../../electron/api/youtube/viralMetrics.js'

const NOW = new Date('2026-07-08T00:00:00Z')

describe('daysSinceUpload', () => {
  it('counts UTC days from YYYYMMDD, floor at 1', () => {
    expect(daysSinceUpload('20260701', NOW)).toBe(7)
    expect(daysSinceUpload('20260708', NOW)).toBe(1) // 당일도 최소 1(0나눗셈 방지)
    expect(daysSinceUpload('20260709', NOW)).toBe(1) // 미래도 최소 1
  })
  it('returns null for missing/malformed date', () => {
    expect(daysSinceUpload('', NOW)).toBeNull()
    expect(daysSinceUpload('NA', NOW)).toBeNull()
    expect(daysSinceUpload('2026-07-01', NOW)).toBeNull()
    expect(daysSinceUpload(undefined, NOW)).toBeNull()
  })
})

describe('viralTier', () => {
  it('grades by view/subscriber ratio', () => {
    expect(viralTier(0.5)).toBe('low')
    expect(viralTier(1)).toBe('ok')
    expect(viralTier(4.9)).toBe('ok')
    expect(viralTier(5)).toBe('high')
    expect(viralTier(19.9)).toBe('high')
    expect(viralTier(20)).toBe('explosive')
    expect(viralTier(1000)).toBe('explosive')
  })
  it('returns unknown for null/NaN/Infinity', () => {
    expect(viralTier(null)).toBe('unknown')
    expect(viralTier(Infinity)).toBe('unknown')
    expect(viralTier(NaN)).toBe('unknown')
  })
})

describe('computeViralMetrics', () => {
  it('computes ratio, tier, viewsPerDay, engagement', () => {
    const m = computeViralMetrics(
      { viewCount: 1000000, likeCount: 20000, subscribers: 100000, uploadDate: '20260701' },
      NOW,
    )
    expect(m.ratio).toBeCloseTo(10) // 100만 / 10만 = 10배
    expect(m.tier).toBe('high')
    expect(m.viewsPerDay).toBe(Math.round(1000000 / 7))
    expect(m.engagement).toBeCloseTo(0.02) // 2만 / 100만
  })

  it('handles subscribers=0/NA → ratio null, tier unknown', () => {
    const m = computeViralMetrics({ viewCount: 5000, subscribers: 0, uploadDate: '20260701' }, NOW)
    expect(m.ratio).toBeNull()
    expect(m.tier).toBe('unknown')
  })

  it('handles hidden likes (null) → engagement null', () => {
    const m = computeViralMetrics(
      { viewCount: 1000, likeCount: null, subscribers: 500, uploadDate: '20260701' },
      NOW,
    )
    expect(m.engagement).toBeNull()
    expect(m.ratio).toBeCloseTo(2)
    expect(m.tier).toBe('ok')
  })

  it('handles missing uploadDate → viewsPerDay null (ratio still works)', () => {
    const m = computeViralMetrics({ viewCount: 1000, subscribers: 100, uploadDate: '' }, NOW)
    expect(m.viewsPerDay).toBeNull()
    expect(m.ratio).toBeCloseTo(10)
    expect(m.tier).toBe('high')
  })

  it('never divides by zero views', () => {
    const m = computeViralMetrics({ viewCount: 0, likeCount: 0, subscribers: 100, uploadDate: '20260701' }, NOW)
    expect(m.engagement).toBeNull()
    expect(m.ratio).toBe(0)
    expect(m.tier).toBe('low')
  })
})
