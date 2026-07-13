/**
 * M0-10 — Codex 지속 thread + `turn/steer`.
 *
 * **스펙 criterion:** app-server **1개** / thread **1개** 에서 **turn 2개 이상**, **60분 workflow**,
 * **mid-run `turn/steer`** 를 통과한다. **app-server/thread 재생성 또는 steer 의미 불보존이면 FAIL.**
 * (실패 시: `interrupt current turn → 같은 thread 의 새 turn 에 지시 재주입` 이 동일 의도를 보존하는지 검증하고,
 *  둘 다 실패하면 Codex 오케스트레이터를 ship 하지 않는다.)
 *
 * 정본 타입 (vendored 0.142.5):
 *   `TurnSteerParams  = { threadId, clientUserMessageId?, input, expectedTurnId }`
 *     └ `expectedTurnId` 는 **필수**다. *"Required active turn id precondition.
 *        The request fails when it does not match the currently active turn."*
 *   `TurnSteerResponse = { turnId }`
 *
 * ⚠️ **`DEFAULT_TIMEOUT_MS = 10분`(codexSdk.js) 과의 관계.**
 *    그건 제품의 `runCodexTurn` **wrapper** 가 거는 run timeout 이다 (story 는 "한 프롬프트 = 한 스레드 = 한 턴").
 *    60분 오케스트레이터 세션은 그 wrapper 를 쓰면 **10분에 죽는다.**
 *    이 스파이크는 app-server 를 직접 물고 있으므로 그 wrapper 를 안 탄다 —
 *    즉 **"app-server/thread 가 60분을 견디는가"** 를 재는 것이고, wrapper 는 M2 가 안 쓰면 되는 문제다.
 *    그래서 이 파일은 **"app-server 자체의 수명"** 만 판정한다.
 *
 * `npm run test:spike` (SPIKE=1) 로만 돈다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
    `${RESULT_DIR}/m0-10-raw.jsonl`,
    JSON.stringify({ runId: RUN_ID, label, codexBin: CODEX_BIN, codexVersion: CODEX_VERSION, ...data }) + '\n',
  )
}

const sessions = []
const workDirs = []
afterEach(async () => {
  record('__verdict__', { verdict: 'see-runner' })
  while (sessions.length) await sessions.pop().close()
  while (workDirs.length) rmSync(workDirs.pop(), { recursive: true, force: true })
})

/**
 * **app-server 1개 + thread 1개**를 열고 유지한다. 여기서 turn 을 여러 번 돌린다.
 * criterion 의 핵심이 "재생성하지 않는다" 이므로 spawn/thread-start 는 **정확히 한 번**만 한다.
 */
async function openCodexSession({ slowMs = 0 } = {}) {
  const workDir = mkdtempSync(join(tmpdir(), 'm0-10-'))
  workDirs.push(workDir)
  const markerPath = join(workDir, 'marker')

  // 제품 3경로를 그대로 통과한다 (M0-8 과 같은 규칙).
  const runtime = await prepareCodexRuntimeHome({ env: process.env })
  const opts = buildCodexClientOptions({
    env: runtime.env,
    runtimeProfile: 'orchestrator',
    mcpServers: {
      echo: {
        command: process.execPath,
        args: [FIXTURE],
        env: {
          ECHO_GATED_MARKER_FILE: markerPath,
          // slow_echo 는 env 로만 등록된다 — 안 그러면 M0-8 의 inventory exact-match 가 깨진다.
          ...(slowMs > 0 ? { ECHO_SLOW_MS: String(slowMs) } : {}),
        },
      },
    },
  })

  const child = spawn(CODEX_BIN, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env: opts.env })
  const pid = child.pid

  let nextId = 100
  const pending = new Map()        // 우리 요청 id → resolve
  const listeners = new Set()      // (msg) => void
  const events = []                // 관측 로그
  const elicitations = []          // 승인 요청 관측 (pending 을 만들려면 필요하다)
  let buf = ''
  // 기본은 즉시 승인. 테스트가 갈아끼우면 **붙잡을 수** 있다.
  let elicitResponder = () => undefined

  const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n')
  /**
   * ⚠️ **모든 요청에 timeout 을 건다.** 안 걸면 서버가 응답을 안 줄 때 **영원히 매달린다** —
   * 실제로 밟았다: 틀린 `expectedTurnId` 로 `turn/steer` 를 쐈더니 응답이 안 왔고, 20분짜리 테스트가
   * 32분 넘게 걸려 있었다. **"응답이 없다" 도 측정 결과다** — 그러려면 유한 시간에 그걸 알아야 한다.
   */
  const request = (method, params, timeoutMs = 60_000) => new Promise((res, rej) => {
    const id = nextId++
    const t = setTimeout(() => {
      pending.delete(id)
      rej(Object.assign(new Error(`no response to ${method} in ${timeoutMs}ms`), { noResponse: true }))
    }, timeoutMs)
    pending.set(id, {
      res: (v) => { clearTimeout(t); res(v) },
      rej: (e) => { clearTimeout(t); rej(e) },
    })
    send({ jsonrpc: '2.0', id, method, params })
  })

  child.stdout.on('data', (d) => {
    buf += d.toString()
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
      if (!line) continue
      let m; try { m = JSON.parse(line) } catch { continue }

      // ⚠️ 서버→클라이언트 **요청도 id 를 쓴다.** 요청/응답은 `method` 유무로만 갈린다.
      if (m.method) {
        // 승인은 전부 즉시 통과시킨다 — 여기서 재는 건 승인이 아니라 **thread 수명과 steer** 다.
        if (m.method === 'mcpServer/elicitation/request') {
          const isNative = m.params?._meta?.codex_approval_kind === 'mcp_tool_call'
          const rec = { at: Date.now(), kind: isNative ? 'native' : 'fixture', id: m.id }
          elicitations.push(rec)
          // ⚠️ **elicitation 도 waitable 채널로 흘린다.** 안 그러면 `waitFor` 가 이걸로는 절대 안 깨어나고
          //    무관한 이벤트나 timeout 으로만 풀린다 — 실제로 그랬다(3분 timeout 경로로 179.7초를 낭비했고,
          //    "승인 창이 pending 이었다" 는 **우연히** 참이었다).
          for (const fn of listeners) fn({ method: '__elicitation__', rec })
          // responder 를 갈아끼울 수 있어야 **pending elicitation** 을 만들 수 있다 (Q5).
          Promise.resolve(elicitResponder(m.params, rec)).then((payload) => {
            rec.heldMs = Date.now() - rec.at
            send({ jsonrpc: '2.0', id: m.id, result: payload ?? (isNative
              ? { action: 'accept', content: {}, _meta: null }
              : { action: 'accept', content: { approve: true }, _meta: null }) })
          })
          continue
        }
        events.push({ at: Date.now(), method: m.method, params: m.params })
        for (const fn of listeners) fn(m)
        continue
      }

      const p = pending.get(m.id)
      if (p) {
        pending.delete(m.id)
        if (m.error) p.rej(Object.assign(new Error(m.error.message), { rpc: m.error }))
        else p.res(m.result)
      }
    }
  })

  const waitFor = (pred, timeoutMs, what) => new Promise((res, rej) => {
    const hit = events.find(pred)
    if (hit) return res(hit)
    const t = setTimeout(() => { listeners.delete(fn); rej(new Error(`timeout waiting for ${what}`)) }, timeoutMs)
    const fn = (m) => {
      if (!pred(m)) return
      clearTimeout(t); listeners.delete(fn); res(m)
    }
    listeners.add(fn)
  })

  // ── handshake: **딱 한 번** ──
  await request('initialize', {
    clientInfo: { name: 'autoflowcut-m0-10', title: 'AutoFlowCut M0-10', version: '0.0.1' },
    capabilities: { experimentalApi: true, requestAttestation: false },
  })
  send({ jsonrpc: '2.0', method: 'initialized', params: {} })

  const started = await request('thread/start', buildOrchestratorThreadParams({
    workingDirectory: workDir, config: opts.config,
  }))
  const threadId = started?.threadId ?? started?.thread?.id

  /** 한 턴을 돌리고 끝날 때까지 기다린다. `onInFlight(turnId)` 는 턴이 도는 중에 부른다. */
  const runTurn = async (text, { timeoutMs = 10 * 60 * 1000, onInFlight } = {}) => {
    const startedAt = Date.now()
    const ack = await request('turn/start', { threadId, input: [{ type: 'text', text }] })
    const turnId = ack?.turn?.id
    const done = waitFor(
      (m) => m.method === 'turn/completed' && m.params?.turn?.id === turnId,
      timeoutMs, `turn/completed(${turnId})`,
    )
    if (onInFlight) await onInFlight(turnId)
    const completed = await done
    const toolCalls = events
      .filter((e) => e.method === 'item/completed' && e.params?.item?.type === 'mcpToolCall' && e.params?.turnId === turnId)
      .map((e) => ({ tool: e.params.item.tool, status: e.params.item.status, resultText: e.params.item.result?.content?.map((c) => c.text).join('') ?? null }))
    const finalText = events
      .filter((e) => e.method === 'item/completed'
        && e.params?.item?.type === 'agentMessage'
        && e.params?.turnId === turnId
        && e.params?.item?.phase === 'final_answer')
      .map((e) => e.params.item.text).join('\n')
    return { turnId, finalText, toolCalls, wallMs: Date.now() - startedAt, status: completed.params?.turn?.status ?? null, error: completed.params?.turn?.error ?? null }
  }

  const session = {
    pid, threadId, events, elicitations, request, runTurn, waitFor,
    setElicitResponder: (fn) => { elicitResponder = fn },
    alive: () => { try { process.kill(pid, 0); return true } catch { return false } },
    close: async () => { try { child.kill('SIGTERM') } catch {} ; await runtime.cleanup() },
  }
  sessions.push(session)
  return session
}

describe('M0-10 — Codex 지속 thread + turn/steer', () => {
  /**
   * 🎯 **criterion 은 "같은 app-server / 같은 thread 에서 셋 다"** 다:
   *    *"세션은 최소 **60분 workflow, 후속 user message, mid-run `turn/steer`** 를
   *      **같은 app-server/thread 에서** 통과해야 한다"*
   *
   * ⚠️ 처음엔 "60분 견딤" 과 "steer 됨" 을 **두 세션으로 나눠서** 재고 합성으로 PASS 를 주장했다.
   *    **합성이 깨지는 지점이 바로 위험 지점이다** — 50분 idle 뒤의 steer, 오래된 thread 의 active-turn 추적,
   *    승인 창이 떠 있는 채로의 steer. 아무도 안 쟀다. 그래서 **한 세션**으로 합친다.
   */
  it('🎯 한 app-server / 한 thread 에서 60분 + 후속 user message + mid-run steer 를 전부 통과한다', async () => {
    const SLOW_MS = 90_000
    const s = await openCodexSession({ slowMs: SLOW_MS })
    const t0 = Date.now()
    const elapsed = () => (Date.now() - t0) / 60000
    const marks = []
    const log = (m) => { console.log(`  [${elapsed().toFixed(1)}분] ${m}`); marks.push({ atMin: +elapsed().toFixed(2), m }) }

    // ── turn 1 (t=0) ──
    const t1 = await s.runTurn('Call the "echo" tool from the echo MCP server with text "first". Then reply with the tool result.', { timeoutMs: 8 * 60 * 1000 })
    log(`turn1 → ${t1.status} ${JSON.stringify(t1.finalText.slice(0, 40))}`)

    // ⚠️ **idle 을 진짜로 견디는지**가 핵심이다. keepalive 를 쏘면 "idle timeout 이 있는데 우리가 가려버린" 측정이 된다.
    await new Promise((r) => setTimeout(r, 26 * 60 * 1000))

    // ── turn 2 (t≈26) — **후속 user message** (criterion 이 명시한 그것) ──
    const t2 = await s.runTurn('Reply with exactly the word SECOND and nothing else.', { timeoutMs: 8 * 60 * 1000 })
    log(`turn2 (후속 user message) → ${t2.status} ${JSON.stringify(t2.finalText)}`)

    await new Promise((r) => setTimeout(r, 26 * 60 * 1000))

    // ── turn 3 (t≈52) — **승인 창이 pending 인 채로 steer 를 쏘면?** (아무도 안 쟀다) ──
    let steerWhilePending = null
    let releaseGate
    const gateHeld = new Promise((r) => { releaseGate = r })
    let nativePendingAtSteer = null
    s.setElicitResponder(async (params, rec) => {
      if (rec.kind !== 'native') return undefined         // fixture 게이트는 즉시 통과
      await gateHeld                                       // native 승인을 **붙잡는다** → pending 상태
      return { action: 'accept', content: {}, _meta: null }
    })
    const t3 = await s.runTurn('Call the echo_gated tool from the echo MCP server with text "gated". Then reply with the tool result.', {
      timeoutMs: 8 * 60 * 1000,
      onInFlight: async (turnId) => {
        // 승인 창이 **실제로 뜰 때까지** 기다린다 → 그 상태에서 steer 를 쏜다.
        await s.waitFor(
          (m) => m.method === '__elicitation__' && m.rec.kind === 'native',
          3 * 60 * 1000, 'native elicitation 도착',
        )
        // 🔴 **steer 를 쏘는 그 시점에 native 가 정말 pending 인가**를 못박는다.
        //    안 박으면 elicitation 이 늦게 떠서 **아무것도 pending 이 아닌 채** steer 를 재고도 초록이 된다.
        nativePendingAtSteer = s.elicitations.some((e) => e.kind === 'native' && e.heldMs === undefined)
        try {
          const ok = await s.request('turn/steer', {
            threadId: s.threadId, expectedTurnId: turnId,
            input: [{ type: 'text', text: 'Also mention the word PENDINGSTEER in your final reply.' }],
          }, 30_000)
          steerWhilePending = { accepted: true, ...ok }
        } catch (err) {
          steerWhilePending = { accepted: false, error: err.rpc ?? { message: err.message, noResponse: !!err.noResponse } }
        }
        releaseGate()                                      // 이제 승인을 풀어준다
      },
    })
    log(`turn3 (pending 승인 중 steer) → ${t3.status} | steerWhilePending=${JSON.stringify(steerWhilePending)}`)

    // ── turn 4 (t≈54) — **mid-run steer 가 의미를 바꾸는가** + in-flight 툴이 살아남는가 ──
    s.setElicitResponder(() => undefined)                  // 다시 즉시 승인
    let steerResult = null
    let staleSteerError = null
    const t4 = await s.runTurn(
      'Call the slow_echo tool from the echo MCP server with text "original". '
      + 'After the tool returns, reply with exactly the word ORIGINAL and nothing else.',
      {
        timeoutMs: 10 * 60 * 1000,
        onInFlight: async (turnId) => {
          await s.waitFor((m) => m.method === 'item/started' && m.params?.item?.type === 'mcpToolCall'
            && m.params?.item?.tool === 'slow_echo', 5 * 60 * 1000, 'slow_echo item/started')

          // (a) 틀린 expectedTurnId 는 **거부돼야 한다** (타입 주석이 그렇게 못박는다)
          try {
            const ok = await s.request('turn/steer', {
              threadId: s.threadId, expectedTurnId: '00000000-0000-0000-0000-000000000000',
              input: [{ type: 'text', text: 'this must not apply' }],
            }, 30_000)
            staleSteerError = { WRONGLY_SUCCEEDED: ok }
          } catch (err) {
            staleSteerError = err.rpc ?? { message: err.message, noResponse: !!err.noResponse }
          }

          // (b) 진짜 steer
          steerResult = await s.request('turn/steer', {
            threadId: s.threadId, expectedTurnId: turnId,
            input: [{ type: 'text', text: 'Change of plan: when the tool returns, reply with exactly the word STEERED instead of ORIGINAL.' }],
          }, 60_000)
        },
      },
    )
    log(`turn4 (mid-run steer) → ${t4.status} ${JSON.stringify(t4.finalText)} | tools=${JSON.stringify(t4.toolCalls)}`)

    // 60분을 채운다 (criterion 은 **최소 60분**이다. 58 로 깎지 않는다.)
    while (elapsed() < 60.5) await new Promise((r) => setTimeout(r, 30_000))

    // ── turn 5 (t>60) — 60분을 넘긴 뒤에도 **같은 thread 가 산다** ──
    const t5 = await s.runTurn('Reply with exactly the word ALIVE and nothing else.', { timeoutMs: 8 * 60 * 1000 })
    log(`turn5 (60분 경과 후) → ${t5.status} ${JSON.stringify(t5.finalText)}`)

    const totalMin = elapsed()
    const turns = [t1, t2, t3, t4, t5]
    const r = {
      pid: s.pid, threadId: s.threadId, totalMin,
      turns: turns.map((t) => ({ turnId: t.turnId, status: t.status, finalText: t.finalText.slice(0, 60), wallMs: t.wallMs, toolCalls: t.toolCalls })),
      steerResult, staleSteerError, steerWhilePending, nativePendingAtSteer,
      elicitations: s.elicitations.map((e) => ({ kind: e.kind, heldMs: e.heldMs })),
      marks, alive: s.alive(),
      appServerRespawned: false,     // spawn 은 딱 한 번이다 (구성상)
      threadRecreated: false,        // thread/start 도 딱 한 번이다 (구성상)
    }
    record('M0-10 한 세션: 60분 + 후속 user message + mid-run steer', r)
    console.log('\n===== M0-10 =====')
    console.log('  총 경과   :', totalMin.toFixed(1), '분  | pid', s.pid, '| thread', s.threadId, '| alive', s.alive())
    console.log('  stale steer:', JSON.stringify(staleSteerError))
    console.log('  steer      :', JSON.stringify(steerResult))
    console.log('  pending 중 steer:', JSON.stringify(steerWhilePending))

    // ── criterion 1: 60분 (최소 60. 58 로 깎지 않는다) ──
    expect(totalMin).toBeGreaterThanOrEqual(60)

    // ── criterion 2: app-server / thread 재생성 없음, turn 2개 이상 ──
    expect(s.alive(), 'app-server 가 죽었다').toBe(true)
    expect(new Set(turns.map((t) => t.turnId)).size, '서로 다른 turn 이 5개여야 한다').toBe(5)
    for (const t of turns) expect(t.status, `turn ${t.turnId} 가 completed 가 아니다`).toBe('completed')
    expect(t2.finalText).toContain('SECOND')     // 후속 user message
    expect(t5.finalText).toContain('ALIVE')      // 60분 넘겨서도 산다

    // ── criterion 3: mid-run steer 가 **의미를 바꾼다** ──
    expect(t4.finalText).toContain('STEERED')
    expect(t4.finalText).not.toContain('ORIGINAL')
    expect(steerResult?.turnId, 'steer 가 그 turn 에 안 꽂혔다').toBe(t4.turnId)

    // 🔴 **의미 보존의 나머지 절반**: steer 가 in-flight 툴을 **죽이지 않았는가.**
    //    codex 가 slow_echo 를 취소하고 곧장 STEERED 라고 답해도 위 assertion 은 통과한다.
    //    오케스트레이터에서 steer 는 "돌고 있는 배치를 죽이지 않고 계획만 수정" 이어야 한다.
    const slow = t4.toolCalls.find((t) => t.tool === 'slow_echo')
    expect(slow, 'slow_echo tool call 기록이 없다').toBeTruthy()
    expect(slow.status, '🔴 steer 가 in-flight tool call 을 죽였다 — 의미 불보존이다').toBe('completed')
    expect(t4.wallMs, 'turn 이 slow_echo 보다 빨리 끝났다 = 툴이 취소된 것').toBeGreaterThanOrEqual(SLOW_MS * 0.9)

    // ── criterion 4: expectedTurnId precondition ──
    expect(staleSteerError, '틀린 expectedTurnId 로 steer 했는데 성공했다').toBeTruthy()
    expect(staleSteerError.WRONGLY_SUCCEEDED, '틀린 expectedTurnId 가 수락됐다 — 다른 turn 에 steer 가 꽂힐 수 있다').toBeUndefined()

    // ── 승인 pending 중 steer ──
    //    스펙에 요구가 없어서 **판정이 아니라 기록**이지만, D9/D20 설계가 이 관측 위에 선다.
    //    → **"steer 를 쏘는 그 시점에 native 가 pending 이었다" 를 못박는다.** 안 박으면 관측이 구전이 된다.
    expect(nativePendingAtSteer, '🔴 steer 시점에 native 승인이 pending 이 아니었다 — 다른 걸 쟀다').toBe(true)
    expect(steerWhilePending, 'pending 중 steer 를 시도조차 못 했다').toBeTruthy()
    // 승인 우회가 아님을 확인: gated body 는 **accept 뒤에만** 돈다 (결과에 approved: 가 있다).
    expect(t3.toolCalls.find((t) => t.tool === 'echo_gated')?.resultText).toContain('approved:')
  }, 80 * 60 * 1000)
})
