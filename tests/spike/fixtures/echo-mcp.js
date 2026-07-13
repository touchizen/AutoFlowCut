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
  // ⚠️ fail-closed. marker 가 없으면 recordBodyRun 이 no-op 이 되고, 그러면 body 가 몇 번을 돌든
  // 부모는 항상 bodyRuns=0 을 본다 — **deny 테스트가 공짜로 통과한다.** M0-9 에서 실제로 이걸 밟았다
  // (테스트가 ECHO_MCP_MARKER 를 심는데 fixture 는 ECHO_GATED_MARKER_FILE 을 읽고 있었다).
  // 관측 장치가 죽었으면 측정을 시작하지 않는 게 맞다.
  if (!markerFile) throw new Error('echo-mcp: ECHO_GATED_MARKER_FILE 이 없다 — body 관측이 불가능하므로 기동을 거부한다')

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
      // 스펙 §212 의 제품 설계(adapter 의 tool handler 가 elicitInput 을 소유)와 같은 모양이다.
      // hold 는 responder 가 건다.
      //
      // 🔴 **여기가 함정이다.** MCP SDK 의 `DEFAULT_REQUEST_TIMEOUT_MSEC` 는 **60초**다
      //    (`@modelcontextprotocol/sdk/shared/protocol.js`). timeout 을 안 넘기면 사람이 10분을 고민하는 순간
      //    **우리 쪽 SDK 가** 요청을 죽인다:
      //      `mcpToolCall failed  wall=60,012ms  "MCP error -32001: Request timed out"`
      //    Codex 가 죽인 게 아니다. 우리 MCP 서버가 죽인 거다. 실측으로 밟았다.
      //    → **M2 adapter 는 elicitInput 에 승인 창보다 긴 timeout 을 반드시 넘겨야 한다.**
      //
      // 기본값(=함정) 그대로 재고 싶으면 ECHO_ELICIT_TIMEOUT_MS=0 을 준다.
      const t = process.env.ECHO_ELICIT_TIMEOUT_MS
      const requestOptions = t === '0' ? undefined : { timeout: Number(t ?? 30 * 60 * 1000) }

      const result = await server.server.elicitInput({
        message: `Approve echo of: ${text}`,
        requestedSchema: {
          type: 'object',
          properties: { approve: { type: 'boolean', title: 'Approve' } },
          required: ['approve'],
        },
      }, requestOptions)

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

  // ── out-of-band elicitation (M0-9 의 `turnId:null` 경로) ──
  // 스펙 M0-9 는 "`turnId:null` 도 UI/respond 가 완주해야 한다" 를 요구한다.
  // tool handler **안에서** 연 elicitation 은 언제나 turn 에 correlate 되므로 turnId 가 채워진다.
  // MCP 는 elicitation 을 "turn 과 무관한 server→client 요청" 으로 모델링하고
  // (`McpServerElicitationRequestParams.turnId` 주석), Codex 바이너리에도
  // "out-of-band elicitation count" 카운터가 있다. **handler 밖에서** 열면 그 경로를 탄다.
  //
  // 기본 off. env 를 준 스파이크에서만 켠다 (다른 스파이크의 동작을 안 바꾼다).
  const oobDelayMs = Number(process.env.ECHO_OOB_ELICIT_MS ?? 0)
  if (oobDelayMs > 0) {
    setTimeout(async () => {
      // ⚠️ 결과를 **반드시 관측 가능한 곳에 남긴다.** promise 를 그냥 삼키면
      //    "app-server 가 응답을 무시했다 / promise 가 reject 됐다" 와 "정상 완주했다" 가 구별이 안 된다.
      //    부모는 후속 turn 이 completed 인 것만 보고 "respond 완주" 라고 오판하게 된다.
      const outFile = process.env.ECHO_OOB_RESULT_FILE
      const write = (obj) => { if (outFile) appendFileSync(outFile, JSON.stringify(obj) + '\n') }
      try {
        const result = await server.server.elicitInput({
          message: 'Out-of-band approval (no tool call, no turn)',
          requestedSchema: {
            type: 'object',
            properties: { approve: { type: 'boolean', title: 'Approve' } },
            required: ['approve'],
          },
        })
        write({ resolved: true, action: result.action, content: result.content ?? null })
      } catch (err) {
        write({ resolved: false, error: String(err?.message ?? err) })
      }
    }, oobDelayMs)
  }
}
