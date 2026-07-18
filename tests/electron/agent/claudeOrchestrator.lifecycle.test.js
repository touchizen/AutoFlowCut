// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_CLAUDE_MAX_TURNS,
  AGENT_CLAUDE_MCP_TOOL_TIMEOUT_MS,
  AGENT_MCP_SERVER_NAME,
  AGENT_SESSION_MAX_TOOL_CALLS,
  AGENT_SESSION_MAX_TURNS,
} from '../../../electron/agent/constants.js'
import { createClaudeOrchestrator } from '../../../electron/agent/claudeOrchestrator.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function asyncChannel() {
  const values = []
  const waiters = []
  let ended = false
  return {
    push(value) {
      const waiter = waiters.shift()
      if (waiter) waiter({ value, done: false })
      else values.push(value)
    },
    end() {
      ended = true
      while (waiters.length) waiters.shift()({ value: undefined, done: true })
    },
    [Symbol.asyncIterator]() { return this },
    next() {
      if (values.length) return Promise.resolve({ value: values.shift(), done: false })
      if (ended) return Promise.resolve({ value: undefined, done: true })
      return new Promise((resolve) => waiters.push(resolve))
    },
  }
}

function successResult(uuid = 'result-1') {
  return { type: 'result', subtype: 'success', is_error: false, uuid }
}

function createHarness({ afterInput, beforeInputs, cancelCapability = true, ...overrides } = {}) {
  const output = asyncChannel()
  const inputs = []
  const order = []
  const inputDone = deferred()
  const onDelta = vi.fn()
  const onEvent = vi.fn()
  const onExit = vi.fn()
  const setModel = vi.fn(async (model) => { order.push(`setModel:${model}`) })
  const close = vi.fn(() => output.end())
  const interrupt = vi.fn()
  const cancelAsyncMessage = vi.fn(async () => true)
  const capabilityRead = vi.fn(() => (cancelCapability ? cancelAsyncMessage : undefined))
  const query = {
    setModel,
    close,
    interrupt,
    [Symbol.asyncIterator]: () => output,
  }
  Object.defineProperty(query, 'cancelAsyncMessage', { get: capabilityRead })
  let queryParams
  const queryFactory = vi.fn((params) => {
    queryParams = params
    ;(async () => {
      let index = 0
      try {
        await beforeInputs
        for await (const message of params.prompt) {
          index += 1
          inputs.push(message)
          order.push(`input:${message.message.content}`)
          await afterInput?.(index, message)
        }
        inputDone.resolve()
      } catch (error) {
        inputDone.reject(error)
      }
    })()
    return query
  })
  const sdkMcpServer = { type: 'sdk', name: AGENT_MCP_SERVER_NAME }
  const sdkMcpServerFactory = vi.fn(() => sdkMcpServer)
  const toolDefinitions = []
  const toolFactory = vi.fn((name, description, inputSchema, handler, extras) => {
    const definition = { name, description, inputSchema, handler, extras }
    toolDefinitions.push(definition)
    return definition
  })
  const elicitationResponder = { handle: vi.fn() }
  const toolCore = {
    list: vi.fn(() => [{
      name: 'read_stats',
      permission: 'R',
      description: 'Read statistics.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    }]),
    call: vi.fn(),
  }
  const grantLedger = { consume: vi.fn(), closeSession: vi.fn() }
  const randomUuid = vi.fn(() => `input-${inputs.length + 1}`)
  const orchestrator = createClaudeOrchestrator({
    sessionId: 'session-1',
    model: 'claude-sonnet-5',
    env: { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/tmp/claude-test' },
    elicitationResponder,
    toolCore,
    grantLedger,
    queryFactory,
    sdkMcpServerFactory,
    toolFactory,
    randomUuid,
    onDelta,
    onEvent,
    onExit,
    ...overrides,
  })
  return {
    orchestrator,
    output,
    inputs,
    order,
    inputDone: inputDone.promise,
    onDelta,
    onEvent,
    onExit,
    query,
    queryFactory,
    get queryParams() { return queryParams },
    sdkMcpServer,
    sdkMcpServerFactory,
    toolDefinitions,
    toolFactory,
    elicitationResponder,
    toolCore,
    grantLedger,
    randomUuid,
    capabilityRead,
    cancelAsyncMessage,
  }
}

describe('Claude orchestrator capability ceiling', () => {
  it('visible turns + hidden abort turns + tool calls를 maxTurns로 예약한다', () => {
    expect(AGENT_CLAUDE_MAX_TURNS).toBe(384)
    expect(AGENT_CLAUDE_MAX_TURNS).toBe(
      2 * AGENT_SESSION_MAX_TURNS + AGENT_SESSION_MAX_TOOL_CALLS,
    )
  })
})

describe('createClaudeOrchestrator — persistent Query lifecycle', () => {
  it('open은 격리 options를 뒤 spread 없이 고정하고 같은 promise를 재사용한다', async () => {
    const inheritedEnv = { PATH: '/custom/bin', KEEP_ME: 'yes' }
    const h = createHarness({ env: inheritedEnv })
    const first = h.orchestrator.open()
    const second = h.orchestrator.open()

    expect(second).toBe(first)
    await expect(first).resolves.toEqual({ provider: 'claude', model: 'claude-sonnet-5' })
    expect(h.queryFactory).toHaveBeenCalledOnce()
    expect(h.sdkMcpServerFactory).toHaveBeenCalledWith({
      name: AGENT_MCP_SERVER_NAME,
      version: '0.0.0',
      tools: h.toolDefinitions,
      alwaysLoad: true,
    })
    expect(h.toolDefinitions).toHaveLength(1)
    expect(h.toolDefinitions[0]).toEqual(expect.objectContaining({
      name: 'read_stats',
      description: 'Read statistics.',
      handler: expect.any(Function),
    }))
    expect(h.queryParams.options).toEqual({
      tools: [],
      allowedTools: [],
      settingSources: [],
      skills: [],
      permissionMode: 'default',
      canUseTool: expect.any(Function),
      supportedDialogKinds: [],
      includePartialMessages: true,
      persistSession: true,
      maxTurns: 384,
      mcpServers: { [AGENT_MCP_SERVER_NAME]: h.sdkMcpServer },
      env: { ...inheritedEnv, MCP_TOOL_TIMEOUT: String(AGENT_CLAUDE_MCP_TOOL_TIMEOUT_MS) },
      model: 'claude-sonnet-5',
    })
    expect(h.queryParams.options.maxTurns).not.toBe(2)
    expect(inheritedEnv).toEqual({ PATH: '/custom/bin', KEEP_ME: 'yes' })
    const denied = await h.queryParams.options.canUseTool('mcp__other__unknown', {})
    expect(denied).toEqual({ behavior: 'deny', message: expect.any(String) })
    expect(denied.message).not.toContain('M3')
    expect(h.elicitationResponder.handle).not.toHaveBeenCalled()
    expect(h.capabilityRead).toHaveBeenCalledOnce()

    await h.orchestrator.close()
  })

  it('send는 다른 모델의 setModel 완료 뒤 envelope를 쓰고 합성 turn id를 증가시킨다', async () => {
    const h = createHarness()
    await h.orchestrator.open()

    const first = await h.orchestrator.send('첫 요청', 'claude-haiku-4-5')
    expect(first).toEqual({ turn: { id: 'claude:session-1:1', status: 'inProgress' } })
    expect(h.order).toEqual(['setModel:claude-haiku-4-5', 'input:첫 요청'])
    expect(h.inputs[0]).toEqual({
      type: 'user',
      uuid: 'input-1',
      parent_tool_use_id: null,
      message: { role: 'user', content: '첫 요청' },
    })

    h.output.push(successResult('result-first'))
    await vi.waitFor(() => expect(h.onEvent).toHaveBeenCalledWith({
      method: 'turn/completed',
      params: { turn: { id: 'claude:session-1:1', status: 'completed' } },
    }))
    const second = await h.orchestrator.send('둘째 요청', 'claude-haiku-4-5')
    expect(second).toEqual({ turn: { id: 'claude:session-1:2', status: 'inProgress' } })
    expect(h.query.setModel).toHaveBeenCalledTimes(1)

    await h.orchestrator.close()
  })

  it('generator yield 전 ownerless output/result를 새 turn에 귀속하지 않는다', async () => {
    const inputStartGate = deferred()
    const h = createHarness({ beforeInputs: inputStartGate.promise })
    await h.orchestrator.open()
    const sending = h.orchestrator.send('아직 yield 안 된 요청', 'claude-sonnet-5')
    await vi.waitFor(() => expect(h.randomUuid).toHaveBeenCalledOnce())

    h.output.push({
      type: 'assistant',
      uuid: 'pre-yield-orphan',
      message: { id: 'old-message', stop_reason: 'end_turn', content: [{ type: 'text', text: '이전 출력' }] },
    })
    h.output.push(successResult('pre-yield-orphan-result'))
    await vi.waitFor(() => expect(h.query.close).toHaveBeenCalledOnce())
    inputStartGate.resolve()

    await expect(sending).resolves.toEqual({
      error: 'agent-send-cancelled',
      message: '전송이 중단되었습니다.',
      turnId: 'claude:session-1:1',
    })
    expect(h.inputs).toHaveLength(0)
    expect(h.onDelta).not.toHaveBeenCalled()
    expect(h.onEvent).not.toHaveBeenCalled()
  })

  it('sdkModel null이면 setModel과 text write를 모두 거부한다', async () => {
    const h = createHarness()
    await h.orchestrator.open()

    await expect(h.orchestrator.send('보내면 안 됨', null)).rejects.toThrow(/sdkModel/i)
    expect(h.query.setModel).not.toHaveBeenCalled()
    expect(h.inputs).toHaveLength(0)

    await h.orchestrator.close()
  })

  it('steer는 active turn에 priority 없는 non-owning envelope를 쓴다', async () => {
    const h = createHarness()
    await h.orchestrator.open()
    await h.orchestrator.send('원 요청', 'claude-sonnet-5')

    await expect(h.orchestrator.steer('방향 수정')).resolves.toEqual({
      turnId: 'claude:session-1:1',
      accepted: true,
    })
    expect(h.inputs[1]).toEqual({
      type: 'user',
      uuid: 'input-2',
      parent_tool_use_id: null,
      message: { role: 'user', content: '방향 수정' },
    })
    expect(h.inputs[1]).not.toHaveProperty('priority')
    expect(h.inputs[1]).not.toHaveProperty('shouldQuery')

    await h.orchestrator.close()
  })

  it('yield 전에 active epoch가 바뀐 queued steer는 structured stale refusal로 끝낸다', async () => {
    const secondInputGate = deferred()
    const h = createHarness({
      afterInput: (index) => (index === 2 ? secondInputGate.promise : undefined),
    })
    await h.orchestrator.open()
    await h.orchestrator.send('원 요청', 'claude-sonnet-5')
    const firstSteer = h.orchestrator.steer('먼저 쓴 수정')
    await vi.waitFor(() => expect(h.inputs).toHaveLength(2))
    const staleSteer = h.orchestrator.steer('queue에서 낡은 수정')

    h.output.push(successResult('result-before-stale'))
    await vi.waitFor(() => expect(h.onEvent).toHaveBeenCalledWith(expect.objectContaining({
      method: 'turn/completed',
    })))
    secondInputGate.resolve()

    await expect(firstSteer).resolves.toEqual({ turnId: 'claude:session-1:1', accepted: true })
    await expect(staleSteer).resolves.toEqual({
      error: 'agent-steer-stale',
      message: '진행 중인 턴이 이미 끝났거나 중단됐습니다.',
      turnId: 'claude:session-1:1',
    })
    expect(h.inputs.map((message) => message.message.content)).toEqual(['원 요청', '먼저 쓴 수정'])

    await h.orchestrator.close()
  })

  it('close는 generator를 끝내고 Query.close를 동기로 정확히 한 번 호출하며 interrupt를 쓰지 않는다', async () => {
    const h = createHarness()
    await h.orchestrator.open()

    const first = h.orchestrator.close()
    const second = h.orchestrator.close()
    expect(second).toBe(first)
    await expect(first).resolves.toEqual({ closed: true })
    await h.inputDone
    expect(h.query.close).toHaveBeenCalledOnce()
    expect(h.query.interrupt).not.toHaveBeenCalled()
    await expect(h.orchestrator.close()).resolves.toEqual({ closed: true })
    expect(h.query.close).toHaveBeenCalledOnce()
  })

  it('close는 yield됐지만 write 확인 전인 steer도 session-closing으로 취소한다', async () => {
    const steerWriteGate = deferred()
    const h = createHarness({
      afterInput: (index) => (index === 2 ? steerWriteGate.promise : undefined),
    })
    await h.orchestrator.open()
    await h.orchestrator.send('원 요청', 'claude-sonnet-5')
    const steering = h.orchestrator.steer('close와 겹친 수정')
    await vi.waitFor(() => expect(h.inputs).toHaveLength(2))

    await h.orchestrator.close()
    steerWriteGate.resolve()

    await expect(steering).resolves.toEqual({
      error: 'agent-session-closing',
      message: '세션을 닫는 중입니다.',
      turnId: null,
    })
    expect(h.query.close).toHaveBeenCalledOnce()
  })

  it('close는 끝나지 않은 setModel을 기다리지 않고 pending send를 즉시 취소한다', async () => {
    const modelGate = deferred()
    const h = createHarness()
    h.query.setModel.mockImplementationOnce(() => modelGate.promise)
    await h.orchestrator.open()
    let sendOutcome
    const sending = h.orchestrator.send('모델 전환 중 요청', 'claude-haiku-4-5')
      .then((value) => { sendOutcome = value; return value })
    await vi.waitFor(() => expect(h.query.setModel).toHaveBeenCalledOnce())

    await h.orchestrator.close()

    await vi.waitFor(() => expect(sendOutcome).toEqual({
      error: 'agent-send-cancelled',
      message: '전송이 중단되었습니다.',
      turnId: 'claude:session-1:1',
    }), { timeout: 200 })
    expect(h.inputs).toHaveLength(0)
    modelGate.resolve()
    await sending
  })

  it('close와 같은 tick의 setModel reject도 pending send structured cancellation로 수렴시킨다', async () => {
    const modelGate = deferred()
    const h = createHarness()
    h.query.setModel.mockImplementationOnce(() => modelGate.promise)
    await h.orchestrator.open()
    const sending = h.orchestrator.send('reject와 close가 겹친 요청', 'claude-haiku-4-5')
    const observed = sending.then(
      (value) => ({ status: 'resolved', value }),
      (error) => ({ status: 'rejected', error }),
    )
    await vi.waitFor(() => expect(h.query.setModel).toHaveBeenCalledOnce())

    modelGate.reject(new Error('Query closed during setModel'))
    await h.orchestrator.close()

    await expect(observed).resolves.toEqual({
      status: 'resolved',
      value: {
        error: 'agent-send-cancelled',
        message: '전송이 중단되었습니다.',
        turnId: 'claude:session-1:1',
      },
    })
    expect(h.inputs).toHaveLength(0)
  })

  it('abort는 M4 경계를 명시한 최소 stub이다', async () => {
    const h = createHarness()
    await h.orchestrator.open()

    await expect(h.orchestrator.abort()).resolves.toEqual({
      aborted: false,
      reason: 'not-implemented',
    })

    await h.orchestrator.close()
  })

  it('예상 밖 SDK stream 종료만 onExit로 보고한다', async () => {
    const h = createHarness()
    await h.orchestrator.open()

    h.output.end()
    await vi.waitFor(() => expect(h.onExit).toHaveBeenCalledOnce())
    expect(h.onExit).toHaveBeenCalledWith({
      provider: 'claude',
      code: null,
      signal: null,
      error: null,
      reason: 'stream-ended',
    })

    await h.orchestrator.close()
    expect(h.onExit).toHaveBeenCalledOnce()
  })
})
