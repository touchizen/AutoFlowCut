// @vitest-environment node
//
// 2026-10-31 — asb 토큰 지도(flow-media-tokens.js). Flow 가 칩·애셋 항목·미리보기 src 에서 id 를 빼(https://flow.google.com/asb/<토큰>=…)
//   칩 id 는 as29s 로 배운 {토큰: mediaId} 지도로만 읽힌다. 돈 안전 규칙(Codex 2차):
//   지우지 않는다(새 토큰은 더한다 — 늦게 온 옛 답이 새 토큰을 못 지운다) · 한 토큰을 두 id 가 받으면(옛 토큰 포함) 영구 격리 ·
//   격리마다 epoch +1 → 그동안 진행된 판독은 버린다(guarded → null).
import { describe, it, expect } from 'vitest'
import { createMediaTokenRegistry } from '../../electron/flow-media-tokens.js'

const A = '00000001-0000-4000-8000-000000000000'
const B = '00000002-0000-4000-8000-000000000000'

describe('createMediaTokenRegistry', () => {
  it('record → map 에 싣고 knows(id) · 같은 id 의 새 토큰은 더한다(옛 토큰도 그대로)', () => {
    const r = createMediaTokenRegistry()
    expect(r.record('T1', A)).toBe('ok')
    expect(r.knows(A)).toBe(true)
    expect(r.record('T2', A)).toBe('ok')
    expect(r.map).toEqual({ T1: A, T2: A })
    expect(r.record('T1', A)).toBe('ok')   // 늦게 온 옛 답 — 새 토큰을 지우지 않는다(Codex#3)
    expect(r.map).toEqual({ T1: A, T2: A })
  })

  it('Codex#1: 한 토큰을 다른 id 가 받으면 격리 — 갱신 뒤의 옛 토큰이어도(역사를 지우지 않는다) · 이후 그 토큰은 다시 안 들어간다', () => {
    const r = createMediaTokenRegistry()
    r.record('T1', A); r.record('T2', A)
    expect(r.record('T1', B)).toBe('conflict')
    expect(r.map).toEqual({ T2: A })
    expect(r.record('T1', A)).toBe('ambiguous')
    expect(r.record('T1', B)).toBe('ambiguous')
    expect(r.map).toEqual({ T2: A })
  })

  it('Codex#2: 격리마다 epoch +1 — guarded(read) 는 그 사이 격리가 있었으면 null(판독을 믿지 않는다)', async () => {
    const r = createMediaTokenRegistry()
    r.record('T1', A)
    expect(r.epoch()).toBe(0)
    expect(await r.guarded(async () => 'state')).toBe('state')
    const mid = await r.guarded(async () => { r.record('T1', B); return 'state' })
    expect(mid).toBeNull()
    expect(r.epoch()).toBe(1)
    expect(await r.guarded(async () => 'state')).toBe('state')
    r.record('T3', B)   // 더하기는 epoch 를 올리지 않는다(이미 읽힌 id 를 틀리게 만들지 못한다)
    expect(r.epoch()).toBe(1)
  })

  it('guarded 의 read 가 던지면 null', async () => {
    const r = createMediaTokenRegistry()
    expect(await r.guarded(async () => { throw new Error('exec failed') })).toBeNull()
  })
})
