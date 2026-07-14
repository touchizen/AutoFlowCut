// @vitest-environment node
//
// M2 — **Codex MCP stdio adapter** (스펙 D9 결정 2 + (A) 채택 조건 2·5).
//
//   Codex app-server ──spawn──▶ adapter (패키징 Electron + ELECTRON_RUN_AS_NODE=1, 별도 프로세스)
//                                   │  G/B: elicitInput() → 사람 승인
//                                   │  accept 일 때만
//                                   ▼  private RPC (nonce 제시)
//                                main Tool Core → grant 를 원자적으로 1회 consume
//
// 🔴 **조건 2**: adapter 는 승인을 **주장하지 않는다.** elicitation payload 에 `{nonce, tool, argsHash}` 를
//    싣고, main 이 accept 순간 자기 ledger 에 기록한다. adapter 는 그 nonce 를 **제시**만 한다.
//    → handler 가 `elicitInput()` 을 빠뜨리면 grant 가 없어 **진짜 fail-closed**.
//
// 🔴 **조건 5**: `elicitInput()` 에 **명시적 timeout 을 넘겨야 한다.** MCP SDK 기본이 **60초**라
//    (`DEFAULT_REQUEST_TIMEOUT_MSEC`), 안 넘기면 **우리 MCP 서버가** 10분 승인을 60초에 죽인다
//    (실측: `60,013ms` 에 `-32001 Request timed out`). **Codex 가 죽인 게 아니다.**
//
// 🔴 **decline / cancel 은 Tool Core 호출 0회, side effect 0회.**
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAdapterHandlers } from '../../../electron/agent/codexMcpAdapter.js'
import { decodeApprovalPayload, encodeApprovalPayload } from '../../../electron/agent/approvalPayload.js'
import { hashArgs } from '../../../electron/agent/grantLedger.js'

const TOOLS = [
  { name: 'list_scenes', permission: 'R' },
  { name: 'story_confirm_synopsis', permission: 'G' },
  { name: 'generate_videos', permission: 'B' },
]

let rpc, elicitInput, handlers
beforeEach(() => {
  rpc = { call: vi.fn(async () => ({ ok: true })) }
  elicitInput = vi.fn(async () => ({ action: 'accept', content: {} }))
  handlers = createAdapterHandlers({
    tools: TOOLS,
    rpc,
    elicitInput,
    approvalTimeoutMs: 10 * 60 * 1000,
    newNonce: () => 'n1',
  })
})

describe('adapter — R 툴', () => {
  it('R 은 승인 창 없이 바로 private RPC 로 간다', async () => {
    const r = await handlers.callTool('list_scenes', {})

    expect(elicitInput, 'read 툴에 승인 창을 띄웠다').not.toHaveBeenCalled()
    expect(rpc.call).toHaveBeenCalledWith({ tool: 'list_scenes', args: {}, nonce: undefined })
    expect(r).toEqual({ ok: true })
  })
})

describe('adapter — G/B 툴은 승인 뒤에만 (조건 2)', () => {
  it('elicitation payload 에 `{nonce, tool, argsHash}` 를 싣는다 — main 이 이걸로 ledger 에 기록한다', async () => {
    const args = { synopsisMd: '#' }
    await handlers.callTool('story_confirm_synopsis', args)

    expect(elicitInput).toHaveBeenCalledOnce()
    const params = elicitInput.mock.calls[0][0]
    // ⚠️ `params._meta ?? params.meta ?? params` 로 쓰면 **세 가지 shape 을 다 받아준다** — 그중
    //    responder 가 읽을 수 있는 건 `_meta` 하나뿐이다. `_meta` → `meta` 로 오타 내도 초록이었다 (실측).
    //    **실측(2026-07-14)**: 서버가 설정한 `_meta` 는 Codex 를 거쳐 **verbatim 도착한다.**
    //    (반면 `requestedSchema` 의 최상위 커스텀 키는 **삭제된다** — 그쪽으로 옮겼으면 게이트가 죽었다.)
    expect(params._meta).toMatchObject({
      nonce: 'n1',
      tool: 'story_confirm_synopsis',
      argsHash: hashArgs(args),
    })
    expect(params.message).toBe(encodeApprovalPayload('story_confirm_synopsis', args))
    expect(decodeApprovalPayload(params.message)).toEqual({ tool: 'story_confirm_synopsis', args })
  })

  it('accept 면 **그 nonce 를 제시하며** private RPC 를 1회 부른다', async () => {
    const args = { synopsisMd: '#' }
    await handlers.callTool('story_confirm_synopsis', args)

    expect(rpc.call).toHaveBeenCalledOnce()
    expect(rpc.call).toHaveBeenCalledWith({ tool: 'story_confirm_synopsis', args, nonce: 'n1' })
  })

  it('🔴 decline 이면 Tool Core 호출 **0회**', async () => {
    elicitInput.mockResolvedValueOnce({ action: 'decline' })

    const r = await handlers.callTool('generate_videos', { items: [1, 2] })

    expect(rpc.call, '거부했는데 실행됐다').not.toHaveBeenCalled()
    expect(r).toEqual({ status: 'rejected', reason: 'declined-by-user' })
  })

  it('🔴 cancel 이면 Tool Core 호출 **0회**', async () => {
    elicitInput.mockResolvedValueOnce({ action: 'cancel' })

    const r = await handlers.callTool('generate_videos', { items: [1, 2] })

    expect(rpc.call).not.toHaveBeenCalled()
    expect(r).toMatchObject({ status: 'rejected', reason: 'cancelled' })
  })

  it('🔴 알 수 없는 action 은 **거부**한다 (fail-open 금지)', async () => {
    elicitInput.mockResolvedValueOnce({ action: 'something-new' })

    const r = await handlers.callTool('generate_videos', { items: [1] })

    expect(rpc.call).not.toHaveBeenCalled()
    expect(r).toMatchObject({ status: 'rejected' })
  })

  it('🔴 elicitInput 이 던져도(타임아웃 등) 실행하지 않는다', async () => {
    elicitInput.mockRejectedValueOnce(new Error('MCP error -32001: Request timed out'))

    const r = await handlers.callTool('generate_videos', { items: [1] })

    expect(rpc.call).not.toHaveBeenCalled()
    expect(r).toMatchObject({ status: 'rejected' })
  })

  it('🔴 매 호출마다 **새 nonce** — 재사용하면 replay 가 뚫린다', async () => {
    let i = 0
    const h = createAdapterHandlers({
      tools: TOOLS, rpc, elicitInput, approvalTimeoutMs: 1000, newNonce: () => `n${++i}`,
    })

    await h.callTool('story_confirm_synopsis', { a: 1 })
    await h.callTool('story_confirm_synopsis', { a: 1 })

    expect(rpc.call.mock.calls[0][0].nonce).toBe('n1')
    expect(rpc.call.mock.calls[1][0].nonce).toBe('n2')
  })
})

describe('adapter — 조건 5: 명시적 timeout', () => {
  it('🔴 `elicitInput()` 에 **명시적 timeout** 을 넘긴다 (SDK 기본 60초가 10분 승인을 죽인다)', async () => {
    await handlers.callTool('story_confirm_synopsis', { a: 1 })

    const options = elicitInput.mock.calls[0][1]
    expect(options?.timeout, 'timeout 을 안 넘겼다 — 승인 창이 60초에 죽는다').toBe(10 * 60 * 1000)
  })

  it('🔴 timeout 을 안 주면 adapter 생성 자체가 실패한다 (기본값에 기대지 않는다)', () => {
    expect(() => createAdapterHandlers({ tools: TOOLS, rpc, elicitInput }))
      .toThrow(/approvalTimeoutMs/i)
  })
})

describe('adapter — fail-closed', () => {
  it('🔴 툴 표에 없는 이름은 승인도 실행도 하지 않는다', async () => {
    await expect(handlers.callTool('rm_rf', {})).rejects.toThrow(/unknown tool/i)

    expect(elicitInput).not.toHaveBeenCalled()
    expect(rpc.call).not.toHaveBeenCalled()
  })
})

describe('adapter — 승인 문구는 사람이 실제로 볼 수 있어야 한다', () => {
  // synopsis 같은 긴 G payload는 승인 renderer에 도달하기 전에 잘리면 펼칠 방법 자체가 없다.
  // display는 scroll이 맡고 transport는 원본 전체를 보존한다.
  it('긴 인자를 transport에서 자르지 않고 승인 창으로 전부 보낸다', async () => {
    const elicitInput = vi.fn(async () => ({ action: 'decline' }))
    const rpc = { call: vi.fn() }
    const handlers = createAdapterHandlers({
      tools: [{ name: 'story_confirm_synopsis', permission: 'G' }],
      rpc,
      elicitInput,
      approvalTimeoutMs: 1000,
    })

    const huge = { synopsisMd: 'x'.repeat(5000) }
    await handlers.callTool('story_confirm_synopsis', huge)

    const { message } = elicitInput.mock.calls[0][0]
    expect(message).toBe(encodeApprovalPayload('story_confirm_synopsis', huge))
    expect(decodeApprovalPayload(message)).toEqual({ tool: 'story_confirm_synopsis', args: huge })
    expect(message).not.toMatch(/truncated|잘렸|생략/i)
  })

  it('message는 사람 문장이 아니라 main이 검증할 canonical 데이터 봉투다', async () => {
    const elicitInput = vi.fn(async () => ({ action: 'decline' }))
    const handlers = createAdapterHandlers({
      tools: [{ name: 'story_set_speakers', permission: 'G' }],
      rpc: { call: vi.fn() },
      elicitInput,
      approvalTimeoutMs: 1000,
    })

    await handlers.callTool('story_set_speakers', { speakers: [{ id: 'narrator', name: '나레이션' }] })

    const { message } = elicitInput.mock.calls[0][0]
    expect(decodeApprovalPayload(message)).toEqual({
      tool: 'story_set_speakers',
      args: { speakers: [{ id: 'narrator', name: '나레이션' }] },
    })
  })
})
