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
})
