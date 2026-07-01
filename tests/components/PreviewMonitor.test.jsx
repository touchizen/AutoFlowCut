/**
 * PreviewMonitor — 프리뷰 마스터 볼륨/뮤트 컨트롤 (뮤트 버튼 + 볼륨 슬라이더).
 *   inline·전체화면 공통(inner 공유)이라 헤더 도구모음에 렌더된다.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import PreviewMonitor from '../../src/components/PreviewMonitor'

const baseProps = {
  monitorMode: 'inline',
  monitorFullscreen: false,
  monitorWidth: null,
  monitorMs: 0,
  monitorPlaying: false,
  monitorHiddenRoles: new Set(),
  monitorVolume: 1,
  monitorMuted: false,
  setMonitorVolume: vi.fn(),
  toggleMonitorMuted: vi.fn(),
  toggleMonitorFullscreen: vi.fn(),
  onCloseOverlay: vi.fn(),
  startMonitorResize: vi.fn(),
  resetMonitorWidth: vi.fn(),
  mode: 'api',
  anyRunning: false,
  runningGenMode: null,
  bottomPanelView: 'timeline',
  scenes: [],
  videoScenes: [],
  framePairs: [],
  settings: { aspectRatio: '16:9' },
  audioPackage: null,
  srtTrack: [],
  onSelectVideo: vi.fn(),
  onSelectScene: vi.fn(),
  t: (k) => k,
}

const renderMon = (over = {}) => render(<PreviewMonitor {...baseProps} {...over} />)

describe('PreviewMonitor — 마스터 볼륨/뮤트 컨트롤', () => {
  it('inline(비전체화면): 상단 도구모음에 뮤트/볼륨 렌더', () => {
    const { container } = renderMon()
    expect(container.querySelector('.content-monitor-tools .content-monitor-mute')).toBeTruthy()
    expect(container.querySelector('.content-monitor-tools input.content-monitor-volume[type="range"]')).toBeTruthy()
    // inline 엔 트랜스포트 바가 없다.
    expect(container.querySelector('.content-monitor-transport')).toBeNull()
  })

  it('뮤트 아님: 🔊, 슬라이더 값 = 볼륨', () => {
    const { container } = renderMon({ monitorMuted: false, monitorVolume: 0.6 })
    expect(container.querySelector('.content-monitor-mute').textContent).toBe('🔊')
    expect(container.querySelector('input.content-monitor-volume').value).toBe('0.6')
  })

  it('뮤트: 🔇, 슬라이더 값 = 0', () => {
    const { container } = renderMon({ monitorMuted: true, monitorVolume: 0.6 })
    expect(container.querySelector('.content-monitor-mute').textContent).toBe('🔇')
    expect(container.querySelector('input.content-monitor-volume').value).toBe('0')
  })

  it('뮤트 버튼 클릭 → toggleMonitorMuted', () => {
    const toggleMonitorMuted = vi.fn()
    const { container } = renderMon({ toggleMonitorMuted })
    fireEvent.click(container.querySelector('.content-monitor-mute'))
    expect(toggleMonitorMuted).toHaveBeenCalledTimes(1)
  })

  it('슬라이더 조절 → setMonitorVolume(숫자)', () => {
    const setMonitorVolume = vi.fn()
    const { container } = renderMon({ setMonitorVolume })
    fireEvent.change(container.querySelector('input.content-monitor-volume'), { target: { value: '0.3' } })
    expect(setMonitorVolume).toHaveBeenCalledWith(0.3)
  })

  it('전체화면: 뮤트/볼륨이 트랜스포트 바(재생 버튼 옆)에 렌더 — 상단 아님', () => {
    // 전체화면은 body 로 portal → document 에서 조회
    renderMon({ monitorFullscreen: true })
    const transport = document.querySelector('.content-monitor-transport')
    expect(transport).toBeTruthy()
    expect(transport.querySelector('.content-monitor-mute')).toBeTruthy()
    expect(transport.querySelector('input.content-monitor-volume')).toBeTruthy()
    // 상단 도구모음엔 뮤트/볼륨이 없어야 한다(중복 방지).
    expect(document.querySelector('.content-monitor-tools .content-monitor-mute')).toBeNull()
  })
})
