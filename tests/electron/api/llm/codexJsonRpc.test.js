// @vitest-environment node
//
// codex app-server 는 newline-delimited JSON-RPC over stdio 다. 여기 있는 건 전부 순수 —
// 프로세스를 안 띄운다. ②(트랜스포트 교체)가 이 클라이언트를 그대로 재사용한다.
import { describe, it, expect, vi } from 'vitest'
import { createNdjsonDecoder, createJsonRpcClient } from '../../../../electron/api/llm/codexJsonRpc'

describe('createNdjsonDecoder', () => {
  it('한 청크에 든 여러 줄을 모두 뱉는다', () => {
    const d = createNdjsonDecoder()
    expect(d('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('줄이 청크 경계로 잘려도 이어 붙인다', () => {
    const d = createNdjsonDecoder()
    expect(d('{"a":')).toEqual([])
    expect(d('1}\n')).toEqual([{ a: 1 }])
  })

  it('개행이 아직 안 왔으면 아무것도 안 뱉는다 (부분 JSON 을 파싱하지 않는다)', () => {
    const d = createNdjsonDecoder()
    expect(d('{"a":1}')).toEqual([])
  })

  it('빈 줄은 건너뛴다', () => {
    expect(createNdjsonDecoder()('\n\n{"a":1}\n\n')).toEqual([{ a: 1 }])
  })

  // stdout 에 JSON 아닌 로그가 섞여도 프로토콜을 죽이면 안 된다.
  it('JSON 이 아닌 줄은 무시한다', () => {
    expect(createNdjsonDecoder()('some log line\n{"a":1}\n')).toEqual([{ a: 1 }])
  })

  it('Buffer 청크도 받는다', () => {
    expect(createNdjsonDecoder()(Buffer.from('{"a":1}\n'))).toEqual([{ a: 1 }])
  })
})

describe('createJsonRpcClient', () => {
  function harness({ onNotification, onServerRequest } = {}) {
    const writes = []
    const client = createJsonRpcClient({ write: (s) => writes.push(s), onNotification, onServerRequest })
    return { client, writes, sent: () => writes.map((w) => JSON.parse(w)) }
  }

  it('request 는 개행으로 끝나는 JSON-RPC 프레임을 쓴다', () => {
    const { client, writes, sent } = harness()
    client.request('model/list', { a: 1 })
    expect(writes[0].endsWith('\n')).toBe(true)
    expect(sent()[0]).toEqual({ jsonrpc: '2.0', id: 1, method: 'model/list', params: { a: 1 } })
  })

  it('params 를 안 주면 빈 객체를 보낸다', () => {
    const { client, sent } = harness()
    client.request('initialize')
    expect(sent()[0].params).toEqual({})
  })

  it('id 는 요청마다 증가한다', () => {
    const { client, sent } = harness()
    client.request('a'); client.request('b')
    expect(sent().map((m) => m.id)).toEqual([1, 2])
  })

  it('id 로 응답을 매칭해 resolve 한다 (도착 순서가 뒤바뀌어도)', async () => {
    const { client } = harness()
    const a = client.request('a')
    const b = client.request('b')
    client.handle({ id: 2, result: { v: 'b' } })
    client.handle({ id: 1, result: { v: 'a' } })
    expect(await a).toEqual({ v: 'a' })
    expect(await b).toEqual({ v: 'b' })
  })

  it('error 응답은 reject 한다', async () => {
    const { client } = harness()
    const p = client.request('nope')
    client.handle({ id: 1, error: { code: -32601, message: 'Method not found' } })
    await expect(p).rejects.toThrow('Method not found')
  })

  it('result 가 null 인 응답도 resolve 한다 (undefined 와 구분)', async () => {
    const { client } = harness()
    const p = client.request('a')
    client.handle({ id: 1, result: null })
    await expect(p).resolves.toBeNull()
  })

  it('method 가 있는 메시지는 알림으로 넘긴다', () => {
    const onNotification = vi.fn()
    const { client } = harness({ onNotification })
    client.handle({ method: 'item/agentMessage/delta', params: { delta: 'hi' } })
    expect(onNotification).toHaveBeenCalledWith({ method: 'item/agentMessage/delta', params: { delta: 'hi' } })
  })

  it('id + method 는 알림이 아니라 서버 요청으로 넘긴다', () => {
    const onServerRequest = vi.fn()
    const onNotification = vi.fn()
    const { client } = harness({ onServerRequest, onNotification })

    client.handle({ id: 41, method: 'mcpServer/elicitation/request', params: { turnId: null } })

    expect(onServerRequest).toHaveBeenCalledWith({
      id: 41,
      method: 'mcpServer/elicitation/request',
      params: { turnId: null },
    })
    expect(onNotification).not.toHaveBeenCalled()
  })

  it('response 모양이 method 를 함께 가져도 서버 요청보다 먼저 처리한다', async () => {
    const onServerRequest = vi.fn()
    const onNotification = vi.fn()
    const { client } = harness({ onServerRequest, onNotification })
    const pending = client.request('a')

    client.handle({ id: 1, method: 'unexpected', result: 'ok' })

    await expect(pending).resolves.toBe('ok')
    expect(onServerRequest).not.toHaveBeenCalled()
    expect(onNotification).not.toHaveBeenCalled()
  })

  it('respond 는 개행으로 끝나는 JSON-RPC result 프레임을 쓴다', () => {
    const { client, writes, sent } = harness()

    client.respond(41, { action: 'decline' })

    expect(writes).toHaveLength(1)
    expect(writes[0].endsWith('\n')).toBe(true)
    expect(sent()[0]).toEqual({ jsonrpc: '2.0', id: 41, result: { action: 'decline' } })
  })

  it('respondError 는 data 를 보존한 JSON-RPC error 프레임을 쓴다', () => {
    const { client, sent } = harness()

    client.respondError('req-7', { code: -32601, message: 'Method not found', data: { method: 'future/method' } })

    expect(sent()).toEqual([{
      jsonrpc: '2.0',
      id: 'req-7',
      error: { code: -32601, message: 'Method not found', data: { method: 'future/method' } },
    }])
  })

  it('같은 서버 요청 id 에는 respond/respondError를 합쳐 정확히 한 번만 쓴다', () => {
    const { client, writes, sent } = harness()

    expect(client.respond(41, { action: 'decline' })).toBe(true)
    expect(client.respondError(41, { code: -32603, message: 'late failure' })).toBe(false)

    expect(writes, '두 번째 응답이 wire 에 쓰이면 Codex request correlation 이 깨진다').toHaveLength(1)
    expect(sent()[0].result).toEqual({ action: 'decline' })
  })

  it('모르는 id 의 응답은 조용히 버린다 (죽지 않는다)', () => {
    const { client } = harness()
    expect(() => client.handle({ id: 99, result: {} })).not.toThrow()
  })

  it('rejectAll 은 대기 중인 요청을 전부 reject 한다 (프로세스가 죽었을 때)', async () => {
    const { client } = harness()
    const a = client.request('a')
    const b = client.request('b')
    client.rejectAll(new Error('app-server exited'))
    await expect(a).rejects.toThrow('app-server exited')
    await expect(b).rejects.toThrow('app-server exited')
    expect(client.pendingCount).toBe(0)
  })

  it('응답이 온 요청은 rejectAll 에 걸리지 않는다', async () => {
    const { client } = harness()
    const a = client.request('a')
    client.handle({ id: 1, result: 'ok' })
    client.rejectAll(new Error('exited'))
    await expect(a).resolves.toBe('ok')
  })

  // write 가 동기적으로 응답을 밀어 넣는 구현(테스트 더블/파이프)에서도 pending 이 먼저 등록돼야 한다.
  it('write 가 동기로 응답을 되돌려도 놓치지 않는다', async () => {
    let client
    client = createJsonRpcClient({ write: () => client.handle({ id: 1, result: 'sync' }) })
    await expect(client.request('a')).resolves.toBe('sync')
  })
})
