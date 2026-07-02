import { describe, it, expect } from 'vitest'
import { estimateReadingSec, buildFallbackTimeline } from '../../../electron/story/timing.js'

describe('estimateReadingSec', () => {
  it('한국어는 5.5자/초', () => {
    expect(estimateReadingSec('가'.repeat(55), 'ko')).toBeCloseTo(10, 1)
  })
  it('영어는 15자/초', () => {
    expect(estimateReadingSec('a'.repeat(150), 'en')).toBeCloseTo(10, 1)
  })
  it('알 수 없는 언어는 en 규칙', () => {
    expect(estimateReadingSec('a'.repeat(150), 'xx')).toBeCloseTo(10, 1)
  })
  it('빈 텍스트도 최소 1초', () => {
    expect(estimateReadingSec('', 'ko')).toBe(1)
  })
})

describe('buildFallbackTimeline', () => {
  it('세그먼트 text 합산 길이로 순차 배치한다', () => {
    const scenes = [
      { storyId: 'u1', segments: [{ text: '가'.repeat(33) }] },           // 6s
      { storyId: 'u2', segments: [{ text: '가'.repeat(22) }, { text: '가'.repeat(22) }] }, // 8s
    ]
    const tl = buildFallbackTimeline(scenes, 'ko')
    expect(tl[0]).toEqual({ storyId: 'u1', startTime: 0, endTime: 6, duration: 6 })
    expect(tl[1].startTime).toBe(6)
    expect(tl[1].duration).toBeCloseTo(8, 1)
    expect(tl[1].endTime).toBeCloseTo(14, 1)
  })
})
