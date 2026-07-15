import { randomUUID } from 'node:crypto'
import { createCodexOrchestrator } from './codexOrchestrator.js'
import { createElicitationResponder } from './elicitationResponder.js'
import { createPrivateRpc } from './privateRpc.js'
import { createToolCore } from './toolCore.js'
import {
  AGENT_MCP_SERVER_NAME,
  AGENT_SESSION_MAX_MS,
  AGENT_SESSION_MAX_TOOL_CALLS,
  AGENT_SESSION_MAX_TURNS,
} from './constants.js'

/**
 * 앱 수명 controller. 실행 자원은 `open()` 전에는 만들지 않아 agent를 쓰지 않는 부팅에
 * loopback port나 child가 생기지 않게 한다.
 *
 * 🔴 grantLedger/approvalPrompt/toolBridge/storyCommands는 앱 범위지만 sessionId/toolCore/RPC/
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
  // D11 이미지 decode seam(main nativeImage). get_scene_images 가 쓴다. 없으면 그 툴만 못 돈다.
  imageReader = null,
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
  createCodexOrchestratorImpl = createCodexOrchestrator,
  orchestratorOptions = {},
} = {}) {
  let current = null

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

  function reportLimit(session, limit, used) {
    const refusal = { error: 'agent-limit', limit, used }
    // slice 3은 이 callback을 `agent:error`로 보낸다. return value와 event 둘 다 있어야 어느 caller도
    // 조용한 `{success:false}`처럼 버리지 못하고 ChatPanel에 같은 structured failure를 올릴 수 있다.
    onError?.(refusal)
    return refusal
  }

  function admitWallClock(session) {
    const used = Math.max(0, now() - session.startedAt)
    if (used < maxSessionMs) return null

    const refusal = reportLimit(session, maxSessionMs, used)
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
    onUsage?.(usage(session))
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
    onUsage?.(usage(session))
    return null
  }

  async function open() {
    // close 정산 전에 예전 openPromise를 재사용하면 닫힌 identity를 새 세션처럼 돌려준다.
    // 닫기 실패는 closeSession이 current를 비운 뒤 전파하므로, 여기서는 정산만 기다리고 새 open을 계속한다.
    if (current?.closePromise) await current.closePromise.catch(() => {})
    if (current) return current.openPromise

    const sessionId = randomUUIDImpl()
    // renderer의 abort/close보다 story:open이 먼저 끝나는 전환 창이 있다. 세션이 시작된 프로젝트를
    // 여기서 값으로 고정해야 이후 machine 교체가 같은 Tool Core의 실행 대상을 몰래 바꾸지 못한다.
    const projectToken = storyCommands?.projectToken ?? null
    const session = {
      sessionId,
      projectToken,
      startedAt: now(),
      turns: 0,
      toolCalls: 0,
      toolCore: null,
      privateRpc: null,
      elicitationResponder: null,
      orchestrator: null,
      state: 'opening',
      openPromise: null,
      closePromise: null,
    }
    const toolCore = createToolCoreImpl({
      toolBridge,
      grantLedger,
      sessionId,
      projectToken,
      imageReader,
      admitToolCall: () => admitToolCall(session),
    })
    toolCore.use(storyCommands)
    const privateRpc = createPrivateRpcImpl({ toolCore, sessionId })
    const elicitationResponder = createElicitationResponderImpl({
      grantLedger,
      sessionId,
      projectToken,
      adapterServerName: AGENT_MCP_SERVER_NAME,
      askUser: (params, ctx) => approvalPrompt.ask(params, ctx),
    })
    const orchestrator = createCodexOrchestratorImpl({
      ...orchestratorOptions,
      elicitationResponder,
      privateRpc,
      toolCore,
      isPackaged,
      resourcesPath,
      onDelta: (delta) => onDelta?.(delta),
      onEvent: (event) => onEvent?.(event),
      onExit: (details) => {
        onExit?.(details)
        // child가 스스로 죽어도 borrowed RPC와 세션 grant/prompt는 manager가 끝까지 거둔다.
        const exitedSession = current?.sessionId === sessionId ? current : null
        if (exitedSession) closeSession(exitedSession).catch(() => {})
      },
    })
    Object.assign(session, { toolCore, privateRpc, elicitationResponder, orchestrator })
    current = session
    session.openPromise = (async () => {
      try {
        const opened = await orchestrator.open()
        session.state = 'open'
        return { sessionId, ...opened }
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
    session.closePromise = (async () => {
      // app-scoped prompt 자체를 close하면 다음 세션도 영구 decline된다. 현재 세션 pending만 닫는다.
      approvalPrompt?.closeSession?.(session.sessionId)
      const results = await Promise.allSettled([
        session.orchestrator.close(),
        // orchestrator가 빌린 RPC를 닫지 않는 계약이므로 owner인 manager가 반드시 닫는다.
        session.privateRpc.close(),
      ])
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

  function send(text) {
    return withOpenSession((session) => {
      const refusal = admitTurn(session)
      return refusal || session.orchestrator.send(text)
    })
  }

  function steer(text) {
    return withOpenSession((session) => {
      // steer는 이미 계상한 active turn에 입력을 보탠다. 교정 자체에 turn budget을 다시 부과하지
      // 않으며 실제 추가 비용은 tool-call과 wall-clock ledger가 계속 센다.
      const refusal = admitWallClock(session)
      return refusal || session.orchestrator.steer(text)
    })
  }

  function abort() {
    // 한도에 닿았어도 안전 제어인 abort는 막지 않는다.
    return withOpenSession((session) => session.orchestrator.abort())
  }

  return { open, send, steer, abort, close, status }
}

export default { createAgentSessionManager }
