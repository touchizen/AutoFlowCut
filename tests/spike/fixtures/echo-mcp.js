#!/usr/bin/env node
/**
 * M-1 — echo MCP fixture (스펙 §3 M-1)
 *
 * **M0-8/M0-9 는 M1 Tool Core 나 M2 adapter 가 아니라 이 fixture 에 붙는다.**
 * React 도, 사용자 HTTP 설정도, 제품 코드도 전혀 띄우지 않는다. 순수 stdio MCP 서버.
 *
 * 툴 두 개:
 *   - `echo`        — 게이트 없음. 인자를 그대로 돌려준다.
 *   - `echo_gated`  — **tool handler 안에서 즉시** MCP elicitation 을 연다(D9/D22 의 게이트 모델).
 *                     accept 면 body 1회 실행 + result, decline/cancel 이면 body 0회 + blocked.
 *
 * ⚠️ hold 는 여기가 아니라 **responder(클라이언트) 쪽**에 있다.
 * M0-9 가 증명해야 하는 건 "`mcpServer/elicitation/request` 가 **열린 채로** 10분 버텨도
 * Codex 의 call/turn/session 이 안 죽는가" 다. 서버가 요청을 열기 *전에* 자면 전혀 다른 걸
 * 측정하게 된다(=pending elicitation 수명이 아니라 그냥 느린 tool). 그래서 이 fixture 는
 * elicitInput() 을 **지연 없이** 호출하고, 붙잡는 건 응답하는 쪽이 한다.
 *
 * body 실행 관측(ECHO_GATED_MARKER_FILE):
 *   gated tool 의 **body 가 실제로 돈 경우에만** 이 파일에 한 줄을 append 한다. 카운터를
 *   child 메모리에만 두면 부모(테스트)가 볼 수 없어서, "body 를 돌려놓고 blocked 를 반환하는"
 *   회귀가 조용히 통과한다. 파일이 그 구멍을 막는다.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { appendFileSync } from 'node:fs'
import { z } from 'zod'

export function createEchoMcpServer({ markerFile = process.env.ECHO_GATED_MARKER_FILE } = {}) {
  const server = new McpServer(
    { name: 'echo-mcp', version: '0.0.1' },
    { capabilities: { tools: {} } }
  )

  /** gated tool 의 body 가 돌았다는 사실을 부모가 볼 수 있는 곳에 남긴다 */
  const recordBodyRun = (text) => {
    if (markerFile) appendFileSync(markerFile, `${text}\n`)
  }

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
      // ⚠️ 핵심: handler **안에서, 지연 없이** elicitation 을 연다. 이게 MCP SDK 공식 패턴이고,
      // Codex 가 MCP tool call 에 승인 요청을 안 보내는 문제(바이너리 전수조사: mcpToolCallApproval 0회)를
      // 우회하는 유일한 경로다. hold 는 responder 가 건다.
      const result = await server.server.elicitInput({
        message: `Approve echo of: ${text}`,
        requestedSchema: {
          type: 'object',
          properties: { approve: { type: 'boolean', title: 'Approve' } },
          required: ['approve'],
        },
      })

      if (result.action !== 'accept' || result.content?.approve !== true) {
        // body 를 돌리지 않는다 — deny 는 부작용 0회여야 한다(marker 도 안 남는다).
        return {
          isError: true,
          content: [{ type: 'text', text: `blocked:${result.action}` }],
        }
      }

      recordBodyRun(text)
      return { content: [{ type: 'text', text: `approved:${text}` }] }
    }
  )

  return server
}

// stdio 로 직접 실행될 때만 서버를 띄운다 (import 는 부작용 없음)
const isDirectRun = process.argv[1] && process.argv[1].endsWith('echo-mcp.js')
if (isDirectRun) {
  const server = createEchoMcpServer()
  await server.connect(new StdioServerTransport())
}
