import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  AGENT_ADAPTER_APPROVAL_TIMEOUT_MS,
  AGENT_APPROVAL_WINDOW_MS,
  AGENT_MCP_SERVER_NAME,
} from './constants.js'
import { openAppServer, buildOrchestratorThreadParams } from '../api/llm/codexAppServer.js'
import {
  assertCodexChatGptLogin,
  buildCodexClientOptions,
  prepareCodexRuntimeHome,
  prepareCodexWorkingDirectory,
} from '../api/llm/codexSdk.js'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = path.resolve(MODULE_DIR, '..', '..')

export function resolveCodexAdapterPath({
  isPackaged = false,
  resourcesPath = process.resourcesPath,
  repoRoot = DEFAULT_REPO_ROOT,
} = {}) {
  return isPackaged
    ? path.join(resourcesPath, 'agent-adapter', 'codex-adapter.mjs')
    : path.join(repoRoot, 'dist-adapter', 'codex-adapter.mjs')
}

const CLIENT_INFO = { name: 'autoflowcut', title: 'AutoFlowCut', version: '0.0.0' }
const DECLINE = Object.freeze({ action: 'decline', content: {}, _meta: null })

/**
 * 인앱 에이전트용 Codex 지속 세션. story one-shot timeout/lifecycle과 공유하지 않는다.
 * 한 app-server와 thread를 열어 후속 turn 및 active-turn steer를 계속 보낸다.
 */
export function createCodexOrchestrator({
  elicitationResponder,
  privateRpc = null,
  rpcEndpoint = null,
  toolCore = null,
  tools = null,
  approvalTimeoutMs = AGENT_ADAPTER_APPROVAL_TIMEOUT_MS,
  approvalWindowMs = AGENT_APPROVAL_WINDOW_MS,
  adapterPath,
  isPackaged = false,
  resourcesPath = process.resourcesPath,
  repoRoot = DEFAULT_REPO_ROOT,
  model,
  onDelta,
  onEvent,
  onExit,
  env = process.env,
  config = {},
  spawnImpl,
  codexPath,
  authCheck,
  killTimeoutMs,
  existsSyncImpl = existsSync,
  runtimeHomeFactory = prepareCodexRuntimeHome,
  workingDirectoryFactory = prepareCodexWorkingDirectory,
  appServerFactory = openAppServer,
  clientOptionsBuilder = buildCodexClientOptions,
} = {}) {
  if (typeof elicitationResponder?.handle !== 'function') throw new Error('elicitationResponder.handle is required')
  if (!rpcEndpoint && typeof privateRpc?.start !== 'function') throw new Error('privateRpc.start or rpcEndpoint is required')
  if (!Array.isArray(tools) && typeof toolCore?.list !== 'function') throw new Error('toolCore.list or tools is required')
  if (!Number.isFinite(approvalTimeoutMs) || approvalTimeoutMs <= 0) {
    throw new Error('approvalTimeoutMs must be a finite number greater than 0')
  }
  if (!Number.isFinite(approvalWindowMs) || approvalWindowMs <= 0) {
    throw new Error('approvalWindowMs must be a finite number greater than 0')
  }
  if (approvalTimeoutMs <= approvalWindowMs) {
    // adapter 타이머가 먼저 시작되므로 같아도 사람의 승인보다 먼저 만료된다.
    throw new Error('approvalTimeoutMs must be greater than approvalWindowMs')
  }

  const pendingServerRequests = new Map()
  const answeredServerRequestIds = new Set()
  const completedTurnIds = new Set()
  let runtime = null
  let work = null
  let session = null
  let threadId = null
  let activeTurnId = null
  let turnEpoch = 0
  let turnStartPending = false
  let openPromise = null
  let cleanupPromise = null
  let closePromise = null
  let closed = false

  function finishServerRequest(id, payload, { error = false } = {}) {
    if (!pendingServerRequests.has(id)) return false
    pendingServerRequests.delete(id)
    if (!session) return false
    answeredServerRequestIds.add(id)
    return error
      ? session.client.respondError(id, payload)
      : session.client.respond(id, payload)
  }

  function handleServerRequest({ id, method, params }) {
    // Codex가 병렬 호출을 request id로 상관시킨다. nullable turnId는 키가 될 수 없다.
    if (answeredServerRequestIds.has(id) || pendingServerRequests.has(id)) return
    pendingServerRequests.set(id, { method, params })

    if (closed) {
      if (method === 'mcpServer/elicitation/request') finishServerRequest(id, DECLINE)
      else finishServerRequest(id, { code: -32601, message: `Method not found: ${method}` }, { error: true })
      return
    }

    if (method !== 'mcpServer/elicitation/request') {
      finishServerRequest(id, { code: -32601, message: `Method not found: ${method}` }, { error: true })
      return
    }

    Promise.resolve()
      .then(() => {
        if (!pendingServerRequests.has(id)) return null
        return elicitationResponder.handle(params, {
          requestId: id,
          turnId: params?.turnId ?? null,
        })
      })
      .then((result) => {
        if (result) finishServerRequest(id, result)
      })
      // renderer/responder 실패가 Codex의 tool call을 영원히 붙잡지 않게 값으로 닫는다.
      .catch(() => { finishServerRequest(id, DECLINE) })
  }

  function handleNotification(message) {
    const { method, params } = message
    if (method === 'item/agentMessage/delta' && params?.delta) onDelta?.(params.delta)
    if (method === 'turn/completed' && params?.turn?.id) {
      if (params.turn.id === activeTurnId) activeTurnId = null
      // turn/start 응답보다 completed가 먼저 처리되는 stdout race 동안만 기억한다.
      else if (turnStartPending) completedTurnIds.add(params.turn.id)
    }
    onEvent?.(message)
  }

  function handleAppServerExit({ code, signal, error }) {
    const wasClosed = closed
    closed = true
    activeTurnId = null
    answerPendingRequests()
    if (!wasClosed) {
      // Codex notification과 process lifecycle을 섞으면 미래의 같은 method가 live session을 닫는다.
      onExit?.({ code, signal, error })
    }
  }

  function answerPendingRequests() {
    for (const [id, request] of [...pendingServerRequests]) {
      if (request.method === 'mcpServer/elicitation/request') finishServerRequest(id, DECLINE)
      else finishServerRequest(
        id,
        { code: -32601, message: `Method not found: ${request.method}` },
        { error: true },
      )
    }
  }

  function cleanupResources() {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      // 늦게 끝나는 turn/start가 close 뒤 active turn을 다시 설치하지 못하게 세대를 폐기한다.
      turnEpoch += 1
      if (session && threadId && activeTurnId) {
        // close는 interrupt frame을 먼저 쓴 뒤 pending 승인을 닫는다. 응답 대기는 child 종료가 책임진다.
        session.client.request('turn/interrupt', { threadId }).catch(() => {})
      }
      activeTurnId = null
      answerPendingRequests()
      // transport가 살아 있는 close 창에서는 응답 id를 유지한다. 여기서 비우면 같은 요청의 재전달이
      // 앞단 dedupe를 통과해 불필요한 두 번째 응답을 시도한다. child가 끝난 뒤에만 아래에서 비운다.
      await session?.close()
      session = null
      pendingServerRequests.clear()
      answeredServerRequestIds.clear()
      await runtime?.cleanup?.()
      runtime = null
      await work?.cleanup?.()
      work = null
    })()
    return cleanupPromise
  }

  async function doOpen() {
    if (closed) throw new Error('Codex orchestrator is closed')
    try {
      const executable = path.resolve(adapterPath || resolveCodexAdapterPath({ isPackaged, resourcesPath, repoRoot }))
      // dev에는 source tree가 있어도 배포 번들이 빠질 수 있다. spawn 오류로 늦게 숨기지 않는다.
      if (!existsSyncImpl(executable)) throw new Error(`Codex adapter bundle not found: ${executable}`)
      work = await workingDirectoryFactory()
      runtime = await runtimeHomeFactory({ env })
      const endpoint = rpcEndpoint || await privateRpc.start()
      const toolTable = Array.isArray(tools) ? tools : toolCore.list()
      const clientOptions = clientOptionsBuilder({
        env: runtime.env,
        config,
        runtimeProfile: 'orchestrator',
        mcpServers: {
          [AGENT_MCP_SERVER_NAME]: {
            command: process.execPath,
            args: [executable],
            env: {
              ELECTRON_RUN_AS_NODE: '1',
              AUTOFLOWCUT_RPC_URL: `http://${endpoint.host}:${endpoint.port}`,
              AUTOFLOWCUT_RPC_TOKEN: endpoint.token,
              AUTOFLOWCUT_TOOLS: JSON.stringify(toolTable),
              AUTOFLOWCUT_APPROVAL_TIMEOUT_MS: String(approvalTimeoutMs),
            },
          },
        },
      })
      await assertCodexChatGptLogin({ env: clientOptions.env, authCheck })

      session = appServerFactory({
        spawnImpl,
        codexPath,
        killTimeoutMs,
        env: clientOptions.env,
        onNotification: handleNotification,
        onServerRequest: handleServerRequest,
        onExit: handleAppServerExit,
      })
      await session.client.request('initialize', {
        clientInfo: CLIENT_INFO,
        capabilities: { experimentalApi: true },
      })
      const started = await session.client.request('thread/start', buildOrchestratorThreadParams({
        model,
        workingDirectory: work.workingDirectory,
        config: clientOptions.config,
      }))
      threadId = started?.threadId ?? started?.thread?.id
      if (!threadId) throw new Error('Codex thread/start did not return a thread id')
      return { threadId }
    } catch (error) {
      closed = true
      await cleanupResources()
      throw error
    }
  }

  function open() {
    if (closed) return Promise.reject(new Error('Codex orchestrator is closed'))
    if (!openPromise) openPromise = doOpen()
    return openPromise
  }

  async function send(text) {
    await open()
    if (turnStartPending) {
      throw new Error('Codex orchestrator turn start is already in flight; use steer instead')
    }
    turnStartPending = true
    const epoch = turnEpoch
    try {
      const result = await session.client.request('turn/start', {
        threadId,
        input: [{ type: 'text', text }],
      })
      const startedTurnId = result?.turn?.id ?? null
      if (epoch === turnEpoch) {
        activeTurnId = startedTurnId && !completedTurnIds.delete(startedTurnId) ? startedTurnId : null
      }
      return result
    } finally {
      turnStartPending = false
      completedTurnIds.clear()
    }
  }

  async function steer(text) {
    await open()
    if (!activeTurnId) throw new Error('Codex orchestrator has no active turn to steer')
    return session.client.request('turn/steer', {
      threadId,
      expectedTurnId: activeTurnId,
      input: [{ type: 'text', text }],
    })
  }

  async function abort() {
    await open()
    // interrupt 응답보다 늦은 turn/start 응답도 이 중단을 뒤집을 수 없어야 한다.
    turnEpoch += 1
    const interrupted = session.client.request('turn/interrupt', { threadId })
    answerPendingRequests()
    activeTurnId = null
    return interrupted
  }

  function close() {
    if (closePromise) return closePromise
    closed = true
    closePromise = (async () => {
      if (openPromise) {
        try { await openPromise } catch { /* doOpen이 같은 cleanup을 끝낸다. */ }
      }
      await cleanupResources()
    })()
    return closePromise
  }

  return { open, send, steer, abort, close }
}

export default { createCodexOrchestrator, resolveCodexAdapterPath, AGENT_MCP_SERVER_NAME }
