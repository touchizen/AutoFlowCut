// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createAgentSessionManager } from '../../../electron/agent/sessionManager.js'
import { encodeApprovalPayload } from '../../../electron/agent/approvalPayload.js'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'
import { createApprovalPrompt } from '../../../electron/agent/approvalPrompt.js'
import { AGENT_MCP_SERVER_NAME } from '../../../electron/agent/constants.js'
import { EventEmitter, once } from 'node:events'
import { spawn } from 'node:child_process'

function fakeWindow() {
  const win = new EventEmitter()
  win.isDestroyed = () => false
  win.webContents = new EventEmitter()
  win.webContents.send = vi.fn()
  return win
}

function appDeps(overrides = {}) {
  return {
    grantLedger: {
      grant: vi.fn(),
      consume: vi.fn(() => false),
      closeSession: vi.fn(),
    },
    approvalPrompt: {
      ask: vi.fn(async () => ({ action: 'decline' })),
      closeSession: vi.fn(),
    },
    toolBridge: {},
    storyCommands: { hasProject: () => true, projectToken: 'project-token' },
    ...overrides,
  }
}

function lifecycleHarness(overrides = {}) {
  const privateRpcs = []
  const orchestrators = []
  const createPrivateRpcImpl = vi.fn(({ toolCore, sessionId }) => {
    const rpc = {
      sessionId,
      toolCore,
      closed: false,
      start: vi.fn(async () => {
        if (rpc.closed) throw new Error('private RPC is closed')
        return { host: '127.0.0.1', port: 43000 + privateRpcs.length, token: `token-${sessionId}` }
      }),
      close: vi.fn(async () => { rpc.closed = true }),
    }
    privateRpcs.push(rpc)
    return rpc
  })
  const createCodexOrchestratorImpl = vi.fn((options) => {
    const record = {
      options,
      alive: false,
      open: vi.fn(async () => {
        await options.privateRpc.start()
        record.alive = true
        return { threadId: `thread-${orchestrators.length}` }
      }),
      send: vi.fn(async (text) => ({ turn: { id: `turn-${text}` } })),
      steer: vi.fn(async (text) => ({ steered: text })),
      abort: vi.fn(async () => ({ aborted: true })),
      close: vi.fn(async () => { record.alive = false }),
    }
    orchestrators.push(record)
    return record
  })
  const manager = createAgentSessionManager({
    ...appDeps(),
    createPrivateRpcImpl,
    createCodexOrchestratorImpl,
    ...overrides,
  })
  return { manager, privateRpcs, orchestrators, createPrivateRpcImpl, createCodexOrchestratorImpl }
}

function realResourceHarness(overrides = {}) {
  let child = null
  let orchestrator = null
  const createCodexOrchestratorImpl = vi.fn((options) => {
    orchestrator = {
      send: vi.fn(async (text) => ({ turn: { id: `turn-${text}` } })),
      steer: vi.fn(async (text) => ({ steered: text })),
      abort: vi.fn(async () => ({ aborted: true })),
      open: vi.fn(async () => {
        const endpoint = await options.privateRpc.start()
        child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' })
        await once(child, 'spawn')
        return { threadId: 'thread-real-resource', rpcEndpoint: endpoint }
      }),
      close: vi.fn(async () => {
        if (!child || child.exitCode !== null || child.signalCode !== null) return
        const exited = once(child, 'exit')
        child.kill('SIGTERM')
        await exited
      }),
    }
    return orchestrator
  })
  const manager = createAgentSessionManager({
    ...appDeps({ storyCommands: { hasProject: () => true, projectToken: 'project-token' } }),
    createCodexOrchestratorImpl,
    ...overrides,
  })
  return {
    manager,
    get child() { return child },
    get orchestrator() { return orchestrator },
  }
}

describe('AgentSessionManager boot lifecycle', () => {
  it('앱 부팅 때 manager만 만들어서는 private RPC를 만들거나 포트를 열지 않는다', async () => {
    const createPrivateRpcImpl = vi.fn()

    const manager = createAgentSessionManager({ ...appDeps(), createPrivateRpcImpl })

    expect(manager.status()).toEqual({ state: 'idle', sessionId: null })
    expect(createPrivateRpcImpl).not.toHaveBeenCalled()
  })

  it('hasProject가 없는 storyCommands는 세션 자원을 만들기 전에 fail-closed한다', async () => {
    const h = lifecycleHarness({
      storyCommands: { listScenes: vi.fn(async () => ({ scenes: [] })) },
    })

    try {
      await expect(h.manager.open()).rejects.toThrow('storyCommands.hasProject must be a function')
      // 설정 누락을 실행 중 no-project 값으로 숨기지 말고, port/child 생성 자체를 막아야 한다.
      expect(h.createPrivateRpcImpl).not.toHaveBeenCalled()
      expect(h.createCodexOrchestratorImpl).not.toHaveBeenCalled()
    } finally {
      await h.manager.close()
    }
  })
})

describe('AgentSessionManager per-session ownership', () => {
  it('session close는 app-scoped tool bridge의 operation snapshots를 다음 session 전에 지운다', async () => {
    const toolBridge = { clearOperations: vi.fn() }
    const h = lifecycleHarness({ toolBridge })

    await h.manager.open()
    await h.manager.close()

    expect(toolBridge.clearOperations).toHaveBeenCalledOnce()
  })

  it('open → close → open은 새 identity와 새 irreversible RPC로 두 번째 session을 실제 시작한다', async () => {
    const h = lifecycleHarness()

    const first = await h.manager.open()
    await h.manager.close()
    const second = await h.manager.open()

    expect(first.sessionId).not.toBe(second.sessionId)
    expect(h.createPrivateRpcImpl).toHaveBeenCalledTimes(2)
    expect(h.privateRpcs.map((rpc) => rpc.sessionId)).toEqual([first.sessionId, second.sessionId])
    expect(h.privateRpcs[0].close).toHaveBeenCalledOnce()
    expect(h.privateRpcs[1].start).toHaveBeenCalledOnce()
    expect(h.orchestrators[0].alive).toBe(false)
    expect(h.orchestrators[1].alive).toBe(true)
    expect(h.orchestrators[1].open).toHaveBeenCalledOnce()

    await h.manager.close()
  })

  it('close 중 open은 닫히는 session을 돌려주지 않고 새 session을 열어 send까지 수행한다', async () => {
    const h = lifecycleHarness()
    const first = await h.manager.open()
    let finishChildClose
    h.orchestrators[0].close.mockImplementationOnce(() => new Promise((resolve) => {
      finishChildClose = () => {
        h.orchestrators[0].alive = false
        resolve()
      }
    }))

    const closing = h.manager.close()
    expect(h.manager.status().state).toBe('closing')
    const reopening = h.manager.open()
    finishChildClose()
    await closing
    const second = await reopening

    // 핵심은 id 모양이 아니라, 새 자원 묶음이 실제로 열려 다음 turn을 받는지다.
    expect(second.sessionId).not.toBe(first.sessionId)
    await expect(h.manager.send('재시작 후 turn')).resolves.toEqual({ turn: { id: 'turn-재시작 후 turn' } })
    expect(h.privateRpcs[0].closed).toBe(true)
    expect(h.privateRpcs[1].start).toHaveBeenCalledOnce()
    expect(h.orchestrators[1].send).toHaveBeenCalledWith('재시작 후 turn')

    await h.manager.close()
  })

  it('packaged app 위치를 orchestrator에 실제 값 그대로 전달한다', async () => {
    const h = lifecycleHarness({
      isPackaged: true,
      resourcesPath: '/Applications/AutoFlowCut.app/Contents/Resources',
    })

    await h.manager.open()

    expect(h.createCodexOrchestratorImpl).toHaveBeenCalledWith(expect.objectContaining({
      isPackaged: true,
      resourcesPath: '/Applications/AutoFlowCut.app/Contents/Resources',
    }))
    await h.manager.close()
  })

  it('이전 sessionId에 늦게 생긴 grant도 다음 session의 Tool Core가 consume하지 못한다', async () => {
    const grantLedger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
    const storyCommands = {
      hasProject: () => true,
      projectToken: 'project-token',
      confirmSynopsis: vi.fn(async () => ({ ok: true })),
    }
    const h = lifecycleHarness({ grantLedger, storyCommands })
    const args = { synopsisMd: '# 승인했던 내용' }

    const first = await h.manager.open()
    await h.manager.close()
    grantLedger.grant({
      nonce: 'late-old-session-grant',
      tool: 'story_confirm_synopsis',
      argsHash: hashArgs(args),
      sessionId: first.sessionId,
      projectToken: storyCommands.projectToken,
    })
    const second = await h.manager.open()

    const result = await h.privateRpcs[1].toolCore.call(
      'story_confirm_synopsis',
      args,
      { nonce: 'late-old-session-grant' },
    )

    expect(second.sessionId).not.toBe(first.sessionId)
    expect(result).toEqual({ status: 'rejected', reason: 'unconfirmed' })
    expect(storyCommands.confirmSynopsis).not.toHaveBeenCalled()
    await h.manager.close()
  })
})

describe('AgentSessionManager close drain', () => {
  it('close는 현재 세션의 병렬 approval을 모두 decline하고 RPC와 Codex child를 끝낸다', async () => {
    const win = fakeWindow()
    const approvalPrompt = createApprovalPrompt({ getWindow: () => win, timeoutMs: 60_000 })
    const grantLedger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
    const h = lifecycleHarness({ approvalPrompt, grantLedger })
    await h.manager.open()
    const responder = h.orchestrators[0].options.elicitationResponder
    const request = (nonce, requestId) => {
      const args = { requestNonce: nonce }
      return responder.handle({
        serverName: AGENT_MCP_SERVER_NAME,
        message: encodeApprovalPayload('generate_videos', args),
        _meta: { nonce, tool: 'generate_videos', argsHash: hashArgs(args) },
      }, { requestId, turnId: null })
    }
    const first = request('n1', 101)
    const second = request('n2', 102)
    expect(approvalPrompt.pendingCount()).toBe(2)

    await h.manager.close()

    expect(approvalPrompt.pendingCount()).toBe(0)
    await expect(first).resolves.toEqual({ action: 'decline', content: {}, _meta: null })
    await expect(second).resolves.toEqual({ action: 'decline', content: {}, _meta: null })
    expect(h.privateRpcs[0].close).toHaveBeenCalledOnce()
    expect(h.privateRpcs[0].closed).toBe(true)
    expect(h.orchestrators[0].close).toHaveBeenCalledOnce()
    expect(h.orchestrators[0].alive).toBe(false)
    approvalPrompt.close()
  })

  // 🔴 세션을 닫는 것과 **승인 채널 자체를 닫는 것**은 다르다. `approvalPrompt` 는 앱 수명이고
  //    `agent:permission-response` IPC listener 를 소유한다. 세션 close 가 `close()` 를 부르면
  //    **다음 세션의 모든 승인이 사람에게 도달하지도 못하고 auto-decline** 된다 — 첫 close 이후
  //    G/B 툴이 영구히 죽는다 (privateRpc 의 A1 과 같은 병, 채널만 다르다).
  //
  //    ⚠️ 이 테스트가 없어서 뮤턴트(`closeSession` → `close`)가 **살아남았다.** 위 harness 의 가짜
  //       approvalPrompt 가 하필 `close` 를 안 갖고 있어 `?.close?.()` 가 no-op 이 됐기 때문이다.
  //       그래서 여기서는 **진짜 `createApprovalPrompt`** 로 renderer 도달을 직접 잰다.
  it('세션 close 는 앱 수명 approvalPrompt 를 폐쇄하지 않는다 — 다음 세션의 승인은 사람에게 도달한다', async () => {
    const win = fakeWindow()
    const approvalPrompt = createApprovalPrompt({ getWindow: () => win, timeoutMs: 60_000 })
    const grantLedger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
    const h = lifecycleHarness({ approvalPrompt, grantLedger })

    await h.manager.open()
    await h.manager.close()
    win.webContents.send.mockClear()

    await h.manager.open()
    const responder = h.orchestrators[1].options.elicitationResponder
    const args = { items: [1, 2] }
    const pending = responder.handle({
      serverName: AGENT_MCP_SERVER_NAME,
      message: encodeApprovalPayload('generate_videos', args),
      _meta: { nonce: 'n-second', tool: 'generate_videos', argsHash: hashArgs(args) },
    }, { requestId: 201, turnId: null })

    // effect 를 본다: 승인 요청이 **실제로 renderer 로 나갔는가.** 값이 decline 인지만 보면
    // "사람이 거부했다" 와 "물어보지도 못했다" 를 구분하지 못한다.
    expect(approvalPrompt.pendingCount(), '두 번째 세션의 승인이 즉시 decline 됐다 — 사람에게 묻지도 않았다').toBe(1)
    expect(win.webContents.send).toHaveBeenCalledWith('agent:permission-request', expect.objectContaining({
      tool: 'generate_videos',
      args,
    }))

    approvalPrompt.respond({ requestId: [...win.webContents.send.mock.calls]
      .find(([channel]) => channel === 'agent:permission-request')[1].requestId, action: 'accept' })
    await expect(pending).resolves.toMatchObject({ action: 'accept' })

    await h.manager.close()
    approvalPrompt.close()
  })
})

describe('AgentSessionManager commands and events', () => {
  it('send/steer/abort를 현재 persistent orchestrator에 위임한다', async () => {
    const h = lifecycleHarness()
    await h.manager.open()

    await expect(h.manager.send('새 turn')).resolves.toEqual({ turn: { id: 'turn-새 turn' } })
    await expect(h.manager.steer('방향 수정')).resolves.toEqual({ steered: '방향 수정' })
    await expect(h.manager.abort()).resolves.toEqual({ aborted: true })

    expect(h.orchestrators[0].send).toHaveBeenCalledWith('새 turn')
    expect(h.orchestrators[0].steer).toHaveBeenCalledWith('방향 수정')
    expect(h.orchestrators[0].abort).toHaveBeenCalledOnce()
    await h.manager.close()
  })

  it('orchestrator delta/event/exit를 노출하고 unexpected exit도 세션 자원을 정리한다', async () => {
    const onDelta = vi.fn()
    const onEvent = vi.fn()
    const onExit = vi.fn()
    const h = lifecycleHarness({ onDelta, onEvent, onExit })
    const opened = await h.manager.open()
    const event = { method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } }
    const exited = { code: 23, signal: 'SIGKILL', error: new Error('crashed') }

    h.orchestrators[0].options.onDelta('조각')
    h.orchestrators[0].options.onEvent(event)
    h.orchestrators[0].options.onExit(exited)

    expect(onDelta).toHaveBeenCalledWith('조각')
    expect(onEvent).toHaveBeenCalledWith(event)
    expect(onExit).toHaveBeenCalledWith(exited)
    await vi.waitFor(() => expect(h.manager.status()).toEqual({ state: 'idle', sessionId: null }))
    expect(h.privateRpcs[0].close).toHaveBeenCalledOnce()
    expect(h.orchestrators[0].close).toHaveBeenCalledOnce()
    expect(opened.sessionId).toBeTruthy()
  })

  it('turn/tool admission 뒤의 app ledger snapshot을 usage callback으로 노출한다', async () => {
    const onUsage = vi.fn()
    const storyCommands = {
      hasProject: () => true,
      projectToken: 'project-token',
      listScenes: vi.fn(async () => ({ scenes: [] })),
    }
    const h = lifecycleHarness({ onUsage, now: () => 10_000, storyCommands })
    const opened = await h.manager.open()

    await h.manager.send('usage turn')
    await h.privateRpcs[0].toolCore.call('list_scenes')

    expect(onUsage.mock.calls.map(([snapshot]) => snapshot)).toEqual([
      { sessionId: opened.sessionId, turns: 1, toolCalls: 0, elapsedMs: 0 },
      { sessionId: opened.sessionId, turns: 1, toolCalls: 1, elapsedMs: 0 },
    ])
    await h.manager.close()
  })
})

describe('AgentSessionManager D10 app ledger', () => {
  it('기본 64번째 turn/start는 admit하고 65번째는 structured value로 report한다', async () => {
    const onError = vi.fn()
    const h = lifecycleHarness({ onError })
    await h.manager.open()

    const admitted = await Promise.all(
      Array.from({ length: 64 }, (_, index) => h.manager.send(`turn-${index + 1}`)),
    )
    const refused = await h.manager.send('turn-65')

    expect(admitted).toHaveLength(64)
    expect(refused).toEqual({ error: 'agent-limit', limit: 64, used: 64 })
    expect(h.orchestrators[0].send).toHaveBeenCalledTimes(64)
    expect(onError).toHaveBeenCalledWith({ error: 'agent-limit', limit: 64, used: 64 })
    expect(h.manager.status()).toMatchObject({ turns: 64, toolCalls: 0 })
    await h.manager.close()
  })

  it('turn은 completion이 아니라 admission에서 세므로 실패한 turn도 budget을 쓴다', async () => {
    const onError = vi.fn()
    const h = lifecycleHarness({ maxTurns: 1, onError })
    await h.manager.open()
    h.orchestrators[0].send.mockRejectedValueOnce(new Error('turn failed'))

    await expect(h.manager.send('실패할 turn')).rejects.toThrow('turn failed')
    await expect(h.manager.send('재시도')).resolves.toEqual({
      error: 'agent-limit',
      limit: 1,
      used: 1,
    })

    expect(h.orchestrators[0].send).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith({ error: 'agent-limit', limit: 1, used: 1 })
    await h.manager.close()
  })

  it('steer는 이미 센 active turn에 주입하므로 turn budget을 증가시키지 않는다', async () => {
    const h = lifecycleHarness({ maxTurns: 1 })
    await h.manager.open()

    await h.manager.send('한 turn')
    await expect(h.manager.steer('첫 수정')).resolves.toEqual({ steered: '첫 수정' })
    await expect(h.manager.steer('둘째 수정')).resolves.toEqual({ steered: '둘째 수정' })

    expect(h.manager.status()).toMatchObject({ turns: 1 })
    await expect(h.manager.send('두 번째 turn')).resolves.toEqual({
      error: 'agent-limit',
      limit: 1,
      used: 1,
    })
    expect(h.orchestrators[0].steer).toHaveBeenCalledTimes(2)
    await h.manager.close()
  })

  it('병렬 Tool Core 호출은 각각 admit하고 256 기본 경계 뒤 호출을 value로 거부한다', async () => {
    const onError = vi.fn()
    const storyCommands = {
      hasProject: () => true,
      projectToken: 'project-token',
      listScenes: vi.fn(async () => ({ scenes: [] })),
    }
    const h = lifecycleHarness({ storyCommands, onError })
    await h.manager.open()
    const core = h.privateRpcs[0].toolCore

    const admitted = await Promise.all(
      Array.from({ length: 256 }, () => core.call('list_scenes')),
    )
    const refused = await core.call('list_scenes')

    expect(admitted).toHaveLength(256)
    expect(refused).toEqual({ status: 'rejected', reason: 'agent-limit', limit: 256, used: 256 })
    expect(storyCommands.listScenes).toHaveBeenCalledTimes(256)
    expect(onError).toHaveBeenCalledWith({ error: 'agent-limit', limit: 256, used: 256 })
    expect(h.manager.status()).toMatchObject({ turns: 0, toolCalls: 256 })
    await h.manager.close()
  })

  it('tool 실패도 실제 invoke이므로 admission에서 1회 센다', async () => {
    const h = lifecycleHarness({
      maxToolCalls: 1,
      storyCommands: {
        hasProject: () => true,
        projectToken: 'project-token',
        listScenes: vi.fn(async () => ({ scenes: [] })),
      },
    })
    await h.manager.open()
    const core = h.privateRpcs[0].toolCore

    await expect(core.call('not_a_tool')).rejects.toThrow('unknown tool: not_a_tool')
    await expect(core.call('list_scenes')).resolves.toEqual({
      status: 'rejected',
      reason: 'agent-limit',
      limit: 1,
      used: 1,
    })
    expect(h.manager.status()).toMatchObject({ toolCalls: 1 })
    await h.manager.close()
  })

  it('정확히 2시간이 되면 새 turn을 admit하지 않고 wall limit을 value로 report한다', async () => {
    let time = 5_000
    const onError = vi.fn()
    const h = lifecycleHarness({ now: () => time, onError })
    await h.manager.open()
    time += 2 * 60 * 60 * 1000

    const refused = await h.manager.send('2시간 경계 뒤 작업')

    expect(refused).toEqual({
      error: 'agent-limit',
      limit: 2 * 60 * 60 * 1000,
      used: 2 * 60 * 60 * 1000,
    })
    expect(h.orchestrators[0].send).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(refused)
    await h.manager.close()
  })

  it('wall-clock 한도 거부는 Codex child를 종료하고 실제 private RPC port를 닫는다', async () => {
    let time = 5_000
    const h = realResourceHarness({ now: () => time })

    try {
      const opened = await h.manager.open()
      const url = `http://${opened.rpcEndpoint.host}:${opened.rpcEndpoint.port}/call`
      const beforeClose = await fetch(url, {
        headers: { authorization: `Bearer ${opened.rpcEndpoint.token}` },
      })
      expect(beforeClose.status).toBe(405)
      expect(h.child.exitCode).toBeNull()

      time += 2 * 60 * 60 * 1000
      await expect(h.manager.send('2시간 경계 뒤 자원 해제')).resolves.toEqual({
        error: 'agent-limit',
        limit: 2 * 60 * 60 * 1000,
        used: 2 * 60 * 60 * 1000,
      })

      // manager status 만 idle로 바꾸는 뮤턴트를 막는다. OS child 종료와 같은 port 접속 실패를 본다.
      await vi.waitFor(() => expect(h.child.signalCode).toBe('SIGTERM'))
      await expect(fetch(url, {
        headers: { authorization: `Bearer ${opened.rpcEndpoint.token}` },
      })).rejects.toThrow()
      expect(h.orchestrator.send).not.toHaveBeenCalled()
    } finally {
      await h.manager.close()
    }
  })
})
