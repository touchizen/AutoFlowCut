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





  // 실시간(스트리밍) 표시용. message_delta 는 응답 내 output 누적치라 더하면 중복 —
  // pending 은 key 별 교체(setCumulative 와 같은 꼴)로 두고 snapshot 에 포함한다.
  it('pending 은 같은 key 를 교체하고 snapshot 에 포함된다', () => {
    const t = createUsageTracker()
    t.setPending('q1', { input: 500, output: 3 })
    t.setPending('q1', { input: 500, output: 120 }) // output 누적 증가 → 교체
    expect(t.snapshot()).toEqual({ input: 500, output: 120 }) // 6/123 이 아니다
  })

  // 급소: 스트림이 끝나면 result 가 확정 usage 를 addDelta 로 커밋한다. pending 을 안 지우면
  // 같은 응답이 두 번(진행중 추정 + 확정) 세어진다.
  it('clearPending 후 addDelta 커밋 — 이중계산 없이 확정치만 남는다', () => {
    const t = createUsageTracker()
    t.setPending('q1', { input: 500, output: 120 }) // 진행중 추정
    t.clearPending('q1')
    t.addDelta({ input: 512, output: 128 })          // 확정
    expect(t.snapshot()).toEqual({ input: 512, output: 128 })
  })

  it('pending 은 codex cumulative 와 격리된다 — key 공간이 겹치지 않는다', () => {
    const t = createUsageTracker()
    t.setCumulative({ key: 't1', input: 100, output: 40 })
    t.setPending('t1', { input: 7, output: 2 }) // 같은 문자열이어도 별개 통
    expect(t.snapshot()).toEqual({ input: 107, output: 42 })
  })

  it('null/빈 pending 은 무시한다', () => {
    const t = createUsageTracker()
    t.setPending('q1', null)
    t.setPending(null, { input: 1, output: 1 })
    t.clearPending('nope')
    expect(t.snapshot()).toEqual({ input: 0, output: 0 })
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
