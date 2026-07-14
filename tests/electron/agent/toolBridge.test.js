// @vitest-environment node
//
// M1 slice 13a/13b — `toolBridge` (스펙 D14).
//
//   electron/agent/toolBridge.js (main owner)
//     toolBridge.invoke(name, args, {timeoutMs}) -> Promise<structured result>
//     pending Map<requestId, {resolve, reject, timer}>
//             │ webContents.send('agent:bridge-request', {requestId, name, args})
//             ▼
//   src/agent/toolBridgeHandlers.js (renderer owner, allowlisted handlers)
//             │ ipcRenderer.send('agent:bridge-response', {requestId, result|error})
//             └ ipcRenderer.send('agent:bridge-event', {operationId, status, progress})
//
// 🔴 **왜 main 이 renderer 를 불러야 하는가:** admission(구독 게이트/크레딧 소비)과 detached
//    파이프라인이 **renderer 에** 산다. 그런데 그 결과값이 **main 의 Tool Core 호출자에게 돌아와야**
//    에이전트가 "승인됐다/거부됐다"를 안다. 기존 `webContents.executeJavaScript` 경로는
//    선택형 HTTP 서버 수명에 묶여 있어 **제품 seam 으로 재사용하지 않는다** (D14).
//
// 계약의 급소는 **정확히 한 번**이다. correlation id 로 한 번만 settle 하고,
// timeout / window destroy / 중복 응답 / allowlist 밖 name / operationId 불일치는 전부 거부한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createToolBridge } from '../../../electron/agent/toolBridge.js'

function fakeWindow() {
  const sent = []
  return {
    sent,
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
  }
}

let win, bridge
beforeEach(() => {
  vi.useFakeTimers()
  win = fakeWindow()
  bridge = createToolBridge({ getWindow: () => win })
})
afterEach(() => {
  vi.useRealTimers()
})

/** invoke 가 renderer 로 보낸 request 를 꺼낸다. */
const lastRequest = () => win.sent.filter((s) => s.channel === 'agent:bridge-request').at(-1)?.payload

describe('toolBridge — correlated invoke (slice 13a)', () => {
  it('request id 가 renderer 응답과 correlate 되어 **호출자에게** 값을 돌려준다', async () => {
    const p = bridge.invoke('video.admit', { items: [1] })

    const req = lastRequest()
    expect(req.name).toBe('video.admit')
    expect(req.args).toEqual({ items: [1] })
    expect(req.requestId, 'correlation id 가 없다').toBeTruthy()

    bridge.handleResponse({ requestId: req.requestId, result: { accepted: true, operationId: 'op-1' } })

    // 🔴 값이 **main 의 Tool Core 호출자에게** 돌아와야 한다 — fire-and-forget 이면 에이전트가 결과를 모른다.
    await expect(p).resolves.toEqual({ accepted: true, operationId: 'op-1' })
  })

  it('🔴 중복 응답은 **정확히 한 번만** settle 한다 (두 번째는 찾을 게 없다)', async () => {
    const p = bridge.invoke('video.admit', {})
    const { requestId } = lastRequest()

    // ⚠️ `await expect(p).resolves...` 만으로는 **아무것도 증명하지 못한다** — JS Promise 는 원래
    //    한 번만 settle 되므로, pending 을 안 지워도 이 단언은 통과한다 (뮤테이션으로 실측 확인).
    //    계약은 **우리 pending 에서 사라져서 두 번째 응답이 찾을 게 없는 것**이다. 그걸 못박는다.
    expect(bridge.handleResponse({ requestId, result: { accepted: true, operationId: 'op-1' } })).toBe(true)
    expect(bridge.pendingCount(), '첫 응답 뒤에도 pending 에 남아 있다 — 두 번째 응답이 이걸 집는다').toBe(0)

    // 두 번째는 집을 게 없어야 한다 (false = 아무것도 settle 하지 않았다).
    expect(bridge.handleResponse({ requestId, result: { accepted: false } })).toBe(false)

    await expect(p).resolves.toEqual({ accepted: true, operationId: 'op-1' })
  })

  it('🔴 모르는 requestId 응답은 무시한다 (다른 요청을 settle 하지 않는다)', async () => {
    const p = bridge.invoke('video.admit', {})
    const { requestId } = lastRequest()

    bridge.handleResponse({ requestId: 'not-a-real-id', result: { accepted: false } })
    bridge.handleResponse({ requestId, result: { accepted: true, operationId: 'op-1' } })

    await expect(p).resolves.toEqual({ accepted: true, operationId: 'op-1' })
  })

  it('timeout 이면 reject 하고 pending 을 정리한다', async () => {
    const p = bridge.invoke('video.admit', {}, { timeoutMs: 1000 })
    const rejected = expect(p).rejects.toThrow(/timeout/i)

    await vi.advanceTimersByTimeAsync(1000)
    await rejected

    expect(bridge.pendingCount(), 'timeout 뒤에도 pending 이 남아 있다 = 누수').toBe(0)
  })

  it('timeout 뒤 늦게 온 응답은 아무것도 되살리지 않는다', async () => {
    const p = bridge.invoke('video.admit', {}, { timeoutMs: 1000 })
    const { requestId } = lastRequest()
    const rejected = expect(p).rejects.toThrow(/timeout/i)
    await vi.advanceTimersByTimeAsync(1000)
    await rejected

    // 늦게 도착한 응답이 throw 하거나 다른 요청을 settle 하면 안 된다.
    expect(() => bridge.handleResponse({ requestId, result: { accepted: true } })).not.toThrow()
    expect(bridge.pendingCount()).toBe(0)
  })

  it('🔴 window 가 죽었으면 보내지 않고 reject 한다 (영원히 매달리지 않는다)', async () => {
    const dead = { isDestroyed: () => true, webContents: { send: vi.fn() } }
    const b = createToolBridge({ getWindow: () => dead })

    await expect(b.invoke('video.admit', {})).rejects.toThrow(/window/i)
    expect(dead.webContents.send, '죽은 window 로 보냈다').not.toHaveBeenCalled()
  })

  it('🔴 allowlist 밖 name 은 renderer 로 **보내지도 않고** 거부한다', async () => {
    await expect(bridge.invoke('rm.-rf', {})).rejects.toThrow(/not allowed/i)
    expect(lastRequest(), 'allowlist 밖인데 renderer 로 보냈다').toBeUndefined()
  })

  it('renderer 가 error 를 돌려주면 reject 한다', async () => {
    const p = bridge.invoke('video.admit', {})
    const { requestId } = lastRequest()

    bridge.handleResponse({ requestId, error: 'subscription-required' })

    await expect(p).rejects.toThrow(/subscription-required/)
  })

  it('🔴 malformed 응답(result 도 error 도 없음)은 거부한다 — undefined 로 resolve 하지 않는다', async () => {
    const p = bridge.invoke('video.admit', {})
    const { requestId } = lastRequest()

    bridge.handleResponse({ requestId })

    await expect(p).rejects.toThrow(/malformed/i)
  })

  it('close 는 pending 을 전부 reject 하고 정리한다 (세션 종료 시 누수 0)', async () => {
    const a = bridge.invoke('video.admit', {})
    const b = bridge.invoke('video.status', {})
    expect(bridge.pendingCount()).toBe(2)

    const ra = expect(a).rejects.toThrow(/closed/i)
    const rb = expect(b).rejects.toThrow(/closed/i)
    bridge.close()
    await ra; await rb

    expect(bridge.pendingCount()).toBe(0)
  })
})

describe('toolBridge — operation snapshot (slice 13b)', () => {
  it('renderer 의 `agent:bridge-event` 가 main snapshot 을 갱신한다', () => {
    bridge.handleEvent({ operationId: 'op-1', status: 'running', progress: { done: 1, total: 3 } })
    expect(bridge.getOperation('op-1')).toEqual({ status: 'running', progress: { done: 1, total: 3 } })

    bridge.handleEvent({ operationId: 'op-1', status: 'complete', progress: { done: 3, total: 3 } })
    expect(bridge.getOperation('op-1')).toEqual({ status: 'complete', progress: { done: 3, total: 3 } })
  })

  it('모르는 operation 조회는 null (지어내지 않는다)', () => {
    expect(bridge.getOperation('nope')).toBeNull()
  })

  it('🔴 operationId 없는 event 는 거부한다 — 조용히 삼키지 않는다', () => {
    expect(() => bridge.handleEvent({ status: 'running' })).toThrow(/operationId/i)
  })
})
