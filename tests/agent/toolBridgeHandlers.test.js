// @vitest-environment node
//
// M1 slice 13a/13b — renderer 쪽 toolBridge handler (스펙 D14).
//
//   main:  webContents.send('agent:bridge-request', {requestId, name, args})
//   ↓
//   renderer(여기): allowlist 된 handler 실행 → ipcRenderer.send('agent:bridge-response', {requestId, result|error})
//                   detached 파이프라인 진행상황 → ipcRenderer.send('agent:bridge-event', {operationId, status, progress})
//
// 🔴 **allowlist 는 renderer 에도 있어야 한다.** main 이 보냈다는 이유로 renderer 가 아무 함수나
//    실행하면, main 쪽 allowlist 가 뚫리는 순간(또는 다른 경로로 이 채널에 접근하는 순간) 방어가 0 이 된다.
//    양쪽에 두는 게 중복이 아니라 **계층 방어**다.
//
// 🔴 **모든 실패 출구에서 응답해야 한다.** handler 가 throw 하거나 이름이 없거나 — 어느 쪽이든
//    응답을 안 보내면 main 의 pending 은 timeout 까지 매달린다. 조용한 실패는 30초짜리 행이 된다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerToolBridgeHandlers } from '../../src/agent/toolBridgeHandlers.js'

let api, requestCb, responses, events, handlers
beforeEach(() => {
  responses = []
  events = []
  api = {
    onToolBridgeRequest: (cb) => { requestCb = cb; return () => { requestCb = null } },
    respondToolBridge: (payload) => responses.push(payload),
    emitToolBridgeEvent: (payload) => events.push(payload),
  }
  handlers = {
    'video.admit': vi.fn(async () => ({ accepted: true, operationId: 'op-1' })),
    'video.status': vi.fn(async () => ({ operationId: 'op-1', status: 'running' })),
  }
})

const send = async (payload) => { await requestCb(payload) }

describe('renderer toolBridgeHandlers (D14)', () => {
  it('allowlist 된 요청을 실행하고 **같은 requestId 로** 응답한다', async () => {
    registerToolBridgeHandlers({ api, handlers })

    await send({ requestId: 'r1', name: 'video.admit', args: { items: [1] } })

    expect(handlers['video.admit']).toHaveBeenCalledWith({ items: [1] })
    expect(responses).toEqual([{ requestId: 'r1', result: { accepted: true, operationId: 'op-1' } }])
  })

  it('🔴 allowlist 밖 name 은 **실행하지 않고** error 로 응답한다 (조용히 무시하면 main 이 매달린다)', async () => {
    registerToolBridgeHandlers({ api, handlers })

    await send({ requestId: 'r2', name: 'video.destroyEverything', args: {} })

    for (const h of Object.values(handlers)) expect(h).not.toHaveBeenCalled()
    expect(responses).toHaveLength(1)
    expect(responses[0].requestId).toBe('r2')
    expect(responses[0].error).toMatch(/not allowed/i)
    expect(responses[0]).not.toHaveProperty('result')
  })

  it('🔴 handler 가 throw 해도 **반드시 응답한다** — 안 그러면 main 이 timeout 까지 매달린다', async () => {
    handlers['video.admit'] = vi.fn(async () => { throw new Error('subscription-required') })
    registerToolBridgeHandlers({ api, handlers })

    await send({ requestId: 'r3', name: 'video.admit', args: {} })

    expect(responses).toEqual([{ requestId: 'r3', error: 'subscription-required' }])
  })

  it('요청 하나당 응답은 **정확히 하나** (result 와 error 를 같이 보내지 않는다)', async () => {
    registerToolBridgeHandlers({ api, handlers })

    await send({ requestId: 'r4', name: 'video.admit', args: {} })

    expect(responses).toHaveLength(1)
    const keys = Object.keys(responses[0]).sort()
    expect(keys).toEqual(['requestId', 'result'])
  })

  it('🔴 requestId 없는 요청은 응답하지 않는다 — 누구에게 답할지 모른다', async () => {
    registerToolBridgeHandlers({ api, handlers })

    await send({ name: 'video.admit', args: {} })

    expect(responses).toHaveLength(0)
    expect(handlers['video.admit'], 'requestId 도 없는데 실행했다').not.toHaveBeenCalled()
  })

  it('detached 파이프라인 진행상황을 `agent:bridge-event` 로 올린다 (slice 13b)', () => {
    const { emitEvent } = registerToolBridgeHandlers({ api, handlers })

    emitEvent({ operationId: 'op-1', status: 'running', progress: { done: 1, total: 3 } })

    expect(events).toEqual([{ operationId: 'op-1', status: 'running', progress: { done: 1, total: 3 } }])
  })

  it('🔴 operationId 없는 event 는 올리지 않는다 — main 이 거부할 걸 보내지 않는다', () => {
    const { emitEvent } = registerToolBridgeHandlers({ api, handlers })

    expect(() => emitEvent({ status: 'running' })).toThrow(/operationId/i)
    expect(events).toHaveLength(0)
  })

  it('dispose 하면 더 이상 요청을 받지 않는다', async () => {
    const { dispose } = registerToolBridgeHandlers({ api, handlers })
    dispose()
    expect(requestCb).toBeNull()
  })
})
