/**
 * M0-8 / M0-9 — Codex disabled profile + MCP elicitation 게이트.
 *
 * **M2 에서 Codex 를 ship 할지 가르는 하드 게이트다.**
 *
 * 스펙(v11):
 *   M0-8: orchestrator tool features(shell/browser/patch/plugins)를 disabled 로 둔 채 echo MCP 에 연결한다.
 *         **client options / runtime home / thread profile 을 모두 통과해** plain echo result 가 오면 PASS.
 *   M0-9: **같은 disabled profile 에서** gated echo tool 이 elicitation 을 열어야 하고, deny/allow 두 run 모두
 *         **10분 hold 해도 어떤 Codex call/turn/session timeout 에도 죽지 않고**,
 *         deny → tool body 0회/blocked, allow → tool body 1회/result 여야 PASS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 이전 라운드가 틀렸던 것 (Codex 교차 리뷰가 잡았다) — 같은 함정을 다시 파지 마라
 *
 * 1. **disabled profile 이 아니었다.** `sandbox:'read-only'` 만 걸고 tool feature 는 안 껐다.
 *    raw 에 `commandExecution` 으로 ambient `~/.codex/superpowers/.../SKILL.md` 를 읽은 기록이 남았다.
 *    shell 이 살아 있는 run 은 M0-8 도 M0-9 도 측정한 게 아니다. → 이제 제품의
 *    `buildCodexClientOptions()` (= TOOL_FEATURE_OVERRIDES) 를 통과한다. 스펙이 요구한 그것이다.
 *
 * 2. **엉뚱한 바이너리를 쟀다.** `spawn('codex')` 는 PATH 상 `node_modules/.bin/codex`(0.142.5) 를 잡는데
 *    스키마는 전역 0.144.1 에서 뽑았다. → 이제 제품의 `resolveCodexExecutablePath()` 로 **절대경로 고정**하고
 *    버전을 raw 에 박는다.
 *
 * 3. **native gate 가 사라져도 테스트가 통과했다.** responder 가 "첫 elicitation" 을 kind 무관하게 hold 했다.
 *    → 이제 hold 대상을 명시(`holdWhich`)하고 elicitation kind 의 **순서까지** 못박는다.
 *
 * 4. `turn ok` 가 측정값이 아니라 상수였다. → 실제 `turn.status`/`turn.error` 를 읽는다.
 *
 * 5. **엉뚱한 게이트를 쟀다.** native 승인을 10분 붙잡아놓고 M0-9 PASS 라고 했다. 스펙 M0-S08 은
 *    *"**gated echo tool 내부** elicitation"* 을 10분 붙잡으라고 한다 — 다른 물건이다.
 *    **criterion 을 통과한 게 아니라 criterion 을 바꿔서 통과시킨 것**이었다.
 *    → 이제 스펙 경로(`holdWhich:'fixture'`)가 정본 테스트고, native 는 보너스로 따로 잰다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * elicitation 은 **두 종류**다 (실측):
 *   #0 native — Codex 가 만든 MCP tool-call 승인.
 *      `_meta.codex_approval_kind:'mcp_tool_call'`, `_meta.persist:['session','always']`, `requestedSchema:{}`
 *      **툴 호출 자체를 막는다.** MCP 서버 쪽 코드가 필요 없다.
 *      ⚠️ 단 **모든** MCP tool call 에 뜬다 — plain `echo` 에도. 스펙의 *"read 1개가 UI 없이 실행"* 요구 과
 *         충돌하므로, 채택하려면 adapter 가 R 툴을 UI 없이 auto-accept 해야 한다(설계 결정).
 *         분류 근거로 `_meta.tool_title` 을 믿지 마라 — 생성 타입상 `_meta` 는 `JsonValue` 다.
 *   #1 fixture — handler 안의 `elicitInput()`. **body 가 이미 도는 중**이라야 발화.
 *      **스펙의 제품 설계(§D9 결정2: "adapter process 안에서 elicitInput() form elicitation을 발행")가 이 모양이다** — adapter 의 tool handler 가 elicitInput 을 소유한다.
 *
 * body 실행 횟수는 child 메모리가 아니라 **marker 파일**로 관측한다.
 *
 * `npm run test:spike` (SPIKE=1) 로만 돈다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

// 어느 바이너리를 쟀는지 안 적으면 측정이 아니다. 제품이 쓸 바로 그 실행파일을 고정한다.
const CODEX_BIN = resolveCodexExecutablePath()
const CODEX_VERSION = execFileSync(CODEX_BIN, ['--version'], { encoding: 'utf-8' }).trim()

/**
 * ⚠️ **invocation 을 식별한다.** 없으면 raw 가 여러 run 을 섞는다 — 실제로 밟았다:
 * `pool:'forks'` 라서 앞선 run 을 `pkill` 했을 때 **fork worker 가 살아남아** 옛 결과를
 * 새 run 의 raw 중간에 써넣었고, 문서가 그 오염된 숫자를 인용했다.
 *
 * `SPIKE_RUN_ID` 는 `scripts/run-spike.mjs` 가 심는다 → **파일이 여러 개여도 한 invocation 은 한 id** 다.
 * (fallback 은 파일별 id. 그래도 안 섞이는 것보단 낫다.)
 */
const RUN_ID = process.env.SPIKE_RUN_ID ?? `nofile-${process.pid}`

const record = (label, data) => {
  mkdirSync(RESULT_DIR, { recursive: true })
  appendFileSync(
    `${RESULT_DIR}/m0-8-9-raw.jsonl`,
    JSON.stringify({ runId: RUN_ID, label, codexBin: CODEX_BIN, codexVersion: CODEX_VERSION, ...data }) + '\n',
  )
}

/**
 * ⚠️ `report()` 는 **assertion 전에** 기록한다. 그래서 raw 행만 봐서는 그 run 이 PASS 였는지 알 수 없다 —
 * 실패한 run 의 행이 성공한 run 의 행과 똑같이 생겼다. (실제로 60초 함정 run 의 실패 행을 PASS 로 읽을 뻔했다.)
 * → 테스트가 끝날 때 **판정을 따로 한 줄 남긴다.** 문서가 인용하는 숫자는 `verdict:'passed'` 인 run 것이어야 한다.
 */
afterEach((ctx) => {
  const state = ctx?.task?.result?.state ?? 'unknown'
  record('__verdict__', { test: ctx?.task?.name ?? '(?)', verdict: state })
})

/**
 * disabled profile 에서 나와도 되는 item 들. 이것 말고 뭐가 나오면 **tool surface 가 열려 있다는 뜻**이다.
 * (`commandExecution`, `fileChange`, `webSearch`, `imageGeneration` … 전부 여기 없어야 한다.
 *  이전 라운드에는 실제로 `commandExecution` 이 나와 ambient SKILL.md 를 셸로 읽었다.)
 */
const BENIGN_ITEM_TYPES = new Set(['userMessage', 'agentMessage', 'reasoning', 'mcpToolCall', 'todoList'])

let workDir
beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), 'm0-89-')) })

/**
 * 🔴 **temp CODEX_HOME 에는 사용자의 진짜 `auth.json` 복사본이 들어 있다.** 지우지 않으면 /tmp 에 영구 잔존한다.
 * 실측으로 밟았다 — 정상 GREEN run 만으로 70개가 쌓여 있었다. (핸드오프는 "크래시 시 잔존" 만 적어놨지만
 * **정상 종료도 안 지우고 있었다.**) 테스트가 실패해도 반드시 돈다.
 */
const runtimeCleanups = []
afterEach(async () => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
  workDir = null
  // 🔴 제품 runtime home 에는 사용자의 **진짜 auth.json** 이 들어 있다. 반드시 지운다.
  //    (제품은 cleanup 이 `finally` 에만 있어 크래시 시 `/tmp` 에 영구 잔존한다 — D23 항목.
  //     실측으로 mode 0600 짜리 복사본 3개가 남아 있었다.)
  while (runtimeCleanups.length) await runtimeCleanups.pop()()
})

/**
 * codex app-server 를 **제품 프로필로** 띄우고 한 thread/turn 을 돌린다.
 *
 * @param prompt        모델에게 시킬 것
 * @param onElicitation `mcpServer/elicitation/request` 가 오면 부른다. 반환값이 respond payload.
 *                      **hold 는 여기서 건다** — fixture 가 아니라 responder 쪽이다.
 */
async function runCodexTurn({ prompt, onElicitation, timeoutMs = 25 * 60 * 1000, lockdown = true, elicitTimeoutMs = null }) {
  // ⚠️ **runtime home 도 제품 것을 쓴다.** 스펙 M0-8 의 PASS 기준은
  //    *"client options / **runtime home** / thread profile 을 **모두 통과**"* 다.
  //    손으로 mkdtemp + auth.json 복사를 하면 셋 중 하나만 측정하는 것이다.
  const runtime = await prepareCodexRuntimeHome({ env: process.env })
  runtimeCleanups.push(runtime.cleanup)
  const codexHome = runtime.codexHome

  return new Promise((resolve_) => {
    const markerPath = join(workDir, 'echo-body-marker')

    // ── 제품 client options 를 **그대로** 통과한다 (스펙 M0-8/M0-S06 의 요구) ──
    // ⚠️ builder 호출 **뒤에** mcp_servers 를 끼워넣으면 안 된다. 그건 builder 를 우회하는 것이고,
    //    스펙 M0-S06 은 *"`mcp_servers:{}` 후처리 … 남으면 RED"* 라고 못박는다.
    //    → `runtimeProfile:'orchestrator'` + `mcpServers` 인자가 정본 경로다 (스펙 D22 제품 seam: "buildCodexClientOptions({runtimeProfile,authProfile})").
    const opts = buildCodexClientOptions({
      env: runtime.env,                 // 제품 runtime home 이 만든 env (CODEX_HOME 포함)
      runtimeProfile: 'orchestrator',
      mcpServers: {
        echo: {
          command: process.execPath,
          args: [FIXTURE],
          // per-server env. M0-11 이 판정할 `AUTOFLOWCUT_AGENT_TOKEN` 전달 경로와 같은 자리다.
          env: {
            ECHO_GATED_MARKER_FILE: markerPath,
            // null 이면 fixture 기본(30분). '0' 이면 **MCP SDK 기본 60초** = 함정 재현.
            ...(elicitTimeoutMs == null ? {} : { ECHO_ELICIT_TIMEOUT_MS: String(elicitTimeoutMs) }),
          },
          // 병렬 tool call 을 허용해야 "승인 2개가 동시에 pending" 상황을 잴 수 있다.
          supports_parallel_tool_calls: true,
        },
      },
      // A/B negative control. lockdown:false 면 feature 잠금을 **일부러 풀어서**,
      // "우리 관측 장치가 shell 실행을 실제로 볼 수 있는가" 를 먼저 증명한다.
      // (builder 가 caller features 를 덮으므로, 이 경로는 builder 결과를 뒤에서 푼다 — control 전용이다.)
    })
    const config = opts.config
    if (!lockdown) {
      config.features = { ...config.features, shell_tool: true, unified_exec: true }
    }

    const child = spawn(CODEX_BIN, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: opts.env,      // SAFE_ENV_KEYS allowlist. CODEX_HOME 은 runtime.env 를 통해 들어온다.
    })

    const lines = []
    const elicitations = []
    const toolCalls = []
    const toolStartWall = new Map()   // itemId → item/started 벽시계 (게이트 대기까지 포함해 재려고)
    const otherItems = []             // shell 이 정말 죽었는지 보는 negative control
    const stderr = []
    let buf = ''
    let settled = false
    let turnDone = null
    let inventory = null
    let inventoryThreadId = null
    // ⚠️ inventory 는 **페이지네이션**된다. turn 이 먼저 끝나버리면 마지막 페이지를 못 보고 finish 하고,
    //    그러면 "둘째 페이지에 codex_apps 가 있는" 경우가 **조용히 통과한다.**
    //    → 둘 다 끝나야 finish 한다 (barrier).
    let inventoryDone = false
    let turnEnded = false

    const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n')

    const finish = (extra) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGTERM')
      // **무엇에 대해** body 가 돌았는지까지 본다. 줄 수만 세면 "A 를 거절했는데 A 가 돌고 B 가 안 돎"
      // 같은 승인-상관관계 버그가 bodyRuns=1 로 통과한다.
      const bodyTexts = existsSync(markerPath)
        ? readFileSync(markerPath, 'utf-8').trim().split('\n').filter(Boolean)
        : []
      resolve_({
        lines: lines.slice(0, 80),
        elicitations, toolCalls, otherItems, inventory,
        stderr: stderr.join('').slice(0, 1500),
        bodyRuns: bodyTexts.length, bodyTexts,
        turnDone, timedOut: false, features: config.features,
        ...extra,
      })
    }
    /** turn 과 inventory(전 페이지)가 **둘 다** 끝나야 종료한다. */
    const maybeFinish = () => { if (turnEnded && inventoryDone) finish({}) }

    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs)

    child.stdout.on('data', (d) => {
      buf += d.toString()
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
        if (!line) continue
        lines.push(line.slice(0, 400))
        let m; try { m = JSON.parse(line) } catch { continue }

        // ⚠️ Codex 의 **서버→클라이언트 요청도 id 0,1,2… 를 쓴다 — 우리 요청 id 와 같은 공간이다.**
        //    요청/응답을 가르는 건 `method` 유무뿐이다. bare `m.id` 로 dispatch 하면 두 번째
        //    elicitation(id:1) 이 thread/start 응답으로 오인돼 threadId=undefined 인 turn/start 가 나간다.
        if (m.method) {
          if (m.method === 'mcpServer/elicitation/request') {
            const at = Date.now()
            const rec = { at, params: m.params, kind: m.params?._meta?.codex_approval_kind ?? 'fixture' }
            elicitations.push(rec)
            // ⚠️ 파서 루프 안에서 await 하지 않는다. 10분 대기 중 다음 'data' 이벤트가 같은 `buf` 를
            //    물고 재진입해서 라인을 중복/유실 처리한다. 응답은 떼어서 보낸다.
            const reqId = m.id
            Promise.resolve(onElicitation?.(m.params)).then((payload) => {
              rec.heldMs = Date.now() - at
              send({ jsonrpc: '2.0', id: reqId, result: payload })
            })
            continue
          }

          // ── **Codex 가 우리를 정말 기다렸는가** 를 재는 곳 ──
          // ⚠️ Codex 의 `durationMs` 로는 못 잰다. 그건 **승인 통과 뒤의 실행 시간**이다
          //    (10분 hold 에서도 17ms). 게이트 대기는 item/started(게이트 전) → item/completed(게이트 후)
          //    **벽시계**로만 보인다. 이걸 안 재면 "Codex 가 우리를 무시하고 스스로 결정하는" 회귀가
          //    조용히 통과한다 — 실제로 그랬다.
          if (m.method === 'item/started' && m.params?.item?.type === 'mcpToolCall') {
            toolStartWall.set(m.params.item.id, Date.now())
          }
          if (m.method === 'item/completed' && m.params?.item?.type === 'mcpToolCall') {
            const it = m.params.item
            const startedWall = toolStartWall.get(it.id)
            toolCalls.push({
              server: it.server,
              tool: it.tool,
              status: it.status,
              wallMs: startedWall == null ? null : Date.now() - startedWall,   // 게이트 대기 포함 = 판정 근거
              codexDurationMs: it.durationMs,                                   // 승인 후 실행시간 (대비용)
              resultText: it.result?.content?.map((c) => c.text).join('') ?? null,
            })
          }
          // negative control: shell/patch/browser 가 정말 죽었는지.
          // 금지 목록이 아니라 **허용 목록**으로 판정한다 — 새 tool surface 가 생기면 조용히 통과하지 말고 터져야 한다.
          if (m.method === 'item/completed' && !BENIGN_ITEM_TYPES.has(m.params?.item?.type)) {
            otherItems.push(m.params.item.type)
          }

          // turn 종료는 **실제 payload** 를 읽는다. 예전엔 `{ok:true}` 상수를 박아서
          // turn 이 failed 여도 표에 'ok' 가 찍혔다.
          if (m.method === 'turn/completed') {
            const t = m.params?.turn ?? {}
            turnDone = { status: t.status ?? null, error: t.error ?? null }
            turnEnded = true
            maybeFinish()
          }
          continue
        }

        // ── 여기부터는 우리 요청에 대한 응답이다 (method 없음) ──

        if (m.id === 0 && m.result) {
          send({ jsonrpc: '2.0', method: 'initialized', params: {} })
          // ⚠️ **thread profile 도 제품 것을 쓴다** (스펙 M0-8: client options / runtime home / thread profile 전부).
          //    `approvalPolicy` 가 급소다 — story 의 `'never'` 는 게이트를 통째로 죽인다.
          send({
            jsonrpc: '2.0', id: 1, method: 'thread/start',
            params: buildOrchestratorThreadParams({ workingDirectory: workDir, config }),
          })
        }

        if (m.id === 1) {
          if (m.error) return finish({ threadError: m.error })
          const threadId = m.result?.threadId ?? m.result?.thread?.id ?? m.result?.id
          // M0-8 negative control: 이 thread 가 **실제로 무엇을 볼 수 있는지** 목록으로 확인한다.
          // ⚠️ threadId 를 안 주면 thread 스코프가 아니라 전역 인벤토리가 온다 (이걸로 한 번 오판했다).
          // ⚠️ 응답은 **페이지네이션된다** (`nextCursor`). 첫 페이지만 읽으면 두 번째 페이지의
          //    codex_apps 를 놓친다. 커서가 없어질 때까지 읽는다.
          send({ jsonrpc: '2.0', id: 3, method: 'mcpServerStatus/list', params: { threadId } })
          inventoryThreadId = threadId
          send({
            jsonrpc: '2.0', id: 2, method: 'turn/start',
            params: { threadId, input: [{ type: 'text', text: prompt }] },
          })
        }

        if (m.id === 3) {
          if (m.error) return finish({ inventoryError: m.error })
          inventory = [
            ...(inventory ?? []),
            ...(m.result.data ?? []).map((sv) => ({ name: sv.name, tools: Object.keys(sv.tools ?? {}).sort() })),
          ]
          if (m.result.nextCursor) {
            send({
              jsonrpc: '2.0', id: 3, method: 'mcpServerStatus/list',
              params: { threadId: inventoryThreadId, cursor: m.result.nextCursor },
            })
          } else {
            inventoryDone = true
            maybeFinish()
          }
        }

        // turn/start 의 즉시 응답은 status:'inProgress' 인 ack 다. 에러일 때만 종료한다.
        if (m.id === 2 && m.error) { turnDone = { status: 'error', error: m.error }; finish({}) }
      }
    })
    child.stderr.on('data', (d) => stderr.push(d.toString()))
    child.on('error', (e) => finish({ spawnError: String(e.message || e) }))

    send({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: {
        clientInfo: { name: 'autoflowcut-m0-spike', title: 'AutoFlowCut M0', version: '0.0.1' },
        // ⚠️ granular approvalPolicy 는 experimentalApi 없이는 거부된다:
        //    -32600 "askForApproval.granular requires experimentalApi capability".
        //    → **Codex 게이트는 experimental 표면 위에 있다.** M2 adapter 는 이걸 계약으로 못박아야 한다.
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    })
  })
}

const report = (label, r) => {
  record(label, r)
  console.log(`\n===== ${label} =====`)
  console.log('  codex        :', CODEX_VERSION, `(${CODEX_BIN})`)
  console.log('  thread error :', r.threadError ? JSON.stringify(r.threadError) : 'none')
  console.log('  inventory    :', r.inventory ? r.inventory.map((s) => `${s.name}[${s.tools.length}]`).join(' ') : '(미조회)')
  console.log('  elicitations :', r.elicitations.length, r.elicitations.map((e) => `${e.kind} held=${((e.heldMs ?? 0) / 1000).toFixed(1)}s`).join(' | '))
  console.log('  tool calls   :', r.toolCalls.map((t) => `${t.server}/${t.tool} ${t.status} wall=${t.wallMs}ms (codexDur=${t.codexDurationMs}ms) result=${JSON.stringify(t.resultText)}`).join(' | ') || '(none)')
  console.log('  비허용 item  :', r.otherItems.length ? r.otherItems.join(',') : '(none) ← shell/patch/browser 안 돌았다')
  console.log('  tool body runs:', r.bodyRuns, JSON.stringify(r.bodyTexts), '  ← marker 파일로 관측')
  console.log('  turn         :', JSON.stringify(r.turnDone))
  console.log('  timedOut     :', !!r.timedOut)
  if (r.stderr) console.log('  stderr       :', r.stderr.slice(0, 300))
}

/** 모든 run 이 만족해야 하는 것: disabled profile 이었고, turn 이 정상 종료했다. */
const expectDisabledProfileAndCleanTurn = (r) => {
  expect(r.spawnError ?? null).toBeNull()
  expect(r.threadError ?? null).toBeNull()
  expect(r.timedOut).toBe(false)

  // M0-8 의 본문: 이 thread 는 **echo 만** 본다. codex_apps(31개 툴, 사용자 ChatGPT 계정에 작용) 가 붙으면 FAIL.
  // ⚠️ blacklist(=codex_apps 만 확인)가 아니라 **exact match** 다. 낯선 서버도, 빈 인벤토리도, 예상 밖 툴도 막는다.
  expect(r.inventory).not.toBeNull()
  expect(r.inventory).toEqual([{ name: 'echo', tools: ['echo', 'echo_gated'] }])

  // shell/patch 가 정말 죽었는가. 이전 라운드는 이걸 안 봐서 ambient SKILL.md 를 셸로 읽는 run 을
  // "disabled profile 측정" 이라고 불렀다.
  expect(r.otherItems).toEqual([])

  expect(r.turnDone?.status).toBe('completed')
  expect(r.turnDone?.error ?? null).toBeNull()
}

/** gated 호출 하나를 집는다. 모델이 툴을 안 불렀으면 게이트를 측정한 게 아니다. */
const gatedCall = (r) => {
  const c = r.toolCalls.find((t) => t.tool === 'echo_gated')
  expect(c, `echo_gated 호출이 없다 — 게이트를 측정한 게 아니다. toolCalls=${JSON.stringify(r.toolCalls)}`).toBeTruthy()
  return c
}

/**
 * elicitation responder. hold 를 **여기서** 건다(fixture 가 아니라).
 *
 * @param holdWhich  **어느 게이트를 붙잡을지.** 이게 무엇을 측정하는지를 가른다:
 *
 *   `'fixture'` — **스펙 M0-S08 의 criterion 그 자체.**
 *       *"gated echo tool **내부** elicitation 이 `mcpServer/elicitation/request` 를 만든다.
 *         deny/allow 두 run 의 **10분 hold** 중 call/turn/session 생존…"*
 *       native 승인은 즉시 통과시키고, **handler 안에서 열린** elicitation 을 10분 붙잡는다.
 *       제품 설계(스펙 §D9 결정2: "adapter process 안에서 elicitInput() form elicitation을 발행")가 이 모양이다 — adapter 의 tool handler 가 elicitInput 을 소유한다.
 *
 *   `'native'` — Codex 가 스스로 만드는 MCP tool-call 승인(#0)을 붙잡는다.
 *       ⚠️ **(B) 는 2026-07-14 에 기각됐다** (`_meta` 가 비계약 `JsonValue` 고, `tool_title` 이 canonical name 이 아니라
 *          display title 이라 R/G/B 분류가 불가능하다). 이 테스트는 **native 게이트의 동작을 문서화하는 용도**로 남긴다 —
 *          제품은 native 를 **UI 없이 auto-accept** 하므로, 그 auto-accept 가 깨지면(=native 가 사람에게 새면)
 *          여기서 잰 동작이 근거가 된다.
 *       ⚠️ 단 **모든** MCP tool call 에 승인이 뜬다 — plain `echo` 에도. 그래서 스펙의 "read 1개가 UI 없이 실행" 요구 의
 *       *"read 1개는 UI 없이 실행"* 과 충돌한다. 채택하려면 adapter 가 R 툴을 **UI 없이 auto-accept** 해야 한다.
 *       ⚠️ 분류를 `_meta.tool_title` 로 하려 들지 마라 — 생성 타입상 `_meta` 는 그냥 `JsonValue` 라
 *          **계약이 아니다.** tool identity 를 어디서 얻을지가 (B) 채택의 선결 문제다.
 *
 *   ⚠️ 이전 라운드는 `'native'` 만 재놓고 M0-9 PASS 라고 했다. **criterion 을 바꿔서 통과시킨 것**이었다.
 */
const responder = ({ holdMs, approve, holdWhich = 'fixture' }) => async (params) => {
  const isNative = params?._meta?.codex_approval_kind === 'mcp_tool_call'
  const hold = async () => { if (holdMs) await new Promise((r) => setTimeout(r, holdMs)) }

  if (isNative) {
    if (holdWhich === 'native') await hold()
    // native #0 의 requestedSchema 는 `{type:'object',properties:{}}` — 빈 yes/no 다.
    // `_meta` 는 생성 타입상 필수 필드(nullable)라 **명시적으로 null** 을 보낸다.
    // (persist 를 안 고르므로 "이번 한 번만" 승인이다.)
    //
    // holdWhich==='fixture' 일 땐 native 를 **항상 통과**시킨다. 그래야 tool body 에 진입해서
    // handler 내부 elicitation 이 열리고, 스펙이 재라는 그 게이트를 잴 수 있다.
    const allowNative = holdWhich === 'fixture' ? true : approve
    return allowNative
      ? { action: 'accept', content: {}, _meta: null }
      : { action: 'decline', content: null, _meta: null }
  }

  // fixture 의 게이트 (#1). body 가 이미 도는 중이라야 여기 온다.
  if (holdWhich === 'fixture') await hold()
  // 거절은 **`action:'decline'`** 으로 보낸다. 스펙이 쓰는 언어가 그것이고(§D9 결정2: "decline|cancel, close, abort 는
  // Tool Core 호출과 side effect 모두 0회"), 사람이 승인 UI 를 거부했을 때 adapter 가 보낼 값이다.
  // (`{action:'accept', content:{approve:false}}` 도 fixture 는 막지만, 그건 "폼을 채워서 아니오" 라는 다른 의미다.)
  return approve
    ? { action: 'accept', content: { approve: true }, _meta: null }
    : { action: 'decline', content: null, _meta: null }
}

describe('M0-8/9 — Codex disabled profile + MCP elicitation 게이트', () => {
  // ── M0-8: disabled profile 에서 plain echo 가 오는가 ──
  it('M0-8: disabled profile(제품 client options) + echo MCP → plain echo result, codex_apps 없음', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the "echo" tool (NOT echo_gated) from the echo MCP server with text "m0-8". Then reply with the tool result.',
      onElicitation: responder({ approve: true }),
      timeoutMs: 5 * 60 * 1000,
    })
    report('M0-8 (disabled profile, product client options)', r)
    expectDisabledProfileAndCleanTurn(r)

    // 기준은 "**plain echo result 가 온다**" 다. spawn/timeout 만 보면 툴이 안 불려도 통과한다.
    const echo = r.toolCalls.find((t) => t.tool === 'echo')
    expect(echo, `echo 호출이 없다 — MCP 연결/툴 노출을 측정하지 못했다. toolCalls=${JSON.stringify(r.toolCalls)}`).toBeTruthy()
    expect(echo.status).toBe('completed')
    expect(echo.resultText).toContain('m0-8')
  }, 8 * 60 * 1000)

  // ── M0-9 deny (짧은 hold) ──
  // ══════════════════════════════════════════════════════════════════════════
  // 스펙 M0-S08 의 criterion: **gated echo tool 내부** elicitation 을 10분 hold
  // ══════════════════════════════════════════════════════════════════════════

  it('M0-9 [스펙 criterion] deny (handler 내부 elicitation, hold 5s)', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server with text "deny-me". Then reply with the tool result.',
      onElicitation: responder({ holdWhich: 'fixture', holdMs: 5_000, approve: false }),
      timeoutMs: 6 * 60 * 1000,
    })
    report('M0-9 [스펙] deny fixture-hold (5s)', r)
    expectDisabledProfileAndCleanTurn(r)
    expectFixtureHoldDeny(r, 4_500)
  }, 10 * 60 * 1000)

  it('M0-9 [스펙 criterion] allow (handler 내부 elicitation, hold 5s)', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server with text "allow-me". Then reply with the tool result.',
      onElicitation: responder({ holdWhich: 'fixture', holdMs: 5_000, approve: true }),
      timeoutMs: 6 * 60 * 1000,
    })
    report('M0-9 [스펙] allow fixture-hold (5s)', r)
    expectDisabledProfileAndCleanTurn(r)
    expectFixtureHoldAllow(r, 4_500, 'approved:allow-me')
  }, 10 * 60 * 1000)

  it('M0-9 [스펙 criterion] deny — handler 내부 elicitation 을 **10분** hold', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server with text "hold-deny". Then reply with the tool result.',
      onElicitation: responder({ holdWhich: 'fixture', holdMs: 10 * 60 * 1000, approve: false }),
      timeoutMs: 20 * 60 * 1000,
    })
    report('M0-9 [스펙] deny fixture-hold (10분)', r)
    expectDisabledProfileAndCleanTurn(r)
    expectFixtureHoldDeny(r, 9.5 * 60 * 1000)
  }, 25 * 60 * 1000)

  it('M0-9 [스펙 criterion] allow — handler 내부 elicitation 을 **10분** hold', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server with text "hold-allow". Then reply with the tool result.',
      onElicitation: responder({ holdWhich: 'fixture', holdMs: 10 * 60 * 1000, approve: true }),
      timeoutMs: 20 * 60 * 1000,
    })
    report('M0-9 [스펙] allow fixture-hold (10분)', r)
    expectDisabledProfileAndCleanTurn(r)
    expectFixtureHoldAllow(r, 9.5 * 60 * 1000, 'approved:hold-allow')
  }, 25 * 60 * 1000)

  // ── 🔴 함정 회귀 테스트 ──
  // MCP SDK 의 요청 timeout 기본값은 **60초**다. adapter 가 elicitInput 에 timeout 을 안 넘기면
  // 사람이 10분을 고민하는 순간 **우리 쪽 SDK 가** 요청을 죽인다. Codex 가 아니라 우리가.
  // 스펙 §D9 결정2 의 설계(adapter handler 가 elicitInput 소유)는 이 함정 위에 서 있다.
  it('🔴 elicitInput 에 timeout 을 안 넘기면 **60초**에 죽는다 (M2 가 반드시 넘겨야 하는 이유)', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server with text "timeout-trap". Then reply with the tool result.',
      onElicitation: responder({ holdWhich: 'fixture', holdMs: 3 * 60 * 1000, approve: true }),
      elicitTimeoutMs: 0,          // ← MCP SDK 기본값(60초) 그대로
      timeoutMs: 6 * 60 * 1000,
    })
    report('🔴 함정: elicitInput timeout 미지정 → 60초 사망', r)
    expectDisabledProfileAndCleanTurn(r)

    // 3분을 붙잡으려 했는데 60초에 죽는다. **승인 게이트가 60초짜리가 된다.**
    const call = gatedCall(r)
    expect(call.status).toBe('failed')
    expect(call.resultText).toContain('-32001')       // MCP error -32001: Request timed out
    expect(call.wallMs).toBeGreaterThanOrEqual(55_000)
    expect(call.wallMs).toBeLessThan(90_000)          // 3분을 못 버틴다
    expect(r.bodyRuns).toBe(0)
  }, 10 * 60 * 1000)

  // ══════════════════════════════════════════════════════════════════════════
  // 보너스: Codex **native** 게이트(#0) — 스펙엔 없지만 더 강하다.
  // 채택하려면 스펙의 "read 1개가 UI 없이 실행" 요구("read 는 UI 없이")를 위해 adapter 가 R 툴을 auto-accept 해야 한다.
  // ══════════════════════════════════════════════════════════════════════════

  it('native 게이트: deny 하면 tool handler 에 **진입조차 못 한다** (hold 5s)', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server with text "deny-me". Then reply with the tool result.',
      onElicitation: responder({ holdWhich: 'native', holdMs: 5_000, approve: false }),
      timeoutMs: 6 * 60 * 1000,
    })
    report('native deny (hold=5s)', r)
    expectDisabledProfileAndCleanTurn(r)
    expectNativeHoldDeny(r, 4_500)
  }, 10 * 60 * 1000)

  it('native 게이트: **10분** hold 뒤 승인해도 tool body 1회 + result', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server with text "hold-allow". Then reply with the tool result.',
      onElicitation: responder({ holdWhich: 'native', holdMs: 10 * 60 * 1000, approve: true }),
      timeoutMs: 20 * 60 * 1000,
    })
    report('native allow (hold=10분)', r)
    expectDisabledProfileAndCleanTurn(r)
    expect(r.elicitations.map((e) => e.kind)).toEqual(['mcp_tool_call', 'fixture'])
    expect(r.elicitations[0].heldMs).toBeGreaterThanOrEqual(9.5 * 60 * 1000)
    const call = gatedCall(r)
    expect(call.wallMs).toBeGreaterThanOrEqual(9.5 * 60 * 1000)
    expect(call.status).toBe('completed')
    expect(call.resultText).toBe('approved:hold-allow')
    expect(r.bodyRuns).toBe(1)
  }, 25 * 60 * 1000)

  // ══════════════════════════════════════════════════════════════════════════
  // M0-8 negative control (A/B): "shell 이 꺼졌다" 를 **증명**한다
  //
  // ⚠️ `otherItems===[]` 만으로는 부족하다 — 그건 "이번 prompt 에서 shell 을 안 썼다" 일 수도 있다.
  //    관측 장치가 shell 실행을 **실제로 볼 수 있다**는 걸 먼저 보이고(enabled control),
  //    그 다음 같은 prompt 가 lockdown 에서 **아무 item 도 못 만든다**는 걸 보여야 닫힌다.
  // ══════════════════════════════════════════════════════════════════════════

  // ⚠️ **echo MCP 툴이 흉내낼 수 없는 작업이어야 한다.**
  //    처음엔 prompt 가 ``echo m0-8-shell-probe`` 였는데, 잠긴 run 에서 모델이 **MCP `echo` 툴로 그 문자열을
  //    그냥 만들어냈다** (raw: `echo/echo → "m0-8-shell-probe"`). 그러면 shell 이 켜져 있었어도 똑같이 통과한다.
  //    = negative control 이 아무것도 증명하지 못한다. `uname` 은 echo 로 대체 불가능하다.
  const SHELL_PROMPT = 'Run the shell command `uname -sr` and report its exact stdout. Do not use any other tool.'

  it('[control] lockdown 을 풀면 shell 이 실제로 돈다 — 관측 장치가 살아있음을 먼저 증명', async () => {
    const r = await runCodexTurn({
      prompt: SHELL_PROMPT,
      onElicitation: responder({ approve: true }),
      lockdown: false,             // ← 일부러 shell_tool 을 켠다
      timeoutMs: 5 * 60 * 1000,
    })
    report('[control] shell enabled (lockdown 해제)', r)
    expect(r.timedOut).toBe(false)

    // 이게 안 나오면 A/B 자체가 무의미하다 — 우리 관측이 shell 을 못 보는 것뿐일 수 있으니까.
    expect(
      r.otherItems,
      'lockdown 을 풀었는데도 shell item 이 안 보인다 → negative control 이 아무것도 증명하지 못한다',
    ).toContain('commandExecution')
  }, 8 * 60 * 1000)

  it('제품 lockdown: 같은 shell prompt 가 **아무 실행도 못 만든다**', async () => {
    const r = await runCodexTurn({
      prompt: SHELL_PROMPT,
      onElicitation: responder({ approve: true }),
      lockdown: true,
      timeoutMs: 5 * 60 * 1000,
    })
    report('제품 lockdown: shell prompt', r)
    expect(r.timedOut).toBe(false)
    expect(r.otherItems).toEqual([])            // commandExecution 0회
    // echo 로는 `uname` 을 대체할 수 없으므로, MCP 툴로 우회한 것도 아니다.
    expect(r.toolCalls).toEqual([])
    expect(r.turnDone?.status).toBe('completed')
  }, 8 * 60 * 1000)

  // ══════════════════════════════════════════════════════════════════════════
  // 승인 **상관관계**: 두 승인이 동시에 pending 일 때, 응답이 올바른 호출에 붙는가
  //
  // 단일 `pendingApproval` 슬롯이나 turnId 키로 구현해도 직렬 테스트는 전부 통과한다.
  // 병렬 + **역순 응답**에서만 "A 의 승인이 B 에 적용되는" 버그가 드러난다.
  // ══════════════════════════════════════════════════════════════════════════

  it('동시 승인 2개를 **역순으로** 응답해도 각각 올바른 호출에 붙는다', async () => {
    const seen = []
    let releaseFirst
    const firstHeld = new Promise((res) => { releaseFirst = res })
    let sawSecond = false

    // 첫 native 승인을 붙잡아 두 번째가 올 때까지 기다린다.
    // 두 번째가 안 오면 = **Codex 가 MCP tool call 을 직렬화한다**는 뜻이고, 그것도 측정 결과다.
    const onElicitation = async (params) => {
      const isNative = params?._meta?.codex_approval_kind === 'mcp_tool_call'
      if (!isNative) return { action: 'accept', content: { approve: true }, _meta: null }

      const text = params?._meta?.tool_params?.text ?? '(?)'
      seen.push(text)

      if (seen.length === 1) {
        // 두 번째 승인이 뜰 때까지 최대 90초 기다린다 (동시 pending 을 만든다)
        await Promise.race([firstHeld, new Promise((res) => setTimeout(res, 90_000))])
        // 역순 응답: **먼저 온 것(text="alpha")을 거절**한다
        return { action: 'decline', content: null, _meta: null }
      }
      sawSecond = true
      releaseFirst()
      // 나중에 온 것(text="beta")을 **승인**한다 — 먼저 응답이 나간다
      return { action: 'accept', content: {}, _meta: null }
    }

    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server TWICE IN PARALLEL in a single step: once with text "alpha" and once with text "beta". Issue both tool calls together, then reply with both results.',
      onElicitation,
      timeoutMs: 10 * 60 * 1000,
    })
    report('승인 상관관계 (병렬 + 역순 응답)', r)
    record('승인 상관관계 관측', { seenOrder: seen, parallelObserved: sawSecond, bodyTexts: r.bodyTexts })
    expectDisabledProfileAndCleanTurn(r)

    // ⚠️ 여기서 빠져나가면 안 된다. "병렬이 안 나왔으니 통과" 로 두면 **핵심 경로를 한 번도 안 돌리고**
    //    GREEN 이 된다 — 회귀 테스트가 아니라 그냥 장식이 된다.
    //    실측(0.142.5): Codex 는 병렬로 낸다. 안 나오면 **동작이 바뀐 것이고, 그건 알아야 한다.**
    expect(
      sawSecond,
      '두 번째 승인이 90초 안에 안 왔다 → Codex 가 MCP tool call 을 직렬화하도록 바뀌었다. ' +
      '승인 상관관계를 검증하지 못했으므로 이 테스트는 통과할 수 없다. (동작 변화 자체가 finding 이다)',
    ).toBe(true)

    // 동시 pending 이 만들어졌다. 이제 **응답이 올바른 호출에 붙었는지**만 본다.
    //
    // ⚠️ **도착 순서를 계약으로 못박지 마라.** 병렬 호출의 도착 순서는 비결정적이다
    //    (실측: 어떤 run 은 [alpha,beta], 어떤 run 은 [beta,alpha]). 한 번 관찰한 순서를 적어넣었다가
    //    다음 run 에서 죽었다 — **코드가 하는 짓을 받아적은 것**이었다.
    //    계약은 순서와 무관하다: **"먼저 온 걸 거절하고 나중 온 걸 승인하면, 나중 온 것만 실행된다."**
    expect(seen.length).toBe(2)
    expect([...seen].sort()).toEqual(['alpha', 'beta'])

    const declined = seen[0]   // 먼저 온 것 — 붙잡아뒀다가 거절했다
    const approved = seen[1]   // 나중 온 것 — 먼저 승인 응답이 나갔다

    // 거절한 쪽은 절대 안 돌아야 하고, 승인한 쪽은 정확히 1회 돌아야 한다.
    // 단일 pending 슬롯이나 "마지막 응답을 아무 호출에나 붙이는" 구현이면 여기서 죽는다.
    expect(r.bodyTexts).toEqual([approved])

    const approvedCall = r.toolCalls.find((t) => t.resultText === `approved:${approved}`)
    expect(approvedCall, `승인한 "${approved}" 가 실행되지 않았다. toolCalls=${JSON.stringify(r.toolCalls)}`).toBeTruthy()

    const declinedCall = r.toolCalls.find((t) => t.status === 'failed')
    expect(declinedCall, `거절한 "${declined}" 의 호출이 failed 로 안 끝났다. toolCalls=${JSON.stringify(r.toolCalls)}`).toBeTruthy()
    expect(r.toolCalls.some((t) => t.resultText === `approved:${declined}`)).toBe(false)
  }, 15 * 60 * 1000)

  it('D9: persist 를 안 고르면 두 번째 호출에도 native 승인이 다시 뜬다', async () => {
    const r = await runCodexTurn({
      prompt: 'Call the echo_gated tool from the echo MCP server TWICE: first with text "one", then with text "two". Then reply with both tool results.',
      onElicitation: responder({ approve: true }),
      timeoutMs: 8 * 60 * 1000,
    })
    report('D9 persist (2회 호출, persist 미선택)', r)
    expectDisabledProfileAndCleanTurn(r)

    const gated = r.toolCalls.filter((t) => t.tool === 'echo_gated')
    expect(gated.length, `echo_gated 를 2회 부르게 하려 했는데 ${gated.length}회 불렀다`).toBe(2)

    // 핵심: 호출 2회면 native 승인도 **2회** 떠야 한다. 1회면 승인이 암묵적으로 지속된 것이고,
    // 그건 D9 가 깨진 것이다 — **G/B tool call 이 사람 결정 없이 실행된다.**
    // (D9 는 "모든" tool call 이 아니라 R/G/B 다. R 은 UI 없이 통과가 의도된 설계다.)
    const natives = r.elicitations.filter((e) => e.kind === 'mcp_tool_call')
    expect(natives.length).toBe(2)
    expect(r.bodyRuns).toBe(2)
  }, 12 * 60 * 1000)
})

/**
 * 스펙 criterion 의 deny 계약 — **handler 내부** elicitation 을 hold 했을 때.
 *
 * native 는 즉시 통과시켰으므로 tool body 에 **진입은 한다**. 그 안에서 elicitInput 이 열리고,
 * 우리가 hold 뒤 거절하면 fixture 는 `blocked:decline` 을 돌려주고 **marker 를 남기지 않는다**.
 *
 * ⚠️ `bodyRuns===0` 만으로는 부족하다 — Codex 가 우리를 무시하고 스스로 거절해도 0 이다(실제로 그랬다).
 *    그래서 셋을 다 못박는다:
 *      (a) fixture elicitation 이 실제로 열렸고 hold 만큼 붙잡혔다
 *      (b) tool call 이 그 시간 내내 **살아 있었다** (= Codex 가 우리를 기다렸다)
 *      (c) 부작용 0회, 그리고 결과가 **fixture 가 만든** `blocked:decline` 이다
 *          (native 를 거절했다면 이 문자열은 안 나온다 — 어느 게이트가 막았는지 여기서 갈린다)
 */
function expectFixtureHoldDeny(r, minHoldMs) {
  expect(r.elicitations.map((e) => e.kind)).toEqual(['mcp_tool_call', 'fixture'])
  const fixture = r.elicitations[1]
  expect(fixture.heldMs).toBeGreaterThanOrEqual(minHoldMs)          // (a)

  const call = gatedCall(r)
  expect(call.wallMs).toBeGreaterThanOrEqual(minHoldMs)             // (b)

  expect(r.bodyRuns).toBe(0)                                        // (c)
  expect(call.status).toBe('failed')
  expect(call.resultText).toBe('blocked:decline')
}

/** 스펙 criterion 의 allow 계약 — handler 내부 elicitation 을 hold 뒤 승인하면 body 정확히 1회. */
function expectFixtureHoldAllow(r, minHoldMs, expectedResult) {
  expect(r.elicitations.map((e) => e.kind)).toEqual(['mcp_tool_call', 'fixture'])
  expect(r.elicitations[1].heldMs).toBeGreaterThanOrEqual(minHoldMs)

  const call = gatedCall(r)
  expect(call.wallMs).toBeGreaterThanOrEqual(minHoldMs)
  expect(call.status).toBe('completed')
  expect(call.resultText).toBe(expectedResult)
  expect(r.bodyRuns).toBe(1)
}

/**
 * native 게이트의 deny 계약. 여기선 **fixture elicitation 이 0회**여야 한다 —
 * tool handler 에 진입조차 못 했다는 뜻이고, 그게 native 게이트가 막았다는 유일한 증거다.
 */
function expectNativeHoldDeny(r, minHoldMs) {
  const natives = r.elicitations.filter((e) => e.kind === 'mcp_tool_call')
  const fixtures = r.elicitations.filter((e) => e.kind === 'fixture')

  expect(natives.length).toBe(1)
  expect(natives[0].heldMs).toBeGreaterThanOrEqual(minHoldMs)

  const call = gatedCall(r)
  expect(call.wallMs).toBeGreaterThanOrEqual(minHoldMs)

  expect(fixtures.length).toBe(0)          // handler 미진입
  expect(r.bodyRuns).toBe(0)
  expect(call.status).toBe('failed')
  expect(call.resultText ?? '').not.toContain('approved:')
}
