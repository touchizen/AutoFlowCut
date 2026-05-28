/**
 * findRangeAt — lower-bound binary search for time-range lookup
 *
 * 가정: ranges는 startMs 오름차순 정렬되어 있고 비-중첩.
 * 반환: 매칭 range 또는 null.
 */
import { describe, it, expect } from 'vitest'
import { findRangeAt } from '../../../src/components/AudioTimeline/PreviewPanel'

const make = (startMs, endMs, extra = {}) => ({ startMs, endMs, ...extra })

describe('findRangeAt', () => {
  describe('exclusive end (scene-style)', () => {
    const ranges = [
      make(0, 1000, { id: 'a' }),
      make(1000, 3000, { id: 'b' }),
      make(3000, 6000, { id: 'c' }),
    ]

    it('returns null for empty ranges', () => {
      expect(findRangeAt([], 500)).toBeNull()
    })

    it('finds the first range when t = startMs', () => {
      expect(findRangeAt(ranges, 0)?.id).toBe('a')
    })

    it('finds correct range in the middle', () => {
      expect(findRangeAt(ranges, 500)?.id).toBe('a')
      expect(findRangeAt(ranges, 1500)?.id).toBe('b')
      expect(findRangeAt(ranges, 4500)?.id).toBe('c')
    })

    it('boundary endMs is NOT included (exclusive)', () => {
      // t == endMs of 'a' (1000) should match 'b' (whose startMs is 1000) not 'a'
      expect(findRangeAt(ranges, 1000)?.id).toBe('b')
      // t == endMs of 'c' (6000) → past last range
      expect(findRangeAt(ranges, 6000)).toBeNull()
    })

    it('returns null below first startMs', () => {
      expect(findRangeAt([make(100, 200)], 50)).toBeNull()
    })

    it('returns null past last endMs', () => {
      expect(findRangeAt(ranges, 6001)).toBeNull()
    })

    it('returns null when t falls in a gap between ranges', () => {
      const gapped = [make(0, 100, { id: 'a' }), make(200, 300, { id: 'b' })]
      expect(findRangeAt(gapped, 150)).toBeNull()
    })
  })

  describe('inclusive end (SRT-style)', () => {
    const ranges = [
      make(0, 1000, { id: 'a' }),
      make(2000, 3000, { id: 'b' }),
    ]

    it('includes endMs', () => {
      expect(findRangeAt(ranges, 1000, /* inclusiveEnd */ true)?.id).toBe('a')
      expect(findRangeAt(ranges, 3000, true)?.id).toBe('b')
    })

    it('still respects gaps', () => {
      expect(findRangeAt(ranges, 1500, true)).toBeNull()
    })
  })

  describe('scale — correctness at 1500 entries', () => {
    const ranges = Array.from({ length: 1500 }, (_, i) => make(i * 100, i * 100 + 80, { i }))

    it('finds middle entry correctly', () => {
      const target = ranges[750]
      expect(findRangeAt(ranges, target.startMs + 40)?.i).toBe(750)
    })

    it('finds first entry', () => {
      expect(findRangeAt(ranges, 50)?.i).toBe(0)
    })

    it('finds last entry', () => {
      expect(findRangeAt(ranges, 1499 * 100 + 50)?.i).toBe(1499)
    })

    it('returns null past the end', () => {
      expect(findRangeAt(ranges, 1500 * 100)).toBeNull()
    })
  })
})
