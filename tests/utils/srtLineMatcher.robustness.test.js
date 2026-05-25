/**
 * srtLineMatcher — Review fix 5 (C11, C14)
 *
 * C11: 빈 텍스트 vs 빈 텍스트가 exact match 로 인정되어 임의 매핑 → 빈 라인은 매칭에서 제외
 * C14: 매우 긴 텍스트끼리 levenshtein O(n*m) 메모리 OOM → 길이 cap
 */
import { describe, it, expect } from 'vitest'
import { matchSrtLines, similarity } from '../../src/utils/srtLineMatcher'

describe('C11 — 빈 텍스트는 exact match 안 함', () => {
  it('빈 old + 빈 new → 매칭 아님 (각각 removed/added)', () => {
    const oldTrack = [
      { id: 'sub_1', text: '' },
      { id: 'sub_2', text: '' },
    ]
    const newTrack = [
      { id: 'sub_x', text: '' },
      { id: 'sub_y', text: '' },
    ]
    const result = matchSrtLines(oldTrack, newTrack)
    expect(result.matched).toHaveLength(0)
    expect(result.removed).toEqual(['sub_1', 'sub_2'])
    expect(result.added).toEqual([0, 1])
  })

  it('빈 old + 비-빈 new → 빈 old 는 removed', () => {
    const oldTrack = [{ id: 'sub_1', text: '' }]
    const newTrack = [{ id: 'sub_x', text: 'NEW' }]
    const result = matchSrtLines(oldTrack, newTrack)
    expect(result.matched).toHaveLength(0)
    expect(result.removed).toEqual(['sub_1'])
    expect(result.added).toEqual([0])
  })

  it('whitespace-only 도 빈 텍스트로 취급', () => {
    const oldTrack = [{ id: 'sub_1', text: '   ' }]
    const newTrack = [{ id: 'sub_x', text: '   ' }]
    const result = matchSrtLines(oldTrack, newTrack)
    expect(result.matched).toHaveLength(0)
  })
})

describe('C14 — levenshtein 길이 cap', () => {
  it('매우 긴 텍스트끼리 similarity 호출은 임계 미만 반환 (cap 작동)', () => {
    const big1 = 'A'.repeat(5000)
    const big2 = 'B'.repeat(5000)
    // OOM 안 일으키고 빠르게 반환되어야 함
    const start = Date.now()
    const sim = similarity(big1, big2)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(1000) // 1초 이내
    expect(sim).toBeLessThan(0.85) // 임계 미만 (서로 다른 텍스트)
  })

  it('큰 텍스트끼리 정확 일치 (정규화 후) 는 1.0 반환 (정확 매치는 빠른 경로)', () => {
    const big = 'X'.repeat(5000)
    expect(similarity(big, big)).toBe(1)
  })

  it('matchSrtLines 가 매우 긴 라인 vs 다른 긴 라인에서도 OOM 없이 완료', () => {
    const big1 = 'A'.repeat(5000)
    const big2 = 'C'.repeat(5000)
    const oldTrack = [{ id: 'sub_1', text: big1 }]
    const newTrack = [{ id: 'sub_x', text: big2 }]
    const start = Date.now()
    const result = matchSrtLines(oldTrack, newTrack)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(2000)
    expect(result.removed).toEqual(['sub_1']) // 매칭 안 됨
    expect(result.added).toEqual([0])
  })
})
