import { randomUUID } from 'node:crypto'
import { createSdkMcpServer, query as claudeQuery } from '@anthropic-ai/claude-agent-sdk'
import {
  AGENT_CLAUDE_MAX_TURNS,
  AGENT_MCP_SERVER_NAME,
} from './constants.js'

const MCP_TOOL_TIMEOUT = '1800000'
const ORPHAN_DRAIN_TIMEOUT_MS = 120_000
const SDK_MCP_VERSION = '0.0.0'

function createInputQueue() {
  const entries = []
  const takers = []
  let ended = false
  let endRefusal = null
  let inFlight = null

  function settle(entry, value, error = null) {
    if (!entry || entry.settled) return
    entry.settled = true
    if (error) entry.reject(error)
    else entry.resolve(value)
  }

  function take() {
    if (entries.length) return Promise.resolve(entries.shift())
    if (ended) return Promise.resolve(null)
    return new Promise((resolve) => takers.push(resolve))
  }

  function push(entry) {
    const taker = takers.shift()
    if (taker) taker(entry)
    else entries.push(entry)
  }

  async function* stream() {
    while (true) {
      const entry = await take()
      if (!entry) return
      const refusal = entry.guard?.()
      if (refusal) {
        settle(entry, { written: false, refusal })
        continue
      }
      try {
        inFlight = entry
        yield entry.message
        settle(entry, { written: true, refusal: null })
      } catch (error) {
        settle(entry, null, error)
        throw error
      } finally {
        if (inFlight === entry) inFlight = null
      }
    }
  }

  function write(message, { guard, cancelRefusal } = {}) {
    if (ended) return Promise.resolve({ written: false, refusal: endRefusal })
    return new Promise((resolve, reject) => push({
      message,
      guard,
      cancelRefusal,
      resolve,
      reject,
      settled: false,
    }))
  }

  function end(refusal) {
    if (ended) return
    ended = true
    endRefusal = refusal
    const cancelled = (entry) => entry?.cancelRefusal ?? refusal
    settle(inFlight, { written: false, refusal: cancelled(inFlight) })
    while (entries.length) {
      const entry = entries.shift()
      settle(entry, { written: false, refusal: cancelled(entry) })
    }
    while (takers.length) takers.shift()(null)
  }

  return { stream, write, end }
}

function assertClaudeQueryOptions(options, { sdkMcpServer, model }) {
  const expectedKeys = [
    'allowedTools',
    'canUseTool',
    'env',
    'includePartialMessages',
    'maxTurns',
    'mcpServers',
    'model',
    'permissionMode',
    'persistSession',
    'settingSources',
    'skills',
    'supportedDialogKinds',
    'tools',
  ]
  const actualKeys = Object.keys(options).sort()
  const emptyArrays = ['tools', 'allowedTools', 'settingSources', 'skills', 'supportedDialogKinds']
  const valid = JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)
    && emptyArrays.every((key) => Array.isArray(options[key]) && options[key].length === 0)
    && options.permissionMode === 'default'
    && typeof options.canUseTool === 'function'
    && options.includePartialMessages === true
    && options.persistSession === true
    && options.maxTurns === AGENT_CLAUDE_MAX_TURNS
    && options.mcpServers?.[AGENT_MCP_SERVER_NAME] === sdkMcpServer
    && Object.keys(options.mcpServers || {}).length === 1
    && options.env?.MCP_TOOL_TIMEOUT === MCP_TOOL_TIMEOUT
    && options.model === model
  if (!valid) throw new Error('Claude orchestrator query options violated the capability boundary')
}

function userEnvelope(text, uuid) {
  return {
    type: 'user',
    uuid,
    parent_tool_use_id: null,
    message: { role: 'user', content: text },
  }
}

function createTurnAccumulator(turnId) {
  return {
    turnId,
    assistantUuids: new Set(),
    openTools: new Map(),
    pendingRefusals: new Map(),
    confirmedRefusalKeys: new Set(),
    refusalSignals: new Set(),
    errors: [],
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function refusalKey(requestId) {
  return nonEmptyString(requestId) ? `request:${requestId}` : 'turn'
}

function sdkResultError(message) {
  const detail = Array.isArray(message?.errors) ? message.errors.filter(Boolean).join('; ') : ''
  return {
    code: 'agent-result-error',
    subtype: message?.subtype || 'unknown',
    message: detail || `Claude SDK result failed (${message?.subtype || 'unknown'})`,
  }
}

function steerRefusal(state, expectedTurnId = null) {
  if (state.kind === 'pendingStart') {
    return {
      error: 'agent-steer-not-started',
      message: '새 작업을 시작하는 중이라 아직 수정할 턴이 없습니다.',
      turnId: null,
    }
  }
  if (state.kind === 'aborting') {
    return {
      error: 'agent-steer-stale',
      message: '중단 처리 중에는 수정할 수 없습니다.',
      turnId: null,
    }
  }
  if (state.kind === 'orphanDrain') {
    return {
      error: 'agent-steer-unavailable',
      message: '이전 교정 입력을 정리 중입니다.',
      turnId: null,
    }
  }
  if (state.kind === 'closing') {
    return {
      error: 'agent-session-closing',
      message: '세션을 닫는 중입니다.',
      turnId: null,
    }
  }
  if (expectedTurnId) {
    return {
      error: 'agent-steer-stale',
      message: '진행 중인 턴이 이미 끝났거나 중단됐습니다.',
      turnId: expectedTurnId,
    }
  }
  return {
    error: 'agent-steer-unavailable',
    message: '진행 중인 턴이 없습니다.',
    turnId: null,
  }
}

/**
 * Claude Agent SDK persistent Query adapter. M3 replaces the deny-only MCP/permission
 * placeholders; M4 extends the existing aborting/output gate with the cancel barrier.
 */
export function createClaudeOrchestrator({
  sessionId,
  elicitationResponder: _elicitationResponder,
  toolCore: _toolCore,
  model: initialModel,
  onDelta,
  onEvent,
  onExit,
  env: inheritedEnv = process.env,
  queryFactory = claudeQuery,
  sdkMcpServerFactory = createSdkMcpServer,
  randomUuid = randomUUID,
  orphanDrainTimeoutMs = ORPHAN_DRAIN_TIMEOUT_MS,
} = {}) {
  if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required')
  if (typeof initialModel !== 'string' || !initialModel) throw new TypeError('Claude sdkModel is required')
  if (typeof queryFactory !== 'function') throw new TypeError('queryFactory must be a function')
  if (typeof sdkMcpServerFactory !== 'function') throw new TypeError('sdkMcpServerFactory must be a function')

  const inputQueue = createInputQueue()
  let state = { kind: 'idle' }
  let currentModel = initialModel
  let turnCounter = 0
  let turnEpoch = 0
  let toolEpoch = 0
  let query = null
  let readerPromise = null
  let openPromise = null
  let closePromise = null
  let queryClosed = false
  let cancelAsyncMessageCapable = false
  let orphanTimer = null
  const retractedPairs = new Set()

  function closeQueryOnce() {
    if (!query || queryClosed) return
    queryClosed = true
    query.close()
  }

  function clearOrphanTimer() {
    if (!orphanTimer) return
    clearTimeout(orphanTimer)
    orphanTimer = null
  }

  function cancelPendingStart(pending) {
    if (pending?.kind !== 'pendingStart' || pending.cancelled) return
    pending.cancelled = true
    pending.resolveCancellation()
  }

  function enterOrphanDrain() {
    if (state.kind === 'orphanDrain' || state.kind === 'closing') return
    if (state.kind === 'pendingStart') cancelPendingStart(state)
    toolEpoch += 1
    state = { kind: 'orphanDrain' }
    orphanTimer = setTimeout(() => {
      if (state.kind !== 'orphanDrain') return
      state = { kind: 'closing' }
      inputQueue.end(steerRefusal(state))
      closeQueryOnce()
      onExit?.({
        provider: 'claude',
        code: null,
        signal: null,
        error: new Error('이전 입력 정리가 끝나지 않아 세션을 닫았습니다.'),
        reason: 'agent-orphan-drain-timeout',
        sessionClosed: true,
      })
    }, orphanDrainTimeoutMs)
  }

  function closeOrphanDrain() {
    if (state.kind !== 'orphanDrain') return
    clearOrphanTimer()
    state = { kind: 'closing' }
    inputQueue.end(steerRefusal(state))
    closeQueryOnce()
  }

  function isRemoteStartFrame(message) {
    return message?.type === 'stream_event'
      || message?.type === 'assistant'
      || isToolResultFrame(message)
      || message?.type === 'result'
  }

  function isToolResultFrame(message) {
    if (message?.type !== 'user' || !Array.isArray(message.message?.content)) return false
    return message.message.content.some((block) => block?.type === 'tool_result')
  }

  function isOrphanOutput(message) {
    return isRemoteStartFrame(message)
  }

  function closeInvalidRemoteStartState() {
    if (state.kind === 'pendingStart') cancelPendingStart(state)
    toolEpoch += 1
    state = { kind: 'closing' }
    inputQueue.end(steerRefusal(state))
    closeQueryOnce()
    onExit?.({
      provider: 'claude',
      code: null,
      signal: null,
      error: new Error('remoteStarted is only valid for an active Claude turn'),
      reason: 'agent-invalid-remote-start-state',
      sessionClosed: true,
    })
  }

  function emitRetraction(active, sourceUuids) {
    const fresh = []
    for (const sourceUuid of Array.isArray(sourceUuids) ? sourceUuids : []) {
      if (!nonEmptyString(sourceUuid)) continue
      const pair = `${active.turnId}\u0000${sourceUuid}`
      if (retractedPairs.has(pair)) continue
      retractedPairs.add(pair)
      fresh.push(sourceUuid)
    }
    if (!fresh.length) return

    for (const [toolUseId, record] of active.accumulator.openTools) {
      if (fresh.some((uuid) => record.sourceUuids.has(uuid))) {
        active.accumulator.openTools.delete(toolUseId)
      }
    }
    const retracted = new Set(fresh)
    active.accumulator.errors = active.accumulator.errors.filter(
      (error) => !retracted.has(error.sourceUuid),
    )
    onEvent?.({
      method: 'item/retracted',
      params: { turnId: active.turnId, sourceUuids: fresh },
    })
  }

  function resolvePendingRefusal(active, requestId, sourceUuids = []) {
    const accumulator = active.accumulator
    if (nonEmptyString(requestId)) accumulator.pendingRefusals.delete(refusalKey(requestId))
    else accumulator.pendingRefusals.delete('turn')
    const retracted = new Set(Array.isArray(sourceUuids) ? sourceUuids : [])
    for (const [key, leg] of accumulator.pendingRefusals) {
      if (retracted.has(leg.sourceUuid)) accumulator.pendingRefusals.delete(key)
    }
  }

  function confirmRefusal(active, leg, key) {
    const accumulator = active.accumulator
    if (accumulator.confirmedRefusalKeys.has(key)) return
    accumulator.confirmedRefusalKeys.add(key)
    accumulator.errors.push({
      code: 'agent-model-refusal',
      requestId: leg?.requestId ?? null,
      sourceUuid: leg?.sourceUuid ?? null,
      message: 'Claude가 요청을 거부했고 대체 모델 응답이 없습니다.',
    })
  }

  function handlePartial(active, message) {
    const event = message?.event
    if (event?.type !== 'content_block_delta' || event.delta?.type !== 'text_delta') return
    if (!nonEmptyString(event.delta.text)) return
    onDelta?.({
      text: event.delta.text,
      turnId: active.turnId,
      sourceUuid: message.uuid,
    })
  }

  function toolRecord(active, message, block) {
    const rawName = block?.name
    const prefix = `mcp__${AGENT_MCP_SERVER_NAME}__`
    if (!nonEmptyString(rawName) || !rawName.startsWith(prefix) || rawName.length === prefix.length) {
      active.accumulator.errors.push({
        code: 'agent-tool-not-allowed',
        sdkTool: rawName ?? null,
        sourceUuid: message.uuid,
        message: '허용되지 않은 Claude 도구 호출입니다.',
      })
      return
    }
    if (!nonEmptyString(block.id) || active.accumulator.openTools.has(block.id)) return
    const item = {
      id: block.id,
      type: 'mcpToolCall',
      tool: rawName.slice(prefix.length),
      sdkTool: rawName,
      arguments: block.input,
      status: 'inProgress',
      sourceUuid: message.uuid,
      sourceUuids: [message.uuid],
    }
    active.accumulator.openTools.set(block.id, {
      item,
      sourceUuids: new Set([message.uuid]),
    })
    onEvent?.({ method: 'item/started', params: { turnId: active.turnId, item } })
  }

  function emitTextRun(active, message, text, number) {
    if (!text) return
    onEvent?.({
      method: 'item/completed',
      params: {
        turnId: active.turnId,
        item: {
          id: number === 1 ? message.uuid : `${message.uuid}:text:${number}`,
          type: 'agentMessage',
          text,
          sdkMessageId: message.message?.id,
          sourceUuid: message.uuid,
        },
      },
    })
  }

  function handleAssistant(active, message) {
    const accumulator = active.accumulator
    const supersedes = Array.isArray(message.supersedes) ? message.supersedes : []
    if (supersedes.length) emitRetraction(active, supersedes)
    if (accumulator.assistantUuids.has(message.uuid)) return
    accumulator.assistantUuids.add(message.uuid)

    if (message.error) {
      accumulator.errors.push({
        code: 'agent-assistant-error',
        sdkError: message.error,
        sourceUuid: message.uuid,
        message: 'Claude assistant 응답에 오류가 있습니다.',
      })
      return
    }

    if (message.message?.stop_reason === 'refusal') {
      const key = refusalKey(message.request_id)
      if (!accumulator.pendingRefusals.has(key) && !accumulator.confirmedRefusalKeys.has(key)) {
        accumulator.pendingRefusals.set(key, {
          requestId: nonEmptyString(message.request_id) ? message.request_id : null,
          sourceUuid: message.uuid,
        })
      }
      return
    }

    const pendingKey = refusalKey(message.request_id)
    if (!supersedes.length && accumulator.pendingRefusals.has(pendingKey)) return
    if (supersedes.length) {
      resolvePendingRefusal(active, message.request_id, supersedes)
    }

    const blocks = Array.isArray(message.message?.content) ? message.message.content : []
    let run = ''
    let emittedRuns = 0
    const flush = () => {
      if (!run) return
      emittedRuns += 1
      emitTextRun(active, message, run, emittedRuns)
      run = ''
    }
    for (const block of blocks) {
      if (block?.type === 'text') {
        run += typeof block.text === 'string' ? block.text : ''
        continue
      }
      flush()
      if (block?.type === 'tool_use') toolRecord(active, message, block)
    }
    flush()
  }

  function handleToolResults(active, message) {
    const blocks = Array.isArray(message.message?.content) ? message.message.content : []
    for (const block of blocks) {
      if (block?.type !== 'tool_result') continue
      const record = active.accumulator.openTools.get(block.tool_use_id)
      if (!record) continue
      active.accumulator.openTools.delete(block.tool_use_id)
      if (nonEmptyString(message.uuid)) record.sourceUuids.add(message.uuid)
      const item = {
        ...record.item,
        status: block.is_error === true ? 'failed' : 'completed',
        sourceUuids: [...record.sourceUuids],
        result: block.content,
      }
      onEvent?.({ method: 'item/completed', params: { turnId: active.turnId, item } })
    }
  }

  function handleRefusalSignal(active, message) {
    if (message.subtype === 'model_refusal_fallback') {
      const sourceUuids = Array.isArray(message.retracted_message_uuids)
        ? message.retracted_message_uuids
        : []
      emitRetraction(active, sourceUuids)
      resolvePendingRefusal(active, message.request_id, sourceUuids)
      return
    }
    if (message.subtype !== 'model_refusal_no_fallback') return
    if (nonEmptyString(message.uuid) && active.accumulator.refusalSignals.has(message.uuid)) return
    if (nonEmptyString(message.uuid)) active.accumulator.refusalSignals.add(message.uuid)
    const key = refusalKey(message.request_id)
    const leg = active.accumulator.pendingRefusals.get(key) || {
      requestId: nonEmptyString(message.request_id) ? message.request_id : null,
      sourceUuid: null,
    }
    active.accumulator.pendingRefusals.delete(key)
    confirmRefusal(active, leg, key)
  }

  function closeOpenToolsAsFailed(active, result = {
    error: 'agent-turn-failed',
    message: 'Claude turn이 tool 완료 전에 실패했습니다.',
  }) {
    for (const [toolUseId, record] of active.accumulator.openTools) {
      active.accumulator.openTools.delete(toolUseId)
      onEvent?.({
        method: 'item/completed',
        params: {
          turnId: active.turnId,
          item: {
            ...record.item,
            status: 'failed',
            sourceUuids: [...record.sourceUuids],
            result,
          },
        },
      })
    }
  }

  function handleOwnedResult(active, message) {
    for (const [key, leg] of active.accumulator.pendingRefusals) {
      confirmRefusal(active, leg, key)
    }
    active.accumulator.pendingRefusals.clear()

    const sdkSuccess = message.subtype === 'success' && message.is_error !== true
    const error = active.accumulator.errors[0] || (!sdkSuccess ? sdkResultError(message) : null)
    if (error) closeOpenToolsAsFailed(active)
    const turn = error
      ? { id: active.turnId, status: 'failed', error }
      : { id: active.turnId, status: 'completed' }
    if (state !== active) return
    state = { kind: 'idle' }
    turnEpoch += 1
    toolEpoch += 1
    onEvent?.({ method: 'turn/completed', params: { turn } })
  }

  function mapSdkMessage(message) {
    // State/epoch ownership is checked before parsing. M4 extends the aborting branch only.
    if (state.kind === 'closing') return
    if (state.kind !== 'active' && Object.hasOwn(state, 'remoteStarted')) {
      closeInvalidRemoteStartState()
      return
    }
    if (state.kind === 'orphanDrain') {
      if (message?.type === 'result') closeOrphanDrain()
      return
    }
    if (state.kind === 'aborting') return
    if (state.kind !== 'active') {
      if (isOrphanOutput(message)) {
        enterOrphanDrain()
        if (message?.type === 'result') closeOrphanDrain()
      }
      return
    }

    const active = state
    // M4 reads this bit; it is set only by the first owned T frame, never by pendingStart.
    if (isRemoteStartFrame(message)) active.remoteStarted = true

    if (message?.type === 'stream_event') handlePartial(active, message)
    else if (message?.type === 'assistant') handleAssistant(active, message)
    else if (message?.type === 'user') handleToolResults(active, message)
    else if (message?.type === 'system') handleRefusalSignal(active, message)
    else if (message?.type === 'result') handleOwnedResult(active, message)
  }

  async function readQuery() {
    try {
      for await (const message of query) mapSdkMessage(message)
      if (state.kind !== 'closing') {
        clearOrphanTimer()
        state = { kind: 'closing' }
        inputQueue.end(steerRefusal(state))
        onExit?.({
          provider: 'claude',
          code: null,
          signal: null,
          error: null,
          reason: 'stream-ended',
        })
      }
    } catch (error) {
      if (state.kind !== 'closing') {
        clearOrphanTimer()
        state = { kind: 'closing' }
        inputQueue.end(steerRefusal(state))
        onExit?.({ provider: 'claude', code: null, signal: null, error, reason: 'stream-error' })
      }
    }
  }

  async function doOpen() {
    if (state.kind === 'closing') throw new Error('Claude orchestrator is closed')
    const sdkMcpServer = sdkMcpServerFactory({
      name: AGENT_MCP_SERVER_NAME,
      version: SDK_MCP_VERSION,
      tools: [], // M3: register the real AutoFlowCut tool definitions.
    })
    const claudeToolPermissionGate = async () => ({
      behavior: 'deny',
      message: 'Claude 인앱 도구 승인은 M3에서 연결됩니다.',
    })
    const options = {
      tools: [],
      allowedTools: [],
      settingSources: [],
      skills: [],
      permissionMode: 'default',
      canUseTool: claudeToolPermissionGate,
      supportedDialogKinds: [],
      includePartialMessages: true,
      persistSession: true,
      maxTurns: AGENT_CLAUDE_MAX_TURNS,
      mcpServers: { [AGENT_MCP_SERVER_NAME]: sdkMcpServer },
      env: { ...inheritedEnv, MCP_TOOL_TIMEOUT },
      model: currentModel,
    }
    // Keep this after the final option assembly: future spreads cannot silently widen capability.
    assertClaudeQueryOptions(options, { sdkMcpServer, model: currentModel })
    query = queryFactory({ prompt: inputQueue.stream(), options })
    if (!query || typeof query[Symbol.asyncIterator] !== 'function' || typeof query.close !== 'function') {
      throw new TypeError('queryFactory must return a Claude Query')
    }
    cancelAsyncMessageCapable = typeof query.cancelAsyncMessage === 'function'
    readerPromise = readQuery()
    readerPromise.catch(() => {})
    return { provider: 'claude', model: currentModel }
  }

  function open() {
    if (state.kind === 'closing') return Promise.reject(new Error('Claude orchestrator is closed'))
    if (!openPromise) openPromise = doOpen()
    return openPromise
  }

  async function send(text, sdkModel = undefined) {
    await open()
    const nextModel = sdkModel === undefined ? currentModel : sdkModel
    if (typeof nextModel !== 'string' || !nextModel) {
      throw new TypeError('Claude sdkModel must be a non-empty string')
    }
    if (state.kind !== 'idle') throw new Error('Claude orchestrator is busy')

    let resolveCancellation
    const cancellation = new Promise((resolve) => { resolveCancellation = resolve })
    const pending = {
      kind: 'pendingStart',
      turnId: `claude:${sessionId}:${++turnCounter}`,
      cancelled: false,
      cancellation,
      resolveCancellation,
    }
    state = pending
    try {
      if (nextModel !== currentModel) {
        const modelOutcome = await Promise.race([
          Promise.resolve(query.setModel(nextModel)).then(() => 'applied'),
          pending.cancellation.then(() => 'cancelled'),
        ])
        if (modelOutcome === 'cancelled' || state !== pending || pending.cancelled) {
          return { error: 'agent-send-cancelled', message: '전송이 중단되었습니다.', turnId: pending.turnId }
        }
        currentModel = nextModel
      }
      if (state !== pending || pending.cancelled) {
        return { error: 'agent-send-cancelled', message: '전송이 중단되었습니다.', turnId: pending.turnId }
      }

      const active = {
        kind: 'active',
        turnId: pending.turnId,
        epoch: null,
        toolEpoch: null,
        remoteStarted: false,
        accumulator: createTurnAccumulator(pending.turnId),
      }
      const receipt = await inputQueue.write(userEnvelope(text, randomUuid()), {
        cancelRefusal: {
          error: 'agent-send-cancelled',
          message: '전송이 중단되었습니다.',
          turnId: pending.turnId,
        },
        guard: () => {
          if (state !== pending || pending.cancelled) {
            return {
              error: 'agent-send-cancelled',
              message: '전송이 중단되었습니다.',
              turnId: pending.turnId,
            }
          }
          // No await between ownership transfer and yield: pre-yield output still belongs to orphan drain.
          active.epoch = ++turnEpoch
          active.toolEpoch = ++toolEpoch
          state = active
          return null
        },
      })
      if (!receipt.written) return receipt.refusal
      return { turn: { id: pending.turnId, status: 'inProgress' } }
    } catch (error) {
      if (pending.cancelled || state.kind === 'closing' || state.kind === 'orphanDrain') {
        return { error: 'agent-send-cancelled', message: '전송이 중단되었습니다.', turnId: pending.turnId }
      }
      if (state === pending || (state.kind === 'active' && state.turnId === pending.turnId)) {
        state = { kind: 'idle' }
      }
      throw error
    }
  }

  async function steer(text) {
    await open()
    if (state.kind !== 'active') return steerRefusal(state)
    const active = state
    const expectedTurnId = active.turnId
    const expectedEpoch = active.epoch
    const receipt = await inputQueue.write(userEnvelope(text, randomUuid()), {
      guard: () => (
        state.kind === 'active'
        && state.turnId === expectedTurnId
        && state.epoch === expectedEpoch
          ? null
          : steerRefusal(state, expectedTurnId)
      ),
    })
    if (!receipt.written) return receipt.refusal
    return { turnId: expectedTurnId, accepted: true }
  }

  async function abort() {
    // M4: early-cancel barrier, remoteStarted capability branch, and watchdog.
    void cancelAsyncMessageCapable
    return { aborted: false, reason: 'not-implemented' }
  }

  function close() {
    if (closePromise) return closePromise
    let resolveClose, rejectClose
    closePromise = new Promise((resolve, reject) => { resolveClose = resolve; rejectClose = reject })
    const previous = state
    try {
      if (previous.kind === 'pendingStart') cancelPendingStart(previous)
      state = { kind: 'closing' }
      turnEpoch += 1
      toolEpoch += 1
      clearOrphanTimer()
      inputQueue.end(steerRefusal(state))
      let closeError = null
      try {
        if (previous.kind === 'active') {
          closeOpenToolsAsFailed(previous, {
            error: 'agent-session-closed',
            message: 'Claude 세션이 닫혀 도구 호출이 종료되었습니다.',
          })
        }
      } catch (error) {
        closeError = error
      }
      try {
        closeQueryOnce()
      } catch (error) {
        closeError ||= error
      }
      if (closeError) rejectClose(closeError)
      else resolveClose({ closed: true })
    } catch (error) {
      rejectClose(error)
    }
    return closePromise
  }

  return { open, send, steer, abort, close }
}

export default { createClaudeOrchestrator }
