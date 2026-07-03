import { describe, it, expect } from 'vitest'
import { buildSegmentTimeline, buildSrt, srtLineId } from '../../../electron/story/timing.js'

const segs = [
  { id: 's1', type: 'narration', text: '첫 문장', durationMs: 2000 },
  { id: 's2', type: 'sfx', text: '', durationMs: 800 },
  { id: 's3', type: 'narration', text: '둘째 문장', durationMs: 1500 },
]

describe('buildSegmentTimeline', () => {
  it('gap 포함 누적 startMs (0, 2150, 3750)', () => {
    const out = buildSegmentTimeline(segs, { gapMs: 150 })
    expect(out.map((s) => s.startMs)).toEqual([0, 2150, 3750])
    expect(segs[0].startMs).toBeUndefined() // 원본 불변
  })
})

describe('srtLineId', () => {
  it('sub_<id>', () => { expect(srtLineId('s3')).toBe('sub_s3') })
})

describe('buildSrt', () => {
  it('narration만 자막화, sfx 제외, 인덱스 1..N 순차', () => {
    const timed = buildSegmentTimeline(segs, { gapMs: 150 })
    const srt = buildSrt(timed)
    // s1: 0~2000, s3: 3750~5250 (s2 sfx 제외)
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,000\n첫 문장')
    expect(srt).toContain('2\n00:00:03,750 --> 00:00:05,250\n둘째 문장')
    expect(srt).not.toContain('800')
  })
})
