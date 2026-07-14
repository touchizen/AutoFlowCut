/**
 * `codex app-server` 프로세스 배선 — story codex 엔진의 트랜스포트.
 * 인증은 ~/.codex 를 그대로 쓴다(ChatGPT 구독 플랜, API 키 없음).
 *
 * model/list 로 모델 목록을, thread/start + turn/start 로 한 턴을 돌린다. 진짜 증분 스트리밍은
 * item/agentMessage/delta 알림으로 온다.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { createNdjsonDecoder, createJsonRpcClient } from './codexJsonRpc.js'
import {
  resolveCodexExecutablePath,
  prepareCodexRuntimeHome,
  prepareCodexWorkingDirectory,
  buildCodexClientOptions,
  assertCodexChatGptLogin,
  createRunSignal,
  mapCodexError,
  parseCodexJson,
  STORY_INSTRUCTIONS_TEXT,
} from './codexSdk.js'

const DEFAULT_TIMEOUT_MS = 20 * 1000
const CLIENT_INFO = { name: 'autoflowcut', title: 'AutoFlowCut', version: '0.0.0' }

const KILL_TIMEOUT_MS = 5 * 1000

/** stdout 배선까지 끝난 app-server 프로세스. close() 는 대기 요청을 정리하고 프로세스를 내린다. */
export function openAppServer({
  spawnImpl = nodeSpawn,
  codexPath = resolveCodexExecutablePath,
  env = process.env,
  onNotification,
  onServerRequest,
  onExit,
  killTimeoutMs = KILL_TIMEOUT_MS,
} = {}) {
  const executable = typeof codexPath === 'function' ? codexPath() : codexPath
  const child = spawnImpl(executable, ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'] })
  const client = createJsonRpcClient({
    write: (line) => child.stdin.write(line),
    onNotification,
    onServerRequest,
  })
  const decode = createNdjsonDecoder()
  let exited = false
  child.stdout.on('data', (chunk) => {
    for (const message of decode(chunk)) client.handle(message)
  })
  // 프로세스가 죽으면 대기 중인 요청이 영원히 매달린다.
  child.on('error', (err) => client.rejectAll(err))
  child.on('exit', (code, signal) => {
    exited = true
    const error = new Error(`codex app-server exited (${code})`)
    client.rejectAll(error)
    try {
      onExit?.({ code, signal, error })
    } finally {
      // 죽은 transport의 응답 id를 session close까지 붙잡아 둘 이유가 없다.
      client.clearServerRequestHistory()
    }
  })
  return {
    client,
    // 자식이 실제로 exit 할 때까지 기다린다 — 안 그러면 아직 임시 CODEX_HOME 에 plugins 를 클론하는
    // 중인 자식과 rm -rf 가 경쟁해 ENOTEMPTY 로 던진다(실 프로세스에서 재현됨).
    async close() {
      client.rejectAll(new Error('codex app-server closed'))
      if (!exited) {
        await new Promise((resolve) => {
          const done = () => { clearTimeout(t); resolve() }
          const t = setTimeout(done, killTimeoutMs) // 안 죽어도 무한 대기하지 않는다
          child.once('exit', done)
          try { child.kill() } catch { done() /* 이미 죽음 */ }
        })
      }
      // transport가 끝난 뒤에만 비운다. 살아 있는 동안 비우면 같은 server request에 두 번 쓴다.
      client.clearServerRequestHistory()
    },
  }
}

/**
 * app-server 를 짧게 띄워 한 번의 RPC 대화를 하고 내린다.
 * 실패/지연은 전부 호출측이 정한 fallback 값으로 흡수한다 — 던지지 않는다.
 */
async function withAppServer(run, { timeoutMs = DEFAULT_TIMEOUT_MS, fallback, ...spawnDeps } = {}) {
  let session = null
  let timer = null
  try {
    session = openAppServer(spawnDeps)
    return await Promise.race([
      (async () => {
        await session.client.request('initialize', { clientInfo: CLIENT_INFO })
        return run(session.client)
      })(),
      // 타이머를 안 지우면 정상 응답 뒤에도 reject 가 일어나 unhandled rejection 이 된다.
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('codex app-server timeout')), timeoutMs) }),
    ])
  } catch {
    return fallback
  } finally {
    if (timer) clearTimeout(timer)
    await session?.close()
  }
}

/** app-server 가 보고하는 모델 목록. 실패하면 [] — 호출측이 정적 폴백을 쓴다. */
export async function listCodexModels(deps = {}) {
  return withAppServer(async (client) => {
    const result = await client.request('model/list', {})
    return Array.isArray(result?.data) ? result.data : []
  }, { ...deps, fallback: [] })
}

// 스토리 어댑터는 codex 가 워크스페이스를 건드리면 안 된다. thread 단위로 도구를 전부 끄고
// read-only 샌드박스로 연다. baseInstructions 덕분에 지시문 파일을 만들 필요가 없다.
function buildThreadStartParams({ model, workingDirectory, config }) {
  return {
    ...(model ? { model } : {}),
    cwd: workingDirectory,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    ephemeral: true,
    baseInstructions: STORY_INSTRUCTIONS_TEXT,
    config,
  }
}

/**
 * 오케스트레이터(인앱 에이전트) thread profile. story 와 **다른 물건이다.**
 *
 * 🎯 `approvalPolicy` 가 급소다. `AskForApproval` 은 5-variant 이고
 *    (`"untrusted" | "on-failure" | "on-request" | {granular:{…}} | "never"`),
 *    story 가 쓰는 **`'never'` 는 "아무것도 묻지 않는다" = MCP elicitation 도 안 묻는다.**
 *    → 클라이언트 응답을 **기다리지 않고 즉시 decline** 을 서버에 돌려준다.
 *    실측: 우리가 5,000ms 붙잡고 있는 동안 tool call 이 **9ms** 에 끝나고 decline 이 나갔다.
 *    **게이트를 켜두고 게이트의 스위치를 꺼놓는 셈이다.**
 *
 *    `granular` 로 exec/patch/skill/permission 승인은 전부 끄고 **MCP elicitation 만** 켠다 — D9 그대로.
 *
 * ⚠️ `granular` 는 `initialize` 의 `capabilities.experimentalApi: true` 없이는 거부된다
 *    (`-32600 askForApproval.granular requires experimentalApi capability`).
 */
export function buildOrchestratorThreadParams({ model, workingDirectory, config }) {
  return {
    ...(model ? { model } : {}),
    cwd: workingDirectory,
    sandbox: 'read-only',
    approvalPolicy: {
      granular: {
        sandbox_approval: false,
        rules: false,
        skill_approval: false,
        request_permissions: false,
        mcp_elicitations: true,
      },
    },
    config,
  }
}

/**
 * 한 프롬프트 = 한 스레드 = 한 턴. turn/start 는 즉시 반환하므로 turn/completed 알림을 기다린다.
 * 최종 텍스트는 item/completed(agentMessage) 에서만 온다 — turn.items 는 비어 있다(itemsView: notLoaded).
 */
async function runCodexTurn(prompt, opts = {}, {
  outputSchema,
  onDelta,
  signal,
  spawnImpl,
  codexPath,
  env = process.env,
  config,
  authCheck,
  killTimeoutMs,
  runtimeHomeFactory = prepareCodexRuntimeHome,
  workingDirectoryFactory = prepareCodexWorkingDirectory,
} = {}) {
  const runSignal = createRunSignal(signal, opts.timeoutMs)
  let runtime = null
  let work = null
  let session = null
  try {
    work = await workingDirectoryFactory()
    runtime = await runtimeHomeFactory({ env })
    const clientOptions = buildCodexClientOptions({ env: runtime.env, config })
    await assertCodexChatGptLogin({ env: clientOptions.env, authCheck })

    let settle
    const turnDone = new Promise((resolve, reject) => { settle = { resolve, reject } })
    // 아래 race 로 처리한다. 핸들러가 없으면 이른 reject 가 unhandled rejection 이 된다.
    turnDone.catch(() => {})

    // 한 턴에 agentMessage 아이템이 여러 개일 수 있다. 아이템 단위로 합친다:
    //  - 완료 알림(item/completed)이 그 아이템의 확정 텍스트다. 빈 문자열도 확정이다
    //    (모델이 진짜 빈 답을 냈을 수 있다) — 델타로 되살리지 않는다.
    //  - 완료가 안 온 아이템은 흘린 델타를 쓴다. 버리면 저장되는 대본이 조용히 잘린다.
    //  - itemId 없는 델타는 어느 아이템 것인지 귀속할 수 없다. 완료 텍스트가 하나라도 있으면
    //    그쪽만 믿는다(안 그러면 같은 텍스트가 두 번 나간다).
    const ANONYMOUS = ''
    const order = []
    const deltaTexts = new Map()
    const completedTexts = new Map()
    const touch = (id) => { if (!deltaTexts.has(id) && !completedTexts.has(id)) order.push(id) }
    const collected = () => {
      const hasCompleted = completedTexts.size > 0
      return order.map((id) => {
        if (completedTexts.has(id)) return completedTexts.get(id)
        if (hasCompleted && id === ANONYMOUS) return ''
        return deltaTexts.get(id) || ''
      }).join('')
    }

    session = openAppServer({
      spawnImpl,
      codexPath,
      killTimeoutMs,
      env: clientOptions.env,
      // 이 콜백은 stdout 이벤트 핸들러 안에서 돈다 — 여기서 던지면 uncaught 가 되고 정리(finally)도
      // 건너뛴다. 반드시 턴 실패로 바꿔 준다.
      onNotification: (message) => {
        try {
          const { method, params } = message
          if (method === 'item/agentMessage/delta') {
            if (!params?.delta) return
            const id = params.itemId ?? ANONYMOUS
            touch(id)
            deltaTexts.set(id, (deltaTexts.get(id) || '') + params.delta)
            onDelta?.(params.delta)
          } else if (method === 'item/completed' && params?.item?.type === 'agentMessage') {
            const id = params.item.id ?? ANONYMOUS
            touch(id)
            completedTexts.set(id, params.item.text ?? '')
          } else if (method === 'turn/completed') {
            const turn = params?.turn
            if (turn?.status === 'failed') settle.reject(new Error(turn.error?.message || 'Codex turn failed'))
            else settle.resolve(collected())
          }
        } catch (err) {
          settle.reject(err)
        }
      },
    })

    // 어떤 요청을 기다리는 중이든 abort/타임아웃이 오면 빠져나와 정리해야 한다.
    // turnDone 은 turn/completed 전에는 절대 resolve 하지 않으므로 취소 신호로 겸용한다.
    let threadId = null
    const onAbort = () => {
      if (threadId) session.client.request('turn/interrupt', { threadId }).catch(() => {})
      settle.reject(new Error('Aborted'))
    }
    if (runSignal.signal.aborted) onAbort()
    else runSignal.signal.addEventListener('abort', onAbort, { once: true })

    const guard = (promise) => {
      promise.catch(() => {}) // close() 의 rejectAll 이 unhandled rejection 이 되지 않게
      return Promise.race([promise, turnDone])
    }

    await guard(session.client.request('initialize', { clientInfo: CLIENT_INFO }))
    const started = await guard(session.client.request('thread/start', buildThreadStartParams({
      model: opts.model,
      workingDirectory: work.workingDirectory,
      config: clientOptions.config,
    })))
    threadId = started?.thread?.id
    const effort = opts.reasoningEffort || opts.modelReasoningEffort

    await guard(session.client.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }],
      ...(effort ? { effort } : {}),
      ...(outputSchema ? { outputSchema } : {}),
    }))
    return await turnDone
  } catch (err) {
    throw mapCodexError(err, { timedOut: runSignal.timedOut(), parentSignal: signal })
  } finally {
    runSignal.cleanup()
    await session?.close()
    await runtime?.cleanup?.()
    await work?.cleanup?.()
  }
}

export async function runCodexText(prompt, opts = {}, deps = {}) {
  return runCodexTurn(prompt, opts, deps)
}

export async function runCodexJson(prompt, outputSchema, opts = {}, deps = {}) {
  const text = await runCodexTurn(prompt, opts, { ...deps, outputSchema })
  return parseCodexJson(text)
}

export default { listCodexModels, runCodexText, runCodexJson }
