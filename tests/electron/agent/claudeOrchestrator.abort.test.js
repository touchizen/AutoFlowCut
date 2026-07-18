// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as agentConstants from '../../../electron/agent/constants.js'
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

function result(uuid = 'result-1') {
  return { type: 'result', subtype: 'success', is_error: false, uuid }
}

function remoteFrame(uuid = 'remote-frame') {
  return {
    type: 'stream_event',
    uuid,
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'remote' } },
  }
}

function createHarness({
  beforeInputs,
  afterInput,
  cancelCapability = true,
  cancelImpl = async () => true,
  approvalPrompt,
  abortBoundaryTimeoutMs = 30_000,
} = {}) {
  const output = asyncChannel()
  const inputs = []
  const inputDone = deferred()
  inputDone.promise.catch(() => {})
  const onDelta = vi.fn()
  const onEvent = vi.fn()
  const onExit = vi.fn()
  const close = vi.fn(() => output.end())
  const cancelAsyncMessage = vi.fn(cancelImpl)
  const query = {
    setModel: vi.fn(async () => {}),
    close,
    interrupt: vi.fn(),
    [Symbol.asyncIterator]: () => output,
  }
  if (cancelCapability) query.cancelAsyncMessage = cancelAsyncMessage

  const queryFactory = vi.fn((params) => {
    ;(async () => {
      try {
        await beforeInputs
        let index = 0
        for await (const message of params.prompt) {
          index += 1
          inputs.push(message)
          await afterInput?.(index, message)
        }
        inputDone.resolve()
      } catch (error) {
        inputDone.reject(error)
      }
    })()
    return query
  })
  const grantLedger = { consume: vi.fn(), closeSession: vi.fn() }
  let nextUuid = 0
  const randomUuid = vi.fn(() => `uuid-${++nextUuid}`)
  const orchestrator = createClaudeOrchestrator({
    sessionId: 'abort-session',
    model: 'claude-sonnet-5',
    env: { PATH: '/usr/bin' },
    elicitationResponder: { handle: vi.fn() },
    toolCore: { list: vi.fn(() => []), call: vi.fn() },
    grantLedger,
    queryFactory,
    sdkMcpServerFactory: vi.fn(() => ({ type: 'sdk' })),
    randomUuid,
    approvalPrompt,
    abortBoundaryTimeoutMs,
    onDelta,
    onEvent,
    onExit,
  })

  return {
    orchestrator,
    output,
    inputs,
    inputDone: inputDone.promise,
    query,
    cancelAsyncMessage,
    grantLedger,
    randomUuid,
    onDelta,
    onEvent,
    onExit,
  }
}

async function startActive(h, text = '실행') {
  await h.orchestrator.open()
  return h.orchestrator.send(text, 'claude-sonnet-5')
}

async function observeRemoteStart(h, uuid = 'remote-frame') {
  h.output.push(remoteFrame(uuid))
  await vi.waitFor(() => expect(h.onDelta).toHaveBeenCalledWith(expect.objectContaining({
    sourceUuid: uuid,
  })))
}

afterEach(() => vi.useRealTimers())

describe('Claude orchestrator §5.7 abort transaction', () => {
  it('defines the fixed abort deadline and silent-stop payload', () => {
    expect(agentConstants.AGENT_CLAUDE_ABORT_BOUNDARY_TIMEOUT_MS).toBe(30_000)
    expect(agentConstants.AGENT_CLAUDE_ABORT_PAYLOAD).toEqual(expect.any(String))
    expect(agentConstants.AGENT_CLAUDE_ABORT_PAYLOAD.length).toBeGreaterThan(0)
  })

  it('idle abort is an input-0 no-op and does not close the Query', async () => {
    const h = createHarness()
    await h.orchestrator.open()

    await expect(h.orchestrator.abort()).resolves.toEqual({ aborted: false, reason: 'idle' })
    expect(h.inputs).toHaveLength(0)
    expect(h.query.close).not.toHaveBeenCalled()

    await h.orchestrator.close()
  })

  it('orphanDrain abort clears the drain and immediately closes without an abort input', async () => {
    const h = createHarness()
    await h.orchestrator.open()
    h.output.push({
      type: 'assistant',
      uuid: 'ownerless-output',
      message: { content: [{ type: 'text', text: 'discard' }] },
    })
    await new Promise((resolve) => setImmediate(resolve))

    const aborting = h.orchestrator.abort()
    expect(h.query.close).toHaveBeenCalledOnce()
    await expect(aborting).resolves.toEqual({
      aborted: true,
      phase: 'orphanDrain',
      turnId: null,
      abortInputId: null,
      sessionClosed: true,
      reason: 'orphan-drain-close',
    })
    expect(h.inputs).toHaveLength(0)
    expect(h.query.interrupt).not.toHaveBeenCalled()
  })

  it('pendingStart abort waits for envelope-0 send unwind, then returns to idle and clears its timer', async () => {
    vi.useFakeTimers()
    const inputGate = deferred()
    const h = createHarness({ beforeInputs: inputGate.promise })
    await h.orchestrator.open()
    const sending = h.orchestrator.send('pending', 'claude-sonnet-5')
    await Promise.resolve()

    const aborting = h.orchestrator.abort()
    inputGate.resolve()

    await expect(sending).resolves.toEqual({
      error: 'agent-send-cancelled',
      message: '전송이 중단되었습니다.',
      turnId: 'claude:abort-session:1',
    })
    await expect(aborting).resolves.toEqual({
      aborted: true,
      phase: 'pendingStart',
      turnId: 'claude:abort-session:1',
      abortInputId: null,
    })
    expect(h.inputs).toHaveLength(0)
    expect(h.query.close).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    await h.orchestrator.close()
  })

  it('pendingStart abort discards even result and only settles when the send unwinds', async () => {
    const inputGate = deferred()
    const h = createHarness({ beforeInputs: inputGate.promise })
    await h.orchestrator.open()
    const sending = h.orchestrator.send('pending', 'claude-sonnet-5')
    await Promise.resolve()
    let settled = false
    const aborting = h.orchestrator.abort().then((value) => { settled = true; return value })

    h.output.push(result('not-a-pending-boundary'))
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    expect(h.query.close).not.toHaveBeenCalled()
    expect(h.onEvent).not.toHaveBeenCalled()

    inputGate.resolve()
    await sending
    await expect(aborting).resolves.toMatchObject({ phase: 'pendingStart' })
    await h.orchestrator.close()
  })

  it('pendingStart watchdog resolves timeout, closes once, and leaves no timer', async () => {
    vi.useFakeTimers()
    const inputGate = deferred()
    const h = createHarness({ beforeInputs: inputGate.promise, abortBoundaryTimeoutMs: 25 })
    await h.orchestrator.open()
    const sending = h.orchestrator.send('blocked pending', 'claude-sonnet-5')
    await Promise.resolve()
    const aborting = h.orchestrator.abort()

    await vi.advanceTimersByTimeAsync(25)

    await expect(aborting).resolves.toEqual({
      error: 'agent-abort-timeout',
      message: '중단을 완료하지 못해 세션을 닫았습니다.',
      aborted: true,
      phase: 'pendingStart',
      turnId: 'claude:abort-session:1',
      abortInputId: null,
      contextPreserved: false,
      sessionClosed: true,
    })
    await expect(sending).resolves.toMatchObject({ error: 'agent-send-cancelled' })
    expect(h.query.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('active abort before any T frame closes only, with no A or cancel call', async () => {
    vi.useFakeTimers()
    const h = createHarness()
    const started = await startActive(h)

    const aborting = h.orchestrator.abort()

    expect(h.query.close).toHaveBeenCalledOnce()
    await expect(aborting).resolves.toEqual({
      aborted: true,
      phase: 'active',
      turnId: started.turn.id,
      abortInputId: null,
      contextPreserved: false,
      sessionClosed: true,
      reason: 'abort-before-remote-start',
    })
    expect(h.inputs).toHaveLength(1)
    expect(h.cancelAsyncMessage).not.toHaveBeenCalled()
    expect(h.query.interrupt).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('active abort after a T frame writes A now, cancels it, observes a boundary, and reuses the Query', async () => {
    const h = createHarness()
    const started = await startActive(h)
    await observeRemoteStart(h)
    vi.useFakeTimers()

    const aborting = h.orchestrator.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.inputs[1]).toEqual({
      type: 'user',
      uuid: 'uuid-2',
      priority: 'now',
      message: { role: 'user', content: agentConstants.AGENT_CLAUDE_ABORT_PAYLOAD },
    })
    expect(h.cancelAsyncMessage).toHaveBeenCalledWith('uuid-2')

    h.output.push(result('opaque-boundary'))
    await vi.advanceTimersByTimeAsync(0)
    await expect(aborting).resolves.toEqual({
      aborted: true,
      phase: 'active',
      turnId: started.turn.id,
      abortInputId: 'uuid-2',
      boundaryObserved: true,
      contextPreserved: true,
      sessionClosed: false,
    })
    expect(h.query.close).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    await expect(h.orchestrator.send('next', 'claude-sonnet-5')).resolves.toEqual({
      turn: { id: 'claude:abort-session:2', status: 'inProgress' },
    })
    expect(h.inputs).toHaveLength(3)
    await h.orchestrator.close()
  })

  it('cancel false closes with abort-cancel-unconfirmed and clears the watchdog', async () => {
    const h = createHarness({ cancelImpl: async () => false })
    const started = await startActive(h)
    await observeRemoteStart(h)
    vi.useFakeTimers()

    await expect(h.orchestrator.abort()).resolves.toEqual({
      aborted: true,
      phase: 'active',
      turnId: started.turn.id,
      abortInputId: 'uuid-2',
      contextPreserved: false,
      sessionClosed: true,
      reason: 'abort-cancel-unconfirmed',
    })
    expect(h.query.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('missing cancel capability degrades without writing A or calling an undeclared method', async () => {
    const h = createHarness({ cancelCapability: false })
    const started = await startActive(h)
    await observeRemoteStart(h)

    await expect(h.orchestrator.abort()).resolves.toEqual({
      aborted: true,
      phase: 'active',
      turnId: started.turn.id,
      abortInputId: null,
      contextPreserved: false,
      sessionClosed: true,
      reason: 'abort-cancel-unavailable',
    })
    expect(h.inputs).toHaveLength(1)
    expect(h.cancelAsyncMessage).not.toHaveBeenCalled()
    expect(h.query.close).toHaveBeenCalledOnce()
  })

  it('cancel rejection resolves agent-abort-failed and closes instead of rejecting', async () => {
    const h = createHarness({ cancelImpl: async () => { throw new Error('cancel failed') } })
    const started = await startActive(h)
    await observeRemoteStart(h)

    await expect(h.orchestrator.abort()).resolves.toEqual({
      error: 'agent-abort-failed',
      message: '중단을 완료하지 못해 세션을 닫았습니다.',
      aborted: true,
      phase: 'active',
      turnId: started.turn.id,
      abortInputId: 'uuid-2',
      contextPreserved: false,
      sessionClosed: true,
    })
    expect(h.query.close).toHaveBeenCalledOnce()
  })

  it('cancel true without an opaque boundary times out and closes once', async () => {
    const h = createHarness({ abortBoundaryTimeoutMs: 40 })
    const started = await startActive(h)
    await observeRemoteStart(h)
    vi.useFakeTimers()
    const aborting = h.orchestrator.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.cancelAsyncMessage).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(40)

    await expect(aborting).resolves.toEqual({
      error: 'agent-abort-timeout',
      message: '중단을 완료하지 못해 세션을 닫았습니다.',
      aborted: true,
      phase: 'active',
      turnId: started.turn.id,
      abortInputId: 'uuid-2',
      contextPreserved: false,
      sessionClosed: true,
    })
    expect(h.query.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('re-entrant Stop returns the same bounded promise and creates one A/timer', async () => {
    const cancelGate = deferred()
    const h = createHarness({ cancelImpl: () => cancelGate.promise })
    await startActive(h)
    await observeRemoteStart(h)

    const first = h.orchestrator.abort()
    const second = h.orchestrator.abort()

    expect(second).toBe(first)
    await vi.waitFor(() => expect(h.cancelAsyncMessage).toHaveBeenCalledOnce())
    expect(h.inputs).toHaveLength(2)
    cancelGate.resolve(false)
    await expect(first).resolves.toMatchObject({ reason: 'abort-cancel-unconfirmed' })
    await expect(second).resolves.toMatchObject({ reason: 'abort-cancel-unconfirmed' })
    expect(h.query.close).toHaveBeenCalledOnce()
  })

  it('concurrent close wins, settles abort once with session-close, and clears the timer', async () => {
    const cancelGate = deferred()
    const h = createHarness({ cancelImpl: () => cancelGate.promise })
    const started = await startActive(h)
    await observeRemoteStart(h)
    vi.useFakeTimers()
    let settlements = 0
    const aborting = h.orchestrator.abort().then((value) => { settlements += 1; return value })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.cancelAsyncMessage).toHaveBeenCalledOnce()

    await expect(h.orchestrator.close()).resolves.toEqual({ closed: true })
    await expect(aborting).resolves.toEqual({
      aborted: true,
      phase: 'active',
      turnId: started.turn.id,
      abortInputId: 'uuid-2',
      sessionClosed: true,
      reason: 'session-close',
    })
    cancelGate.resolve(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(settlements).toBe(1)
    expect(h.query.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes open tools and T synchronously once, invalidates approvals, and suppresses natural completion', async () => {
    const abortWriteGate = deferred()
    const approvalPrompt = { closeSession: vi.fn() }
    const h = createHarness({
      approvalPrompt,
      afterInput: (index) => (index === 2 ? abortWriteGate.promise : undefined),
    })
    const started = await startActive(h)
    h.output.push({
      type: 'assistant',
      uuid: 'tool-frame',
      message: {
        content: [{
          type: 'tool_use',
          id: 'open-tool',
          name: 'mcp__autoflowcut__wait_batch',
          input: { id: 'batch-1' },
        }],
      },
    })
    await vi.waitFor(() => expect(h.onEvent).toHaveBeenCalledWith(expect.objectContaining({
      method: 'item/started',
    })))

    const aborting = h.orchestrator.abort()

    expect(approvalPrompt.closeSession).toHaveBeenCalledWith('abort-session')
    expect(h.grantLedger.closeSession).toHaveBeenCalledWith('abort-session')
    expect(h.onEvent.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ method: 'item/started' }),
      {
        method: 'item/completed',
        params: {
          turnId: started.turn.id,
          item: expect.objectContaining({
            id: 'open-tool',
            status: 'failed',
            result: {
              error: 'agent-turn-aborted',
              message: 'Claude turn이 중단되어 도구 호출이 종료되었습니다.',
            },
          }),
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { id: started.turn.id, status: 'aborted' } },
      },
    ])

    h.output.push({
      type: 'user',
      uuid: 'natural-tool-result',
      message: { content: [{ type: 'tool_result', tool_use_id: 'open-tool', content: 'late' }] },
    })
    h.output.push(result('opaque-natural-result'))
    await new Promise((resolve) => setImmediate(resolve))
    abortWriteGate.resolve()
    await expect(aborting).resolves.toMatchObject({
      boundaryObserved: true,
      contextPreserved: true,
    })
    expect(h.onEvent).toHaveBeenCalledTimes(3)

    await h.orchestrator.close()
  })

  it('aborting(active) drops non-result output and treats result only as an opaque boundary', async () => {
    const cancelGate = deferred()
    const h = createHarness({ cancelImpl: () => cancelGate.promise })
    await startActive(h)
    await observeRemoteStart(h, 'owned-start')
    h.onDelta.mockClear()
    h.onEvent.mockClear()
    let settled = false
    const aborting = h.orchestrator.abort().then((value) => { settled = true; return value })
    await vi.waitFor(() => expect(h.cancelAsyncMessage).toHaveBeenCalledOnce())

    h.output.push(remoteFrame('discarded-delta'))
    h.output.push(result('opaque-any-uuid'))
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.onDelta).not.toHaveBeenCalled()
    expect(h.onEvent).toHaveBeenCalledTimes(1)
    expect(h.onEvent).toHaveBeenCalledWith(expect.objectContaining({ method: 'turn/completed' }))
    expect(settled).toBe(false)

    cancelGate.resolve(true)
    await expect(aborting).resolves.toMatchObject({ boundaryObserved: true })
    await h.orchestrator.close()
  })

  it('stream end during the barrier resolves agent-abort-failed and closes', async () => {
    const cancelGate = deferred()
    const h = createHarness({ cancelImpl: () => cancelGate.promise })
    const started = await startActive(h)
    await observeRemoteStart(h)
    const aborting = h.orchestrator.abort()
    await vi.waitFor(() => expect(h.cancelAsyncMessage).toHaveBeenCalledOnce())

    h.output.end()

    await expect(aborting).resolves.toEqual({
      error: 'agent-abort-failed',
      message: '중단을 완료하지 못해 세션을 닫았습니다.',
      aborted: true,
      phase: 'active',
      turnId: started.turn.id,
      abortInputId: 'uuid-2',
      contextPreserved: false,
      sessionClosed: true,
    })
    expect(h.query.close).toHaveBeenCalledOnce()
  })
})
