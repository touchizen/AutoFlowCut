import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'
import { __tapQueryForTest } from '../../../electron/api/llm/llmClaude.js'
import { __getCodexUsageSinkForTest } from '../../../electron/api/llm/codexAppServer.js'

/**
 * **machine 배선 테스트** — 전역 sink → machine tracker → emit payload 까지 흐르는지.
 *
 * 이 파일이 죽이는 뮤테이션은 **하나**다: stepMachine 의 `setClaudeUsageSink/setCodexUsageSink`
 * 콜백에서 addDelta ↔ setCumulative 를 맞바꾸는 것(= 조용히 틀린 합계 그 자체).
 * 나머지 두 배선 링크는 **각각 다른 파일**이 커버한다(1라운드 리뷰에서 여기 주석이 셋을 다
 * 이 파일 공로로 돌린 게 거짓임이 실측으로 드러났다 — 이 파일은 __getCodexUsageSinkForTest 로
 * sink 를 직접 부르고 __tapQueryForTest 로 tap 헬퍼를 직접 부르므로, transport/제너레이터를
 * 안 지난다):
 *   - claude tap → defaultQuery 가 tap 을 쓰는지: `llmClaude.defaultQueryTap.test.js`
 *   - codex transport → onNotification 이 handleUsageNotification 을 부르는지: `codexAppServer.usageRun.test.js`
 */
const tmpProject = () => mkdtemp(path.join(os.tmpdir(), 'proj-'))

const mkMachine = async (emit = () => {}) => {
  const llm = { generateTitle: vi.fn(async () => ({ title: 'T' })) }
  const m = createStepMachine({ projectPath: await tmpProject(), llm, emit, getApiKey: () => null })
  await m.open()
  return m
}

const lastEmit = async (m, seen) => { seen.length = 0; await m.abort(); return seen[seen.length - 1] }
const results = (...ms) => (async function* () { for (const m of ms) yield m })()

describe('토큰 배선 — provider tap → machine tracker → emit', () => {
  it('claude tap 이 machine 이 물린 sink 를 통해 합계에 들어간다', async () => {
    const seen = []
    const m = await mkMachine((_ch, p) => seen.push(p))

    // machine 이 setClaudeUsageSink 로 물린 전역 sink 를 tap 이 실제로 읽는다.
    const tapped = __tapQueryForTest(() => results(
      { type: 'result', subtype: 'success', usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 7 } },
    ))
    for await (const _m of tapped({})) { /* drain */ }

    // addDelta↔setCumulative 를 맞바꾸면 claude usage 는 key 가 없어 통째로 버려진다 → 0/0 으로 죽는다.
    expect((await lastEmit(m, seen)).usage).toEqual({ input: 120, output: 7 })
  })

  it('claude 호출 두 번은 가산된다 — 교체면 마지막 것만 남는다', async () => {
    const seen = []
    const m = await mkMachine((_ch, p) => seen.push(p))
    for (const n of [10, 5]) {
      const tapped = __tapQueryForTest(() => results({ type: 'result', usage: { input_tokens: n, output_tokens: 1 } }))
      for await (const _m of tapped({})) { /* drain */ }
    }
    expect((await lastEmit(m, seen)).usage).toEqual({ input: 15, output: 2 })
  })

  it('machine 이 codex sink 를 물린다 — 안 물리면 codex 토큰이 통째로 사라진다', async () => {
    const seen = []
    const m = await mkMachine((_ch, p) => seen.push(p))

    const sink = __getCodexUsageSinkForTest()
    expect(typeof sink).toBe('function')

    // codex 는 thread 누적치 → 같은 key 재수신은 교체여야 한다. 가산으로 배선하면 350 이 된다.
    sink({ key: 't1', input: 100, output: 40 })
    sink({ key: 't1', input: 250, output: 90 })
    expect((await lastEmit(m, seen)).usage).toEqual({ input: 250, output: 90 })
  })

  it('엔진 혼합 — claude tap 가산 + codex sink 교체가 한 세션에 섞여도 맞다', async () => {
    const seen = []
    const m = await mkMachine((_ch, p) => seen.push(p))

    const tapped = __tapQueryForTest(() => results({ type: 'result', usage: { input_tokens: 10, output_tokens: 1 } }))
    for await (const _m of tapped({})) { /* drain */ }
    const sink = __getCodexUsageSinkForTest()
    sink({ key: 't1', input: 100, output: 40 })
    sink({ key: 't1', input: 250, output: 90 }) // 교체

    expect((await lastEmit(m, seen)).usage).toEqual({ input: 260, output: 91 })
  })

  // sink 핸드오프 — 새 machine 이 생기면 전역 sink 는 B 로 간다.
  it('나중에 만든 machine 이 sink 를 가져간다 — A 는 오염되지 않는다', async () => {
    const seenA = []
    const a = await mkMachine((_ch, p) => seenA.push(p))
    const seenB = []
    const b = await mkMachine((_ch, p) => seenB.push(p))

    const tapped = __tapQueryForTest(() => results({ type: 'result', usage: { input_tokens: 50, output_tokens: 5 } }))
    for await (const _m of tapped({})) { /* drain */ }

    expect((await lastEmit(b, seenB)).usage).toEqual({ input: 50, output: 5 })
    expect((await lastEmit(a, seenA)).usage).toEqual({ input: 0, output: 0 })
  })
})
