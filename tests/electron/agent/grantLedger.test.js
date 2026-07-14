// @vitest-environment node
//
// M2 — **승인 grant ledger** ((A) 채택 조건 2, 스펙 D9 ERRATA).
//
// 🔴 **왜 문자열 주장을 믿으면 안 되는가.**
//    스펙 본문은 *"Tool Core 는 request context 의 `approvalMode` 만 본다"* 고 썼지만,
//    `approvalMode` 는 **adapter 가 붙이는 문자열**이다. adapter 가 실수로 조기 부착하거나
//    공통 RPC 가 기본값으로 붙이면 **Tool Core 는 승인이 실제로 일어났는지 독립 검증할 수 없다.**
//    → 게이트가 샌다. 그래서 **main 이 자기 ledger 에 직접 기록**하고, adapter 는 **nonce 를 제시**만 한다.
//
//    handler 가 `elicitInput()` 을 **빠뜨리면 grant 자체가 없다** → 진짜 fail-closed.
//
// 계약:
//   - main responder 가 **UI accept 순간** `grant({nonce, tool, argsHash, sessionId})` 를 기록한다.
//   - adapter 의 private RPC 가 nonce 를 제시하면 `consume()` 이 **원자적으로 1회** 소비하고
//     **tool / argsHash / session 을 대조**한다.
//   - 불일치 / 재사용 / 만료 / 없음 → 전부 거부. **side effect 0회.**
import { describe, it, expect, vi } from 'vitest'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'

const clock = () => { let t = 0; return { now: () => t, advance: (ms) => { t += ms } } }
const ledgerAt = (c, ttlMs = 10 * 60 * 1000) => createGrantLedger({ now: c.now, ttlMs })

const G = { tool: 'generate_videos', args: { items: [1, 2] }, sessionId: 's1' }
const grantFor = (g = G) => ({ nonce: 'n1', tool: g.tool, argsHash: hashArgs(g.args), sessionId: g.sessionId })

describe('grantLedger — 정상 경로', () => {
  it('accept 로 기록된 grant 를 같은 tool/args/session 이 소비한다', () => {
    const c = clock()
    const l = ledgerAt(c)
    l.grant(grantFor())

    expect(l.consume({ nonce: 'n1', tool: G.tool, argsHash: hashArgs(G.args), sessionId: 's1' })).toBe(true)
  })
})

describe('grantLedger — fail-closed', () => {
  it('🔴 grant 가 **없으면** 거부한다 (handler 가 elicitInput 을 빠뜨린 경우)', () => {
    const l = ledgerAt(clock())
    expect(l.consume({ nonce: 'never-granted', tool: G.tool, argsHash: hashArgs(G.args), sessionId: 's1' })).toBe(false)
  })

  it('🔴 **1회용이다** — 같은 nonce 두 번째는 거부 (replay 차단)', () => {
    const l = ledgerAt(clock())
    l.grant(grantFor())
    const args = { nonce: 'n1', tool: G.tool, argsHash: hashArgs(G.args), sessionId: 's1' }

    expect(l.consume(args)).toBe(true)
    expect(l.consume(args), '같은 승인으로 두 번 실행됐다').toBe(false)
  })

  it('🔴 **다른 tool** 로는 못 쓴다 — 읽기 승인을 과금 툴에 재사용할 수 없다', () => {
    const l = ledgerAt(clock())
    l.grant(grantFor({ ...G, tool: 'list_scenes' }))

    expect(l.consume({ nonce: 'n1', tool: 'generate_videos', argsHash: hashArgs(G.args), sessionId: 's1' })).toBe(false)
  })

  it('🔴 **args 가 바뀌면** 못 쓴다 — 승인 뒤 인자를 바꿔치기할 수 없다', () => {
    const l = ledgerAt(clock())
    l.grant(grantFor())   // 사용자는 items:[1,2] 를 보고 승인했다

    // 승인 창에 보인 것과 다른 인자로 실행하려 한다 (영상 2개 승인 → 8개 실행).
    const tampered = hashArgs({ items: [1, 2, 3, 4, 5, 6, 7, 8] })
    expect(l.consume({ nonce: 'n1', tool: G.tool, argsHash: tampered, sessionId: 's1' })).toBe(false)
  })

  it('🔴 **다른 세션**의 grant 는 못 쓴다', () => {
    const l = ledgerAt(clock())
    l.grant(grantFor())

    expect(l.consume({ nonce: 'n1', tool: G.tool, argsHash: hashArgs(G.args), sessionId: 's2' })).toBe(false)
  })

  it('🔴 만료된 grant 는 거부한다', () => {
    const c = clock()
    const l = ledgerAt(c, 60_000)
    l.grant(grantFor())

    c.advance(60_001)
    expect(l.consume({ nonce: 'n1', tool: G.tool, argsHash: hashArgs(G.args), sessionId: 's1' })).toBe(false)
  })

  it('🔴 **동시에** 같은 nonce 를 소비하면 정확히 하나만 이긴다 (원자적)', () => {
    const l = ledgerAt(clock())
    l.grant(grantFor())
    const args = { nonce: 'n1', tool: G.tool, argsHash: hashArgs(G.args), sessionId: 's1' }

    // Codex 는 tool call 을 **병렬로 쏜다** (M0-8 실측). 같은 승인이 두 호출에 걸리면 안 된다.
    const results = [l.consume(args), l.consume(args)]
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('세션이 닫히면 그 세션의 grant 는 전부 사라진다', () => {
    const l = ledgerAt(clock())
    l.grant(grantFor())
    l.closeSession('s1')

    expect(l.consume({ nonce: 'n1', tool: G.tool, argsHash: hashArgs(G.args), sessionId: 's1' })).toBe(false)
  })
})

describe('hashArgs — 승인 창에 보인 것과 실행되는 것이 같음을 보장한다', () => {
  it('키 순서가 달라도 같은 해시 (직렬화 순서 때문에 승인이 깨지면 안 된다)', () => {
    expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }))
  })

  it('🔴 값이 하나라도 다르면 다른 해시', () => {
    expect(hashArgs({ items: [1, 2] })).not.toBe(hashArgs({ items: [1, 3] }))
    expect(hashArgs({ items: [1, 2] })).not.toBe(hashArgs({ items: [1, 2, 3] }))
  })

  it('중첩 객체도 순서 무관', () => {
    expect(hashArgs({ o: { x: 1, y: 2 } })).toBe(hashArgs({ o: { y: 2, x: 1 } }))
  })

  it('🔴 배열 순서는 **의미가 있다** — 뒤바뀌면 다른 해시', () => {
    expect(hashArgs({ items: [1, 2] })).not.toBe(hashArgs({ items: [2, 1] }))
  })
})
