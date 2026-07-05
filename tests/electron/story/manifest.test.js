import { describe, it, expect } from 'vitest'
import { buildManifest } from '../../../electron/story/manifest.js'

const segs = [
  { id: 's1', type: 'narration', speaker: 'narrator', audioPath: '/a/s1.wav', startMs: 0, durationMs: 2000 },
  { id: 's2', type: 'sfx', audioPath: '/a/s2.wav', startMs: 2150, durationMs: 800 },
]

describe('buildManifest', () => {
  it('narration은 trackIndex 0, pushRevision 기본 null', () => {
    const m = buildManifest(segs)
    expect(m.version).toBe(1)
    expect(m.pushRevision).toBe(null)
    expect(m.segments[0]).toMatchObject({ id: 's1', type: 'narration', trackIndex: 0, startMs: 0, durationMs: 2000 })
  })

  it('pushRevision 주입', () => {
    expect(buildManifest(segs, { pushRevision: 7 }).pushRevision).toBe(7)
  })

  it('sfx 세그먼트도 포함(trackIndex 없음)', () => {
    const m = buildManifest(segs)
    const sfx = m.segments.find((s) => s.id === 's2')
    expect(sfx.type).toBe('sfx')
    expect(sfx.trackIndex).toBeUndefined()
  })

  it('narrator는 0, non-narrator는 등장순 1+ 트랙을 재사용한다', () => {
    const m = buildManifest([
      { id: 's1', type: 'narration', speaker: 'narrator', audioPath: '/a/s1.wav', startMs: 0, durationMs: 1000 },
      { id: 's2', type: 'narration', speaker: 'mina', audioPath: '/a/s2.wav', startMs: 1000, durationMs: 1000 },
      { id: 's3', type: 'narration', speaker: 'jun', audioPath: '/a/s3.wav', startMs: 2000, durationMs: 1000 },
      { id: 's4', type: 'narration', speaker: 'mina', audioPath: '/a/s4.wav', startMs: 3000, durationMs: 1000 },
    ])
    expect(m.segments.map((s) => s.trackIndex)).toEqual([0, 1, 2, 1])
  })

  it('speakers 목록에 없어도 non-empty non-narrator speaker는 독립 트랙을 받는다', () => {
    const m = buildManifest([
      { id: 's1', type: 'narration', speaker: 'mystery', audioPath: '/a/s1.wav', startMs: 0, durationMs: 1000 },
    ])
    expect(m.segments[0].trackIndex).toBe(1)
  })

  it('speaker 키 정규화로 같은 화자를 같은 트랙에 둔다', () => {
    const m = buildManifest([
      { id: 's1', type: 'narration', speaker: 'Mina', audioPath: '/a/s1.wav', startMs: 0, durationMs: 1000 },
      { id: 's2', type: 'narration', speaker: ' mina ', audioPath: '/a/s2.wav', startMs: 1000, durationMs: 1000 },
      { id: 's3', type: 'narration', speaker: 'mi na', audioPath: '/a/s3.wav', startMs: 2000, durationMs: 1000 },
    ])
    expect(m.segments.map((s) => s.trackIndex)).toEqual([1, 1, 1])
  })

  it('빈 speaker와 나레이션 계열 speaker는 narrator 트랙 0으로 둔다', () => {
    const m = buildManifest([
      { id: 's1', type: 'narration', speaker: '', audioPath: '/a/s1.wav', startMs: 0, durationMs: 1000 },
      { id: 's2', type: 'narration', speaker: '나레이션', audioPath: '/a/s2.wav', startMs: 1000, durationMs: 1000 },
      { id: 's3', type: 'narration', speaker: 'Narration', audioPath: '/a/s3.wav', startMs: 2000, durationMs: 1000 },
    ])
    expect(m.segments.map((s) => s.trackIndex)).toEqual([0, 0, 0])
  })
})
