/**
 * M0-11 — Codex runtime config + **adapter env 전달·비누수**.
 *
 * **스펙 criterion:** inline thread config 와 generated temp `config.toml` 중 MCP 연결 경로를 판정하고,
 * per-server env 의 **`AUTOFLOWCUT_AGENT_TOKEN` / `ELECTRON_RUN_AS_NODE` 가 adapter 에서 보이며
 * app-server / 다른 child 에는 불필요하게 퍼지지 않음**을 확인한다.
 * custom env 유실이면 profile 별 `SAFE_ENV_KEYS` 대안까지 시험하고 **둘 다 실패하면 FAIL.**
 *
 * ⚠️ **왜 어려운가:** 제품은 세 겹으로 env 를 잠근다.
 *   1. `SAFE_ENV_KEYS` allowlist — app-server 의 env 에서 custom 변수를 **버린다**
 *      (`AUTOFLOWCUT_AGENT_TOKEN`, `ELECTRON_RUN_AS_NODE` 는 거기 **없다**)
 *   2. `shell_environment_policy: { inherit: 'none' }` — codex 가 child 에 ambient env 를 안 물려준다
 *   3. `runtimeProfile:'orchestrator'` 의 `mcp_servers.<name>.env` — **per-server** env
 * → 그래서 **"app-server 를 우회해서 adapter 에만"** 전달하는 유일한 길이 3번이다.
 *   그게 정말 되는지, 그리고 **거기 안 준 형제 서버는 정말 못 보는지**를 잰다.
 *
 * 🔴 **토큰 값을 디스크에 적지 않는다.** fixture 는 "보이나 / 값이 맞나" 만 남긴다 —
 *    평문으로 남기면 그 자체가 유출이다.
 *
 * `npm run test:spike` (SPIKE=1) 로만 돈다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildCodexClientOptions, resolveCodexExecutablePath, prepareCodexRuntimeHome } from '../../electron/api/llm/codexSdk.js'
import { buildOrchestratorThreadParams } from '../../electron/api/llm/codexAppServer.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(here, 'fixtures/echo-mcp.js')
const RESULT_DIR = 'docs/superpowers/specs'
const CODEX_BIN = resolveCodexExecutablePath()
const CODEX_VERSION = execFileSync(CODEX_BIN, ['--version'], { encoding: 'utf-8' }).trim()
const RUN_ID = process.env.SPIKE_RUN_ID ?? `nofile-${process.pid}`

const record = (label, data) => {
  mkdirSync(RESULT_DIR, { recursive: true })
  appendFileSync(
    `${RESULT_DIR}/m0-11-raw.jsonl`,
    JSON.stringify({ runId: RUN_ID, label, codexBin: CODEX_BIN, codexVersion: CODEX_VERSION, ...data }) + '\n',
  )
}

const cleanups = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()()
})

/** macOS 에서 **다른 프로세스의 env** 를 읽는다. app-server 가 토큰을 들고 있는지 보려면 이게 필요하다. */
function readProcessEnv(pid) {
  try {
    // `ps eww` 는 argv 뒤에 env 를 붙여준다.
    return execFileSync('ps', ['eww', '-p', String(pid)], { encoding: 'utf-8' })
  } catch {
    return ''
  }
}

describe('M0-11 — adapter env 전달·비누수', () => {
  it('per-server env 는 adapter 에만 도달한다 — app-server 도, 형제 MCP 서버도 못 본다', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'm0-11-'))
    cleanups.push(async () => rmSync(workDir, { recursive: true, force: true }))

    const envDump = join(workDir, 'env-dump.jsonl')
    const TOKEN = `agent-token-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`

    // 🔴 **핵심:** 토큰을 **ambient env 에 절대 넣지 않는다.** per-server env 로만 준다.
    //    (넣어버리면 "SAFE_ENV_KEYS 가 거른다" 를 측정하는 게 아니라 그냥 우리가 안 넣은 걸 확인하는 꼴이 된다.)
    expect(process.env.AUTOFLOWCUT_AGENT_TOKEN, '테스트 전제 위반: ambient 에 토큰이 이미 있다').toBeUndefined()

    // 🔴 **F4: 카나리아.** ambient 에 **가짜 공급자 키**를 심는다.
    //    안 심으면 "OPENAI_API_KEY 가 adapter 에 안 왔다" 는 *"우리가 안 넣었으니 없다"* 일 뿐이고,
    //    `SAFE_ENV_KEYS` 필터가 **실제로 뭔가를 걸러내는 걸 한 번도 못 본다.**
    const CANARY = `spike-canary-${Math.random().toString(36).slice(2)}`
    const ambient = {
      ...process.env,
      OPENAI_API_KEY: CANARY,
      ANTHROPIC_API_KEY: CANARY,
      SOME_RANDOM_SECRET: CANARY,
    }

    const runtime = await prepareCodexRuntimeHome({ env: ambient })
    cleanups.push(runtime.cleanup)

    const opts = buildCodexClientOptions({
      env: runtime.env,
      runtimeProfile: 'orchestrator',
      mcpServers: {
        // (1) 토큰을 **받는** adapter
        adapter: {
          command: process.execPath,
          args: [FIXTURE],
          env: {
            ECHO_GATED_MARKER_FILE: join(workDir, 'marker-adapter'),
            ECHO_ENV_DUMP_FILE: envDump,
            ECHO_SERVER_LABEL: 'adapter',
            ECHO_EXPECTED_TOKEN: TOKEN,
            // ★ 스펙이 지목한 두 운영 변수
            AUTOFLOWCUT_AGENT_TOKEN: TOKEN,
            ELECTRON_RUN_AS_NODE: '1',
          },
        },
        // (2) **안 받는** 형제 서버 — 여기서 토큰이 보이면 **비누수 실패**다
        sibling: {
          command: process.execPath,
          args: [FIXTURE],
          env: {
            ECHO_GATED_MARKER_FILE: join(workDir, 'marker-sibling'),
            ECHO_ENV_DUMP_FILE: envDump,
            ECHO_SERVER_LABEL: 'sibling',
            ECHO_EXPECTED_TOKEN: TOKEN,
            // AUTOFLOWCUT_AGENT_TOKEN 없음. ELECTRON_RUN_AS_NODE 없음.
          },
        },
      },
    })

    // ── app-server 를 띄우고 thread 를 연다 (제품 3경로) ──
    const child = spawn(CODEX_BIN, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env: opts.env })
    cleanups.push(async () => { try { child.kill('SIGTERM') } catch {} })

    const appServerEnvText = await new Promise((res) => {
      // 프로세스가 뜬 직후 env 를 스냅샷한다.
      setTimeout(() => res(readProcessEnv(child.pid)), 1500)
    })

    let buf = ''
    let settled = false
    const done = new Promise((res) => {
      const finish = (v) => { if (!settled) { settled = true; res(v) } }
      const timer = setTimeout(() => finish({ timedOut: true }), 3 * 60 * 1000)
      child.stdout.on('data', (d) => {
        buf += d.toString()
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
          if (!line) continue
          let m; try { m = JSON.parse(line) } catch { continue }
          if (m.method) continue
          if (m.id === 0 && m.result) {
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }) + '\n')
            child.stdin.write(JSON.stringify({
              jsonrpc: '2.0', id: 1, method: 'thread/start',
              params: buildOrchestratorThreadParams({ workingDirectory: workDir, config: opts.config }),
            }) + '\n')
          }
          if (m.id === 1) {
            if (m.error) { clearTimeout(timer); return finish({ threadError: m.error }) }
            const threadId = m.result?.threadId ?? m.result?.thread?.id
            // 서버가 뜰 시간을 준 뒤 인벤토리를 확인한다 (두 서버가 다 살아야 env dump 가 나온다).
            setTimeout(() => child.stdin.write(JSON.stringify({
              jsonrpc: '2.0', id: 2, method: 'mcpServerStatus/list', params: { threadId },
            }) + '\n'), 10_000)
          }
          if (m.id === 2) {
            clearTimeout(timer)
            finish({
              timedOut: false,
              servers: (m.result?.data ?? []).map((s) => ({ name: s.name, tools: Object.keys(s.tools ?? {}).length })),
            })
          }
        }
      })
    })

    // handshake 시작. (⚠️ 이걸 빼먹으면 stdout 핸들러가 영영 안 깨어난다 — 실제로 한 번 밟았다.)
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: {
        clientInfo: { name: 'autoflowcut-m0-11', title: 'AutoFlowCut M0-11', version: '0.0.1' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    }) + '\n')

    const r = await done
    expect(r.timedOut, 'app-server 가 3분 안에 thread/인벤토리를 못 열었다').toBe(false)
    expect(r.threadError ?? null).toBeNull()

    // ── adapter 들이 남긴 env dump 를 읽는다 ──
    const dumps = existsSync(envDump)
      ? readFileSync(envDump, 'utf-8').trim().split('\n').filter(Boolean).map(JSON.parse)
      : []
    const adapter = dumps.find((d) => d.server === 'adapter')
    const sibling = dumps.find((d) => d.server === 'sibling')

    // app-server 프로세스 env 에 토큰이 있나 (값으로 grep — 있으면 그게 유출이다)
    const appServerHasToken = appServerEnvText.includes(TOKEN)
    const appServerHasRunAsNode = /ELECTRON_RUN_AS_NODE/.test(appServerEnvText)
    const appServerHasCanary = appServerEnvText.includes(CANARY)
    // 🔴 **F5: positive control.** `ps eww` 가 실패하면 `''` 가 되고, `''.includes(TOKEN)` 은 false 라
    //    비누수 assertion 이 **공짜로 통과한다.** 우리가 넣은 게 확실한 값(temp CODEX_HOME 경로)이
    //    거기 보이는지 먼저 확인해야 "ps 가 env 를 정말 읽었다" 를 안다.
    const appServerEnvReadable = appServerEnvText.includes(runtime.codexHome)

    const out = {
      servers: r.servers,
      adapter, sibling,
      appServerHasToken, appServerHasRunAsNode, appServerHasCanary, appServerEnvReadable,
      appServerEnvLen: appServerEnvText.length,
      safeEnvKeys: Object.keys(opts.env).sort(),
      // F6: app-server env 가 child 로 어디까지 흘러내리는지 고정한다.
      inheritedByChildren: sibling?.envKeys ?? null,
    }
    record('M0-11 per-server env 전달·비누수', out)
    console.log('\n===== M0-11 =====')
    console.log('  servers        :', JSON.stringify(r.servers))
    console.log('  adapter 가 본 것:', JSON.stringify(adapter))
    console.log('  sibling 이 본 것:', JSON.stringify(sibling))
    console.log('  app-server env 에 토큰:', appServerHasToken, '| ELECTRON_RUN_AS_NODE:', appServerHasRunAsNode)
    console.log('  app-server env keys   :', Object.keys(opts.env).sort().join(','))

    // ── (1) 전달: adapter 는 **본다** ──
    expect(adapter, 'adapter 가 env dump 를 안 남겼다 — 서버가 안 떴거나 env 가 안 왔다').toBeTruthy()
    expect(adapter.sawAgentToken, 'per-server env 의 AUTOFLOWCUT_AGENT_TOKEN 이 adapter 에 안 왔다').toBe(true)
    expect(adapter.agentTokenMatches, '토큰 값이 다르다').toBe(true)
    expect(adapter.electronRunAsNode, 'per-server env 의 ELECTRON_RUN_AS_NODE 가 adapter 에 안 왔다').toBe('1')

    // ── (2) 비누수: 형제 서버는 **못 본다** ──
    expect(sibling, 'sibling 이 env dump 를 안 남겼다').toBeTruthy()
    expect(sibling.sawAgentToken, '🔴 토큰을 안 준 형제 MCP 서버가 토큰을 봤다 — per-server 격리 실패').toBe(false)
    expect(sibling.electronRunAsNode, '🔴 ELECTRON_RUN_AS_NODE 가 형제 서버로 샜다').toBeNull()

    // ── (3) 비누수: app-server 자신도 **못 본다** ──
    //     ⚠️ 먼저 **관측 장치가 살아있는지** 확인한다. ps 가 실패하면 아래 assertion 이 공짜로 통과한다.
    expect(appServerEnvReadable, 'ps 로 app-server env 를 못 읽었다 — 아래 비누수 assertion 이 무의미해진다').toBe(true)
    expect(appServerHasToken, '🔴 app-server 프로세스 env 에 토큰이 들어 있다 — SAFE_ENV_KEYS 를 우회해 샜다').toBe(false)

    // ── (4) 🔴 **카나리아: SAFE_ENV_KEYS 가 실제로 걸러낸다** ──
    //     ambient 에 가짜 OPENAI_API_KEY/ANTHROPIC_API_KEY/SOME_RANDOM_SECRET 를 **심어놓고** 잰다.
    expect(appServerHasCanary, '🔴 ambient 의 공급자 키가 app-server env 로 샜다 — SAFE_ENV_KEYS 가 안 걸렀다').toBe(false)
    expect(adapter.sawOpenAiKey, '🔴 OPENAI_API_KEY 가 adapter 에 샜다').toBe(false)
    expect(adapter.sawAnthropicKey, '🔴 ANTHROPIC_API_KEY 가 adapter 에 샜다').toBe(false)
    expect(sibling.sawOpenAiKey, '🔴 OPENAI_API_KEY 가 형제 서버에 샜다').toBe(false)

    // ── (5) 🔴 **`CODEX_HOME` 은 MCP child 로 안 내려간다.** 이게 제일 중요한 비누수다.
    //     `CODEX_HOME` 은 **복사된 `auth.json` 이 있는 temp 디렉토리 경로**다.
    //     그게 child 에 있으면 아무 MCP 서버나 **사용자의 ChatGPT 자격증명 파일을 읽을 수 있다.**
    //     (리뷰어는 `envKeyCount:12` 를 보고 "SAFE 8 + ECHO 4 니까 CODEX_HOME 도 갔다" 고 추론했는데,
    //      실제로는 SAFE 7 + macOS 가 붙이는 `__CF_USER_TEXT_ENCODING` 이었다. **세보는 것과 여는 것은 다르다.**)
    expect(adapter.envKeys, '🔴 CODEX_HOME 이 adapter 로 내려갔다 — 자격증명 파일 위치가 노출된다').not.toContain('CODEX_HOME')
    expect(sibling.envKeys, '🔴 CODEX_HOME 이 형제 MCP 서버로 내려갔다 — 자격증명 파일 위치가 노출된다').not.toContain('CODEX_HOME')

    // child 가 받는 키 집합을 **못박는다.** 늘어나면 무엇이 새는지 다시 봐야 한다.
    //     per-server env(ECHO_*) + 최소 OS 변수뿐이다.
    const inheritedNonEcho = sibling.envKeys.filter((k) => !k.startsWith('ECHO_'))
    expect(inheritedNonEcho.sort()).toEqual(
      ['HOME', 'LANG', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER', '__CF_USER_TEXT_ENCODING'].sort(),
    )
  }, 6 * 60 * 1000)
})
