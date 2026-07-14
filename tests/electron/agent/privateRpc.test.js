// @vitest-environment node
//
// M2 — **agent-private RPC** (스펙 §5 `electron/agent/privateRpc.js`, D9 결정 2).
//
//   codexMcpAdapter (별도 프로세스, Electron-as-node)
//        │  loopback 임의 포트 + session token
//        ▼  **단방향**: adapter → main Tool Core
//   main Tool Core
//
// 🔴 **왜 이게 위험한가.** 이건 로컬 머신에서 듣는 HTTP 서버다. 같은 머신의 **아무 프로세스나**
//    (브라우저 탭의 스크립트 포함) 이 포트를 두드릴 수 있다. 이 레포엔 이미 그 실수의 표본이 있다 —
//    legacy MCP HTTP 서버는 **토큰 검사가 없고** `Access-Control-Allow-Origin: '*'` 다
//    (`main.js:909-915`). 그걸 반복하면 웹페이지가 사용자의 프로젝트를 조작할 수 있다.
//
//    방어: **loopback 바인딩 + 세션마다 새로 만드는 고엔트로피 토큰 + CORS 헤더 0개.**
//    토큰이 틀리거나 없으면 **Tool Core 를 부르지 않는다** (401 이 아니라 "안 불렀다" 가 계약이다).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPrivateRpc } from '../../../electron/agent/privateRpc.js'

let rpc, toolCore, endpoint
beforeEach(async () => {
  toolCore = { call: vi.fn(async (name, args, context) => ({ ok: true, name, args, context })) }
  rpc = createPrivateRpc({ toolCore, sessionId: 's1' })
  endpoint = await rpc.start()
})
afterEach(async () => { await rpc.close() })

const post = (body, { token = endpoint.token, headers = {} } = {}) =>
  fetch(`http://127.0.0.1:${endpoint.port}/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  })

describe('privateRpc — 정상 경로', () => {
  it('토큰이 맞으면 Tool Core 를 부르고 결과를 돌려준다', async () => {
    const res = await post({ tool: 'list_scenes', args: {}, nonce: 'n1' })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ result: { ok: true, name: 'list_scenes' } })
    expect(toolCore.call).toHaveBeenCalledWith('list_scenes', {}, expect.objectContaining({ nonce: 'n1' }))
  })

  it('Tool Core 가 던지면 error 로 돌려준다 (프로세스를 죽이지 않는다)', async () => {
    toolCore.call.mockRejectedValueOnce(new Error('unknown tool: nope'))

    const res = await post({ tool: 'nope', args: {} })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/unknown tool/) })
  })
})

describe('privateRpc — fail-closed', () => {
  it('🔴 토큰이 **없으면** Tool Core 를 부르지 않는다', async () => {
    const res = await post({ tool: 'list_scenes', args: {} }, { token: null })

    expect(res.status).toBe(401)
    expect(toolCore.call, '토큰 없이 Tool Core 가 불렸다').not.toHaveBeenCalled()
  })

  it('🔴 토큰이 **틀리면** Tool Core 를 부르지 않는다', async () => {
    const res = await post({ tool: 'list_scenes', args: {} }, { token: 'wrong-token' })

    expect(res.status).toBe(401)
    expect(toolCore.call).not.toHaveBeenCalled()
  })

  it('🔴 토큰이 **한 글자만 달라도** 거부한다 (prefix 비교 금지)', async () => {
    const res = await post({ tool: 'list_scenes', args: {} }, { token: endpoint.token.slice(0, -1) })

    expect(res.status).toBe(401)
    expect(toolCore.call).not.toHaveBeenCalled()
  })

  it('🔴 CORS 를 열지 않는다 — 웹페이지가 이 포트를 두드리지 못하게', async () => {
    const res = await post({ tool: 'list_scenes', args: {} })

    // legacy 서버는 `Access-Control-Allow-Origin: '*'` 였다. 그걸 반복하면 아무 사이트나 호출한다.
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('🔴 **loopback 에만** 바인딩한다 (LAN 에 노출되지 않는다)', () => {
    expect(endpoint.host).toBe('127.0.0.1')
  })

  it('🔴 토큰은 세션마다 새로 만들고 추측 불가할 만큼 길다', async () => {
    const other = createPrivateRpc({ toolCore, sessionId: 's2' })
    const e2 = await other.start()
    try {
      expect(e2.token).not.toBe(endpoint.token)
      expect(endpoint.token.length).toBeGreaterThanOrEqual(32)
    } finally {
      await other.close()
    }
  })

  it('🔴 close() 뒤에는 아무도 못 부른다 (세션 종료 = 문을 닫는다)', async () => {
    await rpc.close()

    await expect(post({ tool: 'list_scenes', args: {} })).rejects.toThrow()
    expect(toolCore.call).not.toHaveBeenCalled()
  })

  it('🔴 `/call` 이 아닌 경로는 거부한다 (표면을 넓히지 않는다)', async () => {
    const res = await fetch(`http://127.0.0.1:${endpoint.port}/anything`, {
      method: 'POST',
      headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' },
      body: '{}',
    })

    expect(res.status).toBe(404)
    expect(toolCore.call).not.toHaveBeenCalled()
  })

  it('🔴 GET 은 거부한다 — 단방향 호출 채널이지 조회 API 가 아니다', async () => {
    const res = await fetch(`http://127.0.0.1:${endpoint.port}/call`, {
      headers: { authorization: `Bearer ${endpoint.token}` },
    })

    expect(res.status).toBe(405)
    expect(toolCore.call).not.toHaveBeenCalled()
  })

  it('🔴 malformed body 는 Tool Core 에 닿지 않는다', async () => {
    const res = await fetch(`http://127.0.0.1:${endpoint.port}/call`, {
      method: 'POST',
      headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' },
      body: 'not json',
    })

    expect(res.status).toBe(400)
    expect(toolCore.call).not.toHaveBeenCalled()
  })

  it('🔴 tool 이름이 없으면 거부한다', async () => {
    const res = await post({ args: {} })

    expect(res.status).toBe(400)
    expect(toolCore.call).not.toHaveBeenCalled()
  })
})
