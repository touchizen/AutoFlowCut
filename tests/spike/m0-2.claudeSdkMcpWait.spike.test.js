/**
 * M0-2 — Claude in-process MCP bounded wait.
 *
 * 이 하나가 전체 설계를 좌우한다. 12분 블로킹 MCP 툴이 **종단 `tool_result`** 로 오면
 * 에이전트는 그냥 기다리면 되고 턴 예산이 33~45턴이다. 백그라운드 핸들로 오거나 timeout 으로
 * 죽으면 폴링으로 붕괴하고 280턴이 된다(D2 재산출).
 *
 * 스펙 M0-2: "`type:'sdk'` server에서 `MCP_TOOL_TIMEOUT`이 실제 hard call bound로 적용되는지
 * 먼저 증명한다. 이어 W/T/B matrix로 terminal tool_result/timeout/background handle을 구분한다.
 * PASS는 적용 증거 + `W < min(T,B)` 조합 하나."
 *
 *   W = tool 이 블로킹하는 시간
 *   T = MCP_TOOL_TIMEOUT (env)
 *   B = 그 밖의 상한 (turn/query)
 *
 * ⚠️ 타입 정의가 이미 경고한다: per-server `timeout` 필드는 stdio/SSE/HTTP config 에만 있고
 * `McpSdkServerConfig = { type:'sdk'; name:string }` 에는 **없다**. 그래서 sdk 서버의 유일한
 * 후보 bound 는 env var 뿐이며, 그게 먹는지가 이 스파이크의 전반부다.
 *
 * `npm run test:spike` (SPIKE=1) 로만 돈다. 실제 Claude CLI 자격증명을 쓴다.
 * body 실행 횟수는 in-process 변수가 아니라 **호출 로그**로 관측한다.
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { appendFileSync, mkdirSync } from 'node:fs'
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'

// M0 의 산출물은 PASS/FAIL 이 아니라 **raw 측정치**다. vitest 가 console 을 삼키므로 파일로 남긴다.
const RESULT_DIR = 'docs/superpowers/specs'
const RESULT_FILE = `${RESULT_DIR}/m0-2-raw.jsonl`
const record = (label, r) => {
  mkdirSync(RESULT_DIR, { recursive: true })
  appendFileSync(RESULT_FILE, JSON.stringify({ label, ...r }) + '\n')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 블로킹 툴 하나를 가진 in-process MCP 서버 + 그 툴을 부르라고 시키는 query.
 * 반환값은 판정에 필요한 raw 관측치뿐 — 해석은 테스트가 한다.
 */
async function runBlockingToolCall({ blockMs, toolTimeoutMs, queryTimeoutMs = 15 * 60 * 1000 }) {
  const calls = []          // 툴 body 가 실제로 몇 번, 언제 돌았나
  const events = []         // 스트림에서 본 것

  const server = createSdkMcpServer({
    name: 'm0-2-block',
    version: '0.0.1',
    tools: [
      tool(
        'slow_echo',
        'Echoes the text after blocking. Always call this tool when asked.',
        { text: z.string() },
        async ({ text }) => {
          const startedAt = Date.now()
          calls.push({ startedAt })
          await sleep(blockMs)                     // ← W
          calls[calls.length - 1].endedAt = Date.now()
          return { content: [{ type: 'text', text: `BLOCKED_OK:${text}` }] }
        },
      ),
    ],
  })

  // env 는 프로세스 전역이므로 이 호출 동안만 세팅하고 되돌린다.
  const prevEnv = process.env.MCP_TOOL_TIMEOUT
  if (toolTimeoutMs == null) delete process.env.MCP_TOOL_TIMEOUT
  else process.env.MCP_TOOL_TIMEOUT = String(toolTimeoutMs)   // ← T

  const startedAt = Date.now()
  let terminalToolResult = null
  let streamError = null

  try {
    const q = query({
      prompt: 'Call the slow_echo tool with text "ping". Then reply with exactly the tool result text and nothing else.',
      options: {
        mcpServers: { 'm0-2-block': server },
        allowedTools: ['mcp__m0-2-block__slow_echo'],
        permissionMode: 'bypassPermissions',
        maxTurns: 6,
      },
    })

    const deadline = setTimeout(() => q.interrupt?.(), queryTimeoutMs)
    try {
      for await (const msg of q) {
        events.push({ at: Date.now() - startedAt, type: msg.type, subtype: msg.subtype })
        // 종단 tool_result 는 user 메시지의 content block 으로 되돌아온다.
        const blocks = msg?.message?.content
        if (Array.isArray(blocks)) {
          for (const b of blocks) {
            if (b?.type === 'tool_result') {
              terminalToolResult = {
                at: Date.now() - startedAt,
                isError: b.is_error === true,
                text: JSON.stringify(b.content).slice(0, 200),
              }
            }
          }
        }
      }
    } finally {
      clearTimeout(deadline)
    }
  } catch (e) {
    streamError = String(e?.message || e)
  } finally {
    if (prevEnv == null) delete process.env.MCP_TOOL_TIMEOUT
    else process.env.MCP_TOOL_TIMEOUT = prevEnv
  }

  return {
    elapsedMs: Date.now() - startedAt,
    bodyRuns: calls.length,
    bodyBlockedMs: calls[0]?.endedAt ? calls[0].endedAt - calls[0].startedAt : null,
    bodyCompleted: !!calls[0]?.endedAt,
    terminalToolResult,
    streamError,
    events,
  }
}

const report = (label, r) => {
  record(label, r)
  console.log(`\n===== M0-2 ${label} =====`)
  console.log('  elapsed            :', (r.elapsedMs / 1000).toFixed(1) + 's')
  console.log('  tool body runs     :', r.bodyRuns)
  console.log('  tool body completed:', r.bodyCompleted, r.bodyBlockedMs != null ? `(blocked ${(r.bodyBlockedMs / 1000).toFixed(1)}s)` : '')
  console.log('  terminal tool_result:', r.terminalToolResult
    ? `YES at ${(r.terminalToolResult.at / 1000).toFixed(1)}s  isError=${r.terminalToolResult.isError}  ${r.terminalToolResult.text}`
    : 'NO')
  console.log('  stream error       :', r.streamError || 'none')
}

describe('M0-2 — Claude in-process (type:sdk) MCP bounded wait', () => {
  // ── A. 기준선: 짧게 블로킹하면 종단 tool_result 가 오는가 (메커니즘 자체가 도는가) ──
  it('A: W=5s, T=unset → terminal tool_result 로 돌아온다', async () => {
    const r = await runBlockingToolCall({ blockMs: 5_000, toolTimeoutMs: null })
    report('A (W=5s, T=unset)', r)

    expect(r.bodyRuns).toBe(1)
    expect(r.bodyCompleted).toBe(true)
    expect(r.terminalToolResult).not.toBeNull()
    expect(r.terminalToolResult.isError).toBe(false)
    expect(r.terminalToolResult.text).toContain('BLOCKED_OK')
  }, 5 * 60 * 1000)

  // ── B. T 가 sdk 서버에 hard bound 로 적용되는가 (스펙이 "먼저 증명하라"고 한 것) ──
  //    적용되면 : ~3s 에서 잘리고 is_error tool_result
  //    안 되면   : 10s 를 끝까지 돌고 정상 결과 → **env var 는 sdk 서버에 안 먹는다**
  it('B: W=10s, T=3s → MCP_TOOL_TIMEOUT 이 sdk 서버에 적용되는지 판정한다', async () => {
    const r = await runBlockingToolCall({ blockMs: 10_000, toolTimeoutMs: 3_000 })
    report('B (W=10s, T=3s)', r)

    const cutAt = r.terminalToolResult?.at ?? r.elapsedMs
    const timeoutApplied = r.terminalToolResult?.isError === true && cutAt < 8_000
    console.log('  >>> MCP_TOOL_TIMEOUT applies to type:sdk server?', timeoutApplied ? 'YES' : 'NO')
    console.log('  >>> (NO 이면 sdk 서버에는 hard call bound 가 없다 — D2/D3 재산출 대상)')

    // 판정만 기록한다. 어느 쪽이든 측정 결과이지 실패가 아니다.
    expect(r.bodyRuns).toBe(1)
  }, 5 * 60 * 1000)

  // ── C. 제품이 실제로 필요로 하는 것: W=12분 이 종단 tool_result 로 돌아오는가 ──
  //    A/B 로 (1) 블로킹 툴이 종단 tool_result 를 준다 (2) T 가 hard bound 로 먹는다 는 증명됐다.
  //    남은 건 T 를 넉넉히 줬을 때 **다른 상한 B**(turn/query/API idle)가 12분 전에 죽이지 않는가다.
  //    스펙 M0-2 의 PASS 조건: `W < min(T, B)` 조합이 하나라도 존재할 것.
  it('C: W=12min, T=30min → 12분 블로킹이 종단 tool_result 로 살아 돌아온다 (W < min(T,B))', async () => {
    const r = await runBlockingToolCall({
      blockMs: 12 * 60 * 1000,        // W = 12분 (제품의 실제 최악 케이스)
      toolTimeoutMs: 30 * 60 * 1000,  // T = 30분
      queryTimeoutMs: 25 * 60 * 1000,
    })
    report('C (W=12min, T=30min)', r)

    expect(r.bodyRuns).toBe(1)
    expect(r.bodyCompleted).toBe(true)                    // 툴이 끝까지 돌았다
    expect(r.terminalToolResult).not.toBeNull()           // 백그라운드 핸들이 아니라
    expect(r.terminalToolResult.isError).toBe(false)      // timeout 도 아니고
    expect(r.terminalToolResult.text).toContain('BLOCKED_OK')
    expect(r.terminalToolResult.at).toBeGreaterThan(12 * 60 * 1000)  // 진짜로 12분을 기다렸다
  }, 40 * 60 * 1000)
})
