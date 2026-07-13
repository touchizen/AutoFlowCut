/**
 * M0-9 보강 — **`turnId:null` (out-of-band) elicitation**.
 *
 * 스펙 M0-9 는 단일 criterion 안에 이걸 넣어놨다: *"`turnId:null` 도 UI/respond 가 완주해야 한다."*
 * 그런데 tool handler **안에서** 연 elicitation 은 항상 turn 에 correlate 되어 turnId 가 채워진다
 * (실측 6/6 non-null). 그래서 그 경로만 재고 M0-9 PASS 라고 하면 **criterion 하나를 안 돌린 것**이다.
 *
 * 생성 타입이 왜 nullable 인지 직접 말해준다:
 *   > "Active Codex turn when this elicitation was observed, **if app-server could correlate one**.
 *   >  This is nullable because MCP models elicitation as a standalone server-to-client request …"
 * 그리고 Codex 바이너리엔 `out-of-band elicitation count` 카운터가 있다.
 *
 * → fixture 가 **tool handler 밖에서** (turn 이 없을 때) elicitInput 을 열게 하고,
 *   (a) 정말 `turnId:null` 로 오는지
 *   (b) 거기에 respond 해도 되는지
 *   (c) 그 뒤 **세션이 살아서 정상 turn 을 완주**하는지
 *   를 잰다. (c) 가 핵심이다 — out-of-band 승인 하나가 세션을 죽이면 M2 adapter 가 거기서 멈춘다.
 *
 * `npm run test:spike` (SPIKE=1) 로만 돈다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, existsSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
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
    `${RESULT_DIR}/m0-8-9-raw.jsonl`,
    JSON.stringify({ runId: RUN_ID, label, codexBin: CODEX_BIN, codexVersion: CODEX_VERSION, ...data }) + '\n',
  )
}

/** raw 행만 봐서는 PASS 였는지 알 수 없다 (report 는 assertion 전에 기록한다). 판정을 따로 남긴다. */
afterEach((ctx) => {
  record('__verdict__', { test: ctx?.task?.name ?? '(?)', verdict: ctx?.task?.result?.state ?? 'unknown' })
})

// 🔴 temp CODEX_HOME 에는 사용자의 진짜 auth.json 복사본이 있다. 반드시 지운다.
const workDirs = []
const runtimeCleanups = []
afterEach(async () => {
  while (workDirs.length) rmSync(workDirs.pop(), { recursive: true, force: true })
  // 🔴 제품 runtime home 에는 사용자의 진짜 auth.json 이 있다. 반드시 지운다.
  while (runtimeCleanups.length) await runtimeCleanups.pop()()
})

describe('M0-9 — out-of-band elicitation (turnId:null)', () => {
  it('handler 밖 elicitation 은 turnId:null 로 오고, respond 뒤에도 세션이 살아 정상 turn 을 완주한다', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'm0-9-oob-'))
    workDirs.push(workDir)
    // 제품 runtime home (스펙 M0-8: client options / runtime home / thread profile 전부 통과)
    const runtime = await prepareCodexRuntimeHome({ env: process.env })
    runtimeCleanups.push(runtime.cleanup)

    const markerPath = join(workDir, 'echo-body-marker')
    // fixture 의 OOB elicitInput() **promise 가 무엇으로 resolve 됐는지**를 여기에 남긴다.
    // 이게 없으면 "app-server 가 우리 응답을 무시했다" 와 "정상 완주했다" 를 구별할 수 없다.
    const oobResultPath = join(workDir, 'oob-result.jsonl')
    // 제품 builder 를 **그대로** 통과한다 (우회 금지 — 스펙 M0-S06).
    const opts = buildCodexClientOptions({
      env: runtime.env,
      runtimeProfile: 'orchestrator',
      mcpServers: {
        echo: {
          command: process.execPath,
          args: [FIXTURE],
          env: {
            ECHO_GATED_MARKER_FILE: markerPath,
            // thread 가 서면 서버가 뜨고, 2초 뒤 **turn 없이** elicitation 을 연다.
            ECHO_OOB_ELICIT_MS: '2000',
            ECHO_OOB_RESULT_FILE: oobResultPath,
          },
        },
      },
    })
    const config = opts.config

    const r = await new Promise((resolve_) => {
      const child = spawn(CODEX_BIN, ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: opts.env,
      })
      const send = (m) => child.stdin.write(JSON.stringify(m) + '\n')
      const elicitations = []
      let buf = ''
      let settled = false
      let threadId = null
      let turnStarted = false
      let turnDone = null
      const toolCalls = []

      const finish = (extra) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.kill('SIGTERM')
        const bodyRuns = existsSync(markerPath)
          ? readFileSync(markerPath, 'utf-8').trim().split('\n').filter(Boolean).length
          : 0
        // fixture 쪽에서 본 OOB elicitInput() 의 실제 결과
        const oobResult = existsSync(oobResultPath)
          ? JSON.parse(readFileSync(oobResultPath, 'utf-8').trim().split('\n')[0])
          : null
        resolve_({ elicitations, turnDone, bodyRuns, toolCalls, oobResult, timedOut: false, ...extra })
      }
      const timer = setTimeout(() => finish({ timedOut: true }), 5 * 60 * 1000)

      child.stdout.on('data', (d) => {
        buf += d.toString()
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
          if (!line) continue
          let m; try { m = JSON.parse(line) } catch { continue }

          if (m.method) {
            if (m.method === 'mcpServer/elicitation/request') {
              const oob = m.params?._meta?.codex_approval_kind == null && m.params?.turnId == null
              elicitations.push({
                // ⚠️ **"필드가 null 이다" 와 "필드가 없다" 를 구별해서 기록한다.**
                //    `?? null` 로 정규화해버리면 스펙이 요구한 `turnId:null` 을 증명한 게 아니라
                //    "없거나 null 이다" 만 증명한 게 된다.
                hasTurnIdField: Object.prototype.hasOwnProperty.call(m.params ?? {}, 'turnId'),
                rawTurnId: m.params?.turnId,
                turnId: m.params?.turnId ?? null,
                kind: m.params?._meta?.codex_approval_kind ?? 'fixture',
                message: m.params?.message ?? null,
              })
              // 응답이 **완주하는지**가 요구사항이다. accept 로 답한다.
              send({ jsonrpc: '2.0', id: m.id, result: { action: 'accept', content: { approve: true }, _meta: null } })

              // out-of-band 하나를 처리한 뒤 **세션이 살아있는지**를 본다 → 정상 turn 을 하나 돌린다.
              if (oob && !turnStarted) {
                turnStarted = true
                send({
                  jsonrpc: '2.0', id: 2, method: 'turn/start',
                  params: {
                    threadId,
                    input: [{ type: 'text', text: 'Call the "echo" tool from the echo MCP server with text "after-oob". Then reply with the tool result.' }],
                  },
                })
              }
              continue
            }
            if (m.method === 'item/completed' && m.params?.item?.type === 'mcpToolCall') {
              const it = m.params.item
              toolCalls.push({
                tool: it.tool,
                status: it.status,
                resultText: it.result?.content?.map((c) => c.text).join('') ?? null,
              })
            }
            if (m.method === 'turn/completed') {
              const t = m.params?.turn ?? {}
              turnDone = { status: t.status ?? null, error: t.error ?? null }
              finish({})
            }
            continue
          }

          if (m.id === 0 && m.result) {
            send({ jsonrpc: '2.0', method: 'initialized', params: {} })
            send({
              jsonrpc: '2.0', id: 1, method: 'thread/start',
              params: buildOrchestratorThreadParams({ workingDirectory: workDir, config }),
            })
          }
          if (m.id === 1) {
            if (m.error) return finish({ threadError: m.error })
            threadId = m.result?.threadId ?? m.result?.thread?.id
            // ⚠️ turn 을 **일부러 안 띄운다.** out-of-band elicitation 이 먼저 와야 turnId:null 을 잰다.
          }
          if (m.id === 2 && m.error) { turnDone = { status: 'error', error: m.error }; finish({}) }
        }
      })
      child.on('error', (e) => finish({ spawnError: String(e.message || e) }))

      send({
        jsonrpc: '2.0', id: 0, method: 'initialize',
        params: {
          clientInfo: { name: 'autoflowcut-m0-9-oob', title: 'AutoFlowCut M0-9 OOB', version: '0.0.1' },
          capabilities: { experimentalApi: true, requestAttestation: false },
        },
      })
    })

    record('M0-9 out-of-band elicitation (turnId:null)', r)
    console.log('\n===== M0-9 out-of-band (turnId:null) =====')
    console.log('  elicitations:', JSON.stringify(r.elicitations, null, 1))
    console.log('  oob result  :', JSON.stringify(r.oobResult), '  ← fixture 가 본 elicitInput() 결과')
    console.log('  tool calls  :', JSON.stringify(r.toolCalls))
    console.log('  turn        :', JSON.stringify(r.turnDone))
    console.log('  timedOut    :', !!r.timedOut)

    expect(r.spawnError ?? null).toBeNull()
    expect(r.threadError ?? null).toBeNull()
    expect(r.timedOut).toBe(false)

    // (a) turn 없이 열린 elicitation 이 실제로 도착했고, **turnId 가 null 이다**
    const oob = r.elicitations.find((e) => e.message?.startsWith('Out-of-band'))
    expect(oob, `out-of-band elicitation 이 안 왔다 — turnId:null 경로를 측정하지 못했다. elicitations=${JSON.stringify(r.elicitations)}`).toBeTruthy()
    // wire 에 **필드가 있고 그 값이 null** 이어야 한다 (필드 누락과 구별한다).
    expect(oob.hasTurnIdField).toBe(true)
    expect(oob.rawTurnId).toBeNull()

    // (b) **respond 가 정말 완주했다** — MCP 서버 쪽 elicitInput() promise 가 우리 응답으로 resolve 됐다.
    //     ⚠️ 이걸 안 보면 app-server 가 응답을 무시했거나 promise 가 reject 돼도
    //        "후속 turn 이 completed" 만 보고 완주했다고 오판한다. (deny run 도 turn 은 completed 다.)
    expect(r.oobResult, 'fixture 가 OOB elicitInput() 결과를 안 남겼다 — 완주를 관측하지 못했다').toBeTruthy()
    expect(r.oobResult.resolved).toBe(true)
    expect(r.oobResult.action).toBe('accept')
    expect(r.oobResult.content).toEqual({ approve: true })

    // (c) 그 뒤 세션이 살아서 정상 turn 을 끝냈다 — **툴 호출까지 성공**해야 한다.
    //     turn.status 만 보면 tool 이 실패해도 completed 다(deny run 이 그렇다).
    expect(r.turnDone?.status).toBe('completed')
    expect(r.turnDone?.error ?? null).toBeNull()
    const echo = r.toolCalls.find((t) => t.tool === 'echo')
    expect(echo, `OOB 뒤 echo 호출이 없다 — 세션 생존을 증명하지 못했다. toolCalls=${JSON.stringify(r.toolCalls)}`).toBeTruthy()
    expect(echo.status).toBe('completed')
    expect(echo.resultText).toContain('after-oob')
  }, 8 * 60 * 1000)
})
