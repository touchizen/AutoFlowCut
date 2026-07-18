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

  // 스트리밍 진행(pending) → 확정(commit) 배선. 이 경로가 이중계산이 실제로 일어나는 glue 다:
  // clearPending 을 빼면 추정치가 확정치에 얹혀 두 배가 되고, setPending 을 addDelta 로 바꾸면
  // 델타마다 누적이 다시 더해진다. tap/tracker 단위 테스트는 이 machine 배선을 안 지난다.
  const se = (event) => ({ type: 'stream_event', event })
  it('스트리밍 pending→commit 이 machine 배선을 통과해도 확정치만 남는다 (이중계산 킬)', async () => {
    const events = []
    const m = await mkMachine((ch, p) => events.push([ch, p]))
    events.length = 0
    const tapped = __tapQueryForTest(() => results(
      se({ type: 'message_start', message: { usage: { input_tokens: 2, cache_creation_input_tokens: 98, cache_read_input_tokens: 0 } } }),
      se({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'x'.repeat(300) } }), // 추정 out=100
      { type: 'result', subtype: 'success', usage: { input_tokens: 2, cache_creation_input_tokens: 98, output_tokens: 42 } },
    ))
    for await (const _m of tapped({})) { /* drain */ }
    const usage = events.filter(([ch]) => ch === 'story:usage').map(([, p]) => p.usage)
    // 진행 중엔 추정치(in=100, out=100)가 실려 올라간다 — setPending→addDelta 스왑 시 값이 어긋난다.
    expect(usage).toContainEqual({ input: 100, output: 100 })
    // 확정 후 snapshot = 확정치만. clearPending 을 빼면 100(추정)+42 = 142 로 뜬다.
    expect(usage[usage.length - 1]).toEqual({ input: 100, output: 42 })
  })

  it('스트림이 result 없이 끝나면 machine 합계에서 추정치가 빠진다 (clear 라우팅)', async () => {
    const events = []
    const m = await mkMachine((ch, p) => events.push([ch, p]))
    events.length = 0
    const tapped = __tapQueryForTest(() => results(
      se({ type: 'message_start', message: { usage: { input_tokens: 2, cache_creation_input_tokens: 98 } } }),
      se({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'y'.repeat(300) } }), // 추정 out=100
      // result 없음 — 중단/EOF
    ))
    for await (const _m of tapped({})) { /* drain */ }
    const usage = events.filter(([ch]) => ch === 'story:usage').map(([, p]) => p.usage)
    expect(usage).toContainEqual({ input: 100, output: 100 }) // 진행 중엔 떴다가
    expect(usage[usage.length - 1]).toEqual({ input: 0, output: 0 }) // finally clear 로 정리됨
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

  // 실패한 side action 도 화면에 반영되려면 sink 발화 자체가 emit 을 유발해야 한다.
  // 이게 없으면 실패로 쓴 토큰이 다음 성공 emit 까지 안 보인다(3R Codex MEDIUM).
  it('claude sink 가 story:usage 이벤트를 쏜다 — 실패 경로도 즉시 반영', async () => {
    const events = []
    const m = await mkMachine((ch, p) => events.push([ch, p]))
    events.length = 0

    const tapped = __tapQueryForTest(() => results({ type: 'result', usage: { input_tokens: 12, output_tokens: 3 } }))
    for await (const _m of tapped({})) { /* drain */ }

    const usageEvents = events.filter(([ch]) => ch === 'story:usage')
    expect(usageEvents).toHaveLength(1)
    expect(usageEvents[0][1].usage).toEqual({ input: 12, output: 3 })
  })

  it('codex sink 도 story:usage 이벤트를 쏜다', async () => {
    const events = []
    const m = await mkMachine((ch, p) => events.push([ch, p]))
    events.length = 0

    __getCodexUsageSinkForTest()({ key: 't1', input: 50, output: 20 })

    const usageEvents = events.filter(([ch]) => ch === 'story:usage')
    expect(usageEvents).toHaveLength(1)
    expect(usageEvents[0][1].usage).toEqual({ input: 50, output: 20 })
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
