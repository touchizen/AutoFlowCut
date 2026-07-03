import { describe, it, expect } from 'vitest'
import { regroupScenes } from '../../../electron/story/regroup.js'

// startMs는 무시하고 durationMs 누적으로 그룹 판정 (startMs는 결과 계산용)
function seg(id, durationMs, startMs) { return { id, type: 'narration', durationMs, startMs } }

describe('regroupScenes', () => {
  it('누적 6초 도달 시 씬 마감', () => {
    const segs = [seg('a', 3000, 0), seg('b', 3500, 3150), seg('c', 3000, 6800)]
    const scenes = regroupScenes(segs, { minMs: 6000, maxMs: 10000 })
    // a+b = 6500ms >= 6000 → 씬1 [a,b]; c → 씬2 [c]
    expect(scenes.map((s) => s.segmentIds)).toEqual([['a', 'b'], ['c']])
    expect(scenes[0].startMs).toBe(0)
  })

  it('다음 세그먼트가 maxMs 초과 유발하면 현재 씬 먼저 마감', () => {
    const segs = [seg('a', 5000, 0), seg('b', 6000, 5150)]
    const scenes = regroupScenes(segs, { minMs: 6000, maxMs: 10000 })
    // a=5000(<6000) 이지만 a+b=11000 > 10000 → a 단독 마감, b 단독
    expect(scenes.map((s) => s.segmentIds)).toEqual([['a'], ['b']])
  })

  it('단일 세그먼트가 maxMs 초과면 단독 씬', () => {
    const segs = [seg('a', 12000, 0)]
    const scenes = regroupScenes(segs, { minMs: 6000, maxMs: 10000 })
    expect(scenes).toHaveLength(1)
    expect(scenes[0].segmentIds).toEqual(['a'])
    expect(scenes[0].durationMs).toBe(12000)
  })

  it('endMs = 마지막 세그먼트 startMs + durationMs', () => {
    const segs = [seg('a', 3000, 0), seg('b', 4000, 3150)]
    const scenes = regroupScenes(segs, { minMs: 6000, maxMs: 10000 })
    expect(scenes[0].endMs).toBe(7150)
    expect(scenes[0].durationMs).toBe(7150) // startMs 0 기준
  })
})
