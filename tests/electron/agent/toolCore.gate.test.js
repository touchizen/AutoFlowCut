// @vitest-environment node
//
// M2 — **Tool Core 가 게이트를 소유한다** ((A) 채택 조건 1, 스펙 D9 ERRATA).
//
// 🔴 **스펙 본문의 *"Tool Core 는 `approvalMode` 만 본다"* 는 fail-closed 가 아니다.**
//    `approvalMode` 는 **adapter 가 붙이는 문자열**이다. adapter 가 실수로 조기 부착하거나
//    공통 RPC 가 기본값으로 붙이면 **Tool Core 는 승인이 실제로 있었는지 독립 검증할 수 없다.**
//    → 그래서 Tool Core 는 **스스로 등급을 재산출하고**, G/B 는 **main ledger 의 grant 를 원자적으로
//      1회 consume** 해야만 실행한다. adapter 의 주장은 증거가 아니다.
//
//    handler 가 `elicitInput()` 을 빠뜨리면 **grant 자체가 없다** → 진짜 fail-closed.
//
// 결과 정규화는 D8: `{status:'rejected', reason:'unconfirmed'}` — **side effect 0회.**
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createToolCore } from '../../../electron/agent/toolCore.js'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'

let ledger, storyCommands, core
beforeEach(() => {
  ledger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
  storyCommands = {
    hasProject: () => true,
    projectToken: 'pt',
    getState: vi.fn(async () => ({ steps: {} })),
    listScenes: vi.fn(async () => ({ scenes: [] })),
    // G 툴 — 실제 side effect 를 내는 것들. 승인 전엔 **한 번도 불리면 안 된다.**
    confirmSynopsis: vi.fn(async () => ({ ok: true })),
  }
  core = createToolCore({ grantLedger: ledger, sessionId: 's1' })
  core.use(storyCommands)
})

describe('Tool Core 게이트 — 등급을 스스로 재산출한다', () => {
  it('R 툴은 grant 없이 돈다 (승인 UI 0회)', async () => {
    const r = await core.call('list_scenes', {})
    expect(r).toEqual({ scenes: [] })
  })

  it('🔴 G 툴은 grant 가 **없으면** 거부한다 — side effect 0회', async () => {
    const r = await core.call('story_confirm_synopsis', { synopsisMd: '#' })

    expect(r).toEqual({ status: 'rejected', reason: 'unconfirmed' })
    expect(storyCommands.confirmSynopsis, '승인 없이 실행됐다').not.toHaveBeenCalled()
  })

  it('G 툴은 grant 를 consume 하면 실행된다', async () => {
    const args = { synopsisMd: '#' }
    ledger.grant({ nonce: 'n1', tool: 'story_confirm_synopsis', argsHash: hashArgs(args), sessionId: 's1' })

    const r = await core.call('story_confirm_synopsis', args, { nonce: 'n1' })

    expect(storyCommands.confirmSynopsis).toHaveBeenCalledOnce()
    expect(r).toMatchObject({ ok: true })
  })

  it('🔴 **adapter 가 approvalMode 를 붙여도 통과하지 못한다** — 문자열은 증거가 아니다', async () => {
    // adapter 버그(또는 악의)로 승인 없이 "승인됨" 을 주장한다.
    const r = await core.call('story_confirm_synopsis', { synopsisMd: '#' }, {
      approvalMode: 'mcp-elicitation',   // ← 주장일 뿐
    })

    expect(r, 'approvalMode 문자열만으로 게이트가 뚫렸다').toEqual({ status: 'rejected', reason: 'unconfirmed' })
    expect(storyCommands.confirmSynopsis).not.toHaveBeenCalled()
  })

  it('🔴 같은 grant 를 두 번 쓰면 두 번째는 거부 — side effect 는 정확히 1회', async () => {
    const args = { synopsisMd: '#' }
    ledger.grant({ nonce: 'n1', tool: 'story_confirm_synopsis', argsHash: hashArgs(args), sessionId: 's1' })

    await core.call('story_confirm_synopsis', args, { nonce: 'n1' })
    const second = await core.call('story_confirm_synopsis', args, { nonce: 'n1' })

    expect(second).toEqual({ status: 'rejected', reason: 'unconfirmed' })
    expect(storyCommands.confirmSynopsis).toHaveBeenCalledOnce()
  })

  it('🔴 승인 뒤 **인자를 바꿔치기**하면 거부 — 사용자가 본 것과 다른 게 실행되지 않는다', async () => {
    const shown = { synopsisMd: '짧은 시놉시스' }
    ledger.grant({ nonce: 'n1', tool: 'story_confirm_synopsis', argsHash: hashArgs(shown), sessionId: 's1' })

    const r = await core.call('story_confirm_synopsis', { synopsisMd: '전혀 다른 내용' }, { nonce: 'n1' })

    expect(r).toEqual({ status: 'rejected', reason: 'unconfirmed' })
    expect(storyCommands.confirmSynopsis).not.toHaveBeenCalled()
  })

  it('🔴 **R 툴의 grant 를 G 툴에 재사용**할 수 없다', async () => {
    const args = { synopsisMd: '#' }
    ledger.grant({ nonce: 'n1', tool: 'list_scenes', argsHash: hashArgs(args), sessionId: 's1' })

    const r = await core.call('story_confirm_synopsis', args, { nonce: 'n1' })

    expect(r).toEqual({ status: 'rejected', reason: 'unconfirmed' })
    expect(storyCommands.confirmSynopsis).not.toHaveBeenCalled()
  })

  it('정책표를 조회할 수 있다 (adapter 가 어떤 툴에 elicitation 을 열지 정하는 근거)', () => {
    const byName = Object.fromEntries(core.list().map((t) => [t.name, t.permission]))
    expect(byName.list_scenes).toBe('R')
    expect(byName.story_get_state).toBe('R')
    expect(byName.wait_batch).toBe('R')
  })
})

// 🔴 **fixture 로 B 를 주장하는 건 B 커버리지가 아니다.**
//    테스트가 `generate_videos: 'B'` 를 *fixture 배열에* 써놓고 통과하면, **실제 정책표에 B 가 한 줄도
//    없어도** 초록이다 (실측: `permission !== 'R'` → `=== 'G'` 로 바꿔도 전부 초록이었다).
//    → **실제 표**를 상대로, D9.3 이 이름을 댄 툴이 전부 게이트에 걸리는지 잰다.
describe('🔴 D9.3 이 이름을 댄 툴은 전부 G 또는 B 다 (실제 정책표)', () => {
  const MUST_BE_GATED = ['story_confirm_synopsis', 'story_set_speakers', 'story_start_step', 'generate_videos']

  it.each(MUST_BE_GATED)('%s 는 R 이 아니다', (name) => {
    const t = core.list().find((x) => x.name === name)
    expect(t, `${name} 이 정책표에 없다 — 등급 없는 툴은 게이트를 안 탄다`).toBeTruthy()
    expect(['G', 'B']).toContain(t.permission)
  })

  it('🔴 **B 툴**은 grant 없이 거부된다 (과금은 사람 승인 뒤에만 — D9.3)', async () => {
    const bridge = { invoke: vi.fn(async () => ({ accepted: true })) }
    const c = createToolCore({ grantLedger: ledger, sessionId: 's1', toolBridge: bridge })
    c.use(storyCommands)

    const r = await c.call('generate_videos', { items: [1, 2] })

    expect(r).toEqual({ status: 'rejected', reason: 'unconfirmed' })
    expect(bridge.invoke, '🔴 승인 없이 과금 admission 이 실행됐다').not.toHaveBeenCalled()
  })

  it('B 툴은 grant 를 consume 하면 실행된다', async () => {
    const bridge = { invoke: vi.fn(async () => ({ accepted: true, operationId: 'op-1' })) }
    const c = createToolCore({ grantLedger: ledger, sessionId: 's1', toolBridge: bridge })
    c.use(storyCommands)
    const args = { items: [1, 2] }
    ledger.grant({ nonce: 'n1', tool: 'generate_videos', argsHash: hashArgs(args), sessionId: 's1' })

    const r = await c.call('generate_videos', args, { nonce: 'n1' })

    expect(bridge.invoke).toHaveBeenCalledOnce()
    expect(r).toMatchObject({ accepted: true })
  })
})
