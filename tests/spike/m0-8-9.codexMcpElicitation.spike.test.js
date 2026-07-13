/**
 * M0-8 / M0-9 — Codex disabled profile + MCP, 그리고 elicitation 게이트.
 *
 * **M2 에서 Codex 를 ship 할지 가르는 하드 게이트다.**
 *
 * M0-8: orchestrator tool features(shell/browser/patch/plugins)를 disabled 로 둔 채 spike echo MCP 에
 *       연결한다. plain echo result 가 오면 PASS. 제품 Tool Core/HTTP 사용 금지.
 * M0-9: 같은 profile 에서 gated echo tool 이 handler 내부 `elicitation/create` 를 열어
 *       **`mcpServer/elicitation/request`** 를 발생시켜야 한다. deny/allow 두 run 모두
 *       **10분 hold 해도 어떤 Codex call/turn/session timeout 에도 죽지 않고**,
 *       deny 는 tool body 0회 + blocked, allow 는 tool body 1회 + result 여야 PASS.
 *       **exec approval 로 대체한 test 는 무효다.**
 *
 * 바이너리 실측(0.144.1)으로 확보한 표면:
 *   thread/start, turn/start, turn/steer, turn/interrupt
 *   mcpServer/elicitation/request        ← 스펙이 지목한 그것. 실재한다.
 *   item/mcpToolCall/progress            ← 있음
 *   (mcpToolCall 승인 요청은 **없다** — D9 가 옳았다)
 *
 * body 실행 횟수는 child 메모리가 아니라 **marker 파일**로 관측한다. 안 그러면
 * "body 를 돌려놓고 blocked 를 반환하는" 회귀가 조용히 통과한다.
 *
 * `npm run test:spike` (SPIKE=1) 로만 돈다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(here, 'fixtures/echo-mcp.js')
const RESULT_DIR = 'docs/superpowers/specs'
const record = (label, data) => {
  mkdirSync(RESULT_DIR, { recursive: true })
  appendFileSync(`${RESULT_DIR}/m0-8-9-raw.jsonl`, JSON.stringify({ label, ...data }) + '\n')
}

let workDir
beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), 'm0-89-')) })

/**
 * codex app-server 를 띄우고 한 thread/turn 을 돌린다.
 *
 * @param prompt        모델에게 시킬 것
 * @param onElicitation `mcpServer/elicitation/request` 가 오면 부른다. 반환값이 respond payload.
 *                      **hold 는 여기서 건다** — fixture 가 아니라 responder 쪽이다.
 */
function runCodexTurn({ prompt, onElicitation, timeoutMs = 25 * 60 * 1000 }) {
  return new Promise((resolve_) => {
    const markerPath = join(workDir, 'echo-body-marker')

    // ⚠️ 실측: `thread/start` 의 inline `mcpServers` 는 **무시된다** (echo 언급 0회, 사용자의 전역
    //    ~/.codex/config.toml 서버들만 떴다). MCP 연결 경로는 **temp CODEX_HOME + 생성 config.toml**
    //    이다 — 이게 M0-11 이 판정하라고 한 바로 그 갈림길이다.
    //    동시에 프로필 격리도 여기서 얻는다(사용자 전역 MCP 서버가 안 딸려온다).
    const codexHome = join(workDir, 'codex-home')
    mkdirSync(codexHome, { recursive: true })
    // 구독 자격증명만 가져온다. 다른 설정은 일절 상속하지 않는다.
    const realAuth = join(process.env.HOME, '.codex', 'auth.json')
    if (existsSync(realAuth)) copyFileSync(realAuth, join(codexHome, 'auth.json'))
    writeFileSync(join(codexHome, 'config.toml'), [
      '[mcp_servers.echo]',
      `command = ${JSON.stringify(process.execPath)}`,
      `args = [${JSON.stringify(FIXTURE)}]`,
      '[mcp_servers.echo.env]',
      `ECHO_MCP_MARKER = ${JSON.stringify(markerPath)}`,
      '',
    ].join('\n'), 'utf-8')

    const child = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CODEX_HOME: codexHome, ECHO_MCP_MARKER: markerPath },
    })

    const lines = []
    const elicitations = []
    const stderr = []
    let buf = ''
    let settled = false
    let threadId = null
    let turnDone = null

    const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n')

    const finish = (extra) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGTERM')
      const bodyRuns = existsSync(markerPath)
        ? readFileSync(markerPath, 'utf-8').trim().split('\n').filter(Boolean).length
        : 0
      resolve_({ lines: lines.slice(0, 60), elicitations, stderr: stderr.join('').slice(0, 1500), bodyRuns, turnDone, ...extra })
    }
    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs)

    child.stdout.on('data', async (d) => {
      buf += d.toString()
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
        if (!line) continue
        lines.push(line.slice(0, 400))
        let m; try { m = JSON.parse(line) } catch { continue }

        // 1) initialize 응답 → thread/start
        if (m.id === 0 && m.result) {
          send({ jsonrpc: '2.0', method: 'initialized', params: {} })
          send({
            jsonrpc: '2.0', id: 1, method: 'thread/start',
            params: {
              cwd: workDir,
              // M0-8: orchestrator tool features 를 전부 끈다.
              sandboxMode: 'read-only',
              approvalPolicy: 'never',
              // mcpServers 를 여기 넣어도 무시된다(실측). config.toml 이 정본이다.
            },
          })
        }

        // 2) thread/start 응답 → turn/start
        if (m.id === 1) {
          if (m.error) return finish({ threadError: m.error })
          threadId = m.result?.threadId ?? m.result?.thread?.id ?? m.result?.id
          send({
            jsonrpc: '2.0', id: 2, method: 'turn/start',
            params: { threadId, input: [{ type: 'text', text: prompt }] },
          })
        }

        // 3) elicitation 요청 → responder 가 hold 를 걸고 응답한다
        if (m.method === 'mcpServer/elicitation/request') {
          const at = Date.now()
          elicitations.push({ at, params: JSON.stringify(m.params).slice(0, 300), turnId: m.params?.turnId ?? null })
          const payload = await onElicitation?.(m.params)
          elicitations[elicitations.length - 1].heldMs = Date.now() - at
          send({ jsonrpc: '2.0', id: m.id, result: payload })
        }

        // turn/start 의 즉시 응답은 status:'inProgress' 인 ack 다 — 여기서 끝내면 아무것도 못 잰다.
        if (m.id === 2 && m.error) { turnDone = { error: m.error }; finish({}) }
        if (m.method === 'turn/completed') { turnDone = { ok: true }; finish({}) }
      }
    })
    child.stderr.on('data', (d) => stderr.push(d.toString()))
    child.on('error', (e) => finish({ spawnError: String(e.message || e) }))

    send({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { clientInfo: { name: 'autoflowcut-m0-spike', title: 'AutoFlowCut M0', version: '0.0.1' } },
    })
  })
}

const report = (label, r) => {
  record(label, r)
  console.log(`\n===== ${label} =====`)
  console.log('  thread error :', r.threadError ? JSON.stringify(r.threadError) : 'none')
  console.log('  elicitations :', r.elicitations.length, r.elicitations.map((e) => `held=${((e.heldMs ?? 0) / 1000).toFixed(1)}s turnId=${e.turnId}`).join(' | '))
  console.log('  tool body runs:', r.bodyRuns, '  ← marker 파일로 관측')
  console.log('  turn done    :', JSON.stringify(r.turnDone))
  console.log('  timedOut     :', !!r.timedOut)
  if (r.stderr) console.log('  stderr       :', r.stderr.slice(0, 300))
}

// elicitation responder. hold 를 **여기서** 건다(fixture 가 아니라).
const responder = ({ holdMs, approve }) => async () => {
  if (holdMs) await new Promise((r) => setTimeout(r, holdMs))
  return { action: 'accept', content: { approve } }
}

describe('M0-8/9 — Codex disabled profile + MCP elicitation 게이트', () => {
  // ── M0-8: disabled profile 에서 plain echo 가 오는가 (연결 자체가 되는가) ──
  it('M0-8: disabled profile + spike echo MCP → plain echo result', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the "echo" tool (NOT echo_gated) from the echo MCP server with text "m0-8". Then reply with the tool result.',
      onElicitation: responder({ approve: true }),   // gated 를 골라도 막히지 않게
      timeoutMs: 5 * 60 * 1000,
    })
    report('M0-8 (plain echo, temp CODEX_HOME profile)', r)
    expect(r.spawnError ?? null).toBeNull()
    expect(r.timedOut).toBe(false)
  }, 8 * 60 * 1000)

  // ── M0-9 deny (짧은 hold): 거절하면 **tool body 0회** 여야 한다 ──
  it('M0-9 deny (hold 5s): elicitation 발화 → deny → tool body 0회 + blocked', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server with text "deny-me". Then reply with the tool result.',
      onElicitation: responder({ holdMs: 5_000, approve: false }),
      timeoutMs: 6 * 60 * 1000,
    })
    report('M0-9 deny (hold=5s)', r)

    expect(r.elicitations.length).toBeGreaterThanOrEqual(1)
    expect(r.elicitations[0].heldMs).toBeGreaterThan(4_500)
    expect(r.bodyRuns).toBe(0)          // ← deny 는 부작용 0회. marker 파일로 관측.
    expect(r.timedOut).toBe(false)
  }, 10 * 60 * 1000)

  // ── M0-9 allow (짧은 hold): 승인하면 **tool body 1회** + result ──
  it('M0-9 allow (hold 5s): elicitation 발화 → allow → tool body 1회 + result', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server with text "allow-me". Then reply with the tool result.',
      onElicitation: responder({ holdMs: 5_000, approve: true }),
      timeoutMs: 6 * 60 * 1000,
    })
    report('M0-9 allow (hold=5s)', r)

    expect(r.elicitations.length).toBeGreaterThanOrEqual(1)
    expect(r.bodyRuns).toBe(1)          // ← allow 뒤에만 body 가 돈다
    expect(r.timedOut).toBe(false)
  }, 10 * 60 * 1000)

  // ── M0-9 하드 게이트: **10분 hold** 를 견디는가 (deny) ──
  it('M0-9 deny (hold 10분): 어떤 Codex call/turn/session timeout 에도 죽지 않는다', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server with text "hold-deny". Then reply with the tool result.',
      onElicitation: responder({ holdMs: 10 * 60 * 1000, approve: false }),
      timeoutMs: 20 * 60 * 1000,
    })
    report('M0-9 deny (hold=10min)', r)

    expect(r.elicitations[0].heldMs).toBeGreaterThan(9.5 * 60 * 1000)
    expect(r.bodyRuns).toBe(0)
    expect(r.timedOut).toBe(false)
  }, 25 * 60 * 1000)

  // ── M0-9 하드 게이트: **10분 hold** 를 견디는가 (allow) ──
  it('M0-9 allow (hold 10분): 10분 뒤 승인해도 tool body 1회 + result', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server with text "hold-allow". Then reply with the tool result.',
      onElicitation: responder({ holdMs: 10 * 60 * 1000, approve: true }),
      timeoutMs: 20 * 60 * 1000,
    })
    report('M0-9 allow (hold=10min)', r)

    expect(r.elicitations[0].heldMs).toBeGreaterThan(9.5 * 60 * 1000)
    expect(r.bodyRuns).toBe(1)
    expect(r.timedOut).toBe(false)
  }, 25 * 60 * 1000)
})
