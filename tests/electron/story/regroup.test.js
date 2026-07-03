import { describe, it, expect } from 'vitest'
import { regroupScenes } from '../../../electron/story/regroup.js'

// MED7: 그룹 판정은 startMs 기반 실제 wall-clock span(gap 포함)으로 한다 (durationMs 합만으로 판정하지 않음)
function seg(id, durationMs, startMs, speaker) { return { id, type: 'narration', durationMs, startMs, speaker } }

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

  // MED7-1: durationMs 합(gap 제외)만으로는 9900ms(<=maxMs)라 안 닫히지만, 실제 wall-clock
  // span(gap 포함, b.startMs+b.durationMs-a.startMs=10100ms)은 maxMs(10000) 초과 → a를 먼저
  // 마감하고 b를 새 씬으로 시작해야 한다.
  it('gap 포함 실제 span이 maxMs를 초과하면 (durationMs 합은 이내여도) 먼저 마감한다', () => {
    const segs = [seg('a', 5000, 0), seg('b', 4900, 5200)]
    // durationMs 합 = 9900 <= 10000 (버그: 이 값만 보면 안 닫힘)
    // 실제 span = 5200+4900-0 = 10100 > 10000 (정답: 여기서 닫혀야 함)
    const scenes = regroupScenes(segs, { minMs: 6000, maxMs: 10000 })
    expect(scenes.map((s) => s.segmentIds)).toEqual([['a'], ['b']])
  })

  // Codex-2 LOW: 화자 변경 시 "이미 minMs 도달했으면 추가 전에 마감" 분기(speakerChanged &&
  // span>=minMs)는 도달 불가능한 죽은 코드였다 — 매 반복 끝에서 무조건 span>=minMs면 이미
  // flush되므로, 다음 반복 진입 시점엔 항상 span<minMs다. 아래는 화자가 바뀌어도 duration
  // 규칙만으로 동일한 마감 지점이 나온다는 걸(죽은 분기 없이도 결과가 같다는 걸) 검증한다 —
  // 화자 변경이 "추가" 마감을 일으키지 않고, minMs 도달 시점의 통상 flush와 우연히 일치할 뿐임.
  it('화자 변경 시점이 minMs 도달과 겹쳐도 duration 규칙만으로 동일하게 마감된다', () => {
    const segs = [
      seg('a', 4000, 0, 'X'),
      seg('b', 3000, 4150, 'X'), // a+b span = 4150+3000-0 = 7150 >= 6000 → duration 규칙으로 이미 마감
      seg('c', 2000, 7300, 'Y'), // 화자 변경 — 이때 cur는 이미 비어있어(방금 flush) 화자 분기는 관여하지 않음
    ]
    const scenes = regroupScenes(segs, { minMs: 6000, maxMs: 10000 })
    expect(scenes.map((s) => s.segmentIds)).toEqual([['a', 'b'], ['c']])
  })

  // MED7-2: 화자 변경이 minMs 도달 전이면 마감하지 않는다 (짧은 씬 난사 방지)
  it('화자 변경이 minMs 도달 전이면 마감하지 않고 계속 누적한다', () => {
    const segs = [
      seg('a', 3000, 0, 'X'),
      seg('b', 2500, 3150, 'Y'), // span = 3150+2500-0 = 5650 < 6000, 화자 달라도 마감 안 함
    ]
    const scenes = regroupScenes(segs, { minMs: 6000, maxMs: 10000 })
    expect(scenes.map((s) => s.segmentIds)).toEqual([['a', 'b']])
  })
})
