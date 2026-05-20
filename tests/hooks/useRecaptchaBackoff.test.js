import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecaptchaBackoff } from '../../src/hooks/useRecaptchaBackoff'

// Simple i18n stub: returns the key (with interpolation for min value)
const t = (key, vars) => {
  if (vars?.min !== undefined) return `wait ${vars.min} min`
  return key
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

// ─── 1. Reset state on init/reset ───────────────────────────────────────────
describe('reset()', () => {
  it('incident count and modal state are zero/null after reset()', () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t, { graceMs: 0 }))

    act(() => { result.current.reset() })

    expect(result.current.modalState).toBeNull()
    expect(result.current._debug.incidentCount()).toBe(0)
    expect(result.current._debug.isHandling()).toBe(false)
  })
})

// ─── 2. Single block: auto mode ─────────────────────────────────────────────
describe('registerBlock() — auto mode (tier 1)', () => {
  it('modal becomes {mode:auto, waitMs:300000} immediately, resolves after 5 min', async () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t, { graceMs: 0 }))

    let p
    act(() => { p = result.current.registerBlock() })

    // modal set synchronously (inside act) before await
    expect(result.current.modalState).toEqual({ mode: 'auto', waitMs: 300_000 })

    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })

    const ret = await p
    expect(ret.mode).toBe('auto')
    expect(ret.resumed).toBe(true)
    expect(ret.waitedMs).toBeGreaterThanOrEqual(299_000)
    expect(result.current.modalState).toBeNull()
    expect(result.current._debug.incidentCount()).toBe(1)
  })
})

// ─── 3. Concurrent calls absorbed ───────────────────────────────────────────
describe('registerBlock() — concurrent call absorption', () => {
  it('second call while first is in-progress resolves immediately as absorbed', async () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t, { graceMs: 0 }))

    let p1, p2
    act(() => { p1 = result.current.registerBlock() })

    // second call before first resolves
    let absorbed
    await act(async () => {
      p2 = result.current.registerBlock()
      absorbed = await p2
    })

    expect(absorbed.mode).toBe('absorbed')
    expect(absorbed.waitedMs).toBe(0)
    expect(result.current._debug.incidentCount()).toBe(1) // only 1 incident

    // clean up first promise
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    await p1
  })
})

// ─── 4. Escalation tiers ────────────────────────────────────────────────────
describe('registerBlock() — escalation tiers', () => {
  it('tier 1→2→3→4(manual) with correct waitMs at each level', async () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t, { graceMs: 0 }))

    // Tier 1: 300000 ms
    let p
    act(() => { p = result.current.registerBlock() })
    expect(result.current.modalState).toEqual({ mode: 'auto', waitMs: 300_000 })
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    const r1 = await p
    expect(r1.mode).toBe('auto')
    expect(result.current._debug.incidentCount()).toBe(1)

    // Tier 2: 600000 ms
    act(() => { p = result.current.registerBlock() })
    expect(result.current.modalState).toEqual({ mode: 'auto', waitMs: 600_000 })
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
    const r2 = await p
    expect(r2.mode).toBe('auto')
    expect(result.current._debug.incidentCount()).toBe(2)

    // Tier 3: 1800000 ms
    act(() => { p = result.current.registerBlock() })
    expect(result.current.modalState).toEqual({ mode: 'auto', waitMs: 1_800_000 })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_800_000) })
    const r3 = await p
    expect(r3.mode).toBe('auto')
    expect(result.current._debug.incidentCount()).toBe(3)

    // Tier 4: manual — now waits for cancelWait/stop; use cancelWait to resolve it
    act(() => { p = result.current.registerBlock() })
    expect(result.current.modalState).toEqual({ mode: 'manual', waitMs: 0 })
    // resolve via cancelWait (resumed=false because cancelledByUser=true)
    await act(async () => {
      result.current.cancelWait()
      await vi.advanceTimersByTimeAsync(600)
    })
    const r4 = await p
    expect(r4.mode).toBe('manual')
    expect(r4.resumed).toBe(false)
    expect(result.current._debug.incidentCount()).toBe(4)
  })
})

// ─── 5. cancelWait shortens auto-mode wait ───────────────────────────────────
describe('cancelWait()', () => {
  it('ends an in-progress wait early; waitedMs reflects only elapsed time', async () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t, { graceMs: 0 }))

    let p
    act(() => { p = result.current.registerBlock() })

    // advance 30 s into the 5-min wait
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })

    // cancel the wait
    act(() => { result.current.cancelWait() })

    // give the loop one more tick to detect cancelRef
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })

    const ret = await p
    expect(ret.mode).toBe('auto')
    expect(ret.waitedMs).toBeLessThan(35_000)
    expect(result.current.modalState).toBeNull()
  })
})

// ─── 6. recordSuccess resets incident counter at threshold ───────────────────
describe('recordSuccess() — resets at threshold', () => {
  it('25 consecutive successes after 1 block resets incident to 0', async () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t, { graceMs: 0 }))

    // one block (tier 1)
    let p
    act(() => { p = result.current.registerBlock() })
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    await p
    expect(result.current._debug.incidentCount()).toBe(1)

    // 25 consecutive successes
    act(() => {
      for (let i = 0; i < 25; i++) result.current.recordSuccess()
    })
    expect(result.current._debug.incidentCount()).toBe(0)

    // next block → tier 1 again
    act(() => { p = result.current.registerBlock() })
    expect(result.current.modalState).toEqual({ mode: 'auto', waitMs: 300_000 })
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    const ret = await p
    expect(ret.mode).toBe('auto')
    expect(result.current._debug.incidentCount()).toBe(1)
  })
})

// ─── 7. recordSuccess below threshold doesn't reset ──────────────────────────
describe('recordSuccess() — below threshold', () => {
  it('24 successes after 1 block do not reset; next block becomes tier 2', async () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t, { graceMs: 0 }))

    let p
    act(() => { p = result.current.registerBlock() })
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    await p
    expect(result.current._debug.incidentCount()).toBe(1)

    act(() => {
      for (let i = 0; i < 24; i++) result.current.recordSuccess()
    })
    expect(result.current._debug.incidentCount()).toBe(1) // not reset

    // next block → tier 2 (incident becomes 2)
    act(() => { p = result.current.registerBlock() })
    expect(result.current.modalState).toEqual({ mode: 'auto', waitMs: 600_000 })
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
    await p
    expect(result.current._debug.incidentCount()).toBe(2)
  })
})

// ─── 8. recordFailure zeroes the streak ─────────────────────────────────────
describe('recordFailure()', () => {
  it('failure resets streak; 20 successes after failure not enough to reset incidents', async () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t, { graceMs: 0 }))

    // 1 block
    let p
    act(() => { p = result.current.registerBlock() })
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    await p

    // 10 successes
    act(() => {
      for (let i = 0; i < 10; i++) result.current.recordSuccess()
    })

    // failure resets streak
    act(() => { result.current.recordFailure() })

    // 20 more successes (only 20 consecutive after failure — below 25 threshold)
    act(() => {
      for (let i = 0; i < 20; i++) result.current.recordSuccess()
    })
    expect(result.current._debug.incidentCount()).toBe(1) // not reset

    // next block → tier 2
    act(() => { p = result.current.registerBlock() })
    expect(result.current.modalState).toEqual({ mode: 'auto', waitMs: 600_000 })
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
    await p
    expect(result.current._debug.incidentCount()).toBe(2)
  })
})

// ─── 9. notifyOS called with correct title/body ───────────────────────────────
describe('notifyOS injection', () => {
  it('auto mode: notifyOS called with correct title and min value in body', async () => {
    const notifyOS = vi.fn()
    const { result } = renderHook(() => useRecaptchaBackoff(t, { notifyOS, graceMs: 0 }))

    let p
    act(() => { p = result.current.registerBlock() })
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    await p

    expect(notifyOS).toHaveBeenCalledTimes(1)
    const call = notifyOS.mock.calls[0][0]
    expect(call.title).toBe('AutoFlowCut')
    expect(call.body).toContain('5') // 300000ms = 5 min
  })

  it('manual mode: notifyOS called with manual message key', async () => {
    const notifyOS = vi.fn()
    const { result } = renderHook(() => useRecaptchaBackoff(t, { notifyOS, graceMs: 0 }))

    // force 4 incidents to reach manual mode (first 3 auto tiers)
    for (let i = 0; i < 3; i++) {
      let p
      act(() => { p = result.current.registerBlock() })
      if (i === 0) await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
      else if (i === 1) await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
      else await act(async () => { await vi.advanceTimersByTimeAsync(1_800_000) })
      await p
    }
    notifyOS.mockClear()

    // 4th block → manual; resolve with cancelWait
    let p
    act(() => { p = result.current.registerBlock() })
    expect(notifyOS).toHaveBeenCalledTimes(1)
    const call = notifyOS.mock.calls[0][0]
    expect(call.title).toBe('AutoFlowCut')
    expect(call.body).toBe('recaptcha.notifyManual')

    // clean up
    await act(async () => {
      result.current.cancelWait()
      await vi.advanceTimersByTimeAsync(600)
    })
    await p
  })
})

// ─── 10. No notifyOS injected = no error ─────────────────────────────────────
describe('default usage (no opts)', () => {
  it('does not throw when notifyOS is not provided', async () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t, { graceMs: 0 }))

    let p
    expect(() => {
      act(() => { p = result.current.registerBlock() })
    }).not.toThrow()

    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    await expect(p).resolves.toMatchObject({ mode: 'auto' })
  })
})

// ─── 11. Stop signal ends wait early (P1-A) ──────────────────────────────────
describe('getStopRequested integration (P1-A)', () => {
  it('stop signal ends auto-mode wait early with resumed:false', async () => {
    let stopFlag = false
    const { result } = renderHook(() =>
      useRecaptchaBackoff(t, { graceMs: 0, getStopRequested: () => stopFlag })
    )

    let p
    act(() => { p = result.current.registerBlock() })

    // advance 60 seconds into the 5-min wait
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    // set stop flag
    stopFlag = true

    // advance 600ms so the loop polls getStopRequested
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })

    const ret = await p
    expect(ret.resumed).toBe(false)
    expect(ret.mode).toBe('auto')
    expect(ret.waitedMs).toBeGreaterThanOrEqual(60_000)
    expect(ret.waitedMs).toBeLessThan(65_000)
  })
})

// ─── 12. Manual mode awaits cancelWait (P1-C) ────────────────────────────────
describe('manual mode — awaits cancelWait (P1-C)', () => {
  it('manual mode promise does not resolve immediately; resolves after cancelWait', async () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t, { graceMs: 0 }))

    // reach manual (incident=4): run 3 auto tiers first
    for (let i = 0; i < 3; i++) {
      let p
      act(() => { p = result.current.registerBlock() })
      if (i === 0) await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
      else if (i === 1) await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
      else await act(async () => { await vi.advanceTimersByTimeAsync(1_800_000) })
      await p
    }

    let resolved = false
    let ret
    let p
    act(() => {
      p = result.current.registerBlock()
      p.then(r => { resolved = true; ret = r })
    })

    // After 10 seconds — must NOT have resolved
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(resolved).toBe(false)

    // Now cancelWait
    await act(async () => {
      result.current.cancelWait()
      await vi.advanceTimersByTimeAsync(600)
    })
    await p

    expect(resolved).toBe(true)
    expect(ret.mode).toBe('manual')
    expect(ret.resumed).toBe(false)
  })
})

// ─── 13. Manual mode awaits stop (P1-C) ──────────────────────────────────────
describe('manual mode — awaits stop signal (P1-C)', () => {
  it('manual mode promise resolves with resumed:false when stop signal fires', async () => {
    let stopFlag = false
    const { result } = renderHook(() =>
      useRecaptchaBackoff(t, { graceMs: 0, getStopRequested: () => stopFlag })
    )

    // reach manual
    for (let i = 0; i < 3; i++) {
      let p
      act(() => { p = result.current.registerBlock() })
      if (i === 0) await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
      else if (i === 1) await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
      else await act(async () => { await vi.advanceTimersByTimeAsync(1_800_000) })
      await p
    }

    let p
    act(() => { p = result.current.registerBlock() })

    // still pending after 5 seconds
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    // fire stop
    stopFlag = true
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })

    const ret = await p
    expect(ret.mode).toBe('manual')
    expect(ret.resumed).toBe(false)
  })
})

// ─── 14. Grace period absorbs subsequent calls (P2-A) ────────────────────────
describe('grace period (P2-A)', () => {
  it('call within grace window is absorbed; call after grace starts new incident', async () => {
    const GRACE = 200
    const { result } = renderHook(() => useRecaptchaBackoff(t, { graceMs: GRACE }))

    // First registerBlock — auto tier 1
    let p1
    act(() => { p1 = result.current.registerBlock() })
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    const r1 = await p1
    expect(r1.mode).toBe('auto')
    expect(result.current._debug.incidentCount()).toBe(1)
    // handlingRef still true (grace window active)
    expect(result.current._debug.isHandling()).toBe(true)

    // Within grace window — second call absorbed
    let p2
    await act(async () => {
      p2 = result.current.registerBlock()
    })
    const r2 = await p2
    expect(r2.mode).toBe('absorbed')
    expect(result.current._debug.incidentCount()).toBe(1)

    // After grace expires
    await act(async () => { await vi.advanceTimersByTimeAsync(GRACE + 50) })
    expect(result.current._debug.isHandling()).toBe(false)

    // Now a new call → new incident
    let p3
    act(() => { p3 = result.current.registerBlock() })
    expect(result.current._debug.incidentCount()).toBe(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
    await p3
  })
})

// ─── 15. allowAbsorb=false bypasses grace window ────────────────────────────────
describe('allowAbsorb=false (submit-probe semantics)', () => {
  it('allowAbsorb=false bypasses grace window and starts a new incident', async () => {
    const notifyOS = vi.fn()
    const { result } = renderHook(() =>
      useRecaptchaBackoff(t, { notifyOS, graceMs: 5000 })
    )

    // First wave: tier 1 (5 min)
    let p1
    act(() => { p1 = result.current.registerBlock() })
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000) })
    const r1 = await p1
    expect(r1.mode).toBe('auto')
    expect(r1.waitedMs).toBeGreaterThanOrEqual(299000)

    // Grace window is now active (5s). handlingRef stays true.
    // allowAbsorb=true (default) — absorbs.
    let pAbsorbed
    act(() => { pAbsorbed = result.current.registerBlock() })
    const rAbsorbed = await pAbsorbed
    expect(rAbsorbed.mode).toBe('absorbed')
    expect(result.current._debug.incidentCount()).toBe(1)

    // allowAbsorb=false — must NOT absorb, must escalate to tier 2 (10 min).
    let p2
    act(() => { p2 = result.current.registerBlock({ allowAbsorb: false }) })
    // Incident count must have bumped to 2 synchronously.
    expect(result.current._debug.incidentCount()).toBe(2)
    // Run out tier 2 wait.
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000) })
    const r2 = await p2
    expect(r2.mode).toBe('auto')
    expect(r2.waitedMs).toBeGreaterThanOrEqual(599000)
  })
})

// ─── 16. cancelWait during grace releases immediately ─────────────────────────
describe('cancelWait during grace releases immediately', () => {
  it('cancelWait clears grace timer and allows new incident immediately', async () => {
    const GRACE = 5000
    const { result } = renderHook(() => useRecaptchaBackoff(t, { graceMs: GRACE }))

    // complete an auto block — enters grace
    let p1
    act(() => { p1 = result.current.registerBlock() })
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    await p1
    expect(result.current._debug.isHandling()).toBe(true) // grace active

    // cancelWait clears grace immediately
    act(() => { result.current.cancelWait() })
    expect(result.current._debug.isHandling()).toBe(false)

    // new registerBlock starts a fresh incident without waiting for grace to expire
    let p2
    act(() => { p2 = result.current.registerBlock() })
    expect(result.current._debug.incidentCount()).toBe(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
    await p2
  })
})
