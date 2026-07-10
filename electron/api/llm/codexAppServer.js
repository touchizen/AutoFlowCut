/**
 * `codex app-server` 프로세스 배선. 인증은 ~/.codex 를 그대로 쓴다(ChatGPT 구독 플랜, API 키 없음).
 *
 * 지금은 model/list 만 쓴다. 트랜스포트 교체(thread/start + turn/start + item/agentMessage/delta)는
 * 같은 createJsonRpcClient 위에 올린다 — docs/superpowers/plans/2026-07-10-codex-appserver-*.md
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

/** stdout 배선까지 끝난 app-server 프로세스. close() 는 대기 요청을 정리하고 프로세스를 내린다. */
function openAppServer({ spawnImpl = nodeSpawn, codexPath = resolveCodexExecutablePath, env = process.env, onNotification } = {}) {
  const executable = typeof codexPath === 'function' ? codexPath() : codexPath
  const child = spawnImpl(executable, ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'] })
  const client = createJsonRpcClient({ write: (line) => child.stdin.write(line), onNotification })
  const decode = createNdjsonDecoder()
  child.stdout.on('data', (chunk) => {
    for (const message of decode(chunk)) client.handle(message)
  })
  // 프로세스가 죽으면 대기 중인 요청이 영원히 매달린다.
  child.on('error', (err) => client.rejectAll(err))
  child.on('exit', (code) => client.rejectAll(new Error(`codex app-server exited (${code})`)))
  return {
    client,
    close() {
      client.rejectAll(new Error('codex app-server closed'))
      try { child.kill() } catch { /* 이미 죽음 */ }
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
    session?.close()
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
  // model_instructions_file 은 SDK 경로에서 쓰던 파일 트릭이다 — app-server 는 baseInstructions 를 쓴다.
  const { model_instructions_file: _unusedFile, ...threadConfig } = config
  return {
    ...(model ? { model } : {}),
    cwd: workingDirectory,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    ephemeral: true,
    baseInstructions: STORY_INSTRUCTIONS_TEXT,
    config: threadConfig,
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

    let finalText = ''
    let settle
    const turnDone = new Promise((resolve, reject) => { settle = { resolve, reject } })
    // 아래 race 로 처리한다. 핸들러가 없으면 이른 reject 가 unhandled rejection 이 된다.
    turnDone.catch(() => {})

    session = openAppServer({
      spawnImpl,
      codexPath,
      env: clientOptions.env,
      onNotification: (message) => {
        const { method, params } = message
        if (method === 'item/agentMessage/delta') {
          if (params?.delta) onDelta?.(params.delta)
        } else if (method === 'item/completed' && params?.item?.type === 'agentMessage') {
          finalText = params.item.text || ''
        } else if (method === 'turn/completed') {
          const turn = params?.turn
          if (turn?.status === 'failed') settle.reject(new Error(turn.error?.message || 'Codex turn failed'))
          else settle.resolve(finalText)
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
    session?.close()
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
