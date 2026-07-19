import { randomUUID } from 'node:crypto'
import { createClaudeOrchestrator } from './claudeOrchestrator.js'
import { createCodexOrchestrator } from './codexOrchestrator.js'
import { createElicitationResponder } from './elicitationResponder.js'
import { createPrivateRpc } from './privateRpc.js'
import { createToolCore } from './toolCore.js'
import {
  AGENT_CLAUDE_ABORT_BOUNDARY_TIMEOUT_MS,
  AGENT_MCP_SERVER_NAME,
  AGENT_SESSION_MAX_MS,
  AGENT_SESSION_MAX_TOOL_CALLS,
  AGENT_SESSION_MAX_TURNS,
} from './constants.js'

/**
 * 앱 수명 controller. 실행 자원은 `open()` 전에는 만들지 않아 agent를 쓰지 않는 부팅에
 * loopback port나 child가 생기지 않게 한다.
 *
 * 🔴 grantLedger/approvalPrompt/toolBridge/storyCommands는 앱 범위지만 sessionId/toolCore/provider 자원/
 * responder/orchestrator는 세션 범위다. RPC의 `close()`는 되돌릴 수 없고 Tool Core와 responder는
 * sessionId를 생성 시 고정하므로, 이 묶음을 재사용하면 두 번째 open이 죽거나 이전 grant identity를
 * 공유한다. 그래서 매 open마다 묶음을 새로 만들고 이 manager가 private RPC를 직접 닫는다.
 * orchestrator는 RPC를 빌릴 뿐 소유하지 않는다.
 */
export function createAgentSessionManager({
  grantLedger,
  approvalPrompt,
  toolBridge,
  storyCommands,
  modelCatalog,
  // D11 이미지 decode seam(main nativeImage). get_scene_images 가 쓴다. 없으면 그 툴만 못 돈다.
  imageReader = null,
  // slice 33 visual review durable store. 없으면 review 툴만 못 돈다.
  visualReviewStore = null,
  isPackaged = false,
  resourcesPath = process.resourcesPath,
  onDelta,
  onEvent,
  onExit,
  onError,
  onUsage,
  now = () => Date.now(),
  maxSessionMs = AGENT_SESSION_MAX_MS,
  maxTurns = AGENT_SESSION_MAX_TURNS,
  maxToolCalls = AGENT_SESSION_MAX_TOOL_CALLS,
  randomUUIDImpl = randomUUID,
  createToolCoreImpl = createToolCore,
  createPrivateRpcImpl = createPrivateRpc,
  createElicitationResponderImpl = createElicitationResponder,
  createClaudeOrchestratorImpl = createClaudeOrchestrator,
  createCodexOrchestratorImpl = createCodexOrchestrator,
  orchestratorOptions = {},
} = {}) {
  if (typeof modelCatalog?.list !== 'function') throw new TypeError('modelCatalog.list is required')
  if (typeof modelCatalog?.snapshot !== 'function') throw new TypeError('modelCatalog.snapshot is required')

  let current = null
  let reservationSequence = 0

  const CANCELLED = Symbol('agent-send-cancelled')
  const CLOSING_REFUSAL = {
    error: 'agent-session-closing',
    message: '세션을 닫는 중입니다.',
    turnId: null,
  }

  function replaceRunState(session, kind, fields = {}) {
    if (session.provider !== 'codex') throw new Error('replaceRunState is codex-only; claude uses a nested authority cell')
    // Codex flat cell 전용이다. Claude nested cell은 orchestrator가 authority라 이 함수에 넘기지 않는다.
    const runState = session.runState
    const steerEpoch = fields.steerEpoch ?? runState.steerEpoch ?? 0
    const toolEpoch = fields.toolEpoch ?? runState.toolEpoch ?? 0
    for (const key of Object.keys(runState)) delete runState[key]
    Object.assign(runState, { kind, turnId: null, steerEpoch, toolEpoch, ...fields })
    return runState
  }

  function runStateView(session) {
    const state = session.provider === 'claude' ? session.runState?.state : session.runState
    return { kind: state?.kind, turnId: state?.turnId ?? null }
  }

  function busyRefusal(runState) {
    switch (runState?.kind) {
      case 'pendingStart':
        return {
          error: 'agent-busy',
          message: '새 작업을 시작하는 중입니다. 잠시 후 다시 시도해 주세요.',
          turnId: runState.turnId,
        }
      case 'active':
        return {
          error: 'agent-busy',
          message: '에이전트가 이미 작업 중입니다. 진행 중인 턴에는 Steer를 사용해 주세요.',
          turnId: runState.turnId,
        }
      case 'aborting':
        return {
          error: 'agent-busy',
          message: '중단 처리 중입니다. 완료될 때까지 기다려 주세요.',
          turnId: null,
        }
      case 'orphanDrain':
        return {
          error: 'agent-busy',
          message: '이전 교정 입력을 정리 중입니다. 잠시 후 다시 시도해 주세요.',
          turnId: null,
        }
      case 'closing':
        return CLOSING_REFUSAL
      default:
        return null
    }
  }

  function steerRefusal(runState) {
    switch (runState?.kind) {
      case 'active':
        return null
      case 'pendingStart':
        return {
          error: 'agent-steer-not-started',
          message: '새 작업을 시작하는 중이라 아직 수정할 턴이 없습니다.',
          turnId: null,
        }
      case 'aborting':
        return {
          error: 'agent-steer-stale',
          message: '중단 처리 중에는 수정할 수 없습니다.',
          turnId: null,
        }
      case 'orphanDrain':
        return {
          error: 'agent-steer-unavailable',
          message: '이전 교정 입력을 정리 중입니다.',
          turnId: null,
        }
      case 'closing':
        return CLOSING_REFUSAL
      default:
        return {
          error: 'agent-steer-unavailable',
          message: '진행 중인 턴이 없습니다.',
          turnId: null,
        }
    }
  }

  function createReservation(session) {
    let resolveCancellation
    let resolveStartSettled
    const turnId = `${session.sessionId}:pending:${++reservationSequence}`
    return {
      kind: 'pendingStart',
      turnId,
      token: Symbol(turnId),
      sessionToken: session.sessionToken,
      cancelled: false,
      sdkTurnId: null,
      completedTurnIds: new Set(),
      cancellation: new Promise((resolve) => { resolveCancellation = resolve }),
      resolveCancellation,
      startSettled: new Promise((resolve) => { resolveStartSettled = resolve }),
      resolveStartSettled,
      startDidSettle: false,
    }
  }

  function cancelReservation(reservation) {
    if (reservation.cancelled) return
    reservation.cancelled = true
    reservation.resolveCancellation()
  }

  function settleStart(reservation) {
    if (reservation.startDidSettle) return false
    reservation.startDidSettle = true
    reservation.resolveStartSettled()
    return true
  }

  function ownsReservation(session, reservation, ...kinds) {
    return current === session
      && reservation.sessionToken === session.sessionToken
      && session.runState.reservation === reservation
      && kinds.includes(session.runState.kind)
  }

  function cancelledSend(reservation) {
    return {
      error: 'agent-send-cancelled',
      message: '전송이 중단되었습니다.',
      turnId: reservation.turnId,
    }
  }

  function modelUnavailable(reservation) {
    return {
      error: 'agent-model-unavailable',
      message: '선택한 모델을 사용할 수 없습니다.',
      turnId: reservation.turnId,
    }
  }

  function providerSwitchRequired(reservation) {
    return {
      error: 'provider-switch-required',
      message: '모델 제공자를 바꾸려면 새 세션을 시작해 주세요.',
      turnId: reservation.turnId,
    }
  }

  function finishPending(session, reservation, result) {
    settleStart(reservation)
    if (session.provider === 'claude') {
      session.orchestrator.settlePendingAbort?.(reservation)
      // A pre-delegate refusal (D2 provider-switch, model-unavailable, invalid sdkModel,
      // turn-limit, or a thrown list()) unwinds here WITHOUT an abort transaction, so
      // settlePendingAbort is a no-op. Reset the nested cell to idle so the stale reservation
      // does not wedge the session at pendingStart (every later send would return agent-busy and
      // Stop would only close the session). Identity-guard so we never clobber an abort
      // transaction that already replaced the reservation.
      if (session.runState.state === reservation) {
        session.runState.state = { kind: 'idle' }
      }
      return result
    }
    if (ownsReservation(session, reservation, 'pendingStart')) {
      replaceRunState(session, 'idle')
      return result
    }
    if (ownsReservation(session, reservation, 'aborting')) {
      settleAbort(session, session.runState.abortToken, {
        aborted: true,
        phase: 'pendingStart',
        turnId: reservation.turnId,
        abortInputId: null,
      }, 'idle')
    }
    return result
  }

  function reservationWasCancelled(session, reservation) {
    if (current !== session
      || reservation.sessionToken !== session.sessionToken
      || reservation.cancelled) return true
    if (session.provider === 'claude') return session.runState.state !== reservation
    return !ownsReservation(session, reservation, 'pendingStart')
  }

  async function waitForReservation(reservation, promise) {
    return Promise.race([
      Promise.resolve(promise),
      reservation.cancellation.then(() => CANCELLED),
    ])
  }

  function releaseActive(session, reservation) {
    if (!ownsReservation(session, reservation, 'active')) return false
    replaceRunState(session, 'idle')
    return true
  }

  function observeEvent(session, event) {
    if (session.provider === 'codex') {
      const completedTurnId = event?.method === 'turn/completed' ? event?.params?.turn?.id : null
      if (completedTurnId) {
        const runState = session.runState
        const reservation = runState.reservation
        if (runState.kind === 'active' && reservation) {
          if (reservation.sdkTurnId) {
            if (completedTurnId === reservation.sdkTurnId) releaseActive(session, reservation)
          } else {
            // Codex stdout may report completion before turn/start's request promise resolves.
            reservation.completedTurnIds.add(completedTurnId)
          }
        }
      }
    }
    // 통지 throw가 event 처리를 끊으면 안 된다(다른 forward 콜백과 같은 resilience).
    try { onEvent?.(event) } catch { /* notification failure must not break the session */ }
  }

  function status() {
    if (!current) return { state: 'idle', sessionId: null }
    return {
      state: current.state,
      sessionId: current.sessionId,
      startedAt: current.startedAt,
      turns: current.turns,
      toolCalls: current.toolCalls,
    }
  }

  function usage(session) {
    return {
      sessionId: session.sessionId,
      turns: session.turns,
      toolCalls: session.toolCalls,
      elapsedMs: Math.max(0, now() - session.startedAt),
    }
  }

  function reportLimit(session, limit, used, extra = {}) {
    const refusal = { error: 'agent-limit', limit, used, ...extra }
    // slice 3은 이 callback을 `agent:error`로 보낸다. return value와 event 둘 다 있어야 어느 caller도
    // 조용한 `{success:false}`처럼 버리지 못하고 ChatPanel에 같은 structured failure를 올릴 수 있다.
    // 🔴 renderer 통지(webContents.send)가 throw해도 admission flow(caller의 refusal 반환·정산·
    //    wall-clock의 closeSession)가 끊기면 안 된다 — reservation이 pendingStart에 갇혀 wedge된다.
    try { onError?.(refusal) } catch { /* notification failure must not break admission/cleanup */ }
    return refusal
  }

  function admitWallClock(session) {
    const used = Math.max(0, now() - session.startedAt)
    if (used < maxSessionMs) return null

    // wall-clock 한도는 turn/tool-count 한도와 달리 세션을 닫는다. renderer가 ref를 내려 다음 Send가
    // 재open하게 sessionClosed를 실어 보낸다(turn/tool 한도는 세션을 안 닫으므로 이 플래그가 없다).
    const refusal = reportLimit(session, maxSessionMs, used, { sessionClosed: true })
    // admission은 Tool Core 진입에서 동기여야 하지만, 거부된 세션의 child/port를 남겨두면
    // 다시는 일할 수 없는 zombie가 된다. 거부값은 즉시 돌려주고 멱등 close는 백그라운드에서 정산한다.
    closeSession(session).catch(() => {})
    return refusal
  }

  function admitTurn(session) {
    const wallRefusal = admitWallClock(session)
    if (wallRefusal) return wallRefusal
    if (session.turns >= maxTurns) return reportLimit(session, maxTurns, session.turns)

    // 한 turn은 app-server wire의 `turn/start`→`turn/completed` 한 쌍이다. 사용자 입력과 모델 작업을
    // 합친 공급자 공통 단위이므로 send admission에서 정확히 1회 센다. 완료/성공 뒤에 세면 실패·abort
    // turn이 공짜가 되어 무한 재시도가 가능해진다. 64번째는 여기서 64가 되고 65번째가 거부된다.
    session.turns += 1
    try { onUsage?.(usage(session)) } catch { /* notification failure must not break admission */ }
    return null
  }

  function admitToolCall(session) {
    const wallRefusal = admitWallClock(session)
    if (wallRefusal) return wallRefusal
    if (session.toolCalls >= maxToolCalls) {
      return reportLimit(session, maxToolCalls, session.toolCalls)
    }

    // Tool Core call 진입은 실제 invoke와 1:1이다. await 전에 동기로 올려 병렬 호출도 각각 1회다.
    session.toolCalls += 1
    try { onUsage?.(usage(session)) } catch { /* notification failure must not break admission */ }
    return null
  }

  async function open(model) {
    // close 정산 전에 예전 openPromise를 재사용하면 닫힌 identity를 새 세션처럼 돌려준다.
    // 닫기 실패는 closeSession이 current를 비운 뒤 전파하므로, 여기서는 정산만 기다리고 새 open을 계속한다.
    if (current?.closePromise) await current.closePromise.catch(() => {})
    if (current) return current.openPromise

    const snap = modelCatalog.snapshot()
    const defaultRow = snap.rows.find((row) => row.id === snap.defaultId)
    if (!defaultRow) throw new Error('agent-model-unavailable')
    const initialRow = model
      ? snap.rows.find((row) => row.id === model)
      : defaultRow
    if (!initialRow) throw new Error('agent-model-unavailable')
    if (initialRow.provider !== 'codex' && initialRow.provider !== 'claude') {
      throw new Error('agent-model-unavailable')
    }
    if (typeof initialRow.sdkModel !== 'string' || initialRow.sdkModel.trim().length === 0) {
      throw new Error('agent-model-unavailable')
    }
    const defaultPin = {
      id: defaultRow.id,
      provider: defaultRow.provider,
      sdkModel: defaultRow.sdkModel,
      defaultFallbackFrom: defaultRow.defaultFallbackFrom ?? null,
    }
    if (!snap.cacheReady) defaultPin.fallbackReason = 'catalog-cold'

    const sessionId = randomUUIDImpl()
    // renderer의 abort/close보다 story:open이 먼저 끝나는 전환 창이 있다. 세션이 시작된 프로젝트를
    // 여기서 값으로 고정해야 이후 machine 교체가 같은 Tool Core의 실행 대상을 몰래 바꾸지 못한다.
    const projectToken = storyCommands?.projectToken ?? null
    const session = {
      sessionId,
      sessionToken: Symbol(sessionId),
      provider: initialRow.provider,
      defaultPin,
      projectToken,
      startedAt: now(),
      turns: 0,
      toolCalls: 0,
      toolCore: null,
      privateRpc: null,
      elicitationResponder: null,
      orchestrator: null,
      state: 'opening',
      runState: { kind: 'idle', turnId: null, steerEpoch: 0, toolEpoch: 0 },
      openPromise: null,
      closePromise: null,
    }
    if (initialRow.provider === 'claude') {
      session.runState = { state: { kind: 'idle' }, turnEpoch: 0, toolEpoch: 0 }
    }
    const toolCore = createToolCoreImpl({
      toolBridge,
      grantLedger,
      sessionId,
      projectToken,
      imageReader,
      visualReviewStore,
      admitToolCall: () => admitToolCall(session),
    })
    toolCore.use(storyCommands)
    const privateRpc = initialRow.provider === 'codex'
      ? createPrivateRpcImpl({ toolCore, sessionId })
      : null
    const elicitationResponder = createElicitationResponderImpl({
      grantLedger,
      sessionId,
      projectToken,
      adapterServerName: AGENT_MCP_SERVER_NAME,
      askUser: (params, ctx) => approvalPrompt.ask(params, ctx),
    })
    const lifecycleCallbacks = {
      onDelta: (delta) => { try { onDelta?.(delta) } catch { /* notification failure must not break streaming */ } },
      onEvent: (event) => observeEvent(session, event),
      onExit: (details) => {
        // child가 스스로 죽어도 borrowed RPC와 세션 grant/prompt는 manager가 끝까지 거둔다.
        const exitedSession = current?.sessionId === sessionId ? current : null
        // manager가 세션을 닫는지의 진실 소유자는 여기다(orchestrator의 per-path 플래그가 아니라).
        // current 세션의 어떤 exit(crash/stream-ended/stream-error/orphan-drain)든 세션을 닫으므로
        // renderer가 sessionOpenRef를 내려 다음 Send가 재open하게 sessionClosed를 실어 보낸다.
        // stale 세션의 늦은 exit(exitedSession==null)은 current 세션을 안 닫으니 강제하지 않는다.
        // 🔴 renderer 통지(webContents.send)가 throw해도 아래 closeSession은 반드시 돌아야 한다 —
        //    cleanup이 load-bearing이고, 안 돌면 current가 남아 세션이 wedge된다. 통지를 가드한다.
        try {
          onExit?.({ ...details, sessionClosed: (details?.sessionClosed === true) || exitedSession != null })
        } catch { /* run cleanup below regardless of a throwing renderer notification */ }
        if (exitedSession) closeSession(exitedSession).catch(() => {})
      },
    }
    const orchestrator = initialRow.provider === 'codex'
      ? createCodexOrchestratorImpl({
          ...orchestratorOptions,
          model: initialRow.sdkModel,
          elicitationResponder,
          privateRpc,
          toolCore,
          isPackaged,
          resourcesPath,
          ...lifecycleCallbacks,
        })
      : createClaudeOrchestratorImpl({
          sessionId,
          projectToken,
          elicitationResponder,
          toolCore,
          grantLedger,
          model: initialRow.sdkModel,
          runState: session.runState,
          approvalPrompt,
          ...lifecycleCallbacks,
        })
    Object.assign(session, { toolCore, privateRpc, elicitationResponder, orchestrator })
    current = session
    session.openPromise = (async () => {
      try {
        const opened = await orchestrator.open()
        session.state = 'open'
        return { sessionId, ...opened, defaultPin: session.defaultPin }
      } catch (error) {
        await closeSession(session)
        throw error
      }
    })()
    return session.openPromise
  }

  function closeSession(session) {
    if (session.closePromise) return session.closePromise
    session.state = 'closing'
    if (session.provider === 'codex') {
      const previousRunState = { ...session.runState }
      if (previousRunState.reservation) cancelReservation(previousRunState.reservation)
      clearTimeout(previousRunState.timer)
      replaceRunState(session, 'closing', {
        reservation: previousRunState.reservation ?? null,
      })
      if (previousRunState.kind === 'aborting') {
        previousRunState.resolveAbort?.({
          aborted: true,
          phase: previousRunState.phase,
          turnId: previousRunState.turnId,
          abortInputId: null,
          sessionClosed: true,
          reason: 'session-close',
        })
      }
    }
    session.closePromise = (async () => {
      // app-scoped prompt 자체를 close하면 다음 세션도 영구 decline된다. 현재 세션 pending만 닫는다.
      approvalPrompt?.closeSession?.(session.sessionId)
      const results = await Promise.allSettled([
        session.orchestrator.close(),
        // Codex orchestrator가 빌린 RPC를 닫지 않는 계약이므로 owner인 manager가 반드시 닫는다.
        ...(session.privateRpc ? [session.privateRpc.close()] : []),
      ])
      // toolBridge는 app-scoped라 close할 수 없지만, operation snapshot은 session 경계를 넘기지 않는다.
      toolBridge?.clearOperations?.()
      grantLedger?.closeSession?.(session.sessionId)
      if (current === session) current = null
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) throw failed.reason
      return { sessionId: session.sessionId }
    })()
    return session.closePromise
  }

  function close() {
    if (!current) return Promise.resolve(null)
    return closeSession(current)
  }

  async function withOpenSession(run) {
    const session = current
    if (!session || session.state === 'closing') throw new Error('Agent session is not open')
    await session.openPromise
    if (current !== session || session.state !== 'open') throw new Error('Agent session is not open')
    return run(session)
  }

  function send(text, modelId) {
    const session = current
    if (!session) return Promise.reject(new Error('Agent session is not open'))
    const runState = runStateView(session)
    if (session.state === 'closing' || runState.kind === 'closing') {
      return Promise.resolve(CLOSING_REFUSAL)
    }

    const busy = busyRefusal(runState)
    if (busy) return Promise.resolve(busy)

    const reservation = createReservation(session)
    if (session.provider === 'claude') {
      session.runState.state = reservation
    } else {
      replaceRunState(session, 'pendingStart', {
        turnId: reservation.turnId,
        reservation,
      })
    }

    return (async () => {
      try {
        const opened = await waitForReservation(reservation, session.openPromise)
        if (opened === CANCELLED || reservationWasCancelled(session, reservation)) {
          return finishPending(session, reservation, cancelledSend(reservation))
        }
      } catch {
        cancelReservation(reservation)
        return finishPending(session, reservation, cancelledSend(reservation))
      }

      let row
      if (modelId == null) {
        // 생략은 thread 상속이 아니라 open 때 고정한 앱 Default다. 여기서 catalog를 다시 보면
        // cold session이 warm 뒤 다른 기본으로 조용히 바뀌므로 pin만 복사한다.
        const pin = session.defaultPin
        row = pin
          ? { id: pin.id, provider: pin.provider, sdkModel: pin.sdkModel }
          : null
      } else {
        let rows
        try {
          rows = await waitForReservation(reservation, modelCatalog.list())
          if (rows === CANCELLED || reservationWasCancelled(session, reservation)) {
            return finishPending(session, reservation, cancelledSend(reservation))
          }
        } catch {
          if (reservationWasCancelled(session, reservation)) {
            return finishPending(session, reservation, cancelledSend(reservation))
          }
          return finishPending(session, reservation, modelUnavailable(reservation))
        }
        row = Array.isArray(rows) ? rows.find((candidate) => candidate?.id === modelId) : null
      }

      if (!row) return finishPending(session, reservation, modelUnavailable(reservation))
      if (row.provider !== session.provider) {
        return finishPending(session, reservation, providerSwitchRequired(reservation))
      }
      if (typeof row.sdkModel !== 'string' || row.sdkModel.trim().length === 0) {
        return finishPending(session, reservation, modelUnavailable(reservation))
      }
      if (reservationWasCancelled(session, reservation)) {
        return finishPending(session, reservation, cancelledSend(reservation))
      }

      const refusal = admitTurn(session)
      if (refusal) return finishPending(session, reservation, refusal)
      if (reservationWasCancelled(session, reservation)) {
        return finishPending(session, reservation, cancelledSend(reservation))
      }

      if (session.provider === 'claude') {
        settleStart(reservation)
        const result = await session.orchestrator.send(text, row.sdkModel)
        return result
      }

      replaceRunState(session, 'active', {
        turnId: reservation.turnId,
        reservation,
        remoteStarted: false,
      })
      settleStart(reservation)

      try {
        const result = await session.orchestrator.send(text, row.sdkModel)
        const sdkTurnId = result?.turn?.id
        if (typeof sdkTurnId === 'string' && sdkTurnId.trim().length > 0) {
          reservation.sdkTurnId = sdkTurnId
          if (ownsReservation(session, reservation, 'active')) {
            session.runState.turnId = sdkTurnId
            if (reservation.completedTurnIds.has(sdkTurnId)) releaseActive(session, reservation)
          } else if (ownsReservation(session, reservation, 'aborting')) {
            session.runState.turnId = sdkTurnId
          }
        } else {
          releaseActive(session, reservation)
        }
        return result
      } catch (error) {
        releaseActive(session, reservation)
        throw error
      }
    })()
  }

  function steer(text) {
    const session = current
    if (session && (session.state === 'closing' || runStateView(session).kind === 'closing')) {
      return Promise.resolve(CLOSING_REFUSAL)
    }
    return withOpenSession((session) => {
      // steer는 이미 계상한 active turn에 입력을 보탠다. 교정 자체에 turn budget을 다시 부과하지
      // 않으며 실제 추가 비용은 tool-call과 wall-clock ledger가 계속 센다.
      const refusal = admitWallClock(session)
      if (refusal) return refusal
      if (session.provider === 'claude') return session.orchestrator.steer(text)
      return steerRefusal(runStateView(session)) || session.orchestrator.steer(text)
    })
  }

  function abortFailureValue(runState, error) {
    return {
      error,
      message: '중단을 완료하지 못해 세션을 닫았습니다.',
      aborted: true,
      phase: runState.phase,
      turnId: runState.turnId,
      abortInputId: null,
      contextPreserved: false,
      sessionClosed: true,
    }
  }

  function settleAbort(session, abortToken, value, nextKind) {
    const runState = session.runState
    if (current !== session
      || runState.kind !== 'aborting'
      || runState.abortToken !== abortToken) return false

    const { timer, resolveAbort, reservation } = runState
    clearTimeout(timer)
    if (nextKind === 'closing') {
      replaceRunState(session, 'closing', { reservation: reservation ?? null })
    } else {
      replaceRunState(session, nextKind)
    }
    resolveAbort(value)
    return true
  }

  function driveCloseSession(session) {
    try {
      Promise.resolve(closeSession(session)).catch(() => {})
    } catch {
      // abort public promise는 cleanup 실패와 무관하게 이미 structured value로 정산됐다.
    }
  }

  function failAbort(session, abortToken, error = 'agent-abort-failed') {
    const runState = session.runState
    if (current !== session
      || runState.kind !== 'aborting'
      || runState.abortToken !== abortToken) return false

    const settled = settleAbort(
      session,
      abortToken,
      abortFailureValue(runState, error),
      'closing',
    )
    if (settled) driveCloseSession(session)
    return settled
  }

  function startAbortTimer(session, abortState) {
    const abortToken = abortState.abortToken
    abortState.timer = setTimeout(() => {
      const runState = session.runState
      if (current !== session
        || runState.kind !== 'aborting'
        || runState.abortToken !== abortToken) return
      failAbort(session, abortToken, 'agent-abort-timeout')
    }, AGENT_CLAUDE_ABORT_BOUNDARY_TIMEOUT_MS)
  }

  function abort() {
    // 한도에 닿았어도 안전 제어인 abort는 막지 않는다. runState는 모든 await보다 먼저 읽는다.
    const session = current
    const state = session ? runStateView(session) : null
    if (!session || state.kind === 'idle') {
      return Promise.resolve({ aborted: false, reason: 'idle' })
    }

    // Claude owns its own state machine: delegate every non-idle abort (including closing) so the
    // orchestrator's exact value — e.g. {aborted:false,reason:'closing'} — is returned unchanged.
    if (session.provider === 'claude') {
      const delegated = session.orchestrator.abort()
      Promise.resolve(delegated).then((result) => {
        if (result?.sessionClosed === true) driveCloseSession(session)
      }, () => {})
      return delegated
    }

    if (state.kind === 'closing' || session.state === 'closing') {
      return Promise.resolve({ aborted: false, reason: 'idle' })
    }

    const runState = session.runState
    if (runState.kind === 'aborting') return runState.abortPromise
    if (runState.kind === 'pendingStart') {
      const reservation = runState.reservation
      cancelReservation(reservation)
      let resolveAbort
      const abortPromise = new Promise((resolve) => { resolveAbort = resolve })
      const abortToken = Symbol('agent-abort')
      const abortState = replaceRunState(session, 'aborting', {
        turnId: reservation.turnId,
        reservation,
        phase: 'pendingStart',
        abortToken,
        abortPromise,
        resolveAbort,
        timer: null,
        steerEpoch: runState.steerEpoch + 1,
        toolEpoch: runState.toolEpoch + 1,
      })
      startAbortTimer(session, abortState)
      return abortPromise
    }

    const reservation = runState.reservation ?? null
    let resolveAbort
    const abortPromise = new Promise((resolve) => { resolveAbort = resolve })
    const abortToken = Symbol('agent-abort')
    const abortState = replaceRunState(session, 'aborting', {
      turnId: runState.turnId,
      reservation,
      phase: runState.kind,
      abortToken,
      abortPromise,
      resolveAbort,
      timer: null,
      steerEpoch: runState.steerEpoch + 1,
      toolEpoch: runState.toolEpoch + 1,
    })
    startAbortTimer(session, abortState)

    let delegated
    try {
      // Codex의 inner turnStartPending는 transport guard로 남고 public busy authority는 이 wrapper다.
      delegated = session.orchestrator.abort()
    } catch {
      failAbort(session, abortToken)
      return abortPromise
    }
    Promise.resolve(delegated).then(
      (result) => {
        settleAbort(session, abortToken, result, 'idle')
      },
      () => {
        failAbort(session, abortToken)
      },
    )
    return abortPromise
  }

  return { open, send, steer, abort, close, status }
}

export default { createAgentSessionManager }
