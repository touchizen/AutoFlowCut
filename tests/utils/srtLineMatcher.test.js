/**
 * srtLineMatcher — SRT 라인 텍스트 유사도 매칭
 *
 * Phase 9 of docs/superpowers/plans/2026-05-25-srt-csv-track-separation.md
 */
import { describe, it, expect } from 'vitest'
import {
  matchSrtLines,
  normalizeText,
  similarity,
} from '../../src/utils/srtLineMatcher'

// ============================================================
// normalizeText
// ============================================================

describe('normalizeText', () => {
  it('trim + 소문자 + 다중 공백 1개로', () => {
    expect(normalizeText('  Hello   World  ')).toBe('hello world')
  })

  it('한글은 소문자화 영향 없음', () => {
    expect(normalizeText('  자막   1 ')).toBe('자막 1')
  })

  it('빈 문자열 → 빈 문자열', () => {
    expect(normalizeText('')).toBe('')
    expect(normalizeText(null)).toBe('')
    expect(normalizeText(undefined)).toBe('')
  })

  it('구두점 단순화 (선택) — , . ! ? 보존', () => {
    expect(normalizeText('Hello, world!')).toBe('hello, world!')
  })
})

// ============================================================
// similarity
// ============================================================

describe('similarity', () => {
  it('완전 일치 → 1.0', () => {
    expect(similarity('abc', 'abc')).toBe(1)
  })

  it('완전 불일치 → 0', () => {
    expect(similarity('abc', '')).toBe(0)
    expect(similarity('', 'xyz')).toBe(0)
  })

  it('대소문자만 다름 → 1.0 (normalize)', () => {
    expect(similarity('Hello', 'hello')).toBe(1)
  })

  it('일부 변경 → 0~1 사이', () => {
    const sim = similarity('hello world', 'hello there')
    expect(sim).toBeGreaterThan(0)
    expect(sim).toBeLessThan(1)
  })

  it('substring 관계 → 높은 유사도', () => {
    const sim = similarity('자막1', '자막1입니다')
    expect(sim).toBeGreaterThan(0.4)
  })
})

// ============================================================
// matchSrtLines
// ============================================================

describe('matchSrtLines', () => {
  it('완전히 같은 트랙 → 모두 matched', () => {
    const oldTrack = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: '자막1' },
      { id: 'sub_2', startTime: 1, endTime: 2, text: '자막2' },
    ]
    const newTrack = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: '자막1' },
      { id: 'sub_2', startTime: 1, endTime: 2, text: '자막2' },
    ]
    const result = matchSrtLines(oldTrack, newTrack)
    expect(result.matched).toHaveLength(2)
    expect(result.removed).toEqual([])
    expect(result.added).toEqual([])
    expect(result.matched[0]).toMatchObject({ oldId: 'sub_1', newIdx: 0 })
    expect(result.matched[1]).toMatchObject({ oldId: 'sub_2', newIdx: 1 })
  })

  it('라인 1개 삭제 → 그 라인 removed, 나머지 matched', () => {
    const oldTrack = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
      { id: 'sub_2', startTime: 1, endTime: 2, text: 'B' },
      { id: 'sub_3', startTime: 2, endTime: 3, text: 'C' },
    ]
    const newTrack = [
      { id: 'sub_x', startTime: 0, endTime: 1, text: 'A' },
      { id: 'sub_y', startTime: 1, endTime: 2, text: 'C' },
    ]
    const result = matchSrtLines(oldTrack, newTrack)
    expect(result.matched).toHaveLength(2)
    expect(result.removed).toContain('sub_2')
    expect(result.added).toEqual([])
  })

  it('라인 1개 추가 → 그 라인 added, 나머지 matched', () => {
    const oldTrack = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
      { id: 'sub_2', startTime: 1, endTime: 2, text: 'B' },
    ]
    const newTrack = [
      { id: 'sub_x', startTime: 0, endTime: 1, text: 'A' },
      { id: 'sub_y', startTime: 1, endTime: 2, text: 'NEW' },
      { id: 'sub_z', startTime: 2, endTime: 3, text: 'B' },
    ]
    const result = matchSrtLines(oldTrack, newTrack)
    expect(result.matched).toHaveLength(2)
    expect(result.removed).toEqual([])
    expect(result.added).toContain(1) // newIdx 1 (NEW) is added
  })

  it('정규화 매치 (대소문자/공백 다름) → 1.0 매치로 인정', () => {
    const oldTrack = [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'Hello World' }]
    const newTrack = [{ id: 'sub_x', startTime: 0, endTime: 1, text: 'hello world' }]
    const result = matchSrtLines(oldTrack, newTrack)
    expect(result.matched).toHaveLength(1)
    expect(result.matched[0]).toMatchObject({ oldId: 'sub_1', newIdx: 0, score: 1 })
  })

  it('유사도 임계 (0.85) 이상 → 매치, 미만 → removed/added', () => {
    const oldTrack = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: '안녕하세요 반갑습니다' },
    ]
    // 텍스트가 완전히 다름 → 매치 안 됨
    const newTrack = [
      { id: 'sub_x', startTime: 0, endTime: 1, text: '오늘 날씨가 정말 좋네요' },
    ]
    const result = matchSrtLines(oldTrack, newTrack)
    expect(result.matched).toHaveLength(0)
    expect(result.removed).toContain('sub_1')
    expect(result.added).toContain(0)
  })

  it('빈 트랙 처리', () => {
    expect(matchSrtLines([], [])).toEqual({ matched: [], removed: [], added: [] })
    expect(matchSrtLines([{ id: 'a', text: 'x' }], [])).toMatchObject({ removed: ['a'] })
    expect(matchSrtLines([], [{ id: 'b', text: 'x' }])).toMatchObject({ added: [0] })
  })

  it('각 매치는 score 가짐 (1.0 = 완전 일치)', () => {
    const oldTrack = [{ id: 'sub_1', text: 'abc' }]
    const newTrack = [{ id: 'sub_x', text: 'abc' }]
    const result = matchSrtLines(oldTrack, newTrack)
    expect(result.matched[0].score).toBe(1)
  })

  it('같은 텍스트가 여러 번 있어도 1:1 매치 (greedy)', () => {
    const oldTrack = [
      { id: 'sub_1', text: '같은 자막' },
      { id: 'sub_2', text: '같은 자막' },
    ]
    const newTrack = [
      { id: 'sub_x', text: '같은 자막' },
      { id: 'sub_y', text: '같은 자막' },
    ]
    const result = matchSrtLines(oldTrack, newTrack)
    expect(result.matched).toHaveLength(2)
    // 둘 다 매칭, 각자 다른 newIdx
    const usedIndices = result.matched.map(m => m.newIdx).sort()
    expect(usedIndices).toEqual([0, 1])
  })
})
