// @vitest-environment node
//
// M2 — **승인 창을 사람에게 띄운다** (D14: `agent:permission-request` / `agent:permission-response`).
//
//   main elicitationResponder.askUser
//        │  webContents.send('agent:permission-request', {requestId, tool, args, sessionId})
//        ▼
//   ChatPanel (renderer) — 사람이 승인/거부
//        │  ipcRenderer.send('agent:permission-response', {requestId, action})
//        ▼
//   main → accept 면 ledger 에 grant 기록 → adapter 의 RPC 가 그 nonce 를 소비한다
//
// 🔴 **toolBridge 와 실패 방향이 정반대다.**
//    toolBridge 는 실패하면 **throw** 한다 (호출자가 "모른다"를 알아야 하니까).
//    승인은 실패하면 **decline** 이다 — **창이 죽었다고 승인이 될 수는 없다.**
//    reject 로 만들면 상위에서 catch 를 빠뜨리는 순간 어떻게 될지 아무도 모른다. 값으로 닫는다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { createApprovalPrompt } from '../../../electron/agent/approvalPrompt.js'
import { encodeApprovalPayload } from '../../../electron/agent/approvalPayload.js'

function fakeWindow() {
  const sent = []
  const win = new EventEmitter()
  let destroyed = false
  win.sent = sent
  win.isDestroyed = () => destroyed
  win.webContents = new EventEmitter()
  win.webContents.send = (channel, payload) => sent.push({ channel, payload })
  win.destroy = () => { destroyed = true; win.emit('closed') }
  return win
}

let win, prompt
beforeEach(() => {
  vi.useFakeTimers()
  win = fakeWindow()
  prompt = createApprovalPrompt({ getWindow: () => win, timeoutMs: 10 * 60 * 1000 })
})
afterEach(() => { vi.useRealTimers() })

const lastRequest = () => win.sent.filter((s) => s.channel === 'agent:permission-request').at(-1)?.payload
const args = { items: [1, 2] }
const params = {
  message: encodeApprovalPayload('generate_videos', args),
  _meta: { nonce: 'n1', tool: 'generate_videos', argsHash: 'h' },
}
const ctx = { requestId: 7, sessionId: 's1', tool: 'generate_videos', argsHash: 'h', args }

describe('승인 창 — 정상 경로', () => {
  it('renderer 로 승인 요청을 보내고, 사람의 응답을 돌려준다', async () => {
    const p = prompt.ask(params, ctx)

    const req = lastRequest()
    expect(req.requestId).toBeTruthy()
    expect(req.tool).toBe('generate_videos')
    // 🔴 사람이 **무엇을** 승인하는지 보여야 한다 — 이름만 보고 누르면 동의가 아니다.
    expect(req.args).toEqual(args)
    expect(req).not.toHaveProperty('message')
    expect(req.sessionId).toBe('s1')

    prompt.respond({ requestId: req.requestId, action: 'accept' })
    await expect(p).resolves.toEqual({ action: 'accept' })
  })

  it('검증된 args가 없으면 빈 객체로 위장하지 않고 null을 보낸다', async () => {
    const pending = prompt.ask(params, { ...ctx, args: undefined })

    expect(lastRequest().args).toBeNull()
    prompt.respond({ requestId: lastRequest().requestId, action: 'decline' })
    await expect(pending).resolves.toEqual({ action: 'decline' })
  })

  it('거부하면 decline', async () => {
    const p = prompt.ask(params, ctx)
    prompt.respond({ requestId: lastRequest().requestId, action: 'decline' })

    await expect(p).resolves.toEqual({ action: 'decline' })
  })
})

describe('🔴 실패는 전부 decline 이다 — 승인은 fail-closed', () => {
  it('🔴 응답이 없으면(사람이 그냥 안 누름) **decline** — accept 로 흐르지 않는다', async () => {
    const p = prompt.ask(params, ctx)
    const requestId = lastRequest().requestId

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    await expect(p).resolves.toEqual({ action: 'decline' })
    expect(prompt.pendingCount()).toBe(0)
    expect(win.sent).toContainEqual({
      channel: 'agent:permission-cancel',
      payload: { requestId, sessionId: 's1', reason: 'timeout' },
    })
  })

  it('🔴 **창이 죽으면 decline** — 창이 죽었다고 승인이 될 수는 없다', async () => {
    const p = prompt.ask(params, ctx)
    const requestId = lastRequest().requestId
    win.destroy()

    await expect(p).resolves.toEqual({ action: 'decline' })
    expect(prompt.pendingCount()).toBe(0)
    expect(win.sent).toContainEqual({
      channel: 'agent:permission-cancel',
      payload: { requestId, sessionId: 's1', reason: 'renderer-gone' },
    })
  })

  it('🔴 창이 **아예 없으면** 묻지도 않고 decline (renderer 없이 승인은 없다)', async () => {
    const p = createApprovalPrompt({ getWindow: () => null, timeoutMs: 1000 })

    await expect(p.ask(params, ctx)).resolves.toEqual({ action: 'decline' })
  })

  it('🔴 세션이 닫히면 대기 중인 승인은 전부 decline', async () => {
    const a = prompt.ask(params, ctx)
    const b = prompt.ask(params, { ...ctx, requestId: 8 })
    expect(prompt.pendingCount()).toBe(2)

    prompt.close()

    await expect(a).resolves.toEqual({ action: 'decline' })
    await expect(b).resolves.toEqual({ action: 'decline' })
    expect(prompt.pendingCount()).toBe(0)
    expect(win.sent.filter((entry) => entry.channel === 'agent:permission-cancel')).toHaveLength(2)
  })

  it('세션 종료는 그 세션의 병렬 승인만 전부 decline하고 다른 세션 응답은 보존한다', async () => {
    const first = prompt.ask(params, ctx)
    const second = prompt.ask(params, { ...ctx, requestId: 8 })
    const laterSession = prompt.ask(params, { ...ctx, requestId: 9, sessionId: 's2' })
    const requests = win.sent.map(({ payload }) => payload)

    prompt.closeSession('s1')

    await expect(first).resolves.toEqual({ action: 'decline' })
    await expect(second).resolves.toEqual({ action: 'decline' })
    expect(prompt.pendingCount()).toBe(1)
    expect(win.sent.filter((entry) => entry.channel === 'agent:permission-cancel').map((entry) => entry.payload))
      .toEqual(requests.slice(0, 2).map((request) => ({
        requestId: request.requestId,
        sessionId: 's1',
        reason: 'session-closed',
      })))
    expect(prompt.respond({ requestId: requests[2].requestId, action: 'accept' })).toBe(true)
    await expect(laterSession).resolves.toEqual({ action: 'accept' })
  })

  it('세션 종료 뒤에도 app-scoped prompt는 다음 세션 승인을 받을 수 있다', async () => {
    const first = prompt.ask(params, ctx)
    prompt.closeSession('s1')
    await expect(first).resolves.toEqual({ action: 'decline' })

    const reopened = prompt.ask(params, { ...ctx, requestId: 10, sessionId: 's2' })
    prompt.respond({ requestId: lastRequest().requestId, action: 'accept' })

    await expect(reopened).resolves.toEqual({ action: 'accept' })
  })

  it('🔴 **모르는 action** 은 decline (renderer 가 이상한 걸 보내도 승인되지 않는다)', async () => {
    const p = prompt.ask(params, ctx)
    prompt.respond({ requestId: lastRequest().requestId, action: 'yes-please' })

    await expect(p).resolves.toEqual({ action: 'decline' })
    expect(win.sent.filter((entry) => entry.channel === 'agent:permission-cancel')).toHaveLength(0)
  })
})

describe('🔴 정확히 한 번 — 중복/모르는 응답', () => {
  it('중복 응답은 첫 결과를 덮지 않는다 (두 번째는 찾을 게 없다)', async () => {
    const p = prompt.ask(params, ctx)
    const { requestId } = lastRequest()

    expect(prompt.respond({ requestId, action: 'decline' })).toBe(true)
    expect(prompt.pendingCount()).toBe(0)
    // 늦게 온 accept 가 이미 거부된 승인을 뒤집으면 안 된다.
    expect(prompt.respond({ requestId, action: 'accept' })).toBe(false)

    await expect(p).resolves.toEqual({ action: 'decline' })
  })

  it('🔴 모르는 requestId 는 **다른 승인을 settle 하지 않는다**', async () => {
    const p = prompt.ask(params, ctx)
    const { requestId } = lastRequest()

    expect(prompt.respond({ requestId: 'someone-elses', action: 'accept' })).toBe(false)
    prompt.respond({ requestId, action: 'accept' })

    await expect(p).resolves.toEqual({ action: 'accept' })
  })

  it('🔴 **병렬** 승인 두 개가 섞이지 않는다 (Codex 는 병렬로 쏜다)', async () => {
    const a = prompt.ask(params, ctx)
    const b = prompt.ask({ ...params, _meta: { ...params._meta, tool: 'story_confirm_synopsis' } }, { ...ctx, tool: 'story_confirm_synopsis' })

    const reqs = win.sent.filter((s) => s.channel === 'agent:permission-request').map((s) => s.payload)
    expect(new Set(reqs.map((r) => r.requestId)).size, '두 승인이 같은 id 를 썼다').toBe(2)

    prompt.respond({ requestId: reqs[1].requestId, action: 'accept' })
    prompt.respond({ requestId: reqs[0].requestId, action: 'decline' })

    await expect(a).resolves.toEqual({ action: 'decline' })
    await expect(b).resolves.toEqual({ action: 'accept' })
  })
})
