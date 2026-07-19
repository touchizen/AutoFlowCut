// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createAgentSessionManager } from '../../../electron/agent/sessionManager.js'
import { encodeApprovalPayload } from '../../../electron/agent/approvalPayload.js'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'
import { createApprovalPrompt } from '../../../electron/agent/approvalPrompt.js'
import { AGENT_MCP_SERVER_NAME } from '../../../electron/agent/constants.js'
import { EventEmitter, once } from 'node:events'
import { spawn } from 'node:child_process'

const DEFAULT_MODEL_ID = 'codex:gpt-5.5'
const DEFAULT_MODEL_ROW = {
  id: DEFAULT_MODEL_ID,
  provider: 'codex',
  sdkModel: 'gpt-5.5',
  isDefault: true,
  defaultFallbackFrom: 'claude-opus-4-8',
}
const CLAUDE_MODEL_ROW = {
  id: 'claude:opus[1m]',
  provider: 'claude',
  sdkModel: 'opus[1m]',
  isDefault: false,
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function modelCatalogDouble(rows = [DEFAULT_MODEL_ROW], { cacheReady = true } = {}) {
  const snapshotRows = rows.map((row) => ({ ...row }))
  if (!snapshotRows.some((row) => row.id === DEFAULT_MODEL_ID)) {
    snapshotRows.push({
      ...DEFAULT_MODEL_ROW,
      isDefault: !snapshotRows.some((row) => row.isDefault === true),
    })
  }
  const defaultId = snapshotRows.find((row) => row.isDefault === true)?.id ?? DEFAULT_MODEL_ID
  return {
    list: vi.fn(async () => snapshotRows.map((row) => ({ ...row }))),
    defaultModelId: vi.fn(() => defaultId),
    snapshot: vi.fn(() => ({
      cacheReady,
      rows: snapshotRows.map((row) => ({ ...row })),
      defaultId,
    })),
  }
}

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
    toolBridge: {
      invoke: vi.fn(async (name) => {
        if (name === 'scene.snapshot') return { sceneMode: 'audio-first', scenes: [] }
        throw new Error(`unexpected bridge call: ${name}`)
      }),
    },
    storyCommands: {
      hasProject: () => true,
      projectToken: 'project-token',
      getState: vi.fn(async () => ({ sceneMode: 'audio-first' })),
    },
    modelCatalog: modelCatalogDouble(),
    ...overrides,
  }
}

function lifecycleHarness(overrides = {}) {
  const {
    autoComplete = true,
    orchestratorOpenImpl = null,
    orchestratorAbortImpl = null,
    ...managerOverrides
  } = overrides
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
        const opened = orchestratorOpenImpl
          ? await orchestratorOpenImpl({ options, record })
          : { threadId: `thread-${orchestrators.length}` }
        record.alive = true
        return opened
      }),
      send: vi.fn(async (text) => {
        const result = { turn: { id: `turn-${text}` } }
        if (autoComplete) {
          options.onEvent({
            method: 'turn/completed',
            params: { turn: { id: result.turn.id, status: 'completed' } },
          })
        }
        return result
      }),
      steer: vi.fn(async (text) => ({ steered: text })),
      abort: vi.fn(orchestratorAbortImpl || (async () => ({ aborted: true }))),
      close: vi.fn(async () => { record.alive = false }),
    }
    orchestrators.push(record)
    return record
  })
  const manager = createAgentSessionManager({
    ...appDeps(),
    createPrivateRpcImpl,
    createCodexOrchestratorImpl,
    ...managerOverrides,
  })
  return { manager, privateRpcs, orchestrators, createPrivateRpcImpl, createCodexOrchestratorImpl }
}

function claudeSessionHarness({
  modelCatalog = modelCatalogDouble([DEFAULT_MODEL_ROW, CLAUDE_MODEL_ROW]),
  openImpl = null,
  sendImpl = null,
  steerImpl = null,
  abortImpl = null,
  closeImpl = null,
  settlePendingAbortImpl = null,
  ...managerOverrides
} = {}) {
  let options
  const privateRpcFactory = vi.fn(() => {
    throw new Error('Claude sessions must not create private RPC')
  })
  const orchestrator = {}
  const createClaudeOrchestratorImpl = vi.fn((receivedOptions) => {
    options = receivedOptions
    Object.assign(orchestrator, {
      open: vi.fn(() => openImpl
        ? openImpl({ options, orchestrator })
        : Promise.resolve({ provider: 'claude', model: CLAUDE_MODEL_ROW.sdkModel })),
      send: vi.fn((text, sdkModel) => {
        if (sendImpl) return sendImpl({ options, orchestrator, text, sdkModel })
        const pending = options.runState.state
        options.runState.state = { kind: 'active', turnId: pending.turnId }
        return Promise.resolve({ turn: { id: pending.turnId, status: 'inProgress' } })
      }),
      steer: vi.fn((text) => steerImpl
        ? steerImpl({ options, orchestrator, text })
        : Promise.resolve({ delegated: text })),
      abort: vi.fn(() => abortImpl
        ? abortImpl({ options, orchestrator })
        : Promise.resolve({ aborted: false, reason: 'idle' })),
      close: vi.fn(() => closeImpl
        ? closeImpl({ options, orchestrator })
        : Promise.resolve({ closed: true })),
      settlePendingAbort: vi.fn((pending) => settlePendingAbortImpl?.({
        options,
        orchestrator,
        pending,
      })),
    })
    return orchestrator
  })
  const manager = createAgentSessionManager({
    ...appDeps({ modelCatalog }),
    createPrivateRpcImpl: privateRpcFactory,
    createClaudeOrchestratorImpl,
    ...managerOverrides,
  })
  return {
    manager,
    orchestrator,
    createClaudeOrchestratorImpl,
    privateRpcFactory,
    get options() { return options },
  }
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
      storyCommands: {},
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

describe('AgentSessionManager M6b-2a open provider factory', () => {
  it('modelCatalog.snapshot 계약을 생성 시 필수로 검증한다', () => {
    expect(() => createAgentSessionManager({
      ...appDeps(),
      modelCatalog: {
        list: vi.fn(async () => [DEFAULT_MODEL_ROW]),
        defaultModelId: vi.fn(() => DEFAULT_MODEL_ID),
      },
    })).toThrow('modelCatalog.snapshot is required')
  })

  it('prefixed open id를 exact row로 resolve해 Codex 생성자에는 sdkModel만 넘긴다', async () => {
    const selectedRow = {
      id: 'codex:gpt-selected',
      provider: 'codex',
      sdkModel: 'gpt-selected',
      isDefault: false,
    }
    const catalog = modelCatalogDouble([DEFAULT_MODEL_ROW, selectedRow])
    const h = lifecycleHarness({ modelCatalog: catalog })

    const opened = await h.manager.open(selectedRow.id)

    expect(catalog.snapshot).toHaveBeenCalledOnce()
    expect(catalog.list).not.toHaveBeenCalled()
    expect(h.createCodexOrchestratorImpl).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-selected',
      privateRpc: h.privateRpcs[0],
    }))
    expect(h.createCodexOrchestratorImpl).not.toHaveBeenCalledWith(expect.objectContaining({
      model: selectedRow.id,
    }))
    expect(opened.defaultPin).toEqual({
      id: DEFAULT_MODEL_ID,
      provider: 'codex',
      sdkModel: 'gpt-5.5',
      defaultFallbackFrom: 'claude-opus-4-8',
    })
    // codex open 응답은 orchestrator가 provider를 안 실어도 manager가 session.provider를 넣어야 한다
    // (renderer D2가 이 필드로 orchestratorProvider를 잡는다 — 없으면 codex 세션에서 D2가 죽는다).
    expect(opened.provider).toBe('codex')
    await h.manager.close()
  })

  it('open 뒤 status()가 orchestratorProvider와 defaultPin을 remount 복구용으로 노출한다', async () => {
    const catalog = modelCatalogDouble([DEFAULT_MODEL_ROW, CLAUDE_MODEL_ROW])
    const h = lifecycleHarness({ modelCatalog: catalog })

    await h.manager.open(CLAUDE_MODEL_ROW.id)

    // orchestratorProvider는 열린 세션의 provider(claude)이지 pin의 provider(codex fallback)가 아니다.
    // D2 remount 복구가 이 둘을 구분해야 다른-provider 선택을 경고할 수 있다.
    expect(h.manager.status()).toMatchObject({
      state: 'open',
      provider: 'claude',
      // 명시 open이므로 initialModelId는 그 row id(remount에서 selectedModel 복원용).
      initialModelId: CLAUDE_MODEL_ROW.id,
      defaultPin: {
        id: DEFAULT_MODEL_ID,
        provider: 'codex',
        sdkModel: 'gpt-5.5',
        defaultFallbackFrom: 'claude-opus-4-8',
      },
    })
    await h.manager.close()
  })

  it('Default(생략) open의 status.initialModelId는 null이다', async () => {
    const h = lifecycleHarness({ modelCatalog: modelCatalogDouble([DEFAULT_MODEL_ROW]) })
    await h.manager.open()
    expect(h.manager.status()).toMatchObject({ state: 'open', provider: 'codex', initialModelId: null })
    await h.manager.close()
  })

  it('idle status()는 provider/defaultPin을 붙이지 않는다', async () => {
    const h = lifecycleHarness({ modelCatalog: modelCatalogDouble([DEFAULT_MODEL_ROW]) })
    expect(h.manager.status()).toEqual({ state: 'idle', sessionId: null })
  })

  it.each([
    {
      name: 'cold',
      cacheReady: false,
      expectedPin: {
        id: DEFAULT_MODEL_ID,
        provider: 'codex',
        sdkModel: 'gpt-5.5',
        defaultFallbackFrom: 'claude-opus-4-8',
        fallbackReason: 'catalog-cold',
      },
    },
    {
      name: 'warm',
      cacheReady: true,
      expectedPin: {
        id: DEFAULT_MODEL_ID,
        provider: 'codex',
        sdkModel: 'gpt-5.5',
        defaultFallbackFrom: 'claude-opus-4-8',
      },
    },
  ])('$name snapshot의 default row를 open 응답 defaultPin에 고정한다', async ({ cacheReady, expectedPin }) => {
    const catalog = modelCatalogDouble([DEFAULT_MODEL_ROW], { cacheReady })
    const h = lifecycleHarness({ modelCatalog: catalog })

    const opened = await h.manager.open()

    expect(opened.defaultPin).toEqual(expectedPin)
    expect(h.createCodexOrchestratorImpl).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.5' }))
    expect(catalog.list).not.toHaveBeenCalled()
    await h.manager.close()
  })

  it('snapshot defaultId 행이 없으면 세션 자원을 만들기 전에 fail-closed한다', async () => {
    const h = lifecycleHarness({
      modelCatalog: {
        list: vi.fn(async () => []),
        defaultModelId: vi.fn(() => DEFAULT_MODEL_ID),
        snapshot: vi.fn(() => ({
          cacheReady: true,
          rows: [{ id: 'codex:other', provider: 'codex', sdkModel: 'other' }],
          defaultId: DEFAULT_MODEL_ID,
        })),
      },
    })

    await expect(h.manager.open('codex:other')).rejects.toThrow('agent-model-unavailable')
    expect(h.createPrivateRpcImpl).not.toHaveBeenCalled()
    expect(h.createCodexOrchestratorImpl).not.toHaveBeenCalled()
  })

  it('명시 id가 snapshot에 없으면 세션 자원을 만들기 전에 fail-closed한다', async () => {
    const h = lifecycleHarness()

    await expect(h.manager.open('codex:missing')).rejects.toThrow('agent-model-unavailable')
    expect(h.createPrivateRpcImpl).not.toHaveBeenCalled()
    expect(h.createCodexOrchestratorImpl).not.toHaveBeenCalled()
  })

  it('initial row sdkModel이 null이면 provider factory 전에 fail-closed한다', async () => {
    const unresolved = {
      id: 'claude:default',
      provider: 'claude',
      sdkModel: null,
      isDefault: false,
    }
    const createClaudeOrchestratorImpl = vi.fn()
    const h = lifecycleHarness({
      modelCatalog: modelCatalogDouble([DEFAULT_MODEL_ROW, unresolved]),
      createClaudeOrchestratorImpl,
    })

    await expect(h.manager.open(unresolved.id)).rejects.toThrow('agent-model-unavailable')
    expect(h.createPrivateRpcImpl).not.toHaveBeenCalled()
    expect(h.createCodexOrchestratorImpl).not.toHaveBeenCalled()
    expect(createClaudeOrchestratorImpl).not.toHaveBeenCalled()
  })

  it('Claude row는 nested authority cell과 Claude 전용 DI로 열고 private RPC 없이 닫는다', async () => {
    const grantLedger = {
      grant: vi.fn(),
      consume: vi.fn(() => false),
      closeSession: vi.fn(),
    }
    const approvalPrompt = {
      ask: vi.fn(async () => ({ action: 'decline' })),
      closeSession: vi.fn(),
    }
    let claudeOptions
    const claudeOrchestrator = {
      open: vi.fn(async () => ({ provider: 'claude', model: CLAUDE_MODEL_ROW.sdkModel })),
      send: vi.fn(),
      steer: vi.fn(),
      abort: vi.fn(),
      close: vi.fn(async () => {
        expect(claudeOptions.runState).toEqual({
          state: { kind: 'idle' },
          turnEpoch: 0,
          toolEpoch: 0,
        })
      }),
    }
    const createClaudeOrchestratorImpl = vi.fn((options) => {
      claudeOptions = options
      return claudeOrchestrator
    })
    const h = lifecycleHarness({
      grantLedger,
      approvalPrompt,
      modelCatalog: modelCatalogDouble([DEFAULT_MODEL_ROW, CLAUDE_MODEL_ROW]),
      createClaudeOrchestratorImpl,
      orchestratorOptions: { adapterPath: '/codex-only/adapter.mjs' },
    })

    const opened = await h.manager.open(CLAUDE_MODEL_ROW.id)

    expect(h.createCodexOrchestratorImpl).not.toHaveBeenCalled()
    expect(h.createPrivateRpcImpl).not.toHaveBeenCalled()
    expect(createClaudeOrchestratorImpl).toHaveBeenCalledOnce()
    expect(claudeOptions).toEqual(expect.objectContaining({
      sessionId: opened.sessionId,
      projectToken: 'project-token',
      grantLedger,
      approvalPrompt,
      model: CLAUDE_MODEL_ROW.sdkModel,
      runState: {
        state: { kind: 'idle' },
        turnEpoch: 0,
        toolEpoch: 0,
      },
      elicitationResponder: expect.objectContaining({ handle: expect.any(Function) }),
      toolCore: expect.objectContaining({ list: expect.any(Function), call: expect.any(Function) }),
      onDelta: expect.any(Function),
      onEvent: expect.any(Function),
      onExit: expect.any(Function),
    }))
    expect(claudeOptions).not.toHaveProperty('privateRpc')
    expect(claudeOptions).not.toHaveProperty('adapterPath')
    expect(opened).toEqual({
      sessionId: expect.any(String),
      provider: 'claude',
      // 명시 open이므로 open 응답도 initialModelId를 실어 remount에서 selectedModel을 복원한다.
      initialModelId: CLAUDE_MODEL_ROW.id,
      model: CLAUDE_MODEL_ROW.sdkModel,
      defaultPin: {
        id: DEFAULT_MODEL_ID,
        provider: 'codex',
        sdkModel: 'gpt-5.5',
        defaultFallbackFrom: 'claude-opus-4-8',
      },
    })

    await expect(h.manager.close()).resolves.toEqual({ sessionId: opened.sessionId })
    expect(claudeOrchestrator.close).toHaveBeenCalledOnce()
    expect(grantLedger.closeSession).toHaveBeenCalledWith(opened.sessionId)
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
    await expect(h.manager.send('재시작 후 turn', DEFAULT_MODEL_ID)).resolves.toEqual({ turn: { id: 'turn-재시작 후 turn' } })
    expect(h.privateRpcs[0].closed).toBe(true)
    expect(h.privateRpcs[1].start).toHaveBeenCalledOnce()
    expect(h.orchestrators[1].send).toHaveBeenCalledWith('재시작 후 turn', 'gpt-5.5')

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
  it('send 완료 뒤 idle Codex steer/abort는 orchestrator를 호출하지 않고 structured value로 끝낸다', async () => {
    const h = lifecycleHarness()
    await h.manager.open()

    await expect(h.manager.send('새 turn', DEFAULT_MODEL_ID)).resolves.toEqual({ turn: { id: 'turn-새 turn' } })
    await expect(h.manager.steer('방향 수정')).resolves.toEqual({
      error: 'agent-steer-unavailable',
      message: '진행 중인 턴이 없습니다.',
      turnId: null,
    })
    await expect(h.manager.abort()).resolves.toEqual({ aborted: false, reason: 'idle' })

    expect(h.orchestrators[0].send).toHaveBeenCalledWith('새 turn', 'gpt-5.5')
    expect(h.orchestrators[0].steer).not.toHaveBeenCalled()
    expect(h.orchestrators[0].abort).not.toHaveBeenCalled()
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
    // M-3: current 세션의 crash exit(플래그 없어도)은 세션을 닫으므로 manager가 sessionClosed:true를
    // 실어 renderer가 sessionOpenRef를 내리고 다음 Send가 재open하게 한다.
    expect(onExit).toHaveBeenCalledWith({ ...exited, sessionClosed: true })
    await vi.waitFor(() => expect(h.manager.status()).toEqual({ state: 'idle', sessionId: null }))
    expect(h.privateRpcs[0].close).toHaveBeenCalledOnce()
    expect(h.orchestrators[0].close).toHaveBeenCalledOnce()
    expect(opened.sessionId).toBeTruthy()
  })

  it('stale 세션의 늦은 onExit은 current 세션을 안 닫고 sessionClosed를 강제하지 않는다', async () => {
    // M-3의 exitedSession != null 분기 핀: current가 아닌(닫힌) 세션의 늦은 exit은 강제 close 대상이
    // 아니므로 sessionClosed를 true로 만들면 안 된다(살아있는 current 세션의 renderer ref를 오하강).
    const onExit = vi.fn()
    const h = lifecycleHarness({ onExit })
    await h.manager.open()
    await h.manager.close()
    const reopened = await h.manager.open()

    // 첫(stale) orchestrator의 늦은 exit — current(두 번째)와 sessionId가 다르다.
    h.orchestrators[0].options.onExit({ code: 1, signal: null, error: new Error('late') })

    expect(onExit).toHaveBeenLastCalledWith(expect.objectContaining({ sessionClosed: false }))
    expect(h.manager.status().sessionId).toBe(reopened.sessionId)
    await h.manager.close()
  })

  it('onExit renderer 통지가 throw해도 세션 cleanup은 반드시 돈다 (통지가 cleanup을 막지 않음)', async () => {
    // R5 MAJOR: onExit(webContents.send)이 창 파괴 race로 throw하면 뒤의 closeSession이 스킵돼 current가
    // 남아 wedge된다. cleanup이 load-bearing이므로 통지 throw와 무관하게 돌아야 한다.
    const onExit = vi.fn(() => { throw new Error('webContents.send boom') })
    const h = lifecycleHarness({ onExit })
    await h.manager.open()

    h.orchestrators[0].options.onExit({ code: 1, signal: null, error: new Error('crashed') })

    expect(onExit).toHaveBeenCalled()
    await vi.waitFor(() => expect(h.manager.status()).toEqual({ state: 'idle', sessionId: null }))
    expect(h.orchestrators[0].close).toHaveBeenCalledOnce()
  })

  it('turn/tool admission 뒤의 app ledger snapshot을 usage callback으로 노출한다', async () => {
    const onUsage = vi.fn()
    const storyCommands = {
      hasProject: () => true,
      projectToken: 'project-token',
      getState: vi.fn(async () => ({ sceneMode: 'audio-first' })),
    }
    const h = lifecycleHarness({ onUsage, now: () => 10_000, storyCommands })
    const opened = await h.manager.open()

    await h.manager.send('usage turn', DEFAULT_MODEL_ID)
    await h.privateRpcs[0].toolCore.call('list_scenes')

    expect(onUsage.mock.calls.map(([snapshot]) => snapshot)).toEqual([
      { sessionId: opened.sessionId, turns: 1, toolCalls: 0, elapsedMs: 0 },
      { sessionId: opened.sessionId, turns: 1, toolCalls: 1, elapsedMs: 0 },
    ])
    await h.manager.close()
  })
})

describe('AgentSessionManager M6b-2b Claude coordination', () => {
  // NOTE: replaceRunState's `provider !== 'codex'` guard is unreachable defense-in-depth — no
  // correct claude path calls it, so it cannot be pinned behaviorally without synthetic injection,
  // and a source-string assertion violates repo discipline (spec-by-string). The claude nested-cell
  // integrity it protects is covered behaviorally by the refuse-then-resend (C1) and observeEvent
  // guard tests below; the guard itself stays as a loud runtime barrier.

  it('Claude busy 판정은 nested state의 5개 non-idle 상태와 turnId를 읽는다', async () => {
    const h = claudeSessionHarness()
    await h.manager.open(CLAUDE_MODEL_ROW.id)
    const cases = [
      {
        state: { kind: 'pendingStart', turnId: 'manager-pending' },
        expected: {
          error: 'agent-busy',
          message: '새 작업을 시작하는 중입니다. 잠시 후 다시 시도해 주세요.',
          turnId: 'manager-pending',
        },
      },
      {
        state: { kind: 'active', turnId: 'manager-active' },
        expected: {
          error: 'agent-busy',
          message: '에이전트가 이미 작업 중입니다. 진행 중인 턴에는 Steer를 사용해 주세요.',
          turnId: 'manager-active',
        },
      },
      {
        state: { kind: 'aborting' },
        expected: {
          error: 'agent-busy',
          message: '중단 처리 중입니다. 완료될 때까지 기다려 주세요.',
          turnId: null,
        },
      },
      {
        state: { kind: 'orphanDrain' },
        expected: {
          error: 'agent-busy',
          message: '이전 교정 입력을 정리 중입니다. 잠시 후 다시 시도해 주세요.',
          turnId: null,
        },
      },
      {
        state: { kind: 'closing' },
        expected: {
          error: 'agent-session-closing',
          message: '세션을 닫는 중입니다.',
          turnId: null,
        },
      },
    ]

    for (const { state, expected } of cases) {
      h.options.runState.state = state
      await expect(h.manager.send('busy면 보내면 안 됨', CLAUDE_MODEL_ROW.id)).resolves.toEqual(expected)
    }

    expect(h.orchestrator.send).not.toHaveBeenCalled()
    h.options.runState.state = { kind: 'idle' }
    await h.manager.close()
  })

  it('status().turnActive는 turn runState가 idle이 아닌지를 반영한다(remount running 복원용)', async () => {
    const h = claudeSessionHarness()
    await h.manager.open(CLAUDE_MODEL_ROW.id)
    expect(h.manager.status()).toMatchObject({ turnActive: false })
    h.options.runState.state = { kind: 'active', turnId: 't1' }
    expect(h.manager.status()).toMatchObject({ turnActive: true })
    h.options.runState.state = { kind: 'idle' }
    expect(h.manager.status()).toMatchObject({ turnActive: false })
    await h.manager.close()
  })

  it('Claude send는 매니저 P를 delegate 전에 설치하고 결과를 무변형 반환하며 event는 forward-only다', async () => {
    const onEvent = vi.fn()
    const result = Object.freeze({
      turn: Object.freeze({ id: 'manager-result', status: 'inProgress' }),
    })
    let adopted
    const h = claudeSessionHarness({
      onEvent,
      sendImpl: ({ options, text, sdkModel }) => {
        adopted = options.runState.state
        expect(text).toBe('Claude 작업')
        expect(sdkModel).toBe(CLAUDE_MODEL_ROW.sdkModel)
        expect(adopted).toMatchObject({
          kind: 'pendingStart',
          turnId: expect.stringMatching(/:pending:1$/),
          cancelled: false,
          cancellation: expect.any(Promise),
          resolveCancellation: expect.any(Function),
        })
        options.runState.state = { kind: 'active', turnId: adopted.turnId }
        return Promise.resolve(result)
      },
    })
    await h.manager.open(CLAUDE_MODEL_ROW.id)

    await expect(h.manager.send('Claude 작업', CLAUDE_MODEL_ROW.id)).resolves.toBe(result)
    expect(adopted.turnId).not.toMatch(/^claude:/)
    const active = h.options.runState.state
    const completed = {
      method: 'turn/completed',
      params: { turn: { id: adopted.turnId, status: 'completed' } },
    }
    h.options.onEvent(completed)

    expect(h.options.runState.state).toBe(active)
    expect(h.options.runState.state).toEqual({ kind: 'active', turnId: adopted.turnId })
    expect(onEvent).toHaveBeenCalledWith(completed)
    await h.manager.close()
  })

  it('Claude session의 Codex row send는 공통 D2 검사로 delegate 전에 거부한다', async () => {
    const h = claudeSessionHarness()
    await h.manager.open(CLAUDE_MODEL_ROW.id)

    await expect(h.manager.send('provider를 넘기면 안 됨', DEFAULT_MODEL_ID)).resolves.toEqual({
      error: 'provider-switch-required',
      message: '모델 제공자를 바꾸려면 새 세션을 시작해 주세요.',
      turnId: expect.stringMatching(/:pending:1$/),
    })

    expect(h.orchestrator.send).not.toHaveBeenCalled()
    expect(h.orchestrator.settlePendingAbort).toHaveBeenCalledOnce()
    await h.manager.close()
  })

  it('refuse된 Claude send는 nested cell을 idle로 되돌려 다음 send를 wedge하지 않는다', async () => {
    // C1 회귀: send가 reservation을 nested cell에 설치한 뒤 abort 없이 refuse(D2/model/limit)로
    // unwind하면 settlePendingAbort는 no-op이므로 cell을 명시적으로 idle로 되돌려야 한다. 안 그러면
    // cell이 stale pendingStart에 고정돼 이후 모든 send가 agent-busy가 되고 Stop만 세션을 닫는다.
    const h = claudeSessionHarness()
    await h.manager.open(CLAUDE_MODEL_ROW.id)

    await expect(h.manager.send('코덱스로', DEFAULT_MODEL_ID)).resolves.toEqual({
      error: 'provider-switch-required',
      message: '모델 제공자를 바꾸려면 새 세션을 시작해 주세요.',
      turnId: expect.stringMatching(/:pending:1$/),
    })

    // wedge가 없다면 유효한 Claude send가 성공한다(agent-busy가 아님).
    await expect(h.manager.send('클로드로', CLAUDE_MODEL_ROW.id)).resolves.toEqual({
      turn: { id: expect.stringMatching(/:pending:2$/), status: 'inProgress' },
    })
    expect(h.orchestrator.send).toHaveBeenCalledWith('클로드로', CLAUDE_MODEL_ROW.sdkModel)
    await h.manager.close()
  })

  it('Claude closing abort는 orchestrator의 closing 값을 무변형 반환한다', async () => {
    const closingValue = Object.freeze({ aborted: false, reason: 'closing' })
    const h = claudeSessionHarness({ abortImpl: () => Promise.resolve(closingValue) })
    await h.manager.open(CLAUDE_MODEL_ROW.id)
    // nested cell을 closing으로 두면 매니저 top closing 단락이 아니라 claude 위임이 이겨야 한다.
    h.options.runState.state = { kind: 'closing' }

    await expect(h.manager.abort()).resolves.toBe(closingValue)
    expect(h.orchestrator.abort).toHaveBeenCalledOnce()
    await h.manager.close()
  })

  // NOTE: the observeEvent codex-only guard is pure forward-proofing defense — for a real claude
  // session the nested cell has no top-level .kind/.reservation, so removing the guard is a no-op
  // (mutation-confirmed survivor). It cannot be killed without a fully-matching synthetic
  // reservation (sessionToken), which the manager never exposes. Both consult reviewers classified
  // it as acceptable defense-in-depth, not a production risk. Left documented in source, untested.

  it('Claude 명시 open 뒤 생략 send는 Codex defaultPin과의 D2를 공통 검사한다', async () => {
    const catalog = modelCatalogDouble([DEFAULT_MODEL_ROW, CLAUDE_MODEL_ROW])
    const h = claudeSessionHarness({ modelCatalog: catalog })
    await h.manager.open(CLAUDE_MODEL_ROW.id)

    await expect(h.manager.send('기본 provider로 돌아가기')).resolves.toEqual({
      error: 'provider-switch-required',
      message: '모델 제공자를 바꾸려면 새 세션을 시작해 주세요.',
      turnId: expect.stringMatching(/:pending:1$/),
    })

    expect(catalog.list).not.toHaveBeenCalled()
    expect(h.orchestrator.send).not.toHaveBeenCalled()
    expect(h.orchestrator.settlePendingAbort).toHaveBeenCalledOnce()
    await h.manager.close()
  })

  it('catalog await 중 Claude pendingStart abort는 매니저 unwind 훅으로 즉시 idle 정산한다', async () => {
    const catalogGate = deferred()
    const catalog = {
      list: vi.fn(() => catalogGate.promise),
      snapshot: vi.fn(() => ({
        cacheReady: true,
        rows: [{ ...DEFAULT_MODEL_ROW }, { ...CLAUDE_MODEL_ROW }],
        defaultId: DEFAULT_MODEL_ID,
      })),
    }
    let abortPromise
    let resolveAbort
    let transaction
    const h = claudeSessionHarness({
      modelCatalog: catalog,
      abortImpl: ({ options }) => {
        const pending = options.runState.state
        abortPromise = new Promise((resolve) => { resolveAbort = resolve })
        transaction = { kind: 'aborting', phase: 'pendingStart', pending, promise: abortPromise }
        options.runState.state = transaction
        pending.cancelled = true
        pending.resolveCancellation()
        return abortPromise
      },
      settlePendingAbortImpl: ({ options, pending }) => {
        if (options.runState.state !== transaction || transaction.pending !== pending) return
        options.runState.state = { kind: 'idle' }
        resolveAbort({
          aborted: true,
          phase: 'pendingStart',
          turnId: pending.turnId,
          abortInputId: null,
        })
      },
    })
    await h.manager.open(CLAUDE_MODEL_ROW.id)
    const sending = h.manager.send('catalog 대기 Claude 작업', CLAUDE_MODEL_ROW.id)
    await vi.waitFor(() => expect(catalog.list).toHaveBeenCalledOnce())

    const aborting = h.manager.abort()

    expect(aborting).toBe(abortPromise)
    await expect(sending).resolves.toEqual({
      error: 'agent-send-cancelled',
      message: '전송이 중단되었습니다.',
      turnId: expect.stringMatching(/:pending:1$/),
    })
    await expect(aborting).resolves.toEqual({
      aborted: true,
      phase: 'pendingStart',
      turnId: expect.stringMatching(/:pending:1$/),
      abortInputId: null,
    })
    expect(h.orchestrator.settlePendingAbort).toHaveBeenCalledWith(transaction.pending)
    expect(h.options.runState.state).toEqual({ kind: 'idle' })
    expect(h.orchestrator.send).not.toHaveBeenCalled()
    expect(h.orchestrator.close).not.toHaveBeenCalled()

    catalogGate.resolve([DEFAULT_MODEL_ROW, CLAUDE_MODEL_ROW])
    await h.manager.close()
  })

  it('close가 Claude pendingStart 창에 오면 refuse unwind가 closing cell을 idle로 덮지 않는다', async () => {
    // R2 MINOR: finishPending claude 분기의 idle-복원은 `state === reservation` identity-guard가 있어야
    // 한다. close(또는 abort)가 창 안에서 cell을 이미 다른 terminal(여기선 closing)로 바꾼 뒤 send가
    // unwind하면, 무조건 reset은 그 terminal을 idle로 덮어 status 오보/그 창 abort의 값 오류를 낸다.
    const catalogGate = deferred()
    const catalog = {
      list: vi.fn(() => catalogGate.promise),
      snapshot: vi.fn(() => ({
        cacheReady: true,
        rows: [{ ...DEFAULT_MODEL_ROW }, { ...CLAUDE_MODEL_ROW }],
        defaultId: DEFAULT_MODEL_ID,
      })),
    }
    const h = claudeSessionHarness({
      modelCatalog: catalog,
      closeImpl: ({ options }) => {
        // 실제 claudeOrchestrator.close처럼 pendingStart를 취소하고 nested cell을 closing으로 만든다.
        const previous = options.runState.state
        if (previous?.kind === 'pendingStart') {
          previous.cancelled = true
          previous.resolveCancellation()
        }
        options.runState.state = { kind: 'closing' }
        return Promise.resolve({ closed: true })
      },
    })
    await h.manager.open(CLAUDE_MODEL_ROW.id)
    const sending = h.manager.send('close 경쟁 Claude 작업', CLAUDE_MODEL_ROW.id)
    await vi.waitFor(() => expect(catalog.list).toHaveBeenCalledOnce())

    const closing = h.manager.close()

    await expect(sending).resolves.toEqual({
      error: 'agent-send-cancelled',
      message: '전송이 중단되었습니다.',
      turnId: expect.stringMatching(/:pending:1$/),
    })
    // identity-guard가 없으면 여기서 { kind: 'idle' }로 덮인다.
    expect(h.options.runState.state).toEqual({ kind: 'closing' })
    expect(h.orchestrator.send).not.toHaveBeenCalled()

    catalogGate.resolve([DEFAULT_MODEL_ROW, CLAUDE_MODEL_ROW])
    await closing
  })

  it('Claude abort promise/value를 그대로 반환하고 sessionClosed만 background cleanup으로 소비한다', async () => {
    const abortGate = deferred()
    const result = Object.freeze({
      aborted: true,
      phase: 'active',
      turnId: 'manager-active',
      abortInputId: null,
      contextPreserved: false,
      sessionClosed: true,
      reason: 'abort-before-remote-start',
    })
    const h = claudeSessionHarness({
      abortImpl: ({ options }) => {
        options.runState.state = { kind: 'closing' }
        return abortGate.promise
      },
    })
    await h.manager.open(CLAUDE_MODEL_ROW.id)
    h.options.runState.state = { kind: 'active', turnId: 'manager-active' }

    const aborting = h.manager.abort()

    expect(aborting).toBe(abortGate.promise)
    abortGate.resolve(result)
    await expect(aborting).resolves.toBe(result)
    await vi.waitFor(() => expect(h.manager.status()).toEqual({ state: 'idle', sessionId: null }))
    expect(h.orchestrator.abort).toHaveBeenCalledOnce()
    expect(h.orchestrator.close).toHaveBeenCalledOnce()
  })

  it('Claude steer는 nested 상태를 매니저에서 재게이팅하지 않고 orchestrator에 위임한다', async () => {
    const refusal = Object.freeze({
      error: 'agent-steer-unavailable',
      message: '진행 중인 턴이 없습니다.',
      turnId: null,
    })
    const h = claudeSessionHarness({ steerImpl: () => Promise.resolve(refusal) })
    await h.manager.open(CLAUDE_MODEL_ROW.id)

    await expect(h.manager.steer('Claude 수정')).resolves.toBe(refusal)
    expect(h.orchestrator.steer).toHaveBeenCalledWith('Claude 수정')
    await h.manager.close()
  })
})

describe('AgentSessionManager M6b-2b Codex steer gate', () => {
  it('active에서만 delegate하고 pendingStart/aborting에서는 exact refusal을 반환한다', async () => {
    const catalogGate = deferred()
    const catalog = {
      list: vi.fn()
        .mockImplementationOnce(() => catalogGate.promise)
        .mockResolvedValue([DEFAULT_MODEL_ROW]),
      snapshot: vi.fn(() => ({
        cacheReady: true,
        rows: [{ ...DEFAULT_MODEL_ROW }],
        defaultId: DEFAULT_MODEL_ID,
      })),
    }
    const abortGate = deferred()
    const h = lifecycleHarness({
      autoComplete: false,
      modelCatalog: catalog,
      orchestratorAbortImpl: () => abortGate.promise,
    })
    await h.manager.open()
    const pendingSend = h.manager.send('pending 작업', DEFAULT_MODEL_ID)
    await vi.waitFor(() => expect(catalog.list).toHaveBeenCalledOnce())

    await expect(h.manager.steer('pending 수정')).resolves.toEqual({
      error: 'agent-steer-not-started',
      message: '새 작업을 시작하는 중이라 아직 수정할 턴이 없습니다.',
      turnId: null,
    })
    expect(h.orchestrators[0].steer).not.toHaveBeenCalled()

    catalogGate.resolve([DEFAULT_MODEL_ROW])
    await pendingSend
    await expect(h.manager.steer('active 수정')).resolves.toEqual({ steered: 'active 수정' })

    const aborting = h.manager.abort()
    await expect(h.manager.steer('aborting 수정')).resolves.toEqual({
      error: 'agent-steer-stale',
      message: '중단 처리 중에는 수정할 수 없습니다.',
      turnId: null,
    })
    expect(h.orchestrators[0].steer).toHaveBeenCalledTimes(1)

    abortGate.resolve({ aborted: true })
    await aborting
    await h.manager.close()
  })

  it('closing 중 steer는 withOpenSession throw 전에 structured refusal로 끝낸다', async () => {
    const closeGate = deferred()
    const h = lifecycleHarness()
    await h.manager.open()
    h.orchestrators[0].close.mockImplementationOnce(() => closeGate.promise)

    const closing = h.manager.close()

    await expect(h.manager.steer('closing 수정')).resolves.toEqual({
      error: 'agent-session-closing',
      message: '세션을 닫는 중입니다.',
      turnId: null,
    })
    expect(h.orchestrators[0].steer).not.toHaveBeenCalled()

    closeGate.resolve()
    await closing
  })
})

describe('AgentSessionManager M5 send reservation', () => {
  it('modelCatalog.list 계약을 생성 시 검증한다', () => {
    expect(() => createAgentSessionManager({
      ...appDeps(),
      modelCatalog: null,
    })).toThrow('modelCatalog.list is required')
  })

  it('open await 전에 pendingStart를 예약하고 동시 send를 exact busy 값으로 즉시 거부한다', async () => {
    const openGate = deferred()
    const h = lifecycleHarness({
      autoComplete: false,
      orchestratorOpenImpl: () => openGate.promise,
    })
    const opening = h.manager.open()
    const first = h.manager.send('첫 작업', DEFAULT_MODEL_ID)
    const second = h.manager.send('겹친 작업', DEFAULT_MODEL_ID)
    const notSettled = Symbol('not-settled')

    const busy = await Promise.race([
      second,
      new Promise((resolve) => setImmediate(() => resolve(notSettled))),
    ])
    expect(busy).not.toBe(notSettled)
    expect(busy).toEqual({
      error: 'agent-busy',
      message: '새 작업을 시작하는 중입니다. 잠시 후 다시 시도해 주세요.',
      turnId: expect.any(String),
    })
    expect(h.orchestrators[0].send).not.toHaveBeenCalled()

    const aborting = h.manager.abort()
    await expect(first).resolves.toEqual({
      error: 'agent-send-cancelled',
      message: '전송이 중단되었습니다.',
      turnId: busy.turnId,
    })
    await expect(aborting).resolves.toEqual({
      aborted: true,
      phase: 'pendingStart',
      turnId: busy.turnId,
      abortInputId: null,
    })

    openGate.resolve({ threadId: 'thread-after-cancel' })
    await opening
    await h.manager.close()
  })

  it('cold open 중 runState가 idle이면 abort는 openPromise를 기다리지 않고 즉시 no-op한다', async () => {
    const openGate = deferred()
    const h = lifecycleHarness({ orchestratorOpenImpl: () => openGate.promise })
    const opening = h.manager.open()
    const notSettled = Symbol('not-settled')

    const result = await Promise.race([
      h.manager.abort(),
      new Promise((resolve) => setImmediate(() => resolve(notSettled))),
    ])

    expect(result).toEqual({ aborted: false, reason: 'idle' })
    expect(result).not.toBe(notSettled)
    expect(h.orchestrators[0].abort).not.toHaveBeenCalled()

    openGate.resolve({ threadId: 'thread-cold-open' })
    await opening
    await h.manager.close()
  })

  it('active send ack만으로 reservation을 풀지 않고 같은 turn/completed에서만 다음 send를 허용한다', async () => {
    const h = lifecycleHarness({ autoComplete: false })
    await h.manager.open()

    await expect(h.manager.send('첫 active', DEFAULT_MODEL_ID)).resolves.toEqual({
      turn: { id: 'turn-첫 active' },
    })
    await expect(h.manager.send('ack 직후', DEFAULT_MODEL_ID)).resolves.toEqual({
      error: 'agent-busy',
      message: '에이전트가 이미 작업 중입니다. 진행 중인 턴에는 Steer를 사용해 주세요.',
      turnId: 'turn-첫 active',
    })

    h.orchestrators[0].options.onEvent({
      method: 'turn/completed',
      params: { turn: { id: '다른-turn', status: 'completed' } },
    })
    await expect(h.manager.send('다른 completion 뒤', DEFAULT_MODEL_ID)).resolves.toMatchObject({
      error: 'agent-busy',
      turnId: 'turn-첫 active',
    })

    h.orchestrators[0].options.onEvent({
      method: 'turn/completed',
      params: { turn: { id: 'turn-첫 active', status: 'completed' } },
    })
    await expect(h.manager.send('완료 뒤 새 작업', DEFAULT_MODEL_ID)).resolves.toEqual({
      turn: { id: 'turn-완료 뒤 새 작업' },
    })
    await h.manager.close()
  })

  it('active abort가 정산될 때까지 send를 aborting exact busy 값으로 거부한다', async () => {
    const abortGate = deferred()
    const h = lifecycleHarness({
      autoComplete: false,
      orchestratorAbortImpl: () => abortGate.promise,
    })
    await h.manager.open()
    await h.manager.send('active 작업', DEFAULT_MODEL_ID)

    const aborting = h.manager.abort()
    await expect(h.manager.send('abort 중 작업', DEFAULT_MODEL_ID)).resolves.toEqual({
      error: 'agent-busy',
      message: '중단 처리 중입니다. 완료될 때까지 기다려 주세요.',
      turnId: null,
    })

    abortGate.resolve({ aborted: true })
    await expect(aborting).resolves.toEqual({ aborted: true })
    await h.manager.close()
  })

  it.each([
    {
      name: '동기 throw',
      abortImpl: () => { throw new Error('sync abort failed') },
    },
    {
      name: '비동기 reject',
      abortImpl: async () => { throw new Error('async abort failed') },
    },
  ])('active abort delegate $name는 public promise를 reject하지 않고 closing에서 세션을 닫는다', async ({ abortImpl }) => {
    const closeGate = deferred()
    const h = lifecycleHarness({
      autoComplete: false,
      orchestratorAbortImpl: abortImpl,
    })
    await h.manager.open()
    await h.manager.send('abort 실패 active', DEFAULT_MODEL_ID)
    h.orchestrators[0].close.mockImplementationOnce(() => closeGate.promise)

    const aborting = h.manager.abort()

    await expect(aborting).resolves.toEqual({
      error: 'agent-abort-failed',
      message: '중단을 완료하지 못해 세션을 닫았습니다.',
      aborted: true,
      phase: 'active',
      turnId: 'turn-abort 실패 active',
      abortInputId: null,
      contextPreserved: false,
      sessionClosed: true,
    })
    await expect(h.manager.send('실패 뒤 재전송', DEFAULT_MODEL_ID)).resolves.toEqual({
      error: 'agent-session-closing',
      message: '세션을 닫는 중입니다.',
      turnId: null,
    })
    expect(h.orchestrators[0].close).toHaveBeenCalledOnce()

    closeGate.resolve()
    await h.manager.close()
    expect(h.manager.status()).toEqual({ state: 'idle', sessionId: null })
  })

  it('active abort watchdog는 30초에 timeout으로 abort를 정산하고 세션을 제거한다', async () => {
    vi.useFakeTimers()
    try {
      const abortGate = deferred()
      const h = lifecycleHarness({
        autoComplete: false,
        orchestratorAbortImpl: () => abortGate.promise,
      })
      await h.manager.open()
      await h.manager.send('watchdog active', DEFAULT_MODEL_ID)
      const observed = vi.fn()
      h.manager.abort().then(observed)

      await vi.advanceTimersByTimeAsync(30_000)

      expect(observed).toHaveBeenCalledOnce()
      expect(observed).toHaveBeenCalledWith({
        error: 'agent-abort-timeout',
        message: '중단을 완료하지 못해 세션을 닫았습니다.',
        aborted: true,
        phase: 'active',
        turnId: 'turn-watchdog active',
        abortInputId: null,
        contextPreserved: false,
        sessionClosed: true,
      })
      expect(h.orchestrators[0].close).toHaveBeenCalledOnce()
      expect(h.privateRpcs[0].close).toHaveBeenCalledOnce()
      expect(h.manager.status()).toEqual({ state: 'idle', sessionId: null })
    } finally {
      vi.useRealTimers()
    }
  })

  it('active abort 중 direct close는 cleanup이 멈춰도 abort를 session-close로 동기 정산한다', async () => {
    vi.useFakeTimers()
    try {
      const abortGate = deferred()
      const closeGate = deferred()
      const h = lifecycleHarness({
        autoComplete: false,
        orchestratorAbortImpl: () => abortGate.promise,
      })
      await h.manager.open()
      await h.manager.send('direct close active', DEFAULT_MODEL_ID)
      h.orchestrators[0].close.mockImplementationOnce(() => closeGate.promise)
      const observed = vi.fn()
      h.manager.abort().then(observed)

      const closing = h.manager.close()
      await Promise.resolve()

      expect(observed).toHaveBeenCalledOnce()
      expect(observed).toHaveBeenCalledWith({
        aborted: true,
        phase: 'active',
        turnId: 'turn-direct close active',
        abortInputId: null,
        sessionClosed: true,
        reason: 'session-close',
      })
      expect(h.manager.status()).toMatchObject({ state: 'closing' })

      await vi.advanceTimersByTimeAsync(60_000)
      expect(observed).toHaveBeenCalledOnce()

      closeGate.resolve()
      await closing
      expect(observed).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stale abort watchdog는 같은 runState cell의 다음 abort transaction을 닫지 않는다', async () => {
    vi.useFakeTimers()
    let clearTimeoutSpy
    try {
      const secondAbortGate = deferred()
      let abortCalls = 0
      const h = lifecycleHarness({
        autoComplete: false,
        orchestratorAbortImpl: () => {
          abortCalls += 1
          return abortCalls === 1 ? Promise.resolve({ aborted: true }) : secondAbortGate.promise
        },
      })
      await h.manager.open()
      await h.manager.send('첫 abort transaction', DEFAULT_MODEL_ID)

      // 이미 정산된 첫 watchdog을 의도적으로 남겨 stale callback guard 자체를 검증한다.
      clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {})
      await expect(h.manager.abort()).resolves.toEqual({ aborted: true })
      await vi.advanceTimersByTimeAsync(10_000)

      await h.manager.send('둘째 abort transaction', DEFAULT_MODEL_ID)
      const secondObserved = vi.fn()
      h.manager.abort().then(secondObserved)

      // 첫 transaction의 t=30s watchdog만 발화한다. 둘째 watchdog deadline은 t=40s다.
      await vi.advanceTimersByTimeAsync(20_000)

      expect(h.orchestrators[0].close).not.toHaveBeenCalled()
      expect(h.manager.status()).toMatchObject({ state: 'open' })
      expect(secondObserved).not.toHaveBeenCalled()

      secondAbortGate.resolve({ aborted: true })
      await Promise.resolve()
      await Promise.resolve()
      expect(secondObserved).toHaveBeenCalledOnce()
      expect(secondObserved).toHaveBeenCalledWith({ aborted: true })

      clearTimeoutSpy.mockRestore()
      clearTimeoutSpy = null
      vi.clearAllTimers()
      await h.manager.close()
    } finally {
      clearTimeoutSpy?.mockRestore()
      vi.useRealTimers()
    }
  })

  it('close 정산 중 send를 throw 대신 agent-session-closing exact 값으로 거부한다', async () => {
    const closeGate = deferred()
    const h = lifecycleHarness()
    await h.manager.open()
    h.orchestrators[0].close.mockImplementationOnce(() => closeGate.promise)

    const closing = h.manager.close()
    await expect(h.manager.send('닫는 중 작업', DEFAULT_MODEL_ID)).resolves.toEqual({
      error: 'agent-session-closing',
      message: '세션을 닫는 중입니다.',
      turnId: null,
    })

    closeGate.resolve()
    await closing
  })

  it('catalog id를 exact lookup해 row가 가진 sdkModel 문자열만 orchestrator에 보낸다', async () => {
    const catalog = modelCatalogDouble([
      { id: 'codex:gpt-5.5-mini', provider: 'codex', sdkModel: 'gpt-5.5-mini' },
      DEFAULT_MODEL_ROW,
    ])
    const h = lifecycleHarness({ modelCatalog: catalog })
    await h.manager.open()

    await h.manager.send('모델 변환', DEFAULT_MODEL_ID)

    expect(catalog.list).toHaveBeenCalledOnce()
    expect(h.orchestrators[0].send).toHaveBeenCalledWith('모델 변환', 'gpt-5.5')
    expect(h.orchestrators[0].send).not.toHaveBeenCalledWith('모델 변환', DEFAULT_MODEL_ID)
    await h.manager.close()
  })

  it('cold defaultPin은 catalog가 warm된 뒤 생략 send에서도 고정 sdkModel을 쓰고 재조회하지 않는다', async () => {
    const coldDefault = {
      ...DEFAULT_MODEL_ROW,
      sdkModel: 'gpt-cold-pinned',
    }
    const warmDefault = {
      id: 'codex:gpt-warm-default',
      provider: 'codex',
      sdkModel: 'gpt-warm-default',
      isDefault: true,
    }
    let cacheReady = false
    const catalog = {
      snapshot: vi.fn(() => ({
        cacheReady,
        rows: [{ ...(cacheReady ? warmDefault : coldDefault) }],
        defaultId: cacheReady ? warmDefault.id : coldDefault.id,
      })),
      list: vi.fn(async () => {
        cacheReady = true
        return [{ ...warmDefault }]
      }),
      defaultModelId: vi.fn(() => (cacheReady ? warmDefault.id : coldDefault.id)),
    }
    const h = lifecycleHarness({ modelCatalog: catalog })

    const opened = await h.manager.open()
    expect(opened.defaultPin).toMatchObject({
      id: coldDefault.id,
      provider: 'codex',
      sdkModel: 'gpt-cold-pinned',
      fallbackReason: 'catalog-cold',
    })

    await catalog.list()
    await h.manager.send('고정 기본으로 전송')

    expect(catalog.list).toHaveBeenCalledOnce()
    expect(catalog.defaultModelId).not.toHaveBeenCalled()
    expect(h.orchestrators[0].send).toHaveBeenCalledWith('고정 기본으로 전송', 'gpt-cold-pinned')
    expect(h.orchestrators[0].send).not.toHaveBeenCalledWith('고정 기본으로 전송', 'gpt-warm-default')
    await h.manager.close()
  })

  it('null modelId send도 defaultPin의 unusable sdkModel을 공통 검사해 fail-closed한다', async () => {
    const unresolvedDefault = { ...DEFAULT_MODEL_ROW, sdkModel: null }
    const selectedRow = {
      id: 'codex:gpt-selected',
      provider: 'codex',
      sdkModel: 'gpt-selected',
      isDefault: false,
    }
    const catalog = modelCatalogDouble([unresolvedDefault, selectedRow])
    const h = lifecycleHarness({ modelCatalog: catalog })
    await h.manager.open(selectedRow.id)

    await expect(h.manager.send('해결 안 된 pin은 보내면 안 됨', null)).resolves.toEqual({
      error: 'agent-model-unavailable',
      message: '선택한 모델을 사용할 수 없습니다.',
      turnId: expect.any(String),
    })

    expect(catalog.list).not.toHaveBeenCalled()
    expect(h.orchestrators[0].send).not.toHaveBeenCalled()
    await h.manager.close()
  })

  it.each([
    { name: 'missing', ack: {} },
    { name: 'empty string', ack: { turn: { id: '' } } },
    { name: 'whitespace', ack: { turn: { id: '   ' } } },
    { name: 'non-string', ack: { turn: { id: 42 } } },
  ])('send ack의 turn.id가 unusable($name)이면 active를 풀어 다음 send를 admit한다', async ({ ack }) => {
    const h = lifecycleHarness({ autoComplete: false })
    await h.manager.open()
    h.orchestrators[0].send.mockResolvedValueOnce(ack)

    await expect(h.manager.send('turn id 없는 ack', DEFAULT_MODEL_ID)).resolves.toEqual(ack)
    await expect(h.manager.send('다음 정상 작업', DEFAULT_MODEL_ID)).resolves.toEqual({
      turn: { id: 'turn-다음 정상 작업' },
    })
    expect(h.orchestrators[0].send).toHaveBeenCalledTimes(2)
    await h.manager.close()
  })

  it.each([
    {
      name: 'unknown id',
      modelId: 'codex:gpt-missing',
      rows: [DEFAULT_MODEL_ROW],
      refusal: {
        error: 'agent-model-unavailable',
        message: '선택한 모델을 사용할 수 없습니다.',
      },
    },
    {
      name: 'wrong provider',
      modelId: 'claude:opus',
      rows: [{ id: 'claude:opus', provider: 'claude', sdkModel: 'opus' }],
      refusal: {
        error: 'provider-switch-required',
        message: '모델 제공자를 바꾸려면 새 세션을 시작해 주세요.',
      },
    },
    {
      name: 'null sdkModel',
      modelId: 'codex:unresolved',
      rows: [{ id: 'codex:unresolved', provider: 'codex', sdkModel: null }],
      refusal: {
        error: 'agent-model-unavailable',
        message: '선택한 모델을 사용할 수 없습니다.',
      },
    },
  ])('$name은 text를 보내지 않고 structured refusal 뒤 reservation을 해제한다', async ({ modelId, rows, refusal }) => {
    const h = lifecycleHarness({ modelCatalog: modelCatalogDouble(rows) })
    await h.manager.open()

    await expect(h.manager.send('보내면 안 됨', modelId)).resolves.toEqual({
      ...refusal,
      turnId: expect.any(String),
    })
    expect(h.orchestrators[0].send).not.toHaveBeenCalled()

    await expect(h.manager.send('재검증', modelId)).resolves.toMatchObject(refusal)
    expect(h.orchestrators[0].send).not.toHaveBeenCalled()
    await h.manager.close()
  })

  it('open 실패는 pending envelope 0을 agent-send-cancelled로 정산하고 reservation을 남기지 않는다', async () => {
    const openGate = deferred()
    const h = lifecycleHarness({ orchestratorOpenImpl: () => openGate.promise })
    const opening = h.manager.open()
    const openingRejection = opening.catch((error) => error)
    const sending = h.manager.send('열기 실패 중 작업', DEFAULT_MODEL_ID)

    openGate.reject(new Error('open failed'))

    await expect(sending).resolves.toEqual({
      error: 'agent-send-cancelled',
      message: '전송이 중단되었습니다.',
      turnId: expect.any(String),
    })
    expect((await openingRejection).message).toBe('open failed')
    expect(h.orchestrators[0].send).not.toHaveBeenCalled()
    expect(h.manager.status()).toEqual({ state: 'idle', sessionId: null })
  })

  it('catalog await 중 abort는 list 완료를 기다리지 않고 pendingStart를 동기 취소한다', async () => {
    const catalogGate = deferred()
    const catalog = {
      list: vi.fn(() => catalogGate.promise),
      defaultModelId: vi.fn(() => DEFAULT_MODEL_ID),
      snapshot: vi.fn(() => ({
        cacheReady: true,
        rows: [{ ...DEFAULT_MODEL_ROW }],
        defaultId: DEFAULT_MODEL_ID,
      })),
    }
    const h = lifecycleHarness({ modelCatalog: catalog })
    await h.manager.open()
    const sending = h.manager.send('catalog 대기 작업', DEFAULT_MODEL_ID)
    await vi.waitFor(() => expect(catalog.list).toHaveBeenCalledOnce())

    const aborting = h.manager.abort()
    const notSettled = Symbol('not-settled')
    const abortResult = await Promise.race([
      aborting,
      new Promise((resolve) => setImmediate(() => resolve(notSettled))),
    ])
    expect(abortResult).not.toBe(notSettled)
    expect(abortResult).toMatchObject({
      aborted: true,
      phase: 'pendingStart',
      abortInputId: null,
    })
    await expect(sending).resolves.toEqual({
      error: 'agent-send-cancelled',
      message: '전송이 중단되었습니다.',
      turnId: abortResult.turnId,
    })
    expect(h.orchestrators[0].send).not.toHaveBeenCalled()

    catalogGate.resolve([DEFAULT_MODEL_ROW])
    await h.manager.close()
  })

  it('admitTurn refusal은 reservation을 풀어 다음 send도 busy가 아닌 같은 refusal을 받는다', async () => {
    const h = lifecycleHarness({ maxTurns: 0 })
    await h.manager.open()

    const refusal = { error: 'agent-limit', limit: 0, used: 0 }
    await expect(h.manager.send('첫 거부', DEFAULT_MODEL_ID)).resolves.toEqual(refusal)
    await expect(h.manager.send('둘째 거부', DEFAULT_MODEL_ID)).resolves.toEqual(refusal)
    expect(h.orchestrators[0].send).not.toHaveBeenCalled()
    await h.manager.close()
  })
})

describe('AgentSessionManager D10 app ledger', () => {
  it('기본 64번째 turn/start는 admit하고 65번째는 structured value로 report한다', async () => {
    const onError = vi.fn()
    const h = lifecycleHarness({ onError })
    await h.manager.open()

    const admitted = []
    for (let index = 0; index < 64; index += 1) {
      admitted.push(await h.manager.send(`turn-${index + 1}`, DEFAULT_MODEL_ID))
    }
    const refused = await h.manager.send('turn-65', DEFAULT_MODEL_ID)

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

    await expect(h.manager.send('실패할 turn', DEFAULT_MODEL_ID)).rejects.toThrow('turn failed')
    await expect(h.manager.send('재시도', DEFAULT_MODEL_ID)).resolves.toEqual({
      error: 'agent-limit',
      limit: 1,
      used: 1,
    })

    expect(h.orchestrators[0].send).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith({ error: 'agent-limit', limit: 1, used: 1 })
    await h.manager.close()
  })

  it('steer는 이미 센 active turn에 주입하므로 turn budget을 증가시키지 않는다', async () => {
    const h = lifecycleHarness({ maxTurns: 1, autoComplete: false })
    await h.manager.open()

    await h.manager.send('한 turn', DEFAULT_MODEL_ID)
    // autoComplete:false로 turn이 active로 남아 steer가 delegate된다(§5.6: steer는 active에서만).
    await expect(h.manager.steer('첫 수정')).resolves.toEqual({ steered: '첫 수정' })
    await expect(h.manager.steer('둘째 수정')).resolves.toEqual({ steered: '둘째 수정' })

    expect(h.manager.status()).toMatchObject({ turns: 1 })
    // active turn을 완료시켜 두 번째 send가 busy가 아니라 admitTurn까지 도달하게 한다.
    // steer가 budget을 늘리지 않았으므로 turns는 여전히 1이고 두 번째 send는 turn 한도에 걸린다.
    h.orchestrators[0].options.onEvent({
      method: 'turn/completed',
      params: { turn: { id: 'turn-한 turn', status: 'completed' } },
    })
    await expect(h.manager.send('두 번째 turn', DEFAULT_MODEL_ID)).resolves.toEqual({
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
      getState: vi.fn(async () => ({ sceneMode: 'audio-first' })),
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
    expect(storyCommands.getState).toHaveBeenCalledTimes(256)
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
        getState: vi.fn(async () => ({ sceneMode: 'audio-first' })),
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

    const refused = await h.manager.send('2시간 경계 뒤 작업', DEFAULT_MODEL_ID)

    // M-3: wall-clock 한도는 세션을 닫으므로 sessionClosed:true를 실어 renderer가 ref를 내리게 한다.
    // (turn/tool-count 한도는 세션을 안 닫으므로 이 플래그가 없다.)
    expect(refused).toEqual({
      error: 'agent-limit',
      limit: 2 * 60 * 60 * 1000,
      used: 2 * 60 * 60 * 1000,
      sessionClosed: true,
    })
    expect(h.orchestrators[0].send).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(refused)
    await h.manager.close()
  })

  it('limit 통지(onError)가 throw해도 turn-limit send가 reservation을 wedge하지 않는다', async () => {
    // R6 MAJOR: reportLimit의 onError(webContents.send)가 창 파괴 race로 throw하면 admission flow가
    // 끊겨 pendingStart reservation이 안 정산되고 이후 send가 agent-busy로 wedge된다. 통지를 가드해
    // caller가 refusal을 받고 reservation이 idle로 정산돼야 한다.
    const onError = vi.fn(() => { throw new Error('webContents.send boom') })
    const h = lifecycleHarness({ maxTurns: 0, onError })
    await h.manager.open()

    const first = await h.manager.send('첫 시도', DEFAULT_MODEL_ID)
    expect(first).toMatchObject({ error: 'agent-limit', limit: 0 })
    // reservation이 idle로 정산됐어야 다음 send가 busy가 아니라 다시 limit을 준다.
    const second = await h.manager.send('둘째 시도', DEFAULT_MODEL_ID)
    expect(second).toMatchObject({ error: 'agent-limit', limit: 0 })
    await h.manager.close()
  })

  it('wall-clock 통지(onError)가 throw해도 closeSession은 반드시 돈다', async () => {
    // R6: wall-clock refusal 통지 throw가 뒤의 closeSession을 막으면 안 된다(자원 누수/미정산).
    let time = 5_000
    const onError = vi.fn(() => { throw new Error('webContents.send boom') })
    const h = lifecycleHarness({ now: () => time, onError })
    await h.manager.open()
    time += 2 * 60 * 60 * 1000

    await h.manager.send('통지 throw 뒤 자원 해제', DEFAULT_MODEL_ID)

    await vi.waitFor(() => expect(h.manager.status()).toEqual({ state: 'idle', sessionId: null }))
    expect(h.orchestrators[0].close).toHaveBeenCalledOnce()
  })

  it('usage 통지(onUsage)가 throw해도 send admission이 reservation을 wedge하지 않는다', async () => {
    // onUsage는 admitTurn의 turns++ 뒤에 불린다(onError와 같은 sync-admission 경로). throw가 flow를
    // 끊으면 pendingStart reservation이 갇혀 다음 send가 busy가 된다. 가드로 send가 정상 완료돼야 한다.
    const onUsage = vi.fn(() => { throw new Error('webContents.send boom') })
    const h = lifecycleHarness({ onUsage })
    await h.manager.open()

    const first = await h.manager.send('첫 turn', DEFAULT_MODEL_ID)
    expect(first).toMatchObject({ turn: { id: expect.any(String) } })
    expect(onUsage).toHaveBeenCalled()
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
      await expect(h.manager.send('2시간 경계 뒤 자원 해제', DEFAULT_MODEL_ID)).resolves.toEqual({
        error: 'agent-limit',
        limit: 2 * 60 * 60 * 1000,
        used: 2 * 60 * 60 * 1000,
        sessionClosed: true,
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
