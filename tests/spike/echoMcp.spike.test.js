/**
 * M-1 슬라이스 2 `[N]` — echo MCP fixture 가 stdio initialize/list/call 을 반환한다.
 *
 * 실제 child process 를 띄운다. `npm run test:spike` (SPIKE=1) 로만 돈다.
 *
 * 이 fixture 가 GREEN 이어야 M0-8(Codex disabled profile → plain echo)과
 * M0-9(gated tool 안의 elicitation 10분 hold)를 여기에 붙일 수 있다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(here, 'fixtures/echo-mcp.js')

let client
let transport

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [FIXTURE],
  })

  client = new Client(
    { name: 'spike-harness', version: '0.0.1' },
    // elicitation 을 받을 수 있다고 선언해야 서버가 elicitInput 을 열 수 있다
    { capabilities: { elicitation: {} } }
  )
})

afterAll(async () => {
  await client?.close?.()
})

describe('M-1: echo MCP fixture (stdio)', () => {
  it('initialize 가 서버 정보를 돌려준다', async () => {
    await client.connect(transport)

    const info = client.getServerVersion()
    expect(info?.name).toBe('echo-mcp')
  })

  it('tools/list 가 echo 와 echo_gated 를 노출한다', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()

    expect(names).toEqual(['echo', 'echo_gated'])
  })

  it('tools/call 이 echo 결과를 종단 tool_result 로 돌려준다', async () => {
    const r = await client.callTool({ name: 'echo', arguments: { text: 'hello' } })

    expect(r.content[0]).toMatchObject({ type: 'text', text: 'hello' })
    expect(r.isError).toBeFalsy()
  })

  it('gated tool: deny 하면 body 0회 + blocked', async () => {
    // 클라이언트가 elicitation 요청을 받으면 거절한다
    client.setRequestHandler(
      (await import('@modelcontextprotocol/sdk/types.js')).ElicitRequestSchema,
      async () => ({ action: 'decline' })
    )

    const r = await client.callTool({ name: 'echo_gated', arguments: { text: 'nope' } })

    expect(r.isError).toBe(true)
    expect(r.content[0].text).toBe('blocked:decline')
  })

  it('gated tool: accept 하면 body 1회 + result', async () => {
    client.setRequestHandler(
      (await import('@modelcontextprotocol/sdk/types.js')).ElicitRequestSchema,
      async () => ({ action: 'accept', content: { approve: true } })
    )

    const r = await client.callTool({ name: 'echo_gated', arguments: { text: 'yes' } })

    expect(r.isError).toBeFalsy()
    expect(r.content[0].text).toBe('approved:yes')
  })
})
