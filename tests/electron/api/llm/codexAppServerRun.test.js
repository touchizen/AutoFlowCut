// @vitest-environment node
//
// story codex 엔진의 트랜스포트: app-server JSON-RPC.
// 라이브로 확인한 흐름(codex-cli 0.142.5):
//   initialize → thread/start → turn/start(즉시 반환, status=inProgress)
//   → item/agentMessage/delta* → item/completed(agentMessage) → turn/completed(status)
// turn/completed 의 turn.items 는 [] 다(itemsView: notLoaded) — 최종 텍스트는 item/completed 에서만 온다.
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { runCodexText, runCodexJson } from '../../../../electron/api/llm/codexAppServer'

const THREAD_ID = 'thread-1'
const TURN_ID = 'turn-1'

/**
 * 가짜 app-server. script 로 턴 진행을 흉내낸다.
 * emit(child, msg) 는 stdout 으로 한 줄 내보낸다.
 */
function fakeAppServer({ deltas = [], finalText = '', status = 'completed', error = null, onTurnStart, dropAgentMessage = false } = {}) {
  const sent = []
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.kill = vi.fn(() => queueMicrotask(() => child.emit("exit", 0)))
  const push = (obj) => queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify(obj)}\n`))

  child.stdin = {
    write: (line) => {
      const msg = JSON.parse(line)
      sent.push(msg)
      if (msg.method === 'initialize') return push({ id: msg.id, result: {} })
      if (msg.method === 'thread/start') return push({ id: msg.id, result: { thread: { id: THREAD_ID } } })
      if (msg.method === 'turn/interrupt') return push({ id: msg.id, result: {} })
      if (msg.method === 'turn/start') {
        push({ id: msg.id, result: { turn: { id: TURN_ID, items: [], status: 'inProgress' } } })
        onTurnStart?.(msg)
        for (const d of deltas) push({ method: 'item/agentMessage/delta', params: { delta: d, itemId: 'i1', threadId: THREAD_ID, turnId: TURN_ID } })
        if (!dropAgentMessage) {
          push({ method: 'item/completed', params: { threadId: THREAD_ID, turnId: TURN_ID, item: { type: 'agentMessage', id: 'i1', text: finalText } } })
        }
        push({ method: 'turn/completed', params: { threadId: THREAD_ID, turn: { id: TURN_ID, items: [], status, error } } })
        return undefined
      }
      return push({ id: msg.id, error: { message: `unexpected ${msg.method}` } })
    },
    end: vi.fn(),
  }
  const spawnImpl = vi.fn(() => child)
  return { spawnImpl, child, sent }
}

// 실제 프로세스/파일시스템/로그인 검증을 타지 않는 주입 세트.
const deps = (spawnImpl, extra = {}) => ({
  spawnImpl,
  codexPath: '/fake/codex',
  env: {},
  authCheck: async () => 'Logged in using ChatGPT',
  runtimeHomeFactory: async () => ({ codexHome: '/fake/home', env: { CODEX_HOME: '/fake/home' }, cleanup: vi.fn() }),
  workingDirectoryFactory: async () => ({ workingDirectory: '/fake/work', cleanup: vi.fn() }),
  ...extra,
})

describe('runCodexText — app-server 트랜스포트', () => {
  it('최종 텍스트는 item/completed(agentMessage) 에서 온다', async () => {
    const { spawnImpl } = fakeAppServer({ finalText: 'hello world' })
    expect(await runCodexText('p', {}, deps(spawnImpl))).toBe('hello world')
  })

  it('진짜 델타를 그대로 흘린다 (누적 전체 텍스트가 아니다)', async () => {
    const onDelta = vi.fn()
    const { spawnImpl } = fakeAppServer({ deltas: ['hello', ' world'], finalText: 'hello world' })
    await runCodexText('p', {}, deps(spawnImpl, { onDelta }))
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual(['hello', ' world'])
  })

  it('onDelta 가 없어도 동작한다', async () => {
    const { spawnImpl } = fakeAppServer({ deltas: ['a'], finalText: 'a' })
    expect(await runCodexText('p', {}, deps(spawnImpl))).toBe('a')
  })

  it('initialize → thread/start → turn/start 순서로 보낸다', async () => {
    const { spawnImpl, sent } = fakeAppServer({ finalText: 'x' })
    await runCodexText('p', {}, deps(spawnImpl))
    expect(sent.map((m) => m.method)).toEqual(['initialize', 'thread/start', 'turn/start'])
  })

  it('프롬프트를 UserInput 배열로 보낸다', async () => {
    const { spawnImpl, sent } = fakeAppServer({ finalText: 'x' })
    await runCodexText('내 프롬프트', {}, deps(spawnImpl))
    const turn = sent.find((m) => m.method === 'turn/start')
    expect(turn.params.input).toEqual([{ type: 'text', text: '내 프롬프트' }])
    expect(turn.params.threadId).toBe(THREAD_ID)
  })

  it('model 은 thread/start 로, effort 는 turn/start 로 간다', async () => {
    const { spawnImpl, sent } = fakeAppServer({ finalText: 'x' })
    await runCodexText('p', { model: 'gpt-5.5', reasoningEffort: 'xhigh' }, deps(spawnImpl))
    expect(sent.find((m) => m.method === 'thread/start').params.model).toBe('gpt-5.5')
    expect(sent.find((m) => m.method === 'turn/start').params.effort).toBe('xhigh')
  })

  // 도구를 못 쓰게 막는 건 이 어댑터의 안전 장치다 — 빠지면 codex 가 워크스페이스를 건드린다.
  it('thread/start 에 tool-off config 와 read-only 샌드박스를 넣는다', async () => {
    const { spawnImpl, sent } = fakeAppServer({ finalText: 'x' })
    await runCodexText('p', {}, deps(spawnImpl))
    const p = sent.find((m) => m.method === 'thread/start').params
    expect(p.config.features.shell_tool).toBe(false)
    expect(p.config.features.browser_use).toBe(false)
    expect(p.sandbox).toBe('read-only')
    expect(p.approvalPolicy).toBe('never')
    expect(p.baseInstructions).toMatch(/Do not inspect files/)
  })

  it('turn 이 failed 면 turn.error.message 로 던진다', async () => {
    const { spawnImpl } = fakeAppServer({ status: 'failed', error: { message: 'model overloaded' } })
    await expect(runCodexText('p', {}, deps(spawnImpl))).rejects.toThrow('model overloaded')
  })

  it('agentMessage 없이 끝나면 빈 문자열 (매달리지 않는다)', async () => {
    const { spawnImpl } = fakeAppServer({ dropAgentMessage: true })
    expect(await runCodexText('p', {}, deps(spawnImpl))).toBe('')
  })

  it('끝나면 프로세스를 죽이고 임시 디렉토리를 지운다', async () => {
    const runtime = { codexHome: '/h', env: {}, cleanup: vi.fn() }
    const work = { workingDirectory: '/w', cleanup: vi.fn() }
    const { spawnImpl, child } = fakeAppServer({ finalText: 'x' })
    await runCodexText('p', {}, deps(spawnImpl, {
      runtimeHomeFactory: async () => runtime,
      workingDirectoryFactory: async () => work,
    }))
    expect(child.kill).toHaveBeenCalled()
    expect(runtime.cleanup).toHaveBeenCalled()
    expect(work.cleanup).toHaveBeenCalled()
  })

  it('로그인이 안 돼 있으면 프로세스를 띄우지 않고 안내 메시지로 던진다', async () => {
    const { spawnImpl } = fakeAppServer({ finalText: 'x' })
    await expect(runCodexText('p', {}, deps(spawnImpl, { authCheck: async () => 'Not logged in' })))
      .rejects.toThrow(/codex login/i)
    expect(spawnImpl).not.toHaveBeenCalled()
  })

  it('abort 신호가 오면 turn/interrupt 를 보내고 Aborted 로 던진다', async () => {
    const controller = new AbortController()
    const { spawnImpl, sent } = fakeAppServer({
      onTurnStart: () => queueMicrotask(() => controller.abort()),
      deltas: [], finalText: '',
      dropAgentMessage: true,
    })
    // turn/completed 를 안 보내는 서버 → abort 로만 끝난다
    const child = spawnImpl()
    child.stdin.write = ((orig) => (line) => {
      const m = JSON.parse(line)
      sent.push(m)
      if (m.method === 'initialize') child.stdout.emit('data', `${JSON.stringify({ id: m.id, result: {} })}\n`)
      if (m.method === 'thread/start') child.stdout.emit('data', `${JSON.stringify({ id: m.id, result: { thread: { id: THREAD_ID } } })}\n`)
      if (m.method === 'turn/start') { child.stdout.emit('data', `${JSON.stringify({ id: m.id, result: { turn: { id: TURN_ID } } })}\n`); queueMicrotask(() => controller.abort()) }
      if (m.method === 'turn/interrupt') child.stdout.emit('data', `${JSON.stringify({ id: m.id, result: {} })}\n`)
      return undefined
    })(child.stdin.write)

    await expect(runCodexText('p', {}, deps(() => child, { signal: controller.signal })))
      .rejects.toThrow('Aborted')
    expect(sent.map((m) => m.method)).toContain('turn/interrupt')
  })

  it('app-server 가 죽으면 매달리지 않고 던진다', async () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.kill = vi.fn(() => queueMicrotask(() => child.emit("exit", 0)))
    child.stdin = { write: () => queueMicrotask(() => child.emit('exit', 1)), end: vi.fn() }
    await expect(runCodexText('p', {}, deps(() => child))).rejects.toThrow()
  })
})

describe('runCodexJson — outputSchema 보존', () => {
  it('outputSchema 를 turn/start 로 넘긴다', async () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } }
    const { spawnImpl, sent } = fakeAppServer({ finalText: '{"a":"b"}' })
    await runCodexJson('p', schema, {}, deps(spawnImpl))
    expect(sent.find((m) => m.method === 'turn/start').params.outputSchema).toEqual(schema)
  })

  it('최종 텍스트를 JSON 으로 파싱한다', async () => {
    const { spawnImpl } = fakeAppServer({ finalText: '{"a":"b"}' })
    expect(await runCodexJson('p', {}, {}, deps(spawnImpl))).toEqual({ a: 'b' })
  })

  it('코드펜스로 감싸 와도 파싱한다', async () => {
    const { spawnImpl } = fakeAppServer({ finalText: '```json\n{"a":1}\n```' })
    expect(await runCodexJson('p', {}, {}, deps(spawnImpl))).toEqual({ a: 1 })
  })

  it('turn 이 failed 면 파싱하지 않고 던진다', async () => {
    const { spawnImpl } = fakeAppServer({ status: 'failed', error: { message: 'boom' }, finalText: 'not json' })
    await expect(runCodexJson('p', {}, {}, deps(spawnImpl))).rejects.toThrow('boom')
  })
})

// turn/start 응답을 기다리는 사이에 abort/타임아웃이 오면, 그 await 에 매달려 finally 에 못 간다
// → 프로세스와 임시 디렉토리가 남는다. 가짜 서버가 늘 즉시 응답해서 위 테스트들은 못 잡는다.
describe('runCodexText — turn/start 응답 전에 취소', () => {
  function stallingServer(controller) {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.kill = vi.fn(() => queueMicrotask(() => child.emit("exit", 0)))
    const push = (o) => queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify(o)}\n`))
    child.stdin = {
      write: (line) => {
        const m = JSON.parse(line)
        if (m.method === 'initialize') return push({ id: m.id, result: {} })
        if (m.method === 'thread/start') return push({ id: m.id, result: { thread: { id: THREAD_ID } } })
        if (m.method === 'turn/start') return queueMicrotask(() => controller.abort()) // 영원히 응답 안 함
        return undefined
      },
      end: vi.fn(),
    }
    return child
  }

  it('turn/start 가 응답하지 않아도 Aborted 로 즉시 끝난다', async () => {
    const controller = new AbortController()
    const child = stallingServer(controller)
    await expect(runCodexText('p', {}, deps(() => child, { signal: controller.signal })))
      .rejects.toThrow('Aborted')
  })

  it('그 경우에도 프로세스를 죽이고 임시 디렉토리를 지운다', async () => {
    const controller = new AbortController()
    const child = stallingServer(controller)
    const runtime = { env: {}, cleanup: vi.fn() }
    const work = { workingDirectory: '/w', cleanup: vi.fn() }
    await expect(runCodexText('p', {}, deps(() => child, {
      signal: controller.signal,
      runtimeHomeFactory: async () => runtime,
      workingDirectoryFactory: async () => work,
    }))).rejects.toThrow()
    expect(child.kill).toHaveBeenCalled()
    expect(runtime.cleanup).toHaveBeenCalled()
    expect(work.cleanup).toHaveBeenCalled()
  })

  it('타임아웃도 마찬가지로 매달리지 않는다', async () => {
    const child = stallingServer(new AbortController()) // abort 안 걸림 — 타임아웃만
    child.stdin.write = ((w) => (line) => {
      const m = JSON.parse(line)
      if (m.method === 'turn/start') return undefined
      return w(line)
    })(child.stdin.write)
    await expect(runCodexText('p', { timeoutMs: 30 }, deps(() => child))).rejects.toThrow(/timed out/i)
  })
})

// stdout 이벤트 핸들러 안에서 던지면 runCodexTurn 이 못 잡는다 → Electron main uncaught,
// 프로세스/임시 디렉토리 정리도 건너뛴다. (구 SDK 경로는 for-await 루프라 try/catch 에 잡혔다.)
describe('runCodexText — 알림 핸들러의 예외/누락', () => {
  it('onDelta 가 던지면 uncaught 가 아니라 그 에러로 reject 한다', async () => {
    const { spawnImpl } = fakeAppServer({ deltas: ['a'], finalText: 'a' })
    const onDelta = () => { throw new Error('renderer destroyed') }
    await expect(runCodexText('p', {}, deps(spawnImpl, { onDelta }))).rejects.toThrow('renderer destroyed')
  })

  it('onDelta 가 던져도 프로세스와 임시 디렉토리를 정리한다', async () => {
    const runtime = { env: {}, cleanup: vi.fn() }
    const work = { workingDirectory: '/w', cleanup: vi.fn() }
    const { spawnImpl, child } = fakeAppServer({ deltas: ['a'], finalText: 'a' })
    await expect(runCodexText('p', {}, deps(spawnImpl, {
      onDelta: () => { throw new Error('boom') },
      runtimeHomeFactory: async () => runtime,
      workingDirectoryFactory: async () => work,
    }))).rejects.toThrow('boom')
    expect(child.kill).toHaveBeenCalled()
    expect(runtime.cleanup).toHaveBeenCalled()
    expect(work.cleanup).toHaveBeenCalled()
  })

  // 델타는 UI 에 흘렀는데 반환값이 비면 저장되는 대본/시놉시스가 통째로 빈다.
  it('item/completed 가 없으면 흘린 델타를 이어 붙여 돌려준다', async () => {
    const { spawnImpl } = fakeAppServer({ deltas: ['hello', ' world'], dropAgentMessage: true })
    expect(await runCodexText('p', {}, deps(spawnImpl))).toBe('hello world')
  })

  it('agentMessage 가 여러 개면 모두 이어 붙인다 (마지막 것만 남기지 않는다)', async () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.kill = vi.fn(() => queueMicrotask(() => child.emit("exit", 0)))
    const push = (o) => queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify(o)}\n`))
    child.stdin = {
      write: (line) => {
        const m = JSON.parse(line)
        if (m.method === 'initialize') return push({ id: m.id, result: {} })
        if (m.method === 'thread/start') return push({ id: m.id, result: { thread: { id: THREAD_ID } } })
        if (m.method === 'turn/start') {
          push({ id: m.id, result: { turn: { id: TURN_ID } } })
          push({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'i1', text: 'part1 ' } } })
          push({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'i2', text: 'part2' } } })
          push({ method: 'turn/completed', params: { turn: { id: TURN_ID, status: 'completed' } } })
          return undefined
        }
        return undefined
      },
      end: vi.fn(),
    }
    expect(await runCodexText('p', {}, deps(() => child))).toBe('part1 part2')
  })

  it('델타와 item/completed 가 같은 아이템에 오면 중복되지 않는다', async () => {
    const { spawnImpl } = fakeAppServer({ deltas: ['hello', ' world'], finalText: 'hello world' })
    expect(await runCodexText('p', {}, deps(spawnImpl))).toBe('hello world')
  })
})

// 실제로는 delta.itemId 와 item/completed 의 item.id 가 같다(라이브 확인). 그래도 어긋났을 때의
// 실패 모드가 "텍스트 중복"이면 저장된 대본이 조용히 망가진다 — 구조적으로 불가능해야 한다.
describe('runCodexText — 델타/완료 아이템 id 불일치', () => {
  function scriptedServer(events) {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.kill = vi.fn(() => queueMicrotask(() => child.emit("exit", 0)))
    const push = (o) => queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify(o)}\n`))
    child.stdin = {
      write: (line) => {
        const m = JSON.parse(line)
        if (m.method === 'initialize') return push({ id: m.id, result: {} })
        if (m.method === 'thread/start') return push({ id: m.id, result: { thread: { id: THREAD_ID } } })
        if (m.method === 'turn/start') {
          push({ id: m.id, result: { turn: { id: TURN_ID } } })
          for (const e of events) push(e)
          push({ method: 'turn/completed', params: { turn: { id: TURN_ID, status: 'completed' } } })
          return undefined
        }
        return undefined
      },
      end: vi.fn(),
    }
    return child
  }
  const delta = (text, itemId) => ({ method: 'item/agentMessage/delta', params: { delta: text, ...(itemId !== undefined ? { itemId } : {}) } })
  const completed = (id, text) => ({ method: 'item/completed', params: { item: { type: 'agentMessage', id, text } } })

  // itemId 없는 델타는 어느 아이템 것인지 귀속할 수 없다. 완료 텍스트가 있으면 그쪽만 믿는다.
  it('delta 에 itemId 가 없어도 텍스트가 중복되지 않는다', async () => {
    const child = scriptedServer([delta('hello '), delta('world'), completed('i1', 'hello world')])
    expect(await runCodexText('p', {}, deps(() => child))).toBe('hello world')
  })

  it('같은 아이템은 완료 텍스트가 델타를 이긴다', async () => {
    const child = scriptedServer([delta('draft', 'i1'), completed('i1', 'final')])
    expect(await runCodexText('p', {}, deps(() => child))).toBe('final')
  })

  // 부분 완료: 아이템 하나만 완료 안 됐다고 그 텍스트를 버리면 저장된 대본이 조용히 잘린다.
  it('완료되지 않은 아이템의 델타도 순서대로 살린다', async () => {
    const child = scriptedServer([delta('A', 'i1'), completed('i2', 'B')])
    expect(await runCodexText('p', {}, deps(() => child))).toBe('AB')
  })

  it('빈 문자열로 완료된 아이템은 델타로 되살리지 않는다 (모델이 진짜 빈 답을 냈을 수 있다)', async () => {
    const child = scriptedServer([delta('x', 'i1'), completed('i1', '')])
    expect(await runCodexText('p', {}, deps(() => child))).toBe('')
  })

  // 실제 스트림은 아이템마다 delta* → item/completed 가 순차다. 등장 순서가 곧 생성 순서.
  it('아이템 순서는 스트림 등장 순서를 따른다', async () => {
    const child = scriptedServer([
      delta('a', 'i1'), completed('i1', 'A'),
      delta('b', 'i2'), completed('i2', 'B'),
    ])
    expect(await runCodexText('p', {}, deps(() => child))).toBe('AB')
  })

  it('델타 없이 완료만 온 아이템도 등장 순서대로 잇는다', async () => {
    const child = scriptedServer([completed('i1', 'A'), completed('i2', 'B')])
    expect(await runCodexText('p', {}, deps(() => child))).toBe('AB')
  })

  it('완료가 하나도 없으면 델타를 이어 붙인다', async () => {
    const child = scriptedServer([delta('he', 'i1'), delta('llo', 'i1')])
    expect(await runCodexText('p', {}, deps(() => child))).toBe('hello')
  })
})

// runtime.cleanup 의 rm -rf 가 아직 죽는 중인 codex 자식이 쓰는 파일과 경쟁하면 ENOTEMPTY 로
// 던진다(실 프로세스에서 재현됨). close() 는 자식 exit 까지 기다린 뒤에야 정리로 넘어가야 한다.
describe('runCodexText — 정리 순서 (kill → exit → rm)', () => {
  function lingeringServer() {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.exited = false
    const push = (o) => queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify(o)}\n`))
    child.kill = vi.fn(() => { queueMicrotask(() => { child.exited = true; child.emit('exit', 0) }) })
    child.stdin = {
      write: (line) => {
        const m = JSON.parse(line)
        if (m.method === 'initialize') return push({ id: m.id, result: {} })
        if (m.method === 'thread/start') return push({ id: m.id, result: { thread: { id: THREAD_ID } } })
        if (m.method === 'turn/start') {
          push({ id: m.id, result: { turn: { id: TURN_ID } } })
          push({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'i1', text: 'x' } } })
          push({ method: 'turn/completed', params: { turn: { id: TURN_ID, status: 'completed' } } })
          return undefined
        }
        return undefined
      },
      end: vi.fn(),
    }
    return child
  }

  it('cleanup 은 자식이 exit 한 뒤에 돈다', async () => {
    const child = lingeringServer()
    let childExitedAtCleanup = null
    const runtime = { env: {}, cleanup: vi.fn(() => { childExitedAtCleanup = child.exited }) }
    await runCodexText('p', {}, deps(() => child, {
      runtimeHomeFactory: async () => runtime,
      workingDirectoryFactory: async () => ({ workingDirectory: '/w', cleanup: vi.fn() }),
    }))
    expect(child.kill).toHaveBeenCalled()
    expect(childExitedAtCleanup).toBe(true)
  })

  it('자식이 kill 후에도 안 죽으면 무한 대기하지 않는다', async () => {
    const child = lingeringServer()
    child.kill = vi.fn() // exit 을 절대 안 emit
    const runtime = { env: {}, cleanup: vi.fn() }
    await runCodexText('p', {}, deps(() => child, {
      killTimeoutMs: 30,
      runtimeHomeFactory: async () => runtime,
      workingDirectoryFactory: async () => ({ workingDirectory: '/w', cleanup: vi.fn() }),
    }))
    expect(runtime.cleanup).toHaveBeenCalled()
  })
})
