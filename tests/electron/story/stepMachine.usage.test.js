import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

const tmpProject = () => mkdtemp(path.join(os.tmpdir(), 'proj-'))

const mkMachine = async (emit = () => {}) => {
  const llm = { generateTitle: vi.fn(async () => ({ title: 'T' })) }
  const m = createStepMachine({ projectPath: await tmpProject(), llm, emit, getApiKey: () => null })
  await m.open()
  return m
}

/** abort() 는 항상 send('story:state') 를 태운다 — emit 을 유발하는 가장 싼 방법. */
const lastEmit = async (m, seen) => { seen.length = 0; await m.abort(); return seen[seen.length - 1] }

describe('stepMachine 토큰 누산 배선', () => {
  it('emit 에 이번 실행 누적 usage 가 실린다', async () => {
    const seen = []
    const m = await mkMachine((_ch, payload) => seen.push(payload))
    expect((await lastEmit(m, seen)).usage).toEqual({ input: 0, output: 0 })
  })

  it('claude delta 는 가산되어 emit 에 반영된다', async () => {
    const seen = []
    const m = await mkMachine((_ch, payload) => seen.push(payload))
    m.usageTracker.addDelta({ input: 10, output: 4 })
    m.usageTracker.addDelta({ input: 5, output: 1 })
    expect((await lastEmit(m, seen)).usage).toEqual({ input: 15, output: 5 })
  })

  it('codex 누적은 같은 thread 면 교체된다 — 가산이면 뻥튀기', async () => {
    const seen = []
    const m = await mkMachine((_ch, payload) => seen.push(payload))
    m.usageTracker.setCumulative({ key: 't1', input: 100, output: 40 })
    m.usageTracker.setCumulative({ key: 't1', input: 250, output: 90 })
    expect((await lastEmit(m, seen)).usage).toEqual({ input: 250, output: 90 }) // 350/130 아님
  })

  it('엔진 혼합 — claude 가산 + codex 교체가 한 실행에 섞여도 맞다', async () => {
    const seen = []
    const m = await mkMachine((_ch, payload) => seen.push(payload))
    m.usageTracker.addDelta({ input: 10, output: 1 })
    m.usageTracker.setCumulative({ key: 't1', input: 100, output: 40 })
    m.usageTracker.setCumulative({ key: 't1', input: 250, output: 90 })
    expect((await lastEmit(m, seen)).usage).toEqual({ input: 260, output: 91 })
  })

  // 프로젝트 전환 격리 — 모듈 싱글톤이면 A 의 토큰이 B 에 뜬다.
  it('machine 마다 tracker 가 다르다', async () => {
    const seenA = []
    const a = await mkMachine((_ch, p) => seenA.push(p))
    a.usageTracker.addDelta({ input: 999, output: 999 })

    const seenB = []
    const b = await mkMachine((_ch, p) => seenB.push(p))
    expect(b.usageTracker).not.toBe(a.usageTracker)
    expect((await lastEmit(b, seenB)).usage).toEqual({ input: 0, output: 0 })
    // A 는 자기 값을 그대로 갖는다
    expect((await lastEmit(a, seenA)).usage).toEqual({ input: 999, output: 999 })
  })

  // start() 연쇄(자동 진행)에서 앞 합계가 사라지면 안 된다 — progressLog 함정 회귀.
  it('여러 emit 을 거쳐도 합계가 단조 증가한다', async () => {
    const seen = []
    const m = await mkMachine((_ch, payload) => seen.push(payload))
    m.usageTracker.addDelta({ input: 10, output: 2 })
    const first = (await lastEmit(m, seen)).usage
    m.usageTracker.addDelta({ input: 7, output: 3 })
    const second = (await lastEmit(m, seen)).usage
    expect(second.input).toBeGreaterThan(first.input)
    expect(second).toEqual({ input: 17, output: 5 })
  })
})
