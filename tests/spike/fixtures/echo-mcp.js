#!/usr/bin/env node
/**
 * M-1 — echo MCP fixture (스펙 §3 M-1)
 *
 * **M0-8/M0-9 는 M1 Tool Core 나 M2 adapter 가 아니라 이 fixture 에 붙는다.**
 * React 도, 사용자 HTTP 설정도, 제품 코드도 전혀 띄우지 않는다. 순수 stdio MCP 서버.
 *
 * 툴 두 개:
 *   - `echo`        — 게이트 없음. 인자를 그대로 돌려준다.
 *   - `echo_gated`  — **tool handler 안에서** MCP elicitation 을 연다(D9/D22 의 게이트 모델).
 *                     accept 면 body 1회 실행 + result, decline/cancel 이면 body 0회 + blocked.
 *
 * M0-9 가 이 fixture 로 증명해야 하는 것: gated tool 을 elicitation 에서 **10분 hold** 해도
 * Codex 의 어떤 call/turn/session timeout 에도 죽지 않는가. exec approval 로 대체한 테스트는
 * 무효다 — 반드시 `mcpServer/elicitation/request` 가 떠야 한다.
 *
 * 환경변수:
 *   ECHO_GATED_HOLD_MS — elicitInput 호출 전에 이만큼 대기(10분 hold 재현용). 기본 0.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

/** gated tool 의 body 가 몇 번 돌았는지 — deny 면 반드시 0이어야 한다 */
let gatedBodyRuns = 0

export function createEchoMcpServer({ holdMs = Number(process.env.ECHO_GATED_HOLD_MS || 0) } = {}) {
  const server = new McpServer(
    { name: 'echo-mcp', version: '0.0.1' },
    { capabilities: { tools: {} } }
  )

  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Returns the given text unchanged.',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ({ content: [{ type: 'text', text }] })
  )

  server.registerTool(
    'echo_gated',
    {
      title: 'Echo (gated)',
      description: 'Asks the human for approval via MCP elicitation, then echoes.',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => {
      // 10분 hold 재현 — elicitation 을 열기 전에 붙잡아 둔다.
      if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs))

      // ⚠️ 핵심: handler **안에서** elicitation 을 연다. 이게 MCP SDK 공식 패턴이고,
      // Codex 가 MCP tool call 에 승인 요청을 안 보내는 문제(바이너리 전수조사: mcpToolCallApproval 0회)를
      // 우회하는 유일한 경로다.
      const result = await server.server.elicitInput({
        message: `Approve echo of: ${text}`,
        requestedSchema: {
          type: 'object',
          properties: { approve: { type: 'boolean', title: 'Approve' } },
          required: ['approve'],
        },
      })

      if (result.action !== 'accept' || result.content?.approve !== true) {
        // body 를 돌리지 않는다 — deny 는 부작용 0회여야 한다.
        return {
          isError: true,
          content: [{ type: 'text', text: `blocked:${result.action}` }],
        }
      }

      gatedBodyRuns += 1
      return { content: [{ type: 'text', text: `approved:${text}` }] }
    }
  )

  return server
}

/** 테스트가 deny 경로의 "body 0회" 를 검증할 때 쓴다 (in-process 사용 시) */
export function getGatedBodyRuns() {
  return gatedBodyRuns
}

// stdio 로 직접 실행될 때만 서버를 띄운다 (import 는 부작용 없음)
const isDirectRun = process.argv[1] && process.argv[1].endsWith('echo-mcp.js')
if (isDirectRun) {
  const server = createEchoMcpServer()
  await server.connect(new StdioServerTransport())
}
