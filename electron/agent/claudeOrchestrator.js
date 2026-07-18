import { randomUUID } from 'node:crypto'
import {
  createSdkMcpServer,
  query as claudeQuery,
  tool as sdkTool,
} from '@anthropic-ai/claude-agent-sdk'
import { encodeApprovalPayload } from './approvalPayload.js'
import { toMcpContent } from './codexAdapterEntry.js'
import {
  AGENT_CLAUDE_ABORT_BOUNDARY_TIMEOUT_MS,
  AGENT_CLAUDE_ABORT_PAYLOAD,
  AGENT_CLAUDE_MAX_TURNS,
  AGENT_CLAUDE_MCP_TOOL_TIMEOUT_MS,
  AGENT_MCP_SERVER_NAME,
} from './constants.js'
import { hashArgs } from './grantLedger.js'
import { zodFromJson } from './jsonSchemaToZod.js'

const MCP_TOOL_TIMEOUT = String(AGENT_CLAUDE_MCP_TOOL_TIMEOUT_MS)
const ORPHAN_DRAIN_TIMEOUT_MS = 120_000
const SDK_MCP_VERSION = '0.0.0'
const CALL_TOKEN_FIELD = '__autoflowcutCallToken'
const GRANT_NONCE_FIELD = '__autoflowcutGrantNonce'
const SDK_TOOL_PREFIX = `mcp__${AGENT_MCP_SERVER_NAME}__`
const STALE_TOOL_RESULT = Object.freeze({ status: 'rejected', reason: 'aborted-or-stale' })
const carrierShape = zodFromJson({
  type: 'object',
  properties: {
    [CALL_TOKEN_FIELD]: { type: 'string' },
    [GRANT_NONCE_FIELD]: { type: 'string' },
  },
  additionalProperties: false,
}).shape

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
  projectToken = null,
  elicitationResponder,
  toolCore,
  grantLedger,
  model: initialModel,
  onDelta,
  onEvent,
  onExit,
  env: inheritedEnv = process.env,
  queryFactory = claudeQuery,
  sdkMcpServerFactory = createSdkMcpServer,
  toolFactory = sdkTool,
  randomUuid = randomUUID,
  orphanDrainTimeoutMs = ORPHAN_DRAIN_TIMEOUT_MS,
  abortBoundaryTimeoutMs = AGENT_CLAUDE_ABORT_BOUNDARY_TIMEOUT_MS,
  approvalPrompt,
} = {}) {
  if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required')
  if (typeof initialModel !== 'string' || !initialModel) throw new TypeError('Claude sdkModel is required')
  if (typeof elicitationResponder?.handle !== 'function') {
    throw new TypeError('elicitationResponder.handle must be a function')
  }
  if (typeof toolCore?.list !== 'function') throw new TypeError('toolCore.list must be a function')
  if (typeof toolCore?.call !== 'function') throw new TypeError('toolCore.call must be a function')
  if (typeof grantLedger?.closeSession !== 'function') {
    throw new TypeError('grantLedger.closeSession must be a function')
  }
  if (typeof grantLedger?.consume !== 'function') {
    throw new TypeError('grantLedger.consume must be a function')
  }
  if (typeof queryFactory !== 'function') throw new TypeError('queryFactory must be a function')
  if (typeof sdkMcpServerFactory !== 'function') throw new TypeError('sdkMcpServerFactory must be a function')
  if (typeof toolFactory !== 'function') throw new TypeError('toolFactory must be a function')

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
  let currentAbort = null
  const retractedPairs = new Set()
  const authorizedCalls = new Map()

  function invalidateToolAuthorizations() {
    toolEpoch += 1
    authorizedCalls.clear()
    grantLedger.closeSession(sessionId)
  }

  function consumeGrant({ nonce, tool, argsHash }) {
    if (!nonEmptyString(nonce) || !nonEmptyString(tool) || !nonEmptyString(argsHash)) return false
    return grantLedger.consume({ nonce, tool, argsHash, sessionId, projectToken })
  }

  function closeQueryOnce() {
    if (!query || queryClosed) return
    // Mark closed only after a successful close so a throwing close() stays retryable
    // instead of silently leaving a live Query reported as sessionClosed.
    query.close()
    queryClosed = true
  }

  function clearOrphanTimer() {
    if (!orphanTimer) return
    clearTimeout(orphanTimer)
    orphanTimer = null
  }

  function clearAbortTimer(transaction) {
    if (transaction?.timer === null) return
    clearTimeout(transaction.timer)
    transaction.timer = null
  }

  function settleAbort(transaction, value, { nextState, closeSession = false }) {
    if (currentAbort !== transaction || transaction.settled) return false
    transaction.settled = true
    clearAbortTimer(transaction)
    currentAbort = null
    state = { kind: nextState }
    if (closeSession) {
      inputQueue.end(steerRefusal(state))
      // abort always resolves after attempting the close; a throwing close stays retryable
      // (closeQueryOnce marks closed only on success) so a later close() can finish teardown.
      try { closeQueryOnce() } catch { /* resolve regardless; retry happens via a later close() */ }
    }
    transaction.resolve(value)
    return true
  }

  function abortFailureValue(transaction, error) {
    return {
      error,
      message: '중단을 완료하지 못해 세션을 닫았습니다.',
      aborted: true,
      phase: transaction.phase,
      turnId: transaction.turnId,
      abortInputId: transaction.abortInputId,
      contextPreserved: false,
      sessionClosed: true,
    }
  }

  function failAbort(transaction, error = 'agent-abort-failed') {
    return settleAbort(transaction, abortFailureValue(transaction, error), {
      nextState: 'closing',
      closeSession: true,
    })
  }

  function createAbortTransaction({ phase, turnId, pending = null, active = null }) {
    let resolve
    const transaction = {
      kind: 'aborting',
      phase,
      turnId,
      pending,
      active,
      remoteStarted: active?.remoteStarted === true,
      abortInputId: null,
      cancelConfirmed: false,
      opaqueBoundarySeen: false,
      timer: null,
      settled: false,
      promise: null,
      resolve: null,
    }
    transaction.promise = new Promise((settle) => { resolve = settle })
    transaction.resolve = resolve
    currentAbort = transaction
    state = transaction
    transaction.timer = setTimeout(() => {
      failAbort(transaction, 'agent-abort-timeout')
    }, abortBoundaryTimeoutMs)
    return transaction
  }

  function settlePendingAbort(pending) {
    const transaction = currentAbort
    if (transaction?.phase !== 'pendingStart' || transaction.pending !== pending) return
    settleAbort(transaction, {
      aborted: true,
      phase: 'pendingStart',
      turnId: transaction.turnId,
      abortInputId: null,
    }, { nextState: 'idle' })
  }

  function settleActiveAbortBoundary(transaction) {
    if (currentAbort !== transaction
      || !transaction.cancelConfirmed
      || !transaction.opaqueBoundarySeen) return
    settleAbort(transaction, {
      aborted: true,
      phase: 'active',
      turnId: transaction.turnId,
      abortInputId: transaction.abortInputId,
      boundaryObserved: true,
      contextPreserved: true,
      sessionClosed: false,
    }, { nextState: 'idle' })
  }

  function cancelPendingStart(pending) {
    if (pending?.kind !== 'pendingStart' || pending.cancelled) return
    pending.cancelled = true
    pending.resolveCancellation()
  }

  function enterOrphanDrain() {
    if (state.kind === 'orphanDrain' || state.kind === 'closing') return
    if (state.kind === 'pendingStart') cancelPendingStart(state)
    invalidateToolAuthorizations()
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
        error: new Error('orphan drain did not settle in time; session closed'),
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
    invalidateToolAuthorizations()
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
    const turn = error
      ? { id: active.turnId, status: 'failed', error }
      : { id: active.turnId, status: 'completed' }
    if (state !== active) return
    state = { kind: 'idle' }
    turnEpoch += 1
    invalidateToolAuthorizations()
    if (error) closeOpenToolsAsFailed(active)
    onEvent?.({ method: 'turn/completed', params: { turn } })
  }

  function mapSdkMessage(message) {
    // State/epoch ownership is checked before parsing.
    if (state.kind === 'closing') return
    if (state.kind === 'aborting') {
      if (state.phase === 'active'
        && state.remoteStarted
        && message?.type === 'result') {
        state.opaqueBoundarySeen = true
        settleActiveAbortBoundary(state)
      }
      return
    }
    if (state.kind !== 'active' && Object.hasOwn(state, 'remoteStarted')) {
      closeInvalidRemoteStartState()
      return
    }
    if (state.kind === 'orphanDrain') {
      if (message?.type === 'result') closeOrphanDrain()
      return
    }
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
      if (state.kind === 'aborting') {
        failAbort(state)
        onExit?.({
          provider: 'claude',
          code: null,
          signal: null,
          error: null,
          reason: 'stream-ended',
        })
        return
      }
      if (state.kind !== 'closing') {
        clearOrphanTimer()
        // §5.4 step 6: a terminal transition must invalidate live tool authorizations before
        // any late handler can run, otherwise the handler's turn/epoch check is the sole defense.
        invalidateToolAuthorizations()
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
      if (state.kind === 'aborting') {
        failAbort(state)
        onExit?.({ provider: 'claude', code: null, signal: null, error, reason: 'stream-error' })
        return
      }
      if (state.kind !== 'closing') {
        clearOrphanTimer()
        invalidateToolAuthorizations()
        state = { kind: 'closing' }
        inputQueue.end(steerRefusal(state))
        // A throw inside mapSdkMessage (e.g. a renderer callback) leaves the SDK query alive.
        // Guard the close so a throwing query.close() cannot suppress the onExit settlement.
        try { closeQueryOnce() } catch { /* still report the terminal below */ }
        onExit?.({ provider: 'claude', code: null, signal: null, error, reason: 'stream-error' })
      }
    }
  }

  async function doOpen() {
    if (state.kind === 'closing') throw new Error('Claude orchestrator is closed')
    const appTools = toolCore.list()
    const registeredTools = appTools.map((record) => {
      const validator = record.inputSchema ? zodFromJson(record.inputSchema) : null
      // §5.4 fail-closed: only object schemas expose a `.shape` that can carry the reserved
      // carriers. A record/union/primitive top-level schema would register as carrier-only and
      // strip the model's real args (R runs on {}, G/B always mismatch). Refuse rather than corrupt.
      if (validator && (!validator.shape || typeof validator.shape !== 'object')) {
        throw new Error(`Claude MCP tool ${record.name} has a non-object schema that cannot preserve reserved carriers`)
      }
      return { record, validator }
    })
    const toolByName = new Map(registeredTools.map((entry) => [entry.record.name, entry]))

    const deny = (message = '도구 사용이 거부되었습니다.') => ({ behavior: 'deny', message })
    const activeMatches = (turnId, expectedToolEpoch) => (
      state.kind === 'active'
      && state.turnId === turnId
      && state.toolEpoch === expectedToolEpoch
    )
    const cleanHandlerInput = (input) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { args: {}, callToken: null, grantNonce: null }
      }
      const callToken = input[CALL_TOKEN_FIELD]
      const grantNonce = input[GRANT_NONCE_FIELD]
      const args = { ...input }
      delete args[CALL_TOKEN_FIELD]
      delete args[GRANT_NONCE_FIELD]
      return { args, callToken, grantNonce }
    }
    const staleMcpResult = () => ({ content: toMcpContent(STALE_TOOL_RESULT) })

    const sdkTools = registeredTools.map(({ record, validator }) => {
      const rawShape = validator?.shape && typeof validator.shape === 'object'
        ? validator.shape
        : {}
      const inputShape = { ...rawShape, ...carrierShape }

      const handler = async (input = {}) => {
        const { args, callToken, grantNonce } = cleanHandlerInput(input)
        const authorization = nonEmptyString(callToken) ? authorizedCalls.get(callToken) : null
        if (authorization) authorizedCalls.delete(callToken)

        // Every permission (R included) binds the token to its tool + cleaned-args hash so a
        // token approved for one tool/args can never run a different tool or altered args. A
        // separate permission check would be redundant: a token minted for tool X carries X's
        // permission and only its own handler ever sees it, so tool-name equality implies it.
        const grantMatches = authorization?.tool === record.name
          && authorization?.argsHash === hashArgs(args)
        if (!authorization
          || !activeMatches(authorization.turnId, authorization.toolEpoch)
          || !grantMatches) {
          // Burn any G/B grant this call could consume — keyed on the authorization's own nonce
          // (a stale/misrouted grant) or the nonce the model presented, never the destination
          // record's permission (which misses a G/B grant routed to an R handler).
          const exactGrant = authorization?.nonce
            ? { nonce: authorization.nonce, tool: authorization.tool, argsHash: authorization.argsHash }
            : (nonEmptyString(grantNonce)
                ? { nonce: grantNonce, tool: record.name, argsHash: hashArgs(args) }
                : null)
          if (exactGrant) consumeGrant(exactGrant)
          return staleMcpResult()
        }

        const context = record.permission === 'R'
          ? {}
          : { nonce: authorization.nonce }
        const result = await toolCore.call(record.name, args, context)
        return { content: toMcpContent(result) }
      }

      return toolFactory(
        record.name,
        record.description ?? record.name,
        inputShape,
        handler,
      )
    })

    const sdkMcpServer = sdkMcpServerFactory({
      name: AGENT_MCP_SERVER_NAME,
      version: SDK_MCP_VERSION,
      tools: sdkTools,
      alwaysLoad: true,
    })
    const claudeToolPermissionGate = async (sdkToolName, input, permissionContext = {}) => {
      // The SDK callback carries no turn id. Only the synchronously observed active owner is valid.
      if (state.kind !== 'active') return deny('진행 중인 턴이 없어 도구 요청을 처리할 수 없습니다.')
      const turnId = state.turnId
      const expectedToolEpoch = state.toolEpoch
      const callToken = randomUuid()
      const canonicalName = nonEmptyString(sdkToolName) && sdkToolName.startsWith(SDK_TOOL_PREFIX)
        ? sdkToolName.slice(SDK_TOOL_PREFIX.length)
        : null
      const registered = canonicalName ? toolByName.get(canonicalName) : null
      const record = registered?.record
      if (!record
        || !input
        || typeof input !== 'object'
        || Array.isArray(input)
        || Object.hasOwn(input, CALL_TOKEN_FIELD)
        || Object.hasOwn(input, GRANT_NONCE_FIELD)
        || !['R', 'G', 'B'].includes(record.permission)
        || (registered.validator && !registered.validator.safeParse(input).success)
        || permissionContext.signal?.aborted) {
        return deny('허용되지 않은 도구 요청입니다.')
      }

      if (record.permission === 'R') {
        authorizedCalls.set(callToken, {
          turnId,
          toolEpoch: expectedToolEpoch,
          permission: 'R',
          tool: canonicalName,
          argsHash: hashArgs(input),
        })
        return {
          behavior: 'allow',
          updatedInput: { ...input, [CALL_TOKEN_FIELD]: callToken },
        }
      }

      const nonce = randomUuid()
      const argsHash = hashArgs(input)
      let permissionResult
      try {
        permissionResult = await elicitationResponder.handle({
          serverName: AGENT_MCP_SERVER_NAME,
          message: encodeApprovalPayload(canonicalName, input),
          _meta: { nonce, tool: canonicalName, argsHash },
        }, {
          requestId: permissionContext.requestId,
          turnId,
        })
      } catch {
        return deny('도구 승인 처리에 실패했습니다.')
      }

      if (permissionResult?.action !== 'accept') {
        return deny('도구 사용이 승인되지 않았습니다.')
      }
      if (!activeMatches(turnId, expectedToolEpoch) || permissionContext.signal?.aborted) {
        consumeGrant({ nonce, tool: canonicalName, argsHash })
        return deny('승인 시점의 작업이 종료되어 도구를 실행하지 않았습니다.')
      }

      authorizedCalls.set(callToken, {
        turnId,
        toolEpoch: expectedToolEpoch,
        permission: record.permission,
        nonce,
        tool: canonicalName,
        argsHash,
      })
      return {
        behavior: 'allow',
        updatedInput: {
          ...input,
          [CALL_TOKEN_FIELD]: callToken,
          [GRANT_NONCE_FIELD]: nonce,
        },
      }
    }
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
    } finally {
      settlePendingAbort(pending)
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

  async function continueActiveAbort(transaction) {
    try {
      const receipt = await inputQueue.write({
        type: 'user',
        uuid: transaction.abortInputId,
        priority: 'now',
        message: { role: 'user', content: AGENT_CLAUDE_ABORT_PAYLOAD },
      }, {
        guard: () => (state === transaction ? null : steerRefusal(state)),
      })
      if (currentAbort !== transaction) return
      if (!receipt.written) {
        failAbort(transaction)
        return
      }

      const cancelled = await query.cancelAsyncMessage(transaction.abortInputId)
      if (currentAbort !== transaction) return
      if (cancelled !== true) {
        settleAbort(transaction, {
          aborted: true,
          phase: 'active',
          turnId: transaction.turnId,
          abortInputId: transaction.abortInputId,
          contextPreserved: false,
          sessionClosed: true,
          reason: 'abort-cancel-unconfirmed',
        }, { nextState: 'closing', closeSession: true })
        return
      }
      transaction.cancelConfirmed = true
      settleActiveAbortBoundary(transaction)
    } catch {
      failAbort(transaction)
    }
  }

  function abort() {
    if (state.kind === 'aborting') return state.promise
    if (state.kind === 'idle') return Promise.resolve({ aborted: false, reason: 'idle' })
    if (state.kind === 'orphanDrain') {
      clearOrphanTimer()
      state = { kind: 'closing' }
      turnEpoch += 1
      inputQueue.end(steerRefusal(state))
      try { closeQueryOnce() } catch { /* abort never rejects */ }
      return Promise.resolve({
        aborted: true,
        phase: 'orphanDrain',
        turnId: null,
        abortInputId: null,
        sessionClosed: true,
        reason: 'orphan-drain-close',
      })
    }
    if (state.kind === 'pendingStart') {
      const pending = state
      const transaction = createAbortTransaction({
        phase: 'pendingStart',
        turnId: pending.turnId,
        pending,
      })
      cancelPendingStart(pending)
      turnEpoch += 1
      try {
        invalidateToolAuthorizations()
      } catch {
        failAbort(transaction)
      }
      return transaction.promise
    }
    if (state.kind === 'closing') {
      return Promise.resolve({ aborted: false, reason: 'closing' })
    }
    if (state.kind !== 'active') {
      return Promise.resolve({ aborted: false, reason: 'idle' })
    }

    const active = state
    const transaction = createAbortTransaction({
      phase: 'active',
      turnId: active.turnId,
      active,
    })
    turnEpoch += 1

    let setupFailed = false
    try {
      const approvalClose = approvalPrompt?.closeSession?.(sessionId)
      if (approvalClose && typeof approvalClose.then === 'function') {
        Promise.resolve(approvalClose).catch(() => { failAbort(transaction) })
      }
    } catch {
      setupFailed = true
    }
    try {
      invalidateToolAuthorizations()
    } catch {
      setupFailed = true
    }
    try {
      closeOpenToolsAsFailed(active, {
        error: 'agent-turn-aborted',
        message: 'Claude turn이 중단되어 도구 호출이 종료되었습니다.',
      })
    } catch {
      setupFailed = true
    }
    try {
      onEvent?.({
        method: 'turn/completed',
        params: { turn: { id: active.turnId, status: 'aborted' } },
      })
    } catch {
      setupFailed = true
    }

    if (setupFailed) {
      failAbort(transaction)
      return transaction.promise
    }
    if (!transaction.remoteStarted) {
      settleAbort(transaction, {
        aborted: true,
        phase: 'active',
        turnId: active.turnId,
        abortInputId: null,
        contextPreserved: false,
        sessionClosed: true,
        reason: 'abort-before-remote-start',
      }, { nextState: 'closing', closeSession: true })
      return transaction.promise
    }
    if (!cancelAsyncMessageCapable) {
      settleAbort(transaction, {
        aborted: true,
        phase: 'active',
        turnId: active.turnId,
        abortInputId: null,
        contextPreserved: false,
        sessionClosed: true,
        reason: 'abort-cancel-unavailable',
      }, { nextState: 'closing', closeSession: true })
      return transaction.promise
    }

    try {
      transaction.abortInputId = randomUuid()
      void continueActiveAbort(transaction)
    } catch {
      failAbort(transaction)
    }
    return transaction.promise
  }

  function close() {
    if (closePromise) return closePromise
    let resolveClose, rejectClose
    closePromise = new Promise((resolve, reject) => { resolveClose = resolve; rejectClose = reject })
    const previous = state
    let closeError = null
    if (previous.kind === 'pendingStart') cancelPendingStart(previous)
    state = { kind: 'closing' }
    turnEpoch += 1
    try {
      invalidateToolAuthorizations()
    } catch (error) {
      closeError = error
    }
    clearOrphanTimer()
    if (previous.kind === 'aborting') {
      settleAbort(previous, {
        aborted: true,
        phase: previous.phase,
        turnId: previous.turnId,
        abortInputId: previous.abortInputId,
        sessionClosed: true,
        reason: 'session-close',
      }, { nextState: 'closing' })
    }
    try {
      inputQueue.end(steerRefusal(state))
    } catch (error) {
      closeError ||= error
    }
    try {
      if (previous.kind === 'active') {
        closeOpenToolsAsFailed(previous, {
          error: 'agent-session-closed',
          message: 'Claude 세션이 닫혀 도구 호출이 종료되었습니다.',
        })
      }
    } catch (error) {
      closeError ||= error
    }
    try {
      closeQueryOnce()
    } catch (error) {
      closeError ||= error
    }
    const settled = closePromise
    if (closeError) {
      // A failed transport close leaves a live Query. Drop the cached rejection so a later
      // close() retries the still-open Query instead of reporting a permanent zombie.
      if (!queryClosed) closePromise = null
      rejectClose(closeError)
    } else {
      resolveClose({ closed: true })
    }
    return settled
  }

  return { open, send, steer, abort, close }
}

export default { createClaudeOrchestrator }
