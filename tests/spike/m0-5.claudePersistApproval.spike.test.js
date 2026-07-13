/**
 * M0-5 — Claude 지속 Query + 10분 승인 보류.
 *
 * 스펙: "async iterable 한 Query에서 **후속 user message**, **10분 `canUseTool` 보류**,
 * tool_result를 통과한다. **FAIL이면 Claude session API를 재설계하기 전 M2 중단.**"
 *
 * 하드 게이트다. D9(도구별 게이트 = Claude는 `canUseTool`)와 D20(실행 중 사람 편집/steering)이
 * 전부 이것 위에 서 있다. 사람이 승인 다이얼로그를 10분 들여다보는 건 실제 시나리오다.
 *
 * ⚠️ hold 는 **응답하는 쪽(canUseTool)** 이 건다. 툴 body 를 재우면 pending approval 의 수명이
 * 아니라 그냥 느린 툴을 재게 된다 — M-1 의 echo-mcp fixture 주석과 같은 함정.
 *
 * `npm run test:spike` (SPIKE=1) 로만 돈다. 실제 Claude CLI 자격증명을 쓴다.
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { appendFileSync, mkdirSync } from 'node:fs'
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'

const RESULT_DIR = 'docs/superpowers/specs'
const record = (label, data) => {
  mkdirSync(RESULT_DIR, { recursive: true })
  appendFileSync(`${RESULT_DIR}/m0-5-raw.jsonl`, JSON.stringify({ label, ...data }) + '\n')
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 하나의 Query 를 열어두고:
 *   1) 툴 호출을 시킨다 → canUseTool 이 열린다
 *   2) canUseTool 을 holdMs 동안 **붙잡는다** (사람이 승인 다이얼로그를 보고 있는 상태)
 *   3) allow 로 응답한다 → tool_result 가 오는가
 *   4) 같은 Query 에 **후속 user message** 를 밀어넣는다 → 세션이 살아있는가
 */
async function runHeldApproval({ holdMs, followUp = true }) {
  const toolBodyRuns = []
  const approvals = []
  const events = []

  const server = createSdkMcpServer({
    name: 'm0-5-gate',
    version: '0.0.1',
    tools: [
      tool('gated_echo', 'Echoes the text. Always call this when asked.', { text: z.string() },
        async ({ text }) => {
          toolBodyRuns.push(Date.now())
          return { content: [{ type: 'text', text: `GATED_OK:${text}` }] }
        },
        // ⚠️ MCP 툴은 기본이 **deferred** 다 — 안 붙이면 모델이 `tool_reference` 만 받고 실행이
        //    안 된다(1·2차 측정에서 toolBodyRuns=0 으로 실증). alwaysLoad 로 즉시 로드시킨다.
        //    D2 함의: deferred 로 두면 툴 검색 턴이 추가로 붙는다.
        { alwaysLoad: true }),
    ],
  })

  const startedAt = Date.now()
  let terminalToolResult = null
  let followUpAnswered = null
  let streamError = null

  // 후속 user message 를 밀어넣기 위해 prompt 를 async generator 로 준다.
  let pushFollowUp
  const followUpGate = new Promise((r) => { pushFollowUp = r })

  async function* prompts() {
    yield {
      type: 'user',
      message: { role: 'user', content: 'Call the gated_echo tool with text "ping". Then reply with the tool result text only.' },
    }
    if (!followUp) return
    await followUpGate                    // tool_result 를 본 뒤에 두 번째 턴을 민다
    yield {
      type: 'user',
      message: { role: 'user', content: 'Now reply with exactly: FOLLOWUP_OK' },
    }
  }

  try {
    const q = query({
      prompt: prompts(),
      options: {
        mcpServers: { 'm0-5-gate': server },
        // ⚠️ allowedTools 에 넣으면 "auto-allowed without prompting" 이라 canUseTool 이 **안 열린다**.
        //    (1차 측정에서 approvals=[] 로 실증됨.) 게이트를 재려면 여기에 넣으면 안 된다.
        //    availability 제한이 필요하면 allowedTools 가 아니라 `tools` 를 쓴다.
        permissionMode: 'default',
        maxTurns: 8,
        canUseTool: async (toolName, input) => {
          const openedAt = Date.now()
          approvals.push({ toolName, openedAt: openedAt - startedAt })
          await sleep(holdMs)             // ← 사람이 10분 들여다본다
          approvals[approvals.length - 1].heldMs = Date.now() - openedAt
          return { behavior: 'allow', updatedInput: input }
        },
      },
    })

    for await (const msg of q) {
      events.push({ at: Date.now() - startedAt, type: msg.type, raw: JSON.stringify(msg).slice(0, 300) })
      const blocks = msg?.message?.content
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b?.type === 'tool_result' && !terminalToolResult) {
            terminalToolResult = {
              at: Date.now() - startedAt,
              isError: b.is_error === true,
              text: JSON.stringify(b.content).slice(0, 160),
            }
            pushFollowUp?.()              // 이제 후속 턴을 민다
          }
          if (b?.type === 'text' && b.text?.includes('FOLLOWUP_OK')) {
            followUpAnswered = { at: Date.now() - startedAt }
          }
        }
      }
    }
  } catch (e) {
    streamError = String(e?.message || e)
    pushFollowUp?.()
  }

  return {
    elapsedMs: Date.now() - startedAt,
    approvals,
    toolBodyRuns: toolBodyRuns.length,
    terminalToolResult,
    followUpAnswered,
    streamError,
    events: events.slice(0, 40),
  }
}

const report = (label, r) => {
  record(label, r)
  console.log(`\n===== M0-5 ${label} =====`)
  console.log('  elapsed        :', (r.elapsedMs / 60000).toFixed(1) + '분')
  console.log('  canUseTool 열림:', JSON.stringify(r.approvals))
  console.log('  tool body runs :', r.toolBodyRuns)
  console.log('  tool_result    :', r.terminalToolResult ? `YES @ ${(r.terminalToolResult.at / 60000).toFixed(1)}분 isError=${r.terminalToolResult.isError}` : 'NO')
  console.log('  후속 user turn :', r.followUpAnswered ? `YES @ ${(r.followUpAnswered.at / 60000).toFixed(1)}분` : 'NO')
  console.log('  stream error   :', r.streamError || 'none')
}

describe('M0-5 — Claude 지속 Query + 승인 보류', () => {
  // 기준선: 게이트 메커니즘 자체가 도는가 (짧은 hold)
  it('A: 5초 보류 → canUseTool 이 열리고, allow 뒤 tool_result, 그리고 후속 user turn 이 통과한다', async () => {
    const r = await runHeldApproval({ holdMs: 5_000 })
    report('A (hold=5s)', r)

    expect(r.approvals.length).toBe(1)
    expect(r.toolBodyRuns).toBe(1)
    expect(r.terminalToolResult?.isError).toBe(false)
    expect(r.followUpAnswered).not.toBeNull()   // 같은 Query 가 두 번째 턴을 받았다
  }, 10 * 60 * 1000)

  // 하드 게이트: 10분 보류를 견디는가
  it('B: 10분 보류 → 어떤 timeout 에도 죽지 않고 allow 뒤 tool_result 가 온다', async () => {
    const r = await runHeldApproval({ holdMs: 10 * 60 * 1000 })
    report('B (hold=10min)', r)

    expect(r.approvals.length).toBe(1)
    expect(r.approvals[0].heldMs).toBeGreaterThan(9.5 * 60 * 1000)  // 진짜로 10분 붙잡았다
    expect(r.toolBodyRuns).toBe(1)                                   // hold 중엔 body 가 안 돌았고
    expect(r.terminalToolResult).not.toBeNull()                      // allow 뒤에 결과가 왔다
    expect(r.terminalToolResult.isError).toBe(false)
    expect(r.followUpAnswered).not.toBeNull()                        // 세션이 여전히 살아있다
  }, 30 * 60 * 1000)
})
