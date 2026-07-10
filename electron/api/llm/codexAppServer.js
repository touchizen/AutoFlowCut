/**
 * `codex app-server` 프로세스 배선. 인증은 ~/.codex 를 그대로 쓴다(ChatGPT 구독 플랜, API 키 없음).
 *
 * 지금은 model/list 만 쓴다. 트랜스포트 교체(thread/start + turn/start + item/agentMessage/delta)는
 * 같은 createJsonRpcClient 위에 올린다 — docs/superpowers/plans/2026-07-10-codex-appserver-*.md
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { createNdjsonDecoder, createJsonRpcClient } from './codexJsonRpc.js'
import { resolveCodexExecutablePath } from './codexSdk.js'

const DEFAULT_TIMEOUT_MS = 20 * 1000
const CLIENT_INFO = { name: 'autoflowcut', title: 'AutoFlowCut', version: '0.0.0' }

/**
 * app-server 를 띄워 한 번의 RPC 대화를 하고 내린다.
 * 실패/지연은 전부 호출측이 정한 fallback 값으로 흡수한다 — 던지지 않는다.
 */
async function withAppServer(run, { spawnImpl = nodeSpawn, codexPath = resolveCodexExecutablePath, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS, fallback } = {}) {
  let child = null
  let client = null
  let timer = null
  try {
    const executable = typeof codexPath === 'function' ? codexPath() : codexPath
    child = spawnImpl(executable, ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'] })

    client = createJsonRpcClient({ write: (line) => child.stdin.write(line) })
    const decode = createNdjsonDecoder()
    child.stdout.on('data', (chunk) => {
      for (const message of decode(chunk)) client.handle(message)
    })
    // 프로세스가 죽으면 대기 중인 요청이 영원히 매달린다.
    child.on('error', (err) => client.rejectAll(err))
    child.on('exit', (code) => client.rejectAll(new Error(`codex app-server exited (${code})`)))

    return await Promise.race([
      (async () => {
        await client.request('initialize', { clientInfo: CLIENT_INFO })
        return run(client)
      })(),
      // 타이머를 안 지우면 정상 응답 뒤에도 reject 가 일어나 unhandled rejection 이 된다.
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('codex app-server timeout')), timeoutMs) }),
    ])
  } catch {
    return fallback
  } finally {
    if (timer) clearTimeout(timer)
    client?.rejectAll(new Error('codex app-server closed'))
    try { child?.kill() } catch { /* 이미 죽음 */ }
  }
}

/** app-server 가 보고하는 모델 목록. 실패하면 [] — 호출측이 정적 폴백을 쓴다. */
export async function listCodexModels(deps = {}) {
  return withAppServer(async (client) => {
    const result = await client.request('model/list', {})
    return Array.isArray(result?.data) ? result.data : []
  }, { ...deps, fallback: [] })
}

export default { listCodexModels }
