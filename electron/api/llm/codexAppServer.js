/**
 * `codex app-server` 프로세스 배선 — story codex 엔진의 트랜스포트.
 * 인증은 ~/.codex 를 그대로 쓴다(ChatGPT 구독 플랜, API 키 없음).
 *
 * model/list 로 모델 목록을, thread/start + turn/start 로 한 턴을 돌린다. 진짜 증분 스트리밍은
 * item/agentMessage/delta 알림으로 온다.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { createNdjsonDecoder, createJsonRpcClient } from './codexJsonRpc.js'
import { codexNotifToUsage } from './usageTokens.js'
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
function openAppServer({ spawnImpl = nodeSpawn, codexPath = resolveCodexExecutablePath, env = process.env, onNotification, killTimeoutMs = KILL_TIMEOUT_MS } = {}) {
  const executable = typeof codexPath === 'function' ? codexPath() : codexPath
  const child = spawnImpl(executable, ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'] })
  const client = createJsonRpcClient({ write: (line) => child.stdin.write(line), onNotification })
  const decode = createNdjsonDecoder()
  let exited = false
  child.stdout.on('data', (chunk) => {
    for (const message of decode(chunk)) client.handle(message)
  })
  // 프로세스가 죽으면 대기 중인 요청이 영원히 매달린다.
  child.on('error', (err) => client.rejectAll(err))
  child.on('exit', (code) => { exited = true; client.rejectAll(new Error(`codex app-server exited (${code})`)) })
  return {
    client,
    // 자식이 실제로 exit 할 때까지 기다린다 — 안 그러면 아직 임시 CODEX_HOME 에 plugins 를 클론하는
    // 중인 자식과 rm -rf 가 경쟁해 ENOTEMPTY 로 던진다(실 프로세스에서 재현됨).
    async close() {
      client.rejectAll(new Error('codex app-server closed'))
      if (exited) return
      await new Promise((resolve) => {
        const done = () => { clearTimeout(t); resolve() }
        const t = setTimeout(done, killTimeoutMs) // 안 죽어도 무한 대기하지 않는다
        child.once('exit', done)
        try { child.kill() } catch { done() /* 이미 죽음 */ }
      })
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
 * `thread/tokenUsage/updated` 알림 → onUsage. 다른 method 는 통과.
 *
 * payload 는 중첩이다 — `params.tokenUsage.inputTokens` 로 읽으면 undefined 다.
 * 0.144.5 실측 스키마(`codex app-server generate-ts --experimental` → v2/):
 *   { threadId, turnId, tokenUsage: { total: TokenUsageBreakdown, last: ..., modelContextWindow } }
 * total 이 thread 누적치이므로 그걸 읽고 threadId 로 교체한다(가산하면 뻥튀기).
 *
 * 이 함수는 stdout 이벤트 핸들러 안에서 돈다 — 여기서 던지면 uncaught 가 되고 턴 정리(finally)를
 * 건너뛴다. 계측 실패가 생성을 죽이면 안 되므로 전부 삼킨다.
 * @internal export 는 테스트가 실제 알림 모양을 고정하기 위한 것이다.
 */
export function handleUsageNotification(method, params, onUsage) {
  const sink = onUsage
  if (method !== 'thread/tokenUsage/updated' || !sink) return
  try {
    const u = codexNotifToUsage(params)
    if (u) sink(u)
  } catch { /* best-effort */ }
}

// claude 쪽 setClaudeUsageSink 와 대칭. machine 이 자기 tracker 를 물린다.
// machine 은 동시에 1개고(story-api.js: `let machine = null`), 전환 전에 abort() 가
// 진행 중 호출을 전부 취소하므로(제목 생성 포함) 뒤늦은 알림이 새 tracker 를 오염시키지 않는다.
let codexUsageSink = null

/** main 이 tracker 를 물린다. null 로 해제. */
export function setCodexUsageSink(fn) { codexUsageSink = fn }

/**
 * @internal 테스트 전용 — machine 이 sink 를 실제로 물렸는지, 그게 tracker 의 어느 메서드로
 * 가는지를 배선 테스트가 확인한다. 이게 없으면 "machine 생성 → setCodexUsageSink" 배선이
 * 통째로 지워져도 테스트가 전부 통과한다(실측으로 확인된 구멍).
 */
export function __getCodexUsageSinkForTest() { return codexUsageSink }

/**
 * 한 프롬프트 = 한 스레드 = 한 턴. turn/start 는 즉시 반환하므로 turn/completed 알림을 기다린다.
 * 최종 텍스트는 item/completed(agentMessage) 에서만 온다 — turn.items 는 비어 있다(itemsView: notLoaded).
 */
async function runCodexTurn(prompt, opts = {}, {
  outputSchema,
  onDelta,
  onThinkingActivity,
  onUsage,
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
  // **호출 시작 시점의 sink 를 캡처한다** — 알림마다 전역을 다시 읽으면 안 된다.
  // abort() 는 취소만 하고 드레인하지 않는다: `turn/interrupt` 는 fire-and-forget 이고 자식
  // 프로세스는 killTimeoutMs 유예를 두고 죽는다. 그동안 stdout 알림은 계속 흐르는데, 그 시점의
  // 전역 sink 는 이미 새 프로젝트(B)의 것이다 — A 의 threadId 가 B 에 새 key 로 가산된다.
  // 캡처하면 늦은 알림은 죽은 A 의 tracker 로 가고(무해), B 는 깨끗하다.
  const usageSink = onUsage || codexUsageSink
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
          handleUsageNotification(method, params, usageSink)
          if ((method === 'item/started' && params?.item?.type === 'reasoning')
            || method === 'item/reasoning/summaryPartAdded'
            || method === 'item/reasoning/summaryTextDelta'
            || method === 'item/reasoning/textDelta') {
            onThinkingActivity?.()
          } else if (method === 'item/agentMessage/delta') {
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
  const onDelta = deps.onPartialText && deps.onDelta
    ? (delta) => { deps.onDelta(delta); deps.onPartialText(delta) }
    : (deps.onPartialText || deps.onDelta)
  const text = await runCodexTurn(prompt, opts, { ...deps, outputSchema, onDelta })
  return parseCodexJson(text)
}

export default { listCodexModels, runCodexText, runCodexJson }
