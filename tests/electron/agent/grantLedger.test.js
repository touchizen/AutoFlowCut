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
//   - main responder 가 **UI accept 순간** `grant({nonce, tool, argsHash, sessionId, projectToken})` 를 기록한다.
//   - adapter 의 private RPC 가 nonce 를 제시하면 `consume()` 이 **원자적으로 1회** 소비하고
//     **tool / argsHash / session / project 를 대조**한다.
//   - 불일치 / 재사용 / 만료 / 없음 → 전부 거부. **side effect 0회.**
import { describe, it, expect, vi } from 'vitest'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'

const clock = () => { let t = 0; return { now: () => t, advance: (ms) => { t += ms } } }
const ledgerAt = (c, ttlMs = 10 * 60 * 1000) => createGrantLedger({ now: c.now, ttlMs })

const G = { tool: 'generate_videos', args: { items: [1, 2] }, sessionId: 's1', projectToken: 'project-a' }
const grantFor = (g = G) => ({
  nonce: 'n1',
  tool: g.tool,
  argsHash: hashArgs(g.args),
  sessionId: g.sessionId,
  projectToken: g.projectToken,
})

describe('grantLedger — 정상 경로', () => {
  it('accept 로 기록된 grant 를 같은 tool/args/session 이 소비한다', () => {
    const c = clock()
    const l = ledgerAt(c)
    l.grant(grantFor())

    expect(l.consume(grantFor())).toBe(true)
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
    const args = grantFor()

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

    expect(l.consume({ ...grantFor(), sessionId: 's2' })).toBe(false)
  })

  it('🔴 **다른 프로젝트**의 grant는 못 쓴다 — session guard가 빠져도 프로젝트를 건너지 않는다', () => {
    const l = ledgerAt(clock())
    l.grant(grantFor())

    expect(l.consume({ ...grantFor(), projectToken: 'project-b' })).toBe(false)
  })

  it('🔴 만료된 grant 는 거부한다', () => {
    const c = clock()
    const l = ledgerAt(c, 60_000)
    l.grant(grantFor())

    c.advance(60_001)
    expect(l.consume({ nonce: 'n1', tool: G.tool, argsHash: hashArgs(G.args), sessionId: 's1' })).toBe(false)
  })

  // ⚠️ `[l.consume(a), l.consume(a)]` 로 쓰면 **아무것도 증명하지 못한다** — 동기 호출 두 개는
  //    JS 에서 애초에 interleave 될 수 없다. 그건 위의 replay 테스트를 다시 돌리는 것일 뿐이다.
  //    (실측: `grants.delete` 를 검증 **뒤로** 옮겨도 그 테스트는 초록이었다.)
  //
  //    진짜 계약은 **"조회와 삭제 사이에 다른 코드가 끼어들 수 없다"** 이다.
  //    지금은 동기라서 성립하지만, 누가 `consume` 안에 `await` 를 하나 넣는 순간(예: grant 를 디스크에
  //    영속화) **replay 창이 조용히 열린다.** 그걸 잡는다.
  it('🔴 `consume` 은 **동기적으로** 소비를 확정한다 — await 가 끼면 replay 창이 열린다', () => {
    const l = ledgerAt(clock())
    l.grant(grantFor())
    const args = grantFor()

    // Promise 를 돌려주면(= 안에 await 이 생겼다는 뜻) 호출자가 그 사이에 두 번 진입할 수 있다.
    const r = l.consume(args)
    expect(typeof r?.then, '🔴 consume 이 비동기가 됐다 — 조회와 삭제 사이가 열렸다').toBe('undefined')
    expect(r).toBe(true)

    // 그리고 첫 호출이 끝난 **직후** 이미 소비돼 있어야 한다 (지연 삭제 금지).
    expect(l.consume(args)).toBe(false)
  })

  it('세션이 닫히면 그 세션의 grant 는 전부 사라진다', () => {
    const l = ledgerAt(clock())
    l.grant(grantFor())
    l.closeSession('s1')

    expect(l.consume(grantFor())).toBe(false)
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
