/**
 * M-1 슬라이스 2 `[N]` — echo MCP fixture 가 stdio initialize/list/call 을 반환한다.
 *
 * 실제 child process 를 띄운다. `npm run test:spike` (SPIKE=1) 로만 돈다.
 *
 * 이 fixture 가 GREEN 이어야 M0-8(Codex disabled profile → plain echo)과
 * M0-9(gated tool 안의 elicitation 을 **열어둔 채** 10분 hold)를 여기에 붙일 수 있다.
 *
 * hold 는 **responder(여기)** 가 건다 — 서버가 요청을 열기 전에 자면 pending elicitation 의
 * 수명이 아니라 그냥 느린 tool 을 재는 셈이 된다.
 *
 * body 실행 횟수는 child 메모리가 아니라 **marker 파일**로 관측한다. 안 그러면
 * "body 를 돌려놓고 blocked 를 반환하는" 회귀가 조용히 통과한다.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(here, 'fixtures/echo-mcp.js')

let client
let transport
let workDir
let markerFile

/** gated body 가 실제로 돈 횟수 (child 가 append 한 marker 파일을 부모가 읽는다) */
const bodyRuns = () => readFileSync(markerFile, 'utf-8').split('\n').filter(Boolean).length

/** 다음 elicitation 요청을 이 응답으로 처리한다. holdMs 만큼 **요청을 열어둔 채** 붙잡는다. */
function respondToElicitation(response, { holdMs = 0 } = {}) {
  client.setRequestHandler(ElicitRequestSchema, async () => {
    if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs))
    return response
  })
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'echo-mcp-spike-'))
  markerFile = join(workDir, 'gated-body-runs.log')
  writeFileSync(markerFile, '')

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [FIXTURE],
    env: { ...process.env, ECHO_GATED_MARKER_FILE: markerFile },
  })

  client = new Client(
    { name: 'spike-harness', version: '0.0.1' },
    // elicitation 을 받을 수 있다고 선언해야 서버가 elicitInput 을 열 수 있다
    { capabilities: { elicitation: {} } }
  )
  await client.connect(transport)
})

afterAll(async () => {
  await client?.close?.()
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

beforeEach(() => writeFileSync(markerFile, ''))

describe('M-1: echo MCP fixture (stdio)', () => {
  it('initialize 가 서버 정보를 돌려준다', () => {
    expect(client.getServerVersion()?.name).toBe('echo-mcp')
  })

  it('tools/list 가 echo 와 echo_gated 를 노출한다', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['echo', 'echo_gated'])
  })

  it('tools/call 이 echo 결과를 종단 tool_result 로 돌려준다', async () => {
    const r = await client.callTool({ name: 'echo', arguments: { text: 'hello' } })

    expect(r.content[0]).toMatchObject({ type: 'text', text: 'hello' })
    expect(r.isError).toBeFalsy()
  })

  it('gated deny → blocked + body 0회 (marker 파일로 확인)', async () => {
    respondToElicitation({ action: 'decline' })

    const r = await client.callTool({ name: 'echo_gated', arguments: { text: 'nope' } })

    expect(r.isError).toBe(true)
    expect(r.content[0].text).toBe('blocked:decline')
    expect(bodyRuns()).toBe(0)  // body 를 돌려놓고 blocked 를 반환하는 회귀를 잡는다
  })

  it('gated accept → result + body 정확히 1회', async () => {
    respondToElicitation({ action: 'accept', content: { approve: true } })

    const r = await client.callTool({ name: 'echo_gated', arguments: { text: 'yes' } })

    expect(r.isError).toBeFalsy()
    expect(r.content[0].text).toBe('approved:yes')
    expect(bodyRuns()).toBe(1)
  })

  it('elicitation 요청을 열어둔 채 hold 해도 call 이 살아남는다 (M0-9 의 축소판)', async () => {
    // M0-9 의 실제 기준은 10분이다. 여기서는 메커니즘만 고정하고(요청이 열린 채 대기),
    // 10분 hold 는 Codex app-server 를 붙이는 M0-S08 이 같은 responder 로 수행한다.
    respondToElicitation({ action: 'accept', content: { approve: true } }, { holdMs: 1500 })

    const started = Date.now()
    const r = await client.callTool({ name: 'echo_gated', arguments: { text: 'held' } })
    const elapsed = Date.now() - started

    expect(elapsed).toBeGreaterThanOrEqual(1500)  // hold 가 실제로 요청을 붙잡았다
    expect(r.content[0].text).toBe('approved:held')
    expect(bodyRuns()).toBe(1)
  })
})
