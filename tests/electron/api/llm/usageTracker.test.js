import { describe, it, expect } from 'vitest'
import { createUsageTracker } from '../../../../electron/api/llm/usageTracker.js'

describe('createUsageTracker', () => {
  it('delta 는 더한다 (claude)', () => {
    const t = createUsageTracker()
    t.addDelta({ input: 10, output: 5 })
    t.addDelta({ input: 3, output: 2 })
    expect(t.snapshot()).toEqual({ input: 13, output: 7 })
  })

  // 이 기능의 급소. codex 는 thread 누적치를 보내므로 더하면 뻥튀기된다.
  it('같은 key 의 cumulative 는 교체한다 — 더하면 뻥튀기', () => {
    const t = createUsageTracker()
    t.setCumulative({ key: 't1', input: 100, output: 40 })
    t.setCumulative({ key: 't1', input: 250, output: 90 })
    expect(t.snapshot()).toEqual({ input: 250, output: 90 }) // 350/130 이 아니다
  })

  it('다른 key 의 cumulative 는 합산한다 — codex 는 호출당 새 thread', () => {
    const t = createUsageTracker()
    t.setCumulative({ key: 't1', input: 100, output: 10 })
    t.setCumulative({ key: 't2', input: 200, output: 20 })
    expect(t.snapshot()).toEqual({ input: 300, output: 30 })
  })

  it('엔진 혼합 — delta 와 cumulative 가 한 실행에 섞여도 맞다', () => {
    const t = createUsageTracker()
    t.addDelta({ input: 10, output: 1 })
    t.setCumulative({ key: 't1', input: 100, output: 40 })
    t.addDelta({ input: 5, output: 2 })
    t.setCumulative({ key: 't1', input: 250, output: 90 }) // 교체
    expect(t.snapshot()).toEqual({ input: 265, output: 93 }) // 15+250, 3+90
  })

  it('beginRun 은 epoch 를 올리고 합계를 0 으로 되돌린다', () => {
    const t = createUsageTracker()
    t.addDelta({ input: 10, output: 5 })
    const e1 = t.currentEpoch()
    const e2 = t.beginRun()
    expect(e2).toBeGreaterThan(e1)
    expect(t.snapshot()).toEqual({ input: 0, output: 0 })
  })

  it('beginRun 은 codex key 도 지운다 — 이전 실행 thread 가 새 합계에 남으면 안 된다', () => {
    const t = createUsageTracker()
    t.setCumulative({ key: 't1', input: 100, output: 40 })
    t.beginRun()
    expect(t.snapshot()).toEqual({ input: 0, output: 0 })
  })

  // 늦게 끝난 이전 실행이 새 실행을 오염시키면 안 된다.
  it('지난 epoch 의 기록은 무시한다', () => {
    const t = createUsageTracker()
    const stale = t.currentEpoch()
    t.beginRun()
    t.addDelta({ input: 999, output: 999 }, stale)
    t.setCumulative({ key: 't9', input: 999, output: 999 }, stale)
    expect(t.snapshot()).toEqual({ input: 0, output: 0 })
  })

  it('현재 epoch 를 명시해 기록하면 반영된다', () => {
    const t = createUsageTracker()
    const e = t.currentEpoch()
    t.addDelta({ input: 4, output: 1 }, e)
    expect(t.snapshot()).toEqual({ input: 4, output: 1 })
  })

  it('null/빈 기록은 무시한다', () => {
    const t = createUsageTracker()
    t.addDelta(null)
    t.setCumulative(null)
    t.setCumulative({ input: 1, output: 1 }) // key 없음
    expect(t.snapshot()).toEqual({ input: 0, output: 0 })
  })

  it('인스턴스끼리 격리된다 — 모듈 싱글톤이면 프로젝트 A 토큰이 B 에 뜬다', () => {
    const a = createUsageTracker()
    const b = createUsageTracker()
    a.addDelta({ input: 10, output: 5 })
    a.setCumulative({ key: 't1', input: 100, output: 40 })
    expect(b.snapshot()).toEqual({ input: 0, output: 0 })
  })
})
