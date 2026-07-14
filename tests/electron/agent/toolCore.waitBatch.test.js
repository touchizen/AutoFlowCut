// @vitest-environment node
//
// M1 slice 13 — Tool Core `wait_batch` (§2.3).
//
//   wait_batch {type:'scene'|'ref'} → { status, done, total, error }
//   status ∈ 'complete' | 'timeout' | 'cancelled-by-user' | 'error'
//
// 🔴 **timeout 은 값이지 예외가 아니다.** 기다리다 창(window W)이 만료된 건 에이전트가 **행동할 수 있는
//    정상 결과**다 (더 기다릴지, 중간 결과로 갈지). 반면 `toolBridge.invoke` 의 reject 는
//    **인프라 장애**다 (창이 죽었다/bridge 가 닫혔다/응답이 malformed). 둘을 섞으면
//    **renderer 장애를 정상 만료로 위장**하게 되고, 에이전트는 죽은 앱을 계속 기다린다.
//
// 🔴 **W 를 하드코딩하지 않는다** — 스펙이 측정 전 확정을 금지한다. 주입한다.
import { describe, it, expect, vi } from 'vitest'
import { createToolCore } from '../../../electron/agent/toolCore.js'

/** poll 마다 미리 정한 스냅샷을 돌려주는 fake bridge. */
function fakeBridge(snapshots) {
  const calls = []
  return {
    calls,
    invoke: vi.fn(async (name, args) => {
      calls.push({ name, args })
      const next = snapshots.shift()
      if (next instanceof Error) throw next
      return next
    }),
  }
}

const snap = (status, done, total, error = 0) => ({ type: 'scene', status, done, total, error })

/** 가짜 시계: sleep 이 시간을 앞으로 민다 (실제로 기다리지 않는다). */
function fakeClock() {
  let t = 0
  return { now: () => t, sleep: async (ms) => { t += ms } }
}

const core = (bridge, clock, opts = {}) => createToolCore({
  toolBridge: bridge,
  now: clock.now,
  sleep: clock.sleep,
  waitWindowMs: opts.waitWindowMs ?? 60_000,
  pollIntervalMs: opts.pollIntervalMs ?? 5_000,
})

describe('toolCore wait_batch (slice 13)', () => {
  it('running → done 이면 complete 를 반환한다 (요약 문자열이 아니라 JSON)', async () => {
    const bridge = fakeBridge([snap('running', 1, 3), snap('running', 2, 3), snap('complete', 3, 3)])
    const r = await core(bridge, fakeClock()).call('wait_batch', { type: 'scene' })

    expect(r).toEqual({ status: 'complete', done: 3, total: 3, error: 0 })
    expect(bridge.invoke).toHaveBeenCalledTimes(3)
    expect(bridge.calls[0]).toEqual({ name: 'batch.status', args: { type: 'scene' } })
  })

  it('🔴 W 가 만료되면 **값으로** `{status:"timeout"}` 을 돌려준다 (throw 하지 않는다)', async () => {
    // 계속 running → 창이 만료돼야 한다.
    const bridge = fakeBridge(Array.from({ length: 100 }, () => snap('running', 1, 3)))
    const r = await core(bridge, fakeClock(), { waitWindowMs: 20_000, pollIntervalMs: 5_000 })
      .call('wait_batch', { type: 'scene' })

    // 마지막으로 본 카운트를 보존한다 — 에이전트가 "얼마나 됐나" 를 알아야 다음 수를 정한다.
    expect(r).toEqual({ status: 'timeout', done: 1, total: 3, error: 0 })
  })

  it('사용자가 멈추면 cancelled-by-user (부분 카운트 보존)', async () => {
    const bridge = fakeBridge([snap('running', 1, 3), snap('cancelled-by-user', 1, 3)])
    const r = await core(bridge, fakeClock()).call('wait_batch', { type: 'scene' })

    expect(r).toEqual({ status: 'cancelled-by-user', done: 1, total: 3, error: 0 })
  })

  it('🔴 auth 중단(error)은 complete 로 위장하지 않는다 — 안 그러면 죽은 인증으로 재시도 루프를 돈다', async () => {
    const bridge = fakeBridge([snap('error', 1, 3, 1)])
    const r = await core(bridge, fakeClock()).call('wait_batch', { type: 'scene' })

    expect(r).toEqual({ status: 'error', done: 1, total: 3, error: 1 })
  })

  it('🔴 bridge 가 reject 하면(창 파괴/bridge closed) **던진다** — timeout 으로 위장하지 않는다', async () => {
    const bridge = fakeBridge([snap('running', 1, 3), new Error('tool bridge window destroyed')])

    await expect(core(bridge, fakeClock()).call('wait_batch', { type: 'scene' }))
      .rejects.toThrow(/window destroyed/)
    // 배치 상태를 **모르는** 것이다. 마지막 카운트로 timeout 을 지어내면 에이전트가 죽은 앱을 계속 기다린다.
  })

  it('🔴 결과에 내부 필드(`type`)가 새지 않는다', async () => {
    const bridge = fakeBridge([snap('complete', 2, 2)])
    const r = await core(bridge, fakeClock()).call('wait_batch', { type: 'scene' })

    expect(Object.keys(r).sort()).toEqual(['done', 'error', 'status', 'total'])
  })

  it('🔴 모르는 type 은 bridge 를 부르지도 않고 거부한다', async () => {
    const bridge = fakeBridge([])
    await expect(core(bridge, fakeClock()).call('wait_batch', { type: 'video' }))
      .rejects.toThrow(/unknown batch type/i)
    expect(bridge.invoke).not.toHaveBeenCalled()
  })
})
