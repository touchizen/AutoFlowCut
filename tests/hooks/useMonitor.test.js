import { describe, it, expect, beforeEach } from 'vitest'
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

describe('useMonitor — 프리뷰 볼륨/뮤트 (마스터)', () => {
  beforeEach(() => {
    localStorage.removeItem('autoflowcut_monitorVolume')
    localStorage.removeItem('autoflowcut_monitorMuted')
  })

  it('기본값: 볼륨 1.0, 뮤트 false', () => {
    const { result } = render('api', 'text')
    expect(result.current.monitorVolume).toBe(1)
    expect(result.current.monitorMuted).toBe(false)
  })

  it('setMonitorVolume 은 [0,1] 로 clamp 하고 localStorage 에 영속', () => {
    const { result } = render('api', 'text')
    act(() => result.current.setMonitorVolume(0.5))
    expect(result.current.monitorVolume).toBe(0.5)
    expect(localStorage.getItem('autoflowcut_monitorVolume')).toBe('0.5')
    act(() => result.current.setMonitorVolume(1.5))
    expect(result.current.monitorVolume).toBe(1)
    act(() => result.current.setMonitorVolume(-0.3))
    expect(result.current.monitorVolume).toBe(0)
  })

  it('볼륨을 0 으로 내리면 뮤트, 0 초과로 올리면 언뮤트 (슬라이더 0↔뮤트 연동)', () => {
    const { result } = render('api', 'text')
    act(() => result.current.setMonitorVolume(0))
    expect(result.current.monitorMuted).toBe(true)
    act(() => result.current.setMonitorVolume(0.4))
    expect(result.current.monitorMuted).toBe(false)
  })

  it('toggleMonitorMuted 는 뮤트를 뒤집고 영속', () => {
    const { result } = render('api', 'text')
    act(() => result.current.toggleMonitorMuted())
    expect(result.current.monitorMuted).toBe(true)
    expect(localStorage.getItem('autoflowcut_monitorMuted')).toBe('1')
    act(() => result.current.toggleMonitorMuted())
    expect(result.current.monitorMuted).toBe(false)
    expect(localStorage.getItem('autoflowcut_monitorMuted')).toBe('0')
  })

  it('볼륨>0 에서 뮤트 토글은 볼륨을 보존 (언뮤트 시 원래 볼륨)', () => {
    const { result } = render('api', 'text')
    act(() => result.current.setMonitorVolume(0.8))
    act(() => result.current.toggleMonitorMuted())
    expect(result.current.monitorMuted).toBe(true)
    expect(result.current.monitorVolume).toBe(0.8)
    act(() => result.current.toggleMonitorMuted())
    expect(result.current.monitorMuted).toBe(false)
    expect(result.current.monitorVolume).toBe(0.8)
  })

  it('setMonitorVolume 는 비정상 입력(NaN/문자열)을 무시 — NaN 영속/전파 방지', () => {
    const { result } = render('api', 'text')
    act(() => result.current.setMonitorVolume(0.5))
    act(() => result.current.setMonitorVolume('abc'))
    expect(result.current.monitorVolume).toBe(0.5)
    act(() => result.current.setMonitorVolume(NaN))
    expect(result.current.monitorVolume).toBe(0.5)
    expect(localStorage.getItem('autoflowcut_monitorVolume')).toBe('0.5')
  })

  it('볼륨 0(무음)에서 언뮤트하면 볼륨을 복원(1) — "언뮤트인데 무음" 방지', () => {
    const { result } = render('api', 'text')
    act(() => result.current.setMonitorVolume(0)) // volume 0 → muted true
    expect(result.current.monitorMuted).toBe(true)
    act(() => result.current.toggleMonitorMuted()) // 언뮤트
    expect(result.current.monitorMuted).toBe(false)
    expect(result.current.monitorVolume).toBe(1)
  })

  it('초기 마운트 시 localStorage 값을 읽어온다', () => {
    localStorage.setItem('autoflowcut_monitorVolume', '0.25')
    localStorage.setItem('autoflowcut_monitorMuted', '1')
    const { result } = render('api', 'text')
    expect(result.current.monitorVolume).toBe(0.25)
    expect(result.current.monitorMuted).toBe(true)
  })

  it('볼륨/뮤트 변경 시 window CustomEvent(monitor-volume)로 브로드캐스트 (AudioTimeline 동기화)', () => {
    const { result } = render('api', 'text')
    const events = []
    const handler = (e) => events.push(e.detail)
    window.addEventListener('monitor-volume', handler)
    act(() => result.current.setMonitorVolume(0.6))
    act(() => result.current.toggleMonitorMuted())
    window.removeEventListener('monitor-volume', handler)
    // 마지막 브로드캐스트가 최신 상태를 담아야 함
    const last = events[events.length - 1]
    expect(last).toEqual({ volume: 0.6, muted: true })
  })
})
