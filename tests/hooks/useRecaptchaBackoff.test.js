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
    const { result } = renderHook(() => useRecaptchaBackoff(t))

    act(() => { result.current.reset() })

    expect(result.current.modalState).toBeNull()
    expect(result.current._debug.incidentCount()).toBe(0)
    expect(result.current._debug.isHandling()).toBe(false)
  })
})

// ─── 2. Single block: auto mode ─────────────────────────────────────────────
describe('registerBlock() — auto mode (tier 1)', () => {
  it('modal becomes {mode:auto, waitMs:300000} immediately, resolves after 5 min', async () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t))

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
    const { result } = renderHook(() => useRecaptchaBackoff(t))

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
    const { result } = renderHook(() => useRecaptchaBackoff(t))

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

    // Tier 4: manual
    act(() => { p = result.current.registerBlock() })
    const r4 = await p
    expect(r4.mode).toBe('manual')
    expect(r4.waitedMs).toBe(0)
    expect(r4.resumed).toBe(false)
    expect(result.current._debug.incidentCount()).toBe(4)
  })
})

// ─── 5. cancelWait shortens auto-mode wait ───────────────────────────────────
describe('cancelWait()', () => {
  it('ends an in-progress wait early; waitedMs reflects only elapsed time', async () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t))

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
    const { result } = renderHook(() => useRecaptchaBackoff(t))

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
    const { result } = renderHook(() => useRecaptchaBackoff(t))

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
    const { result } = renderHook(() => useRecaptchaBackoff(t))

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
    const { result } = renderHook(() => useRecaptchaBackoff(t, { notifyOS }))

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
    const { result } = renderHook(() => useRecaptchaBackoff(t, { notifyOS }))

    // force 4 incidents to reach manual mode
    for (let i = 0; i < 3; i++) {
      let p
      act(() => { p = result.current.registerBlock() })
      if (i === 0) await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
      else if (i === 1) await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
      else await act(async () => { await vi.advanceTimersByTimeAsync(1_800_000) })
      await p
    }
    notifyOS.mockClear()

    // 4th block → manual
    let p
    act(() => { p = result.current.registerBlock() })
    const ret = await p
    expect(ret.mode).toBe('manual')
    expect(notifyOS).toHaveBeenCalledTimes(1)
    const call = notifyOS.mock.calls[0][0]
    expect(call.title).toBe('AutoFlowCut')
    expect(call.body).toBe('recaptcha.notifyManual')
  })
})

// ─── 10. No notifyOS injected = no error ─────────────────────────────────────
describe('default usage (no opts)', () => {
  it('does not throw when notifyOS is not provided', async () => {
    const { result } = renderHook(() => useRecaptchaBackoff(t))

    let p
    expect(() => {
      act(() => { p = result.current.registerBlock() })
    }).not.toThrow()

    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    await expect(p).resolves.toMatchObject({ mode: 'auto' })
  })
})
