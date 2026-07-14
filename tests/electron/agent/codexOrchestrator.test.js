// @vitest-environment node
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { AGENT_MCP_SERVER_NAME } from '../../../electron/agent/constants.js'
import * as agentConstants from '../../../electron/agent/constants.js'
import { createPrivateRpc } from '../../../electron/agent/privateRpc.js'
import { openAppServer } from '../../../electron/api/llm/codexAppServer.js'
import {
  createCodexOrchestrator,
  resolveCodexAdapterPath,
} from '../../../electron/agent/codexOrchestrator.js'

const THREAD_ID = 'thread-persistent'
const APPROVAL_WINDOW_MS = agentConstants.AGENT_APPROVAL_WINDOW_MS
const APPROVAL_TIMEOUT_MS = agentConstants.AGENT_ADAPTER_APPROVAL_TIMEOUT_MS
const TOOLS = [
  { name: 'list_scenes', permission: 'R' },
  { name: 'generate_videos', permission: 'B' },
]

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

/** 실제 openAppServer를 통과하되 child만 가짜인 stdio app-server. */
function fakeAppServer({ completeTurnImmediately = false, firstTurnStartGate = null, exitGate = null, turnIds = [] } = {}) {
  const sent = []
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.killed = false
  child.kill = vi.fn(() => {
    child.killed = true
    const exit = () => queueMicrotask(() => child.emit('exit', 0, 'SIGTERM'))
    if (exitGate) exitGate.then(exit)
    else exit()
    return true
  })
  let turnNumber = 0
  const emit = (message) => queueMicrotask(() => {
    child.stdout.emit('data', `${JSON.stringify(message)}\n`)
  })
  child.stdin = {
    write: (line) => {
      const message = JSON.parse(line)
      sent.push(message)
      if (!message.method) return true
      if (message.method === 'initialize') emit({ id: message.id, result: {} })
      else if (message.method === 'thread/start') emit({ id: message.id, result: { thread: { id: THREAD_ID } } })
      else if (message.method === 'turn/start') {
        const id = turnIds[turnNumber] ?? `turn-${turnNumber + 1}`
        turnNumber += 1
        const respond = () => {
          emit({ id: message.id, result: { turn: { id, status: 'inProgress' } } })
          if (completeTurnImmediately) {
            emit({ method: 'turn/completed', params: { threadId: THREAD_ID, turn: { id, status: 'completed' } } })
          }
        }
        if (turnNumber === 1 && firstTurnStartGate) firstTurnStartGate.then(respond)
        else respond()
      } else if (message.method === 'turn/steer') {
        emit({ id: message.id, result: { turnId: message.params.expectedTurnId } })
      } else if (message.method === 'turn/interrupt') emit({ id: message.id, result: {} })
      else emit({ id: message.id, error: { code: -32601, message: `unexpected ${message.method}` } })
      return true
    },
    end: vi.fn(),
  }
  return {
    child,
    sent,
    spawnImpl: vi.fn(() => child),
    emitServerRequest(id, method, params) { emit({ id, method, params }) },
    emitNotification(method, params) { emit({ method, params }) },
  }
}

function createHarness(overrides = {}) {
  const { appServerOptions, ...orchestratorOverrides } = overrides
  const appServer = fakeAppServer(appServerOptions)
  const runtime = { codexHome: '/tmp/codex-home', env: { HOME: '/home/user', CODEX_HOME: '/tmp/codex-home' }, cleanup: vi.fn() }
  const work = { workingDirectory: '/tmp/codex-work', cleanup: vi.fn() }
  const privateRpc = {
    start: vi.fn(async () => ({ host: '127.0.0.1', port: 43123, token: 'session-token' })),
    close: vi.fn(async () => {}),
  }
  const toolCore = { list: vi.fn(() => TOOLS) }
  const elicitationResponder = { handle: vi.fn(async () => ({ action: 'accept', content: {}, _meta: null })) }
  const runtimeHomeFactory = vi.fn(async () => runtime)
  const workingDirectoryFactory = vi.fn(async () => work)
  const orchestrator = createCodexOrchestrator({
    elicitationResponder,
    privateRpc,
    toolCore,
    approvalTimeoutMs: APPROVAL_TIMEOUT_MS,
    approvalWindowMs: APPROVAL_WINDOW_MS,
    adapterPath: '/opt/AutoFlowCut/agent-adapter/codex-adapter.mjs',
    model: 'gpt-5.5',
    env: { HOME: '/home/user', PATH: '/usr/bin' },
    spawnImpl: appServer.spawnImpl,
    codexPath: '/fake/codex',
    authCheck: async () => 'Logged in using ChatGPT',
    existsSyncImpl: () => true,
    runtimeHomeFactory,
    workingDirectoryFactory,
    ...orchestratorOverrides,
  })
  return {
    orchestrator,
    appServer,
    runtime,
    work,
    privateRpc,
    toolCore,
    elicitationResponder,
    runtimeHomeFactory,
    workingDirectoryFactory,
  }
}

afterEach(() => vi.useRealTimers())

describe('resolveCodexAdapterPath', () => {
  it('패키징에서는 resources/agent-adapter 번들을 가리킨다', () => {
    expect(resolveCodexAdapterPath({
      isPackaged: true,
      resourcesPath: '/Applications/AutoFlowCut.app/Contents/Resources',
      repoRoot: '/must/not/be/used',
      existsSyncImpl: () => true,          // 실제 packaged: 번들이 resources 에 실려 있다
    })).toBe(path.join(
      '/Applications/AutoFlowCut.app/Contents/Resources',
      'agent-adapter',
      'codex-adapter.mjs',
    ))
  })

  it('개발에서는 repoRoot/dist-adapter 번들을 가리킨다', () => {
    expect(resolveCodexAdapterPath({
      isPackaged: false,
      resourcesPath: '/must/not/be/used',
      repoRoot: '/repo/AutoFlowCut',
    })).toBe(path.join('/repo/AutoFlowCut', 'dist-adapter', 'codex-adapter.mjs'))
  })

  // 🔴 **`app.isPackaged` 는 dev 에서 거짓말을 한다.** `patch-electron-name` 이 electron 바이너리를
  //    `AutoFlowCut.app` 으로 리네임해서 dev 에서도 `isPackaged === true` 가 되고,
  //    `process.resourcesPath` 는 **번들이 없는** electron 자기 Resources 를 가리킨다.
  //    (metaPrompts.js:10-13 이 같은 함정을 이미 실측하고 같은 방식으로 피했다.)
  //    → 플래그를 믿지 말고 **실제로 존재하는 후보**를 고른다.
  it('isPackaged 가 true 여도 그 경로에 번들이 없으면 dist-adapter 로 떨어진다 (dev 리네임 함정)', () => {
    const packaged = path.join('/electron/dist/AutoFlowCut.app/Contents/Resources', 'agent-adapter', 'codex-adapter.mjs')
    const dev = path.join('/repo/AutoFlowCut', 'dist-adapter', 'codex-adapter.mjs')

    expect(resolveCodexAdapterPath({
      isPackaged: true,                                   // ← 리네임 탓에 dev 인데 true 다
      resourcesPath: '/electron/dist/AutoFlowCut.app/Contents/Resources',
      repoRoot: '/repo/AutoFlowCut',
      existsSyncImpl: (candidate) => candidate === dev,   // 번들은 dist-adapter 에만 있다
    })).toBe(dev)

    // 진짜 패키징(둘 다 있을 수 있다)에서는 resources 가 이긴다.
    expect(resolveCodexAdapterPath({
      isPackaged: true,
      resourcesPath: '/electron/dist/AutoFlowCut.app/Contents/Resources',
      repoRoot: '/repo/AutoFlowCut',
      existsSyncImpl: () => true,
    })).toBe(packaged)
  })

  it('어느 후보에도 번들이 없으면 마지막 후보를 돌려준다 — doOpen 의 existsSync 가 경로를 찍고 죽는다', () => {
    const dev = path.join('/repo/AutoFlowCut', 'dist-adapter', 'codex-adapter.mjs')
    expect(resolveCodexAdapterPath({
      isPackaged: true,
      resourcesPath: '/nope/Resources',
      repoRoot: '/repo/AutoFlowCut',
      existsSyncImpl: () => false,
    })).toBe(dev)
  })
})

describe('MCP server name 단일 출처', () => {
  it('session manager와 orchestrator가 같은 exported constant를 import한다', async () => {
    const [main, sessionManager, orchestrator] = await Promise.all([
      readFile(path.join(process.cwd(), 'electron', 'main.js'), 'utf8'),
      readFile(path.join(process.cwd(), 'electron', 'agent', 'sessionManager.js'), 'utf8'),
      readFile(path.join(process.cwd(), 'electron', 'agent', 'codexOrchestrator.js'), 'utf8'),
    ])

    expect(AGENT_MCP_SERVER_NAME).toBe('autoflowcut')
    expect(main).not.toMatch(/const AGENT_MCP_SERVER_NAME\s*=/)
    expect(sessionManager).toMatch(/import \{[^}]*\bAGENT_MCP_SERVER_NAME\b[^}]*\} from '\.\/constants\.js'/)
    expect(orchestrator).toMatch(/import \{[^}]*\bAGENT_MCP_SERVER_NAME\b[^}]*\} from '\.\/constants\.js'/)
  })
})

describe('승인 시간 단일 출처', () => {
  it('prompt/ledger window와 adapter timeout을 공유 상수에서만 파생한다', async () => {
    expect(agentConstants.AGENT_APPROVAL_WINDOW_MS).toBe(10 * 60 * 1000)
    expect(agentConstants.AGENT_APPROVAL_TIMEOUT_MARGIN_MS).toBe(30 * 1000)
    expect(agentConstants.AGENT_ADAPTER_APPROVAL_TIMEOUT_MS).toBe(
      agentConstants.AGENT_APPROVAL_WINDOW_MS + agentConstants.AGENT_APPROVAL_TIMEOUT_MARGIN_MS,
    )

    const [main, orchestrator] = await Promise.all([
      readFile(path.join(process.cwd(), 'electron', 'main.js'), 'utf8'),
      readFile(path.join(process.cwd(), 'electron', 'agent', 'codexOrchestrator.js'), 'utf8'),
    ])
    expect(main).not.toMatch(/AGENT_APPROVAL_TTL_MS/)
    expect(main).toContain('createGrantLedger({ ttlMs: AGENT_APPROVAL_WINDOW_MS })')
    expect(main).toContain('timeoutMs: AGENT_APPROVAL_WINDOW_MS')
    expect(orchestrator).toMatch(/approvalWindowMs\s*=\s*AGENT_APPROVAL_WINDOW_MS/)
    expect(orchestrator).toMatch(/approvalTimeoutMs\s*=\s*AGENT_ADAPTER_APPROVAL_TIMEOUT_MS/)
  })

  it('orchestrator caller가 승인 시간을 다시 입력하지 않아도 공유 기본값을 쓴다', () => {
    expect(() => createHarness({
      approvalTimeoutMs: undefined,
      approvalWindowMs: undefined,
    })).not.toThrow()
  })
})

describe('createCodexOrchestrator — open/profile', () => {
  it('approvalTimeoutMs는 finite positive number만 허용한다', () => {
    // undefined는 공유 상수를 쓰는 정상 경로다. 명시적으로 넘긴 잘못된 값은 계속 거부한다.
    for (const value of [0, -1, NaN, Infinity, '600000']) {
      expect(
        () => createHarness({ approvalTimeoutMs: value }),
        `approvalTimeoutMs=${String(value)}`,
      ).toThrow('approvalTimeoutMs must be a finite number greater than 0')
    }
  })

  it('approvalTimeoutMs는 approvalWindowMs보다 반드시 길어야 한다', () => {
    for (const approvalTimeoutMs of [APPROVAL_WINDOW_MS, APPROVAL_WINDOW_MS - 1]) {
      expect(
        () => createHarness({ approvalTimeoutMs }),
        `approvalTimeoutMs=${approvalTimeoutMs}`,
      ).toThrow('approvalTimeoutMs must be greater than approvalWindowMs')
    }
  })

  it('approvalWindowMs는 finite positive number만 허용한다', () => {
    // undefined는 공유 상수를 쓰는 정상 경로다. 명시적으로 넘긴 잘못된 값은 계속 거부한다.
    for (const value of [0, -1, NaN, Infinity, '600000']) {
      expect(
        () => createHarness({ approvalWindowMs: value }),
        `approvalWindowMs=${String(value)}`,
      ).toThrow('approvalWindowMs must be a finite number greater than 0')
    }
  })

  it('app-server와 thread를 한 번만 열고 experimentalApi initialize를 wire에 보낸다', async () => {
    const h = createHarness()

    await h.orchestrator.open()
    await h.orchestrator.open()

    expect(h.appServer.spawnImpl).toHaveBeenCalledOnce()
    expect(h.privateRpc.start).toHaveBeenCalledOnce()
    expect(h.appServer.sent.filter((m) => m.method === 'initialize')).toHaveLength(1)
    expect(h.appServer.sent.filter((m) => m.method === 'thread/start')).toHaveLength(1)
    expect(h.appServer.sent.find((m) => m.method === 'initialize')?.params).toMatchObject({
      capabilities: { experimentalApi: true },
    })
    await h.orchestrator.close()
  })

  it('resolved adapter 번들이 없으면 spawn 전에 경로를 포함해 명시적으로 실패한다', async () => {
    const missing = '/missing/agent-adapter/codex-adapter.mjs'
    const h = createHarness({ adapterPath: missing, existsSyncImpl: () => false })

    try {
      await expect(h.orchestrator.open()).rejects.toThrow(`Codex adapter bundle not found: ${missing}`)
      expect(h.privateRpc.start).not.toHaveBeenCalled()
      expect(h.appServer.spawnImpl).not.toHaveBeenCalled()
    } finally {
      await h.orchestrator.close()
    }
  })

  it('orchestrator profile의 autoflowcut MCP에 Electron-as-node adapter env와 tool table을 싣는다', async () => {
    const h = createHarness()

    await h.orchestrator.open()

    const thread = h.appServer.sent.find((m) => m.method === 'thread/start')
    const servers = thread.params.config.mcp_servers
    expect(Object.keys(servers)).toEqual([AGENT_MCP_SERVER_NAME])
    expect(servers[AGENT_MCP_SERVER_NAME]).toEqual({
      command: process.execPath,
      args: ['/opt/AutoFlowCut/agent-adapter/codex-adapter.mjs'],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        AUTOFLOWCUT_RPC_URL: 'http://127.0.0.1:43123',
        AUTOFLOWCUT_RPC_TOKEN: 'session-token',
        AUTOFLOWCUT_TOOLS: JSON.stringify(TOOLS),
        AUTOFLOWCUT_APPROVAL_TIMEOUT_MS: String(APPROVAL_TIMEOUT_MS),
      },
    })
    expect(thread.params).toMatchObject({ model: 'gpt-5.5', cwd: '/tmp/codex-work', sandbox: 'read-only' })
    expect(h.toolCore.list).toHaveBeenCalledOnce()
    await h.orchestrator.close()
  })

  it('runtime home과 working directory를 준비하고 close에서 각각 정확히 한 번 정리한다', async () => {
    const h = createHarness()

    await h.orchestrator.open()
    await h.orchestrator.close()
    await h.orchestrator.close()

    expect(h.runtimeHomeFactory).toHaveBeenCalledWith({ env: { HOME: '/home/user', PATH: '/usr/bin' } })
    expect(h.workingDirectoryFactory).toHaveBeenCalledOnce()
    expect(h.runtime.cleanup).toHaveBeenCalledOnce()
    expect(h.work.cleanup).toHaveBeenCalledOnce()
    expect(h.privateRpc.close).not.toHaveBeenCalled()
    expect(h.appServer.child.kill).toHaveBeenCalledOnce()
  })

  it('close 뒤 같은 privateRpc로 두 번째 orchestrator를 열 수 있다', async () => {
    const privateRpc = createPrivateRpc({
      toolCore: { call: vi.fn() },
      sessionId: 'shared-rpc-session',
    })
    const first = createHarness({ privateRpc })
    const second = createHarness({ privateRpc })

    try {
      await first.orchestrator.open()
      await first.orchestrator.close()

      await expect(second.orchestrator.open()).resolves.toEqual({ threadId: THREAD_ID })
      await second.orchestrator.close()
    } finally {
      await Promise.allSettled([first.orchestrator.close(), second.orchestrator.close()])
      await privateRpc.close()
    }
  })
})

describe('createCodexOrchestrator — 지속 turn lifecycle', () => {
  it('close 뒤 send/steer/abort는 명시적인 closed error를 던진다', async () => {
    const h = createHarness()
    await h.orchestrator.open()
    await h.orchestrator.close()

    await expect(h.orchestrator.send('종료 뒤 전송')).rejects.toEqual(new Error('Codex orchestrator is closed'))
    await expect(h.orchestrator.steer('종료 뒤 steer')).rejects.toEqual(new Error('Codex orchestrator is closed'))
    await expect(h.orchestrator.abort()).rejects.toEqual(new Error('Codex orchestrator is closed'))
  })

  it('후속 send와 steer/abort를 같은 thread 및 active turn id로 보낸다', async () => {
    const h = createHarness()
    await h.orchestrator.open()

    const first = await h.orchestrator.send('첫 메시지')
    h.appServer.emitNotification('turn/completed', { threadId: THREAD_ID, turn: { id: first.turn.id, status: 'completed' } })
    await flushMicrotasks()
    const second = await h.orchestrator.send('후속 메시지')
    await h.orchestrator.steer('계획 변경')
    await h.orchestrator.abort()

    const starts = h.appServer.sent.filter((m) => m.method === 'turn/start')
    expect(starts.map((m) => m.params)).toEqual([
      { threadId: THREAD_ID, input: [{ type: 'text', text: '첫 메시지' }] },
      { threadId: THREAD_ID, input: [{ type: 'text', text: '후속 메시지' }] },
    ])
    expect(h.appServer.sent.find((m) => m.method === 'turn/steer')?.params).toEqual({
      threadId: THREAD_ID,
      expectedTurnId: second.turn.id,
      input: [{ type: 'text', text: '계획 변경' }],
    })
    expect(h.appServer.sent.find((m) => m.method === 'turn/interrupt')?.params).toEqual({ threadId: THREAD_ID })
    expect(h.appServer.spawnImpl).toHaveBeenCalledOnce()
    expect(h.appServer.sent.filter((m) => m.method === 'thread/start')).toHaveLength(1)
    await h.orchestrator.close()
  })

  it('delta는 onDelta로, item/completed와 failed turn/completed는 onEvent로 그대로 표면화한다', async () => {
    const onDelta = vi.fn()
    const onEvent = vi.fn()
    const h = createHarness({ onDelta, onEvent })
    await h.orchestrator.open()
    const started = await h.orchestrator.send('실행')
    const item = { type: 'agentMessage', id: 'item-1', text: '완료' }
    const failedTurn = { id: started.turn.id, status: 'failed', error: { message: 'tool failed' } }

    h.appServer.emitNotification('item/agentMessage/delta', { delta: '조각', turnId: started.turn.id })
    h.appServer.emitNotification('item/completed', { turnId: started.turn.id, item })
    h.appServer.emitNotification('turn/completed', { threadId: THREAD_ID, turn: failedTurn })
    await flushMicrotasks()

    expect(onDelta).toHaveBeenCalledWith('조각')
    expect(onEvent).toHaveBeenCalledWith({ method: 'item/completed', params: { turnId: started.turn.id, item } })
    expect(onEvent).toHaveBeenCalledWith({
      method: 'turn/completed',
      params: { threadId: THREAD_ID, turn: failedTurn },
    })
    await h.orchestrator.close()
  })

  it('turn/start 응답과 completed가 같은 batch에 와도 끝난 turn을 active로 되살리지 않는다', async () => {
    const h = createHarness({ appServerOptions: { completeTurnImmediately: true } })
    await h.orchestrator.open()

    await h.orchestrator.send('즉시 완료')

    await expect(h.orchestrator.steer('늦은 steer')).rejects.toThrow(/no active turn/i)
    await h.orchestrator.close()
  })

  it('turn/start가 진행 중이면 두 번째 send를 거부하고 steer 사용을 요구한다', async () => {
    const firstTurnStart = deferred()
    const h = createHarness({ appServerOptions: { firstTurnStartGate: firstTurnStart.promise } })
    await h.orchestrator.open()

    const first = h.orchestrator.send('첫 turn')
    await vi.waitFor(() => {
      expect(h.appServer.sent.filter((message) => message.method === 'turn/start')).toHaveLength(1)
    })

    await expect(h.orchestrator.send('동시 두 번째 turn')).rejects.toThrow(/turn start is already in flight/i)
    expect(h.appServer.sent.filter((message) => message.method === 'turn/start')).toHaveLength(1)

    firstTurnStart.resolve()
    await first
    await h.orchestrator.close()
  })

  it('turn/start 응답 대기 중 abort하면 늦은 응답이 중단된 turn을 active로 되살리지 않는다', async () => {
    const firstTurnStart = deferred()
    const h = createHarness({ appServerOptions: { firstTurnStartGate: firstTurnStart.promise } })
    await h.orchestrator.open()

    const sending = h.orchestrator.send('바로 중단할 turn')
    await vi.waitFor(() => {
      expect(h.appServer.sent.filter((message) => message.method === 'turn/start')).toHaveLength(1)
    })
    await h.orchestrator.abort()

    firstTurnStart.resolve()
    await sending

    await expect(h.orchestrator.steer('중단된 turn steer')).rejects.toThrow(/no active turn/i)
    expect(h.appServer.sent.filter((message) => message.method === 'turn/steer')).toHaveLength(0)
    await h.orchestrator.close()
  })

  it('abort 뒤 완료된 turn id를 남기지 않아 같은 id의 새 turn을 active로 유지한다', async () => {
    const reusedId = 'turn-reused-after-abort'
    const h = createHarness({ appServerOptions: { turnIds: [reusedId, reusedId] } })
    await h.orchestrator.open()

    const interrupted = await h.orchestrator.send('중단할 turn')
    await h.orchestrator.abort()
    h.appServer.emitNotification('turn/completed', {
      threadId: THREAD_ID,
      turn: { id: interrupted.turn.id, status: 'interrupted' },
    })
    await flushMicrotasks()

    await h.orchestrator.send('같은 id의 새 turn')
    await expect(h.orchestrator.steer('새 turn steer')).resolves.toEqual({ turnId: reusedId })
    await h.orchestrator.close()
  })
})

describe('createCodexOrchestrator — server request routing', () => {
  it('session이 생기기 전 끝난 request도 id를 정리해 재사용을 막지 않는다', async () => {
    let onServerRequest
    const respond = vi.fn()
    const request = vi.fn(async (method) => {
      if (method === 'initialize') return {}
      if (method === 'thread/start') return { thread: { id: THREAD_ID } }
      throw new Error(`unexpected ${method}`)
    })
    const appServerFactory = vi.fn((options) => {
      onServerRequest = options.onServerRequest
      onServerRequest({ id: 699, method: 'future/request', params: {} })
      return {
        client: { request, respond, respondError: vi.fn() },
        close: vi.fn(async () => {}),
      }
    })
    const h = createHarness({ appServerFactory })
    await h.orchestrator.open()

    onServerRequest({ id: 699, method: 'mcpServer/elicitation/request', params: { turnId: 'turn-reused' } })
    await flushMicrotasks()

    expect(h.elicitationResponder.handle).toHaveBeenCalledOnce()
    expect(respond).toHaveBeenCalledWith(699, { action: 'accept', content: {}, _meta: null })
    await h.orchestrator.close()
  })

  it('같은 request id가 중복 도착해도 승인 UI와 응답을 각각 한 번만 연다', async () => {
    const answer = deferred()
    const handle = vi.fn(() => answer.promise)
    const h = createHarness({ elicitationResponder: { handle } })
    await h.orchestrator.open()

    h.appServer.emitServerRequest(700, 'mcpServer/elicitation/request', { turnId: 'turn-duplicate' })
    h.appServer.emitServerRequest(700, 'mcpServer/elicitation/request', { turnId: 'turn-duplicate' })
    await flushMicrotasks()
    answer.resolve({ action: 'accept', content: {}, _meta: null })
    await flushMicrotasks()

    expect(handle).toHaveBeenCalledOnce()
    expect(h.appServer.sent.filter((m) => m.id === 700)).toEqual([{
      jsonrpc: '2.0',
      id: 700,
      result: { action: 'accept', content: {}, _meta: null },
    }])
    await h.orchestrator.close()
  })

  it('이미 응답한 request id가 순차 재전달돼도 승인 UI를 다시 열지 않는다', async () => {
    const handle = vi.fn(async () => ({ action: 'accept', content: {}, _meta: null }))
    const h = createHarness({ elicitationResponder: { handle } })
    await h.orchestrator.open()

    h.appServer.emitServerRequest(707, 'mcpServer/elicitation/request', { turnId: 'turn-redelivered' })
    await flushMicrotasks()
    h.appServer.emitServerRequest(707, 'mcpServer/elicitation/request', { turnId: 'turn-redelivered' })
    await flushMicrotasks()

    expect(handle).toHaveBeenCalledOnce()
    expect(h.appServer.sent.filter((message) => message.id === 707)).toHaveLength(1)
    await h.orchestrator.close()
  })

  it('close 중 이미 응답한 request가 재전달돼도 real client에 응답을 재시도하지 않는다', async () => {
    const childExit = deferred()
    let client
    const appServerFactory = vi.fn((options) => {
      const session = openAppServer(options)
      client = session.client
      return session
    })
    const handle = vi.fn(async () => ({ action: 'accept', content: {}, _meta: null }))
    const h = createHarness({
      appServerFactory,
      appServerOptions: { exitGate: childExit.promise },
      elicitationResponder: { handle },
    })
    await h.orchestrator.open()
    const respond = vi.spyOn(client, 'respond')

    h.appServer.emitServerRequest(708, 'mcpServer/elicitation/request', { turnId: 'turn-close' })
    await flushMicrotasks()

    const closePromise = h.orchestrator.close()
    await vi.waitFor(() => expect(h.appServer.child.kill).toHaveBeenCalledOnce())
    h.appServer.emitServerRequest(708, 'mcpServer/elicitation/request', { turnId: 'turn-close' })
    await flushMicrotasks()

    expect(handle).toHaveBeenCalledOnce()
    expect(respond).toHaveBeenCalledOnce()
    expect(h.appServer.sent.filter((message) => message.id === 708)).toEqual([{
      jsonrpc: '2.0',
      id: 708,
      result: { action: 'accept', content: {}, _meta: null },
    }])

    childExit.resolve()
    await closePromise
  })

  it('turnId가 둘 다 null인 병렬 elicitation도 request id로 구분해 역순 응답한다', async () => {
    const a = deferred()
    const b = deferred()
    const handle = vi.fn((_params, { requestId }) => requestId === 701 ? a.promise : b.promise)
    const h = createHarness({ elicitationResponder: { handle } })
    await h.orchestrator.open()

    h.appServer.emitServerRequest(701, 'mcpServer/elicitation/request', { turnId: null, marker: 'a' })
    h.appServer.emitServerRequest(702, 'mcpServer/elicitation/request', { turnId: null, marker: 'b' })
    await flushMicrotasks()
    b.resolve({ action: 'decline', content: {}, _meta: null })
    await flushMicrotasks()
    a.resolve({ action: 'accept', content: {}, _meta: null })
    await flushMicrotasks()

    expect(handle.mock.calls.map(([, ctx]) => ctx)).toEqual([
      { requestId: 701, turnId: null },
      { requestId: 702, turnId: null },
    ])
    const responses = h.appServer.sent.filter((m) => m.id === 701 || m.id === 702)
    expect(responses.map((m) => [m.id, m.result.action])).toEqual([[702, 'decline'], [701, 'accept']])
    await h.orchestrator.close()
  })

  it('elicitation responder가 throw해도 decline을 응답해 Codex를 매달지 않는다', async () => {
    const h = createHarness({ elicitationResponder: { handle: vi.fn(async () => { throw new Error('renderer gone') }) } })
    await h.orchestrator.open()

    h.appServer.emitServerRequest(703, 'mcpServer/elicitation/request', { turnId: 'turn-x' })
    await flushMicrotasks()

    expect(h.appServer.sent.find((m) => m.id === 703)).toEqual({
      jsonrpc: '2.0',
      id: 703,
      result: { action: 'decline', content: {}, _meta: null },
    })
    await h.orchestrator.close()
  })

  it('모르는 server-request method는 -32601 error로 즉시 응답한다', async () => {
    const h = createHarness()
    await h.orchestrator.open()

    h.appServer.emitServerRequest('unknown-1', 'future/approval/request', { value: 1 })
    await flushMicrotasks()

    expect(h.appServer.sent.find((m) => m.id === 'unknown-1')).toEqual({
      jsonrpc: '2.0',
      id: 'unknown-1',
      error: { code: -32601, message: 'Method not found: future/approval/request' },
    })
    await h.orchestrator.close()
  })

  it('close는 interrupt 뒤 pending elicitation을 decline하고 늦은 accept를 두 번째로 쓰지 않는다', async () => {
    const answer = deferred()
    const h = createHarness({ elicitationResponder: { handle: vi.fn(() => answer.promise) } })
    await h.orchestrator.open()
    await h.orchestrator.send('승인 대기')
    h.appServer.emitServerRequest(704, 'mcpServer/elicitation/request', { turnId: null })
    await flushMicrotasks()

    await h.orchestrator.close()
    answer.resolve({ action: 'accept', content: {}, _meta: null })
    await flushMicrotasks()

    const interruptIndex = h.appServer.sent.findIndex((m) => m.method === 'turn/interrupt')
    const responseIndex = h.appServer.sent.findIndex((m) => m.id === 704)
    expect(interruptIndex).toBeGreaterThan(-1)
    expect(responseIndex).toBeGreaterThan(interruptIndex)
    expect(h.appServer.sent.filter((m) => m.id === 704)).toEqual([{
      jsonrpc: '2.0',
      id: 704,
      result: { action: 'decline', content: {}, _meta: null },
    }])
    expect(h.appServer.child.kill).toHaveBeenCalledOnce()
  })

  it('close drain 직후 도착한 server request도 responder를 열지 않고 decline한다', async () => {
    const handle = vi.fn(() => new Promise(() => {}))
    const h = createHarness({ elicitationResponder: { handle } })
    await h.orchestrator.open()
    await h.orchestrator.send('종료 중')
    const originalKill = h.appServer.child.kill
    h.appServer.child.kill = vi.fn(() => {
      h.appServer.emitServerRequest(706, 'mcpServer/elicitation/request', { turnId: null })
      originalKill()
    })

    await h.orchestrator.close()
    await flushMicrotasks()

    expect(handle).not.toHaveBeenCalled()
    expect(h.appServer.sent.filter((m) => m.id === 706)).toEqual([{
      jsonrpc: '2.0',
      id: 706,
      result: { action: 'decline', content: {}, _meta: null },
    }])
  })

  it('app-server가 스스로 종료되면 pending 승인을 decline하고 별도 onExit로만 표면화한다', async () => {
    const answer = deferred()
    const onEvent = vi.fn()
    const onExit = vi.fn()
    const h = createHarness({
      elicitationResponder: { handle: vi.fn(() => answer.promise) },
      onEvent,
      onExit,
    })
    await h.orchestrator.open()
    h.appServer.emitServerRequest(709, 'mcpServer/elicitation/request', { turnId: 'turn-crashed' })
    await flushMicrotasks()

    h.appServer.child.emit('exit', 23, 'SIGKILL')
    await flushMicrotasks()

    expect(h.appServer.sent.filter((message) => message.id === 709)).toEqual([{
      jsonrpc: '2.0',
      id: 709,
      result: { action: 'decline', content: {}, _meta: null },
    }])
    expect(onExit).toHaveBeenCalledWith({
      code: 23,
      signal: 'SIGKILL',
      error: expect.objectContaining({ message: 'codex app-server exited (23)' }),
    })
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'session/exited' }))

    answer.resolve({ action: 'accept', content: {}, _meta: null })
    await flushMicrotasks()
    expect(h.appServer.sent.filter((message) => message.id === 709)).toHaveLength(1)
    await h.orchestrator.close()
  })
})

describe('createCodexOrchestrator — session timeout 분리', () => {
  it('10분 story timeout을 넘겨 61분이 지나도 approval/session을 abort하지 않고 같은 thread를 쓴다', async () => {
    vi.useFakeTimers()
    const answer = deferred()
    const h = createHarness({ elicitationResponder: { handle: vi.fn(() => answer.promise) } })
    await h.orchestrator.open()
    const first = await h.orchestrator.send('긴 작업')
    h.appServer.emitServerRequest(705, 'mcpServer/elicitation/request', { turnId: null })
    await flushMicrotasks()

    await vi.advanceTimersByTimeAsync(61 * 60 * 1000)

    expect(h.appServer.sent.filter((m) => m.method === 'turn/interrupt')).toHaveLength(0)
    expect(h.appServer.sent.filter((m) => m.id === 705)).toHaveLength(0)
    expect(h.appServer.child.kill).not.toHaveBeenCalled()

    answer.resolve({ action: 'accept', content: {}, _meta: null })
    await flushMicrotasks()
    h.appServer.emitNotification('turn/completed', { threadId: THREAD_ID, turn: { id: first.turn.id, status: 'completed' } })
    await flushMicrotasks()
    await h.orchestrator.send('61분 뒤 후속 메시지')

    expect(h.appServer.sent.find((m) => m.id === 705)?.result.action).toBe('accept')
    expect(h.appServer.spawnImpl).toHaveBeenCalledOnce()
    expect(h.appServer.sent.filter((m) => m.method === 'thread/start')).toHaveLength(1)
    await h.orchestrator.close()
  })
})
