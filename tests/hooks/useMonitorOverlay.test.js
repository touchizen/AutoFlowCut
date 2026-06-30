import { describe, it, expect } from 'vitest'
import { renderHook, act as rtlAct } from '@testing-library/react'
import { useMonitorOverlay } from '../../src/hooks/useMonitorOverlay'

// Flow-mode monitor overlay open-state:
//  - starts closed,
//  - auto-opens when playback starts (isPlaying false→true),
//  - can be toggled manually (the '프리뷰' label button),
//  - stays open after playback stops (user closes it via the label).
describe('useMonitorOverlay', () => {
  it('starts closed', () => {
    const { result } = renderHook(({ p }) => useMonitorOverlay(p), { initialProps: { p: false } })
    expect(result.current.open).toBe(false)
  })

  it('auto-opens when playback starts', () => {
    const { result, rerender } = renderHook(({ p }) => useMonitorOverlay(p), { initialProps: { p: false } })
    expect(result.current.open).toBe(false)
    rerender({ p: true })
    expect(result.current.open).toBe(true)
  })

  it('manual setOpen toggles independently', () => {
    const { result } = renderHook(({ p }) => useMonitorOverlay(p), { initialProps: { p: false } })
    rtlAct(() => result.current.setOpen(true))
    expect(result.current.open).toBe(true)
    rtlAct(() => result.current.setOpen(false))
    expect(result.current.open).toBe(false)
  })

  it('stays open after playback stops (does not auto-close)', () => {
    const { result, rerender } = renderHook(({ p }) => useMonitorOverlay(p), { initialProps: { p: false } })
    rerender({ p: true })   // play → open
    expect(result.current.open).toBe(true)
    rerender({ p: false })  // stop → stays open
    expect(result.current.open).toBe(true)
  })

  it('a new playback re-opens after the user closed it', () => {
    const { result, rerender } = renderHook(({ p }) => useMonitorOverlay(p), { initialProps: { p: false } })
    rerender({ p: true })                       // play → open
    rtlAct(() => result.current.setOpen(false)) // user closes mid/after play
    expect(result.current.open).toBe(false)
    rerender({ p: false })                      // stop
    rerender({ p: true })                       // play again → re-open
    expect(result.current.open).toBe(true)
  })
})
