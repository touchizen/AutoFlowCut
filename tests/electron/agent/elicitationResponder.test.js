// @vitest-environment node
//
// M2 — **main 이 소유하는 elicitation responder** ((A) 채택 조건 3·4).
//
// 🔴 **조건 4 — responder 는 main 이 소유한다 (renderer 아님).**
//    native 승인은 **모든** MCP 호출에 뜨고 (plain read 에도 — M0-8 실측), Codex 는 **병렬로 쏜다.**
//    ChatPanel(renderer)이 바쁘거나 죽어 있으면 **R 툴까지 전부 막힌다.**
//    *"R 은 UI 0회"* 는 곧 *"renderer 생존과 무관하게 통과"* 다.
//    → main 이 **분류**한다: native → 즉답(auto-accept), handler elicitation → renderer 로 올림.
//
// 🔴 **조건 3 — auto-accept 는 *양성 매칭* 일 때만.**
//    `_meta.codex_approval_kind === 'mcp_tool_call'` **그리고** `serverName` 이 우리 adapter.
//    **"우리 것 아니면 accept" 는 fail-open 이다** — 미래 Codex 가 새 elicitation 종류를 추가하면 그대로 뚫린다.
//
// 🔴 **pending map 은 JSON-RPC request id + session 으로 잡는다. `turnId` 로 잡지 마라** —
//    out-of-band elicitation 은 실제로 **`turnId: null`** 로 온다 (실측).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElicitationResponder } from '../../../electron/agent/elicitationResponder.js'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'

const OUR_SERVER = 'autoflowcut'

let ledger, askUser, responder
beforeEach(() => {
  ledger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
  askUser = vi.fn(async () => ({ action: 'accept' }))
  responder = createElicitationResponder({
    grantLedger: ledger,
    sessionId: 's1',
    projectToken: 'project-a',
    adapterServerName: OUR_SERVER,
    askUser,
  })
})

const native = (over = {}) => ({
  serverName: OUR_SERVER,
  message: 'Allow the autoflowcut MCP server to run tool "list_scenes"?',
  _meta: { codex_approval_kind: 'mcp_tool_call', tool_title: 'List scenes' },
  ...over,
})

const handlerElicit = (args = { synopsisMd: '#' }, over = {}) => ({
  serverName: OUR_SERVER,
  message: 'Approve story_confirm_synopsis?',
  requestedSchema: { type: 'object', properties: {} },
  _meta: { nonce: 'n1', tool: 'story_confirm_synopsis', argsHash: hashArgs(args) },
  ...over,
})

describe('native 승인 — UI 없이 auto-accept (조건 3)', () => {
  it('양성 매칭이면 즉답 accept — **renderer 를 부르지 않는다**', async () => {
    const r = await responder.handle(native(), { requestId: 1, turnId: null })

    expect(r.action).toBe('accept')
    expect(askUser, 'read 툴 하나에 승인 UI 가 떴다 — renderer 가 죽으면 R 이 전부 막힌다').not.toHaveBeenCalled()
  })

  it('native auto-accept 는 **grant 를 만들지 않는다** — 그건 Codex 의 중복 승인이지 사람의 승인이 아니다', async () => {
    // ⚠️ 특정 nonce 의 `consume` 이 false 인 것만 보면 **아무것도 증명 못 한다** — 뮤턴트가
    //    *다른* 인자로 grant 를 만들어도 그 consume 은 여전히 false 다 (실측으로 걸렸다).
    //    계약은 **grant 를 아예 안 만든다** 이다. 그걸 못박는다.
    const grant = vi.spyOn(ledger, 'grant')

    await responder.handle(native(), { requestId: 1, turnId: null })

    expect(grant, 'Codex 의 중복 승인을 사람의 승인으로 계산했다').not.toHaveBeenCalled()
  })
})

describe('🔴 auto-accept 는 양성 매칭일 때만 — fail-open 금지 (조건 3)', () => {
  it('🔴 **다른 서버**의 native 는 auto-accept 하지 않는다', async () => {
    const r = await responder.handle(native({ serverName: 'some-other-mcp' }), { requestId: 1 })

    expect(r.action, "'우리 것 아니면 accept' 는 fail-open 이다").not.toBe('accept')
  })

  it('🔴 **모르는 kind** 는 auto-accept 하지 않는다 (미래 Codex 가 새 종류를 추가해도 안 뚫린다)', async () => {
    const r = await responder.handle(
      native({ _meta: { codex_approval_kind: 'something_new_in_a_future_codex' } }),
      { requestId: 1 },
    )

    expect(r.action).not.toBe('accept')
  })

  it('🔴 `_meta` 가 아예 없으면 auto-accept 하지 않는다', async () => {
    const r = await responder.handle(native({ _meta: undefined }), { requestId: 1 })

    expect(r.action).not.toBe('accept')
  })
})

describe('🔴 F2 — 설정 하나가 빠지면 게이트가 fail-open 한다', () => {
  it('`adapterServerName` 없이 생성하면 **터진다** (undefined === undefined 로 남의 것이 우리 것이 된다)', () => {
    expect(() => createElicitationResponder({ grantLedger: ledger, sessionId: 's1', askUser }))
      .toThrow(/adapterServerName/)
  })

  it('serverName 이 **없는** elicitation 은 우리 것이 아니다 (auto-accept 도 grant 도 없다)', async () => {
    const grant = vi.spyOn(ledger, 'grant')

    const r1 = await responder.handle({ _meta: { codex_approval_kind: 'mcp_tool_call' } }, { requestId: 1 })
    const r2 = await responder.handle({ _meta: { nonce: 'x', tool: 'generate_videos', argsHash: 'deadbeef' } }, { requestId: 2 })

    expect(r1.action).not.toBe('accept')
    expect(r2.action).not.toBe('accept')
    expect(grant, '남의 elicitation 이 과금 툴 grant 를 발급받았다').not.toHaveBeenCalled()
  })
})

describe('handler elicitation — 사람에게 묻는다 (조건 2·4)', () => {
  it('renderer 로 올리고, accept 면 **ledger 에 grant 를 기록**한다', async () => {
    const args = { synopsisMd: '#' }
    const r = await responder.handle(handlerElicit(args), { requestId: 7, turnId: null })

    expect(askUser).toHaveBeenCalledOnce()
    expect(r.action).toBe('accept')

    // adapter 가 제시할 nonce 로 정확히 소비된다.
    expect(ledger.consume({
      nonce: 'n1',
      tool: 'story_confirm_synopsis',
      argsHash: hashArgs(args),
      sessionId: 's1',
      projectToken: 'project-a',
    })).toBe(true)
  })

  it('🔴 **grant 를 기록한 뒤에** accept 를 응답한다 — 순서가 뒤집히면 adapter 의 RPC 가 먼저 도착해 거부당한다', async () => {
    const order = []
    const l = {
      grant: vi.fn(() => order.push('grant')),
      consume: vi.fn(() => false),
      closeSession: vi.fn(),
    }
    const rr = createElicitationResponder({
      grantLedger: l, sessionId: 's1', projectToken: 'project-a', adapterServerName: OUR_SERVER,
      askUser: async () => { order.push('ask'); return { action: 'accept' } },
    })

    await rr.handle(handlerElicit(), { requestId: 7 })
    order.push('respond')

    expect(order).toEqual(['ask', 'grant', 'respond'])
  })

  it('🔴 decline 이면 grant 를 만들지 않는다', async () => {
    askUser.mockResolvedValueOnce({ action: 'decline' })
    const args = { synopsisMd: '#' }

    const r = await responder.handle(handlerElicit(args), { requestId: 7 })

    expect(r.action).toBe('decline')
    expect(ledger.consume({ nonce: 'n1', tool: 'story_confirm_synopsis', argsHash: hashArgs(args), sessionId: 's1' })).toBe(false)
  })

  it('🔴 사용자가 accept 해도 **payload 가 망가졌으면** grant 를 만들지 않는다 (nonce/tool/argsHash 필수)', async () => {
    const r = await responder.handle(
      handlerElicit(undefined, { _meta: { nonce: 'n1' } }),   // tool/argsHash 없음
      { requestId: 7 },
    )

    expect(r.action).not.toBe('accept')
    expect(askUser, '무엇을 승인하는지도 모르면서 사용자에게 물었다').not.toHaveBeenCalled()
  })
})

describe('🔴 조건 4 — pending 은 request id 로 잡는다 (turnId 가 아니다)', () => {
  it('`turnId: null` 이어도 정상 동작한다 (out-of-band elicitation 실측)', async () => {
    const r = await responder.handle(handlerElicit(), { requestId: 7, turnId: null })
    expect(r.action).toBe('accept')
  })

  it('🔴 **병렬** elicitation 두 개가 서로 섞이지 않는다 (Codex 는 병렬로 쏜다)', async () => {
    const a = { synopsisMd: 'A' }
    const b = { items: [1, 2] }
    const answers = { 7: { action: 'accept' }, 8: { action: 'decline' } }
    const rr = createElicitationResponder({
      grantLedger: ledger, sessionId: 's1', projectToken: 'project-a', adapterServerName: OUR_SERVER,
      askUser: async (_p, ctx) => answers[ctx.requestId],
    })

    const [ra, rb] = await Promise.all([
      rr.handle(handlerElicit(a, { _meta: { nonce: 'na', tool: 'story_confirm_synopsis', argsHash: hashArgs(a) } }), { requestId: 7, turnId: null }),
      rr.handle(handlerElicit(b, { _meta: { nonce: 'nb', tool: 'generate_videos', argsHash: hashArgs(b) } }), { requestId: 8, turnId: null }),
    ])

    expect(ra.action).toBe('accept')
    expect(rb.action).toBe('decline')
    // accept 된 쪽만 grant 가 있다.
    expect(ledger.consume({
      nonce: 'na',
      tool: 'story_confirm_synopsis',
      argsHash: hashArgs(a),
      sessionId: 's1',
      projectToken: 'project-a',
    })).toBe(true)
    expect(ledger.consume({ nonce: 'nb', tool: 'generate_videos', argsHash: hashArgs(b), sessionId: 's1' })).toBe(false)
  })
})
