import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMonitor } from '../../src/hooks/useMonitor'

const render = (mode, activeTab) =>
  renderHook(({ m, a }) => useMonitor({ mode: m, activeTab: a }), { initialProps: { m: mode, a: activeTab } })

describe('useMonitor', () => {
  it('API + non-audio → inline', () => {
    const { result } = render('api', 'text')
    expect(result.current.monitorMode).toBe('inline')
  })

  it('audio tab → null', () => {
    const { result } = render('api', 'audio')
    expect(result.current.monitorMode).toBe(null)
  })

  it('Flow hidden by default; playback auto-opens it (→ inline)', () => {
    const { result } = render('flow', 'text')
    expect(result.current.monitorMode).toBe(null)
    act(() => result.current.setMonitorPlaying(true))
    expect(result.current.monitorOverlayOpen).toBe(true)
    expect(result.current.monitorMode).toBe('inline')
  })

  it('toggleMonitorFullscreen flips fullscreen', () => {
    const { result } = render('api', 'text')
    expect(result.current.monitorFullscreen).toBe(false)
    act(() => result.current.toggleMonitorFullscreen())
    expect(result.current.monitorFullscreen).toBe(true)
  })

  it('fullscreen auto-resets when the monitor becomes not visible (tab → audio)', () => {
    const { result, rerender } = render('api', 'text')
    act(() => result.current.toggleMonitorFullscreen())
    expect(result.current.monitorFullscreen).toBe(true)
    rerender({ m: 'api', a: 'audio' })
    expect(result.current.monitorFullscreen).toBe(false)
  })

  it('mode change resets overlay open (Flow stays hidden by default)', () => {
    const { result, rerender } = render('api', 'text')
    act(() => result.current.setMonitorPlaying(true))
    expect(result.current.monitorOverlayOpen).toBe(true)
    rerender({ m: 'flow', a: 'text' })
    expect(result.current.monitorOverlayOpen).toBe(false)
    expect(result.current.monitorMode).toBe(null)
  })
})
