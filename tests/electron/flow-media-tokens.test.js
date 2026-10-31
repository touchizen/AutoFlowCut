// @vitest-environment node
//
// 2026-10-31 — asb 토큰 지도(flow-media-tokens.js). Flow 가 칩·애셋 항목·미리보기 src 에서 id 를 빼(https://flow.google.com/asb/<토큰>=…)
//   칩 id 는 as29s 로 배운 {토큰: mediaId} 지도로만 읽힌다. 돈 안전 규칙(Codex 2·3·5차):
//   주인 기록(토큰 → 처음 받은 id)은 영구 — 한 토큰을 두 id 가 받으면(갱신 뒤의 옛 토큰이어도) 영구 격리 ·
//   판독 지도는 id 마다 가장 최근 답 하나 — 강제로 다시 물으면 그 id 의 지금 토큰부터 내린다(답 전·실패·시간 초과 = 토큰으로 안 읽힘) ·
//   물음마다 번호 — 더 나중 물음이 있으면 늦게 온 옛 답은 버린다 · 판독 지도에서 빠질 때마다 epoch +1 → 그동안 진행된 판독은 버린다.
import { describe, it, expect } from 'vitest'
import { createMediaTokenRegistry, sharedMediaTokenRegistry, _resetSharedMediaTokensForTests } from '../../electron/flow-media-tokens.js'

const A = '00000001-0000-4000-8000-000000000000'
const B = '00000002-0000-4000-8000-000000000000'
/** 물음 하나 = begin → settle. */
const learn = (r, id, token, o) => r.settle(id, r.begin(id, o), token)

describe('createMediaTokenRegistry', () => {
  it('답 → 판독 지도·knows · 같은 id 의 새 토큰은 옛 토큰을 판독 지도에서 내린다(epoch +1)', () => {
    const r = createMediaTokenRegistry()
    expect(learn(r, A, 'T1')).toBe('ok')
    expect(r.knows(A)).toBe(true)
    expect(r.map).toEqual({ T1: A })
    expect(r.epoch()).toBe(0)
    expect(learn(r, A, 'T2', { force: true })).toBe('ok')
    expect(r.map).toEqual({ T2: A })
    expect(r.epoch()).toBeGreaterThan(0)
  })

  it('Codex 5차: 강제로 다시 물으면 답이 오기 전부터 지금 토큰을 내린다 — 실패(토큰 없음)면 그 id 는 토큰으로 안 읽힌다', () => {
    const r = createMediaTokenRegistry()
    learn(r, A, 'T1')
    const n = r.begin(A, { force: true })
    expect(r.map).toEqual({})
    expect(r.knows(A)).toBe(false)
    expect(r.settle(A, n, null)).toBe('none')
    expect(r.map).toEqual({})
  })

  it('Codex 2차#3: 나중 물음이 있으면 늦게 온 옛 답은 버린다(superseded) — 새 토큰을 되돌리지 못한다', () => {
    const r = createMediaTokenRegistry()
    const n1 = r.begin(A)
    const n2 = r.begin(A, { force: true })
    expect(r.settle(A, n2, 'T2')).toBe('ok')
    expect(r.settle(A, n1, 'T1')).toBe('superseded')
    expect(r.map).toEqual({ T2: A })
  })

  it('Codex 6차#2: 늦게 온 옛 답(superseded)도 주인 증거는 남긴다 — 지금 토큰은 안 바꾸지만, 그 토큰을 다른 id 가 받으면 충돌', () => {
    const r = createMediaTokenRegistry()
    const n1 = r.begin(A)
    const n2 = r.begin(A, { force: true })
    expect(r.settle(A, n2, 'T2')).toBe('ok')
    expect(r.settle(A, n1, 'T1')).toBe('superseded')
    expect(r.map).toEqual({ T2: A })
    expect(learn(r, B, 'T1')).toBe('conflict')
  })

  it('Codex 6차#2: 늦게 온 옛 답의 토큰이 이미 다른 id 것이면 그 토큰을 격리한다', () => {
    const r = createMediaTokenRegistry()
    learn(r, B, 'T5')
    const n1 = r.begin(A)
    r.begin(A, { force: true })
    expect(r.settle(A, n1, 'T5')).toBe('conflict')
    expect(r.map).toEqual({})
    expect(r.knows(B)).toBe(false)
  })

  it('Codex 2차#1·5차: 내려간 옛 토큰도 주인 기록은 남는다 — 그 토큰을 다른 id 가 받으면 격리, 이후 그 토큰은 누구에게도 안 들어간다', () => {
    const r = createMediaTokenRegistry()
    learn(r, A, 'T1'); learn(r, A, 'T2', { force: true })
    expect(learn(r, B, 'T1')).toBe('conflict')
    expect(r.map).toEqual({ T2: A })
    expect(learn(r, B, 'T1')).toBe('ambiguous')
    expect(learn(r, A, 'T1', { force: true })).toBe('ambiguous')
    expect(r.map).toEqual({})   // A 도 강제로 다시 물었고 답이 격리 토큰 → A 는 토큰으로 안 읽힌다
  })

  it('충돌: 지금 쓰이는 토큰을 다른 id 가 받으면 그 토큰을 판독 지도에서 빼고(epoch +1) 두 id 다 그 토큰으로 안 읽힌다', () => {
    const r = createMediaTokenRegistry()
    learn(r, A, 'T1')
    const e = r.epoch()
    expect(learn(r, B, 'T1')).toBe('conflict')
    expect(r.map).toEqual({})
    expect(r.knows(A)).toBe(false)
    expect(r.epoch()).toBeGreaterThan(e)
  })

  it('Codex 2차#2: guarded(read) 는 그 사이 판독 지도에서 빠진 게 있으면 null · 더하기는 epoch 를 안 올린다 · read 가 던지면 null', async () => {
    const r = createMediaTokenRegistry()
    learn(r, A, 'T1')
    expect(await r.guarded(async () => 'state')).toBe('state')
    expect(await r.guarded(async () => { learn(r, B, 'T1'); return 'state' })).toBeNull()
    const e = r.epoch()
    learn(r, B, 'T3')
    expect(r.epoch()).toBe(e)
    expect(await r.guarded(async () => { throw new Error('exec failed') })).toBeNull()
  })

  it('Codex 3차#1: sharedMediaTokenRegistry 는 모듈 하나 — 이미지·영상 핸들러가 같은 주인 기록을 본다 · 시험용 리셋은 새 지도', () => {
    _resetSharedMediaTokensForTests()
    const a = sharedMediaTokenRegistry()
    expect(sharedMediaTokenRegistry()).toBe(a)
    learn(a, A, 'T1')
    expect(learn(sharedMediaTokenRegistry(), B, 'T1')).toBe('conflict')
    _resetSharedMediaTokensForTests()
    expect(sharedMediaTokenRegistry()).not.toBe(a)
    expect(sharedMediaTokenRegistry().map).toEqual({})
  })
})
