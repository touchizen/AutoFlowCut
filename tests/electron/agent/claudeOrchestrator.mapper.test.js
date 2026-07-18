// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function assistant(uuid, content, extra = {}) {
  return {
    type: 'assistant',
    uuid,
    request_id: extra.request_id,
    supersedes: extra.supersedes,
    error: extra.error,
    message: {
      id: extra.messageId || `sdk-${uuid}`,
      stop_reason: extra.stop_reason ?? 'end_turn',
      content,
    },
  }
}

function partial(uuid, text) {
  return {
    type: 'stream_event',
    uuid,
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  }
}

function result(uuid, extra = {}) {
  return {
    type: 'result',
    uuid,
    subtype: extra.subtype || 'success',
    is_error: extra.is_error ?? false,
    errors: extra.errors || [],
  }
}

function createHarness({ setModelImpl, onEventImpl, orphanDrainTimeoutMs = 120_000 } = {}) {
  const output = asyncChannel()
  const inputs = []
  const onDelta = vi.fn()
  const onEvent = onEventImpl || vi.fn()
  const onExit = vi.fn()
  const setModel = vi.fn(setModelImpl || (async () => {}))
  const close = vi.fn(() => output.end())
  const query = {
    setModel,
    close,
    cancelAsyncMessage: vi.fn(async () => true),
    [Symbol.asyncIterator]: () => output,
  }
  let inputUuid = 0
  let prompt
  const queryFactory = vi.fn((params) => {
    prompt = params.prompt
    ;(async () => {
      for await (const message of prompt) inputs.push(message)
    })()
    return query
  })
  const orchestrator = createClaudeOrchestrator({
    sessionId: 'mapper-session',
    model: 'claude-sonnet-5',
    env: { PATH: '/usr/bin' },
    elicitationResponder: { handle: vi.fn() },
    toolCore: { list: vi.fn(() => []) },
    queryFactory,
    sdkMcpServerFactory: vi.fn(() => ({ type: 'sdk' })),
    randomUuid: () => `user-${++inputUuid}`,
    orphanDrainTimeoutMs,
    onDelta,
    onEvent,
    onExit,
  })
  return { orchestrator, output, inputs, onDelta, onEvent, onExit, query }
}

async function start(h, text = '실행', model = 'claude-sonnet-5') {
  await h.orchestrator.open()
  return h.orchestrator.send(text, model)
}

async function waitForEvent(h, predicate) {
  await vi.waitFor(() => expect(h.onEvent.mock.calls.some(([event]) => predicate(event))).toBe(true))
}

afterEach(() => vi.useRealTimers())

describe('Claude §5.3 mapper — delta, assistant text, tools', () => {
  it('partial text는 item을 만들지 않고 provenance object로 onDelta에만 보낸다', async () => {
    const h = createHarness()
    const started = await start(h)

    h.output.push(partial('partial-1', '조각'))
    await vi.waitFor(() => expect(h.onDelta).toHaveBeenCalledWith({
      text: '조각',
      turnId: started.turn.id,
      sourceUuid: 'partial-1',
    }))
    expect(h.onEvent).not.toHaveBeenCalled()

    await h.orchestrator.close()
  })

  it('assistant의 최대 연속 text run을 uuid와 :text:n item으로 완료한다', async () => {
    const h = createHarness()
    const started = await start(h)
    h.output.push(assistant('assistant-1', [
      { type: 'text', text: '앞' },
      { type: 'text', text: ' 문장' },
      { type: 'thinking', thinking: '숨김' },
      { type: 'text', text: '뒤 문장' },
    ], { messageId: 'message-reused' }))

    await vi.waitFor(() => expect(h.onEvent).toHaveBeenCalledTimes(2))
    expect(h.onEvent.mock.calls.map(([event]) => event)).toEqual([
      {
        method: 'item/completed',
        params: {
          turnId: started.turn.id,
          item: {
            id: 'assistant-1',
            type: 'agentMessage',
            text: '앞 문장',
            sdkMessageId: 'message-reused',
            sourceUuid: 'assistant-1',
          },
        },
      },
      {
        method: 'item/completed',
        params: {
          turnId: started.turn.id,
          item: {
            id: 'assistant-1:text:2',
            type: 'agentMessage',
            text: '뒤 문장',
            sdkMessageId: 'message-reused',
            sourceUuid: 'assistant-1',
          },
        },
      },
    ])

    h.output.push(assistant('assistant-1', [{ type: 'text', text: '중복' }]))
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.onEvent).toHaveBeenCalledTimes(2)

    await h.orchestrator.close()
  })

  it('app MCP tool만 canonical started/completed wire로 만들고 tool_result 원문을 보존한다', async () => {
    const h = createHarness()
    const started = await start(h)
    h.output.push(assistant('assistant-tool', [
      {
        type: 'tool_use',
        id: 'tool-use-1',
        name: 'mcp__autoflowcut__generate_videos',
        input: { sceneIds: ['scene-1'] },
      },
    ]))
    await waitForEvent(h, (event) => event.method === 'item/started')
    h.output.push({
      type: 'user',
      uuid: 'tool-result-frame',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'missing', content: 'skip me' },
          { type: 'tool_result', tool_use_id: 'tool-use-1', is_error: true, content: [{ type: 'text', text: '실패 원문' }] },
        ],
      },
    })
    await waitForEvent(h, (event) => event.method === 'item/completed')

    expect(h.onEvent.mock.calls.map(([event]) => event)).toEqual([
      {
        method: 'item/started',
        params: {
          turnId: started.turn.id,
          item: {
            id: 'tool-use-1',
            type: 'mcpToolCall',
            tool: 'generate_videos',
            sdkTool: 'mcp__autoflowcut__generate_videos',
            arguments: { sceneIds: ['scene-1'] },
            status: 'inProgress',
            sourceUuid: 'assistant-tool',
            sourceUuids: ['assistant-tool'],
          },
        },
      },
      {
        method: 'item/completed',
        params: {
          turnId: started.turn.id,
          item: {
            id: 'tool-use-1',
            type: 'mcpToolCall',
            tool: 'generate_videos',
            sdkTool: 'mcp__autoflowcut__generate_videos',
            arguments: { sceneIds: ['scene-1'] },
            status: 'failed',
            sourceUuid: 'assistant-tool',
            sourceUuids: ['assistant-tool', 'tool-result-frame'],
            result: [{ type: 'text', text: '실패 원문' }],
          },
        },
      },
    ])

    await h.orchestrator.close()
  })

  it('다른 MCP server tool은 started로 렌더하지 않고 turn failure를 기록한다', async () => {
    const h = createHarness()
    const started = await start(h)
    h.output.push(assistant('rogue-assistant', [{
      type: 'tool_use', id: 'rogue-tool', name: 'mcp__filesystem__read', input: { path: '/tmp/x' },
    }]))
    h.output.push(result('rogue-result'))

    await waitForEvent(h, (event) => event.method === 'turn/completed')
    expect(h.onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'item/started' }))
    expect(h.onEvent).toHaveBeenLastCalledWith({
      method: 'turn/completed',
      params: {
        turn: {
          id: started.turn.id,
          status: 'failed',
          error: {
            code: 'agent-tool-not-allowed',
            sdkTool: 'mcp__filesystem__read',
            sourceUuid: 'rogue-assistant',
            message: '허용되지 않은 Claude 도구 호출입니다.',
          },
        },
      },
    })

    await h.orchestrator.close()
  })
})

describe('Claude §5.3 mapper — error와 refusal', () => {
  it.each([
    'authentication_failed',
    'oauth_org_not_allowed',
    'billing_error',
    'rate_limit',
    'overloaded',
    'invalid_request',
    'model_not_found',
    'server_error',
    'unknown',
    'max_output_tokens',
  ])('assistant error %s는 정상 content를 억제하고 success result도 failed로 만든다', async (sdkError) => {
    const h = createHarness()
    const started = await start(h)
    h.output.push(assistant(`error-${sdkError}`, [
      { type: 'text', text: '정상처럼 보이면 안 됨' },
      { type: 'tool_use', id: 'hidden-tool', name: 'mcp__autoflowcut__wait_batch', input: {} },
    ], { error: sdkError, stop_reason: 'refusal', request_id: 'same-request' }))
    h.output.push(result(`result-${sdkError}`))

    await waitForEvent(h, (event) => event.method === 'turn/completed')
    expect(h.onEvent).toHaveBeenCalledTimes(1)
    expect(h.onEvent).toHaveBeenCalledWith({
      method: 'turn/completed',
      params: {
        turn: {
          id: started.turn.id,
          status: 'failed',
          error: {
            code: 'agent-assistant-error',
            sdkError,
            sourceUuid: `error-${sdkError}`,
            message: 'Claude assistant 응답에 오류가 있습니다.',
          },
        },
      },
    })

    await h.orchestrator.close()
  })

  it('refusal은 fallback replacement가 오기 전 terminal이 아니며 supersedes를 먼저 retract한다', async () => {
    const h = createHarness()
    const started = await start(h)
    h.output.push(assistant('refused-leg', [{ type: 'text', text: '거부 문구' }], {
      stop_reason: 'refusal', request_id: 'request-1',
    }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.onEvent).not.toHaveBeenCalled()

    h.output.push(assistant('replacement', [{ type: 'text', text: '대체 답변' }], {
      request_id: 'request-1', supersedes: ['refused-leg'],
    }))
    h.output.push({
      type: 'system',
      subtype: 'model_refusal_fallback',
      request_id: 'request-1',
      retracted_message_uuids: ['refused-leg'],
      uuid: 'fallback-signal',
    })
    h.output.push(result('fallback-result'))

    await waitForEvent(h, (event) => event.method === 'turn/completed')
    expect(h.onEvent.mock.calls.map(([event]) => event)).toEqual([
      {
        method: 'item/retracted',
        params: { turnId: started.turn.id, sourceUuids: ['refused-leg'] },
      },
      {
        method: 'item/completed',
        params: {
          turnId: started.turn.id,
          item: {
            id: 'replacement',
            type: 'agentMessage',
            text: '대체 답변',
            sdkMessageId: 'sdk-replacement',
            sourceUuid: 'replacement',
          },
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { id: started.turn.id, status: 'completed' } },
      },
    ])

    await h.orchestrator.close()
  })

  it('supersedes는 같은 turn/source UUID의 assistant error accumulator도 제거한다', async () => {
    const h = createHarness()
    const started = await start(h)
    h.output.push(assistant('retracted-error', [{ type: 'text', text: '오류 frame' }], {
      error: 'overloaded', request_id: 'replacement-request',
    }))
    h.output.push(assistant('error-replacement', [{ type: 'text', text: '복구 답변' }], {
      request_id: 'replacement-request', supersedes: ['retracted-error'],
    }))
    h.output.push(result('replacement-success'))

    await waitForEvent(h, (event) => event.method === 'turn/completed')
    expect(h.onEvent.mock.calls.map(([event]) => event)).toEqual([
      {
        method: 'item/retracted',
        params: { turnId: started.turn.id, sourceUuids: ['retracted-error'] },
      },
      {
        method: 'item/completed',
        params: {
          turnId: started.turn.id,
          item: {
            id: 'error-replacement',
            type: 'agentMessage',
            text: '복구 답변',
            sdkMessageId: 'sdk-error-replacement',
            sourceUuid: 'error-replacement',
          },
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { id: started.turn.id, status: 'completed' } },
      },
    ])

    await h.orchestrator.close()
  })

  it('no-fallback과 owned terminal은 같은 refused leg를 한 번만 failed로 확정한다', async () => {
    const h = createHarness()
    const started = await start(h)
    h.output.push(assistant('refused-no-fallback', [], {
      stop_reason: 'refusal', request_id: 'request-none',
    }))
    const signal = {
      type: 'system',
      subtype: 'model_refusal_no_fallback',
      request_id: 'request-none',
      uuid: 'no-fallback-signal',
    }
    h.output.push(signal)
    h.output.push(signal)
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.onEvent).not.toHaveBeenCalled()
    h.output.push(result('no-fallback-result'))

    await waitForEvent(h, (event) => event.method === 'turn/completed')
    expect(h.onEvent).toHaveBeenCalledTimes(1)
    expect(h.onEvent).toHaveBeenCalledWith({
      method: 'turn/completed',
      params: {
        turn: {
          id: started.turn.id,
          status: 'failed',
          error: {
            code: 'agent-model-refusal',
            requestId: 'request-none',
            sourceUuid: 'refused-no-fallback',
            message: 'Claude가 요청을 거부했고 대체 모델 응답이 없습니다.',
          },
        },
      },
    })

    await h.orchestrator.close()
  })

  it('supersedes 없는 같은 refusal leg의 후속 content/tool은 fallback으로 오인하지 않는다', async () => {
    const h = createHarness()
    const started = await start(h)
    h.output.push(assistant('refused-still-pending', [], {
      stop_reason: 'refusal', request_id: 'request-pending',
    }))
    h.output.push(assistant('not-a-replacement', [
      { type: 'text', text: '렌더 금지' },
      { type: 'tool_use', id: 'pending-tool', name: 'mcp__autoflowcut__wait_batch', input: {} },
    ], { request_id: 'request-pending' }))
    h.output.push(result('pending-terminal'))

    await waitForEvent(h, (event) => event.method === 'turn/completed')
    expect(h.onEvent).toHaveBeenCalledTimes(1)
    expect(h.onEvent).toHaveBeenCalledWith({
      method: 'turn/completed',
      params: {
        turn: {
          id: started.turn.id,
          status: 'failed',
          error: {
            code: 'agent-model-refusal',
            requestId: 'request-pending',
            sourceUuid: 'refused-still-pending',
            message: 'Claude가 요청을 거부했고 대체 모델 응답이 없습니다.',
          },
        },
      },
    })

    await h.orchestrator.close()
  })
})

describe('Claude §5.3 mapper — retraction, terminal, orphan gate', () => {
  it('supersedes dedupe는 uuid-only가 아니라 turnId와 uuid pair를 쓴다', async () => {
    const h = createHarness()
    const first = await start(h, '첫 turn')
    h.output.push(assistant('first-replacement', [{ type: 'text', text: '첫 답' }], {
      supersedes: ['shared-source'],
    }))
    h.output.push(result('first-result'))
    await waitForEvent(h, (event) => event.method === 'turn/completed')

    const second = await h.orchestrator.send('둘째 turn', 'claude-sonnet-5')
    h.output.push(assistant('second-replacement', [{ type: 'text', text: '둘째 답' }], {
      supersedes: ['shared-source'],
    }))
    await waitForEvent(h, (event) => event.method === 'item/retracted' && event.params.turnId === second.turn.id)

    expect(first.turn.id).not.toBe(second.turn.id)
    expect(h.onEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => event.method === 'item/retracted')).toEqual([
      {
        method: 'item/retracted',
        params: { turnId: first.turn.id, sourceUuids: ['shared-source'] },
      },
      {
        method: 'item/retracted',
        params: { turnId: second.turn.id, sourceUuids: ['shared-source'] },
      },
    ])

    await h.orchestrator.close()
  })

  it('failed result는 open tool을 synthetic failed completion으로 먼저 닫는다', async () => {
    const h = createHarness()
    const started = await start(h)
    h.output.push(assistant('open-tool-source', [{
      type: 'tool_use', id: 'open-tool', name: 'mcp__autoflowcut__wait_batch', input: { id: 'batch-1' },
    }]))
    h.output.push(result('failed-result', {
      subtype: 'error_during_execution', is_error: true, errors: ['sdk exploded'],
    }))

    await waitForEvent(h, (event) => event.method === 'turn/completed')
    const events = h.onEvent.mock.calls.map(([event]) => event)
    expect(events.at(-2)).toEqual({
      method: 'item/completed',
      params: {
        turnId: started.turn.id,
        item: expect.objectContaining({
          id: 'open-tool',
          type: 'mcpToolCall',
          status: 'failed',
          result: { error: 'agent-turn-failed', message: 'Claude turn이 tool 완료 전에 실패했습니다.' },
        }),
      },
    })
    expect(events.at(-1)).toEqual({
      method: 'turn/completed',
      params: {
        turn: {
          id: started.turn.id,
          status: 'failed',
          error: {
            code: 'agent-result-error',
            subtype: 'error_during_execution',
            message: 'sdk exploded',
          },
        },
      },
    })

    await h.orchestrator.close()
  })

  it('close는 started tool을 synthetic failed completion으로 정확히 한 번 닫는다', async () => {
    const h = createHarness()
    const started = await start(h)
    h.output.push(assistant('close-tool-source', [{
      type: 'tool_use', id: 'close-tool', name: 'mcp__autoflowcut__wait_batch', input: { id: 'batch-close' },
    }]))
    await waitForEvent(h, (event) => event.method === 'item/started')

    await h.orchestrator.close()
    await h.orchestrator.close()

    expect(h.onEvent.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ method: 'item/started' }),
      {
        method: 'item/completed',
        params: {
          turnId: started.turn.id,
          item: {
            id: 'close-tool',
            type: 'mcpToolCall',
            tool: 'wait_batch',
            sdkTool: 'mcp__autoflowcut__wait_batch',
            arguments: { id: 'batch-close' },
            status: 'failed',
            sourceUuid: 'close-tool-source',
            sourceUuids: ['close-tool-source'],
            result: {
              error: 'agent-session-closed',
              message: 'Claude 세션이 닫혀 도구 호출이 종료되었습니다.',
            },
          },
        },
      },
    ])
  })

  it('close의 synthetic item callback이 던져도 Query.close exact-once 정리는 계속한다', async () => {
    const throwingOnEvent = vi.fn((event) => {
      if (event.method === 'item/completed') throw new Error('renderer callback failed')
    })
    const h = createHarness({ onEventImpl: throwingOnEvent })
    await start(h)
    h.output.push(assistant('throwing-close-source', [{
      type: 'tool_use', id: 'throwing-close-tool', name: 'mcp__autoflowcut__wait_batch', input: {},
    }]))
    await vi.waitFor(() => expect(throwingOnEvent).toHaveBeenCalledWith(expect.objectContaining({
      method: 'item/started',
    })))

    await expect(h.orchestrator.close()).rejects.toThrow('renderer callback failed')
    expect(h.query.close).toHaveBeenCalledOnce()
    await expect(h.orchestrator.close()).rejects.toThrow('renderer callback failed')
    expect(h.query.close).toHaveBeenCalledOnce()
  })

  it('idle의 ownerless result를 owned turn으로 승격하지 않고 즉시 discard+close한다', async () => {
    const h = createHarness()
    await h.orchestrator.open()

    h.output.push(result('orphan-result'))
    await vi.waitFor(() => expect(h.query.close).toHaveBeenCalledOnce())
    expect(h.onDelta).not.toHaveBeenCalled()
    expect(h.onEvent).not.toHaveBeenCalled()
    await expect(h.orchestrator.send('뒤 turn', 'claude-sonnet-5')).rejects.toThrow(/closed/i)

    await h.orchestrator.close()
    expect(h.query.close).toHaveBeenCalledOnce()
  })

  it('pendingStart 중 먼저 온 output은 remote-start로 소유하지 않고 send를 취소한 뒤 orphan drain한다', async () => {
    const modelGate = deferred()
    const h = createHarness({ setModelImpl: () => modelGate.promise })
    await h.orchestrator.open()
    const sending = h.orchestrator.send('절대 쓰면 안 됨', 'claude-haiku-4-5')
    await vi.waitFor(() => expect(h.query.setModel).toHaveBeenCalledOnce())

    h.output.push(assistant('pre-write-output', [{ type: 'text', text: 'orphan' }]))
    await new Promise((resolve) => setImmediate(resolve))
    // pendingStart는 remoteStarted를 가질 수 없다. 첫 output은 orphan drain만 열고,
    // ownerless result 전에는 Query를 닫거나 P를 active T로 승격하지 않는다.
    expect(h.query.close).not.toHaveBeenCalled()
    h.output.push(result('pre-write-result'))
    await vi.waitFor(() => expect(h.query.close).toHaveBeenCalledOnce())
    modelGate.resolve()

    await expect(sending).resolves.toEqual({
      error: 'agent-send-cancelled',
      message: '전송이 중단되었습니다.',
      turnId: 'claude:mapper-session:1',
    })
    expect(h.inputs).toHaveLength(0)
    expect(h.onDelta).not.toHaveBeenCalled()
    expect(h.onEvent).not.toHaveBeenCalled()
  })

  it('ownerless non-result output은 120초 동안 discard한 뒤 watchdog close한다', async () => {
    vi.useFakeTimers()
    const h = createHarness()
    await h.orchestrator.open()
    h.output.push(assistant('orphan-assistant', [{ type: 'text', text: '버림' }]))
    await vi.advanceTimersByTimeAsync(119_999)
    expect(h.query.close).not.toHaveBeenCalled()
    expect(h.onEvent).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(h.query.close).toHaveBeenCalledOnce()
    expect(h.onExit).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'agent-orphan-drain-timeout',
      sessionClosed: true,
    }))
  })

  it('tool_result가 없는 일반 user replay/echo는 remote-start나 orphan output이 아니다', async () => {
    vi.useFakeTimers()
    const h = createHarness()
    await h.orchestrator.open()
    h.output.push({
      type: 'user',
      uuid: 'plain-user-echo',
      message: { role: 'user', content: 'echo without tool result' },
    })

    await vi.advanceTimersByTimeAsync(120_000)

    expect(h.query.close).not.toHaveBeenCalled()
    expect(h.onDelta).not.toHaveBeenCalled()
    expect(h.onEvent).not.toHaveBeenCalled()
    expect(h.onExit).not.toHaveBeenCalled()
    await h.orchestrator.close()
  })
})
