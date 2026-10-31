// @vitest-environment node
//
// 2026-10-31 — asb 토큰 지도(flow-media-tokens.js). Flow 가 칩·애셋 항목·미리보기 src 에서 id 를 빼(https://flow.google.com/asb/<토큰>=…)
//   칩 id 는 드라이버가 우리가 붙인 칩에서 배운 {토큰: mediaId} 지도로만 읽힌다. 돈 안전 규칙:
//   주인 기록(토큰 → 처음 받은 id)은 영구 — 한 토큰을 두 id 가 받으면(내려간 옛 토큰이어도) 영구 격리 · 판독 지도는 id 마다 마지막 토큰 하나 ·
//   판독 지도에서 빠질 때마다 epoch +1 → 그동안 진행된 판독은 버린다.
import { describe, it, expect } from 'vitest'
import { createMediaTokenRegistry, sharedMediaTokenRegistry, _resetSharedMediaTokensForTests } from '../../electron/flow-media-tokens.js'

const A = '00000001-0000-4000-8000-000000000000'
const B = '00000002-0000-4000-8000-000000000000'

describe('createMediaTokenRegistry', () => {
  it('adopt → 판독 지도·knows · 같은 id 의 새 토큰은 옛 토큰을 내린다(epoch +1) · 같은 토큰 다시는 그대로', () => {
    const r = createMediaTokenRegistry()
    expect(r.adopt(A, 'T1')).toBe('ok')
    expect(r.knows(A)).toBe(true)
    expect(r.map).toEqual({ T1: A })
    expect(r.adopt(A, 'T1')).toBe('ok')
    expect(r.epoch()).toBe(0)
    expect(r.adopt(A, 'T2')).toBe('ok')
    expect(r.map).toEqual({ T2: A })
    expect(r.epoch()).toBe(1)
  })

  it('충돌: 지금 쓰이는 토큰을 다른 id 가 받으면 격리 — 두 id 다 그 토큰으로 안 읽히고(epoch +1) 이후 누구에게도 안 들어간다', () => {
    const r = createMediaTokenRegistry()
    r.adopt(A, 'T1')
    const e = r.epoch()
    expect(r.adopt(B, 'T1')).toBe('conflict')
    expect(r.map).toEqual({})
    expect(r.knows(A)).toBe(false)
    expect(r.epoch()).toBeGreaterThan(e)
    expect(r.adopt(A, 'T1')).toBe('ambiguous')
    expect(r.map).toEqual({})
  })

  it('내려간 옛 토큰도 주인 기록은 남는다 — 그 토큰을 다른 id 가 받으면 격리(지금 토큰은 그대로)', () => {
    const r = createMediaTokenRegistry()
    r.adopt(A, 'T1'); r.adopt(A, 'T2')
    expect(r.adopt(B, 'T1')).toBe('conflict')
    expect(r.map).toEqual({ T2: A })
  })

  it('guarded(read) 는 그 사이 판독 지도에서 빠진 게 있으면 null · 더하기는 epoch 를 안 올린다 · read 가 던지면 null', async () => {
    const r = createMediaTokenRegistry()
    r.adopt(A, 'T1')
    expect(await r.guarded(async () => 'state')).toBe('state')
    expect(await r.guarded(async () => { r.adopt(B, 'T1'); return 'state' })).toBeNull()
    const e = r.epoch()
    r.adopt(B, 'T3')
    expect(r.epoch()).toBe(e)
    expect(await r.guarded(async () => { throw new Error('exec failed') })).toBeNull()
  })

  it('sharedMediaTokenRegistry 는 모듈 하나 — 이미지·영상 핸들러가 같은 주인 기록을 본다 · 시험용 리셋은 새 지도', () => {
    _resetSharedMediaTokensForTests()
    const a = sharedMediaTokenRegistry()
    expect(sharedMediaTokenRegistry()).toBe(a)
    a.adopt(A, 'T1')
    expect(sharedMediaTokenRegistry().adopt(B, 'T1')).toBe('conflict')
    _resetSharedMediaTokensForTests()
    expect(sharedMediaTokenRegistry()).not.toBe(a)
    expect(sharedMediaTokenRegistry().map).toEqual({})
  })
})
