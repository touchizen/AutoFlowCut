// @vitest-environment node
//
// **codex usage 배선 통합 테스트** — 실제 app-server 알림 경로를 탄다.
// codexAppServer.usage.test.js 는 handleUsageNotification 을 직접 부를 뿐이라,
// runCodexTurn 의 onNotification → handleUsageNotification(..., usageSink) 배선(codexAppServer.js:210)이
// 통째로 지워져도 통과한다(Codex 2R-LOW-3). 여기서는 fake app-server 가 실제
// thread/tokenUsage/updated 알림을 stdout 으로 흘리고, 그게 sink 까지 도달하는지 본다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { runCodexText, setCodexUsageSink } from '../../../../electron/api/llm/codexAppServer'

const THREAD_ID = 'thread-1'
const TURN_ID = 'turn-1'

const breakdown = (o) => ({
  totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, ...o,
})

/** turn 진행 중 tokenUsage 알림을 흘리는 fake app-server. */
function fakeAppServer({ usageTotals = [] } = {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.kill = vi.fn(() => queueMicrotask(() => child.emit('exit', 0)))
  const push = (obj) => queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify(obj)}\n`))

  child.stdin = {
    write: (line) => {
      const msg = JSON.parse(line)
      if (msg.method === 'initialize') return push({ id: msg.id, result: {} })
      if (msg.method === 'thread/start') return push({ id: msg.id, result: { thread: { id: THREAD_ID } } })
      if (msg.method === 'turn/interrupt') return push({ id: msg.id, result: {} })
      if (msg.method === 'turn/start') {
        push({ id: msg.id, result: { turn: { id: TURN_ID, items: [], status: 'inProgress' } } })
        for (const total of usageTotals) {
          push({
            method: 'thread/tokenUsage/updated',
            params: { threadId: THREAD_ID, turnId: TURN_ID, tokenUsage: { total: breakdown(total), last: breakdown({}), modelContextWindow: 272000 } },
          })
        }
        push({ method: 'item/completed', params: { threadId: THREAD_ID, turnId: TURN_ID, item: { type: 'agentMessage', id: 'i1', text: 'ok' } } })
        push({ method: 'turn/completed', params: { threadId: THREAD_ID, turn: { id: TURN_ID, items: [], status: 'completed', error: null } } })
        return undefined
      }
      return push({ id: msg.id, error: { message: `unexpected ${msg.method}` } })
    },
    end: vi.fn(),
  }
  return { spawnImpl: vi.fn(() => child), child }
}

const deps = (spawnImpl, extra = {}) => ({
  spawnImpl,
  codexPath: '/fake/codex',
  env: {},
  authCheck: async () => 'Logged in using ChatGPT',
  runtimeHomeFactory: async () => ({ codexHome: '/fake/home', env: { CODEX_HOME: '/fake/home' }, cleanup: vi.fn() }),
  workingDirectoryFactory: async () => ({ workingDirectory: '/fake/work', cleanup: vi.fn() }),
  ...extra,
})

describe('codex usage 배선 — 실제 알림 경로', () => {
  beforeEach(() => setCodexUsageSink(null))

  it('turn 중 tokenUsage 알림이 전역 sink 까지 도달한다', async () => {
    const seen = []
    setCodexUsageSink((u) => seen.push(u))
    const { spawnImpl } = fakeAppServer({ usageTotals: [{ inputTokens: 100, outputTokens: 40 }, { inputTokens: 250, outputTokens: 90 }] })

    await runCodexText('프롬프트', {}, deps(spawnImpl))

    // total 은 누적치 → 두 번째가 첫 번째를 덮는 게 아니라, 각각 sink 로 온다(교체는 tracker 의 몫).
    expect(seen).toEqual([
      { key: THREAD_ID, input: 100, output: 40 },
      { key: THREAD_ID, input: 250, output: 90 },
    ])
  })

  it('명시적 onUsage 가 전역 sink 보다 우선한다', async () => {
    const global = []
    const explicit = []
    setCodexUsageSink((u) => global.push(u))
    const { spawnImpl } = fakeAppServer({ usageTotals: [{ inputTokens: 5, outputTokens: 2 }] })

    await runCodexText('프롬프트', {}, deps(spawnImpl, { onUsage: (u) => explicit.push(u) }))

    expect(explicit).toEqual([{ key: THREAD_ID, input: 5, output: 2 }])
    expect(global).toEqual([]) // onUsage 가 있으면 전역은 안 탄다
  })
})
