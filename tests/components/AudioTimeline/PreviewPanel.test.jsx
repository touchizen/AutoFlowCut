/**
 * PreviewPanel — hiddenRoles(트랙 View off)로 이미지/자막/비디오 렌더를 끄는지.
 */
import { describe, it, expect } from 'vitest'
import PreviewPanel from '../../../src/components/AudioTimeline/PreviewPanel'
import { renderWithExportSettings as render } from '../../utils/renderWithExportSettings'

const scenes = [{ id: 's1', imagePath: '/a.png', start_time: 0, end_time: 5 }]
const srtEntries = [{ startMs: 0, endMs: 5000, text: 'Hello' }]

const renderAt = (hiddenRoles) =>
  render(<PreviewPanel playheadMs={1000} scenes={scenes} srtEntries={srtEntries} hiddenRoles={hiddenRoles} />)

describe('PreviewPanel — hiddenRoles (View off)', () => {
  it('기본: 이미지 + 자막 렌더', () => {
    const { container } = renderAt()
    expect(container.querySelector('.atl-preview-img')).toBeInTheDocument()
    expect(container.querySelector('.atl-preview-subtitle')?.textContent).toBe('Hello')
  })

  it("hiddenRoles=subtitle → 자막 숨김 (이미지는 유지)", () => {
    const { container } = renderAt(new Set(['subtitle']))
    expect(container.querySelector('.atl-preview-subtitle')).toBeNull()
    expect(container.querySelector('.atl-preview-img')).toBeInTheDocument()
  })

  it("hiddenRoles=image → 이미지 숨김 (빈 placeholder)", () => {
    const { container } = renderAt(new Set(['image']))
    expect(container.querySelector('.atl-preview-img')).toBeNull()
    expect(container.querySelector('.atl-preview-empty')).toBeInTheDocument()
  })
})

describe('PreviewPanel — 마스터 볼륨/뮤트 (영상 오디오)', () => {
  const activeVideoScene = [{
    id: 's1', imagePath: '/a.png', start_time: 0, end_time: 10,
    videoI2VPath: '/v/i2v_1.mp4', videoI2VDuration: 3,
  }]
  // playhead 9000 → [7000,10000) 활성 비디오
  const renderVid = (props) =>
    render(<PreviewPanel playheadMs={9000} scenes={activeVideoScene} srtEntries={[]} {...props} />)

  it('기본(props 없음): 영상은 muted 유지 (기존 동작 보존, 이중음 방지)', () => {
    const { container } = renderVid()
    expect(container.querySelector('video.atl-preview-video').muted).toBe(true)
  })

  it('monitorMuted=false + monitorVolume=0.5 → 활성 영상 언뮤트 + 볼륨 반영', () => {
    const { container } = renderVid({ monitorMuted: false, monitorVolume: 0.5 })
    const v = container.querySelector('video.atl-preview-video')
    expect(v.muted).toBe(false)
    expect(v.volume).toBe(0.5)
  })

  it('monitorMuted=true → 영상 muted', () => {
    const { container } = renderVid({ monitorMuted: true, monitorVolume: 1 })
    expect(container.querySelector('video.atl-preview-video').muted).toBe(true)
  })

  it('재생 시작(play) 시점에 이미 muted 가 적용됨 — play-before-mute 순서 보장 (기본 muted)', () => {
    const origPlay = window.HTMLMediaElement.prototype.play
    const recorded = {}
    window.HTMLMediaElement.prototype.play = vi.fn(function () { recorded.muted = this.muted; return Promise.resolve() })
    try {
      render(<PreviewPanel playheadMs={9000} scenes={activeVideoScene} srtEntries={[]} isPlaying />)
      expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
      expect(recorded.muted).toBe(true) // 기본 monitorMuted=true — play 호출 순간 이미 muted
    } finally {
      window.HTMLMediaElement.prototype.play = origPlay
    }
  })

  it('prefetch(숨김) 영상은 항상 muted (이중음 방지)', () => {
    const { container } = render(
      <PreviewPanel playheadMs={0} scenes={[{ id: 's1', imagePath: '/a.png', start_time: 0, end_time: 1, videoI2VPath: '/v/i2v_1.mp4', videoI2VDuration: 1 }]} srtEntries={[]} monitorMuted={false} monitorVolume={1} />
    )
    const videos = container.querySelectorAll('video')
    const prefetch = videos[videos.length - 1]
    expect(prefetch.muted).toBe(true)
  })
})

describe('PreviewPanel — i2v/t2v 모니터 우선순위 (top-visible)', () => {
  const bothScene = [{
    id: 's1', imagePath: '/a.png', start_time: 0, end_time: 10,
    videoI2VPath: '/v/i2v_1.mp4', videoI2VDuration: 3,
    videoT2VPath: '/v/t2v_1.mp4', videoT2VDuration: 3,
  }]
  // playhead 9000 → 두 비디오 모두 [7000,10000) 활성 구간
  const renderMon = (hiddenRoles) =>
    render(<PreviewPanel playheadMs={9000} scenes={bothScene} srtEntries={[]} hiddenRoles={hiddenRoles} />)

  it('둘 다 있으면 기본은 i2v 재생 (맨 위 트랙)', () => {
    const { container } = renderMon()
    expect(container.querySelector('video.atl-preview-video').src).toContain('i2v_1')
  })

  it('video-i2v 숨기면 t2v 재생 (수동 토글로 override)', () => {
    const { container } = renderMon(new Set(['video-i2v']))
    expect(container.querySelector('video.atl-preview-video').src).toContain('t2v_1')
  })

  it('프리패치도 top-visible source — i2v 숨기면 다음 t2v 를 워밍(cold-read 방지, P3)', () => {
    // 곧(1000ms 후) 시작할 비디오 씬 — PREFETCH_LEAD_MS(1500) 안.
    const soon = [{
      id: 's1', imagePath: '/a.png', start_time: 0, end_time: 2,
      videoI2VPath: '/v/i2v_1.mp4', videoI2VDuration: 1,
      videoT2VPath: '/v/t2v_1.mp4', videoT2VDuration: 1,
    }]
    const { container } = render(
      <PreviewPanel playheadMs={0} scenes={soon} srtEntries={[]} hiddenRoles={new Set(['video-i2v'])} />
    )
    const videos = container.querySelectorAll('video')
    const prefetch = videos[videos.length - 1] // 마지막 = hidden prefetch <video>
    expect(prefetch.src).toContain('t2v_1') // i2v 아니라 t2v 워밍
  })

  it('videoI2VDisabled 면 i2v 구간 playhead 라도 i2v 영상은 모니터에 안 잡힘', () => {
    const scene = {
      id: 'scene_1', startTime: 0, endTime: 4, duration: 4, imagePath: '/i.png',
      videoI2VPath: '/i.mp4', videoI2VDuration: 4, videoI2VDisabled: true,
    }
    const { container } = render(<PreviewPanel playheadMs={1000} scenes={[scene]} srtEntries={[]} />)
    const vids = [...container.querySelectorAll('video')]
    expect(vids.every(v => !(v.getAttribute('src') || '').includes('i.mp4'))).toBe(true)
  })

  it('같은 씬 i2v·t2v 둘 다 보이고 t2v 가 먼저 시작 → t2v 진입도 프리패치 (P3)', () => {
    // 10s 씬, i2v 2s(→videoIn 8000), t2v 4s(→videoIn 6000, 먼저 시작).
    // 6-8s 는 모니터가 t2v 재생. 프리패치 배열이 i2v 만 남기면 t2v 6s 진입이 cold-read.
    const scene = [{
      id: 's1', imagePath: '/a.png', start_time: 0, end_time: 10,
      videoI2VPath: '/v/i2v_1.mp4', videoI2VDuration: 2,
      videoT2VPath: '/v/t2v_1.mp4', videoT2VDuration: 4,
    }]
    // playhead 5000 → 다음 top-visible 진입은 6000(t2v). 둘 다 보임.
    const { container } = render(<PreviewPanel playheadMs={5000} scenes={scene} srtEntries={[]} />)
    const videos = container.querySelectorAll('video')
    const prefetch = videos[videos.length - 1]
    expect(prefetch.src).toContain('t2v_1') // i2v(8000) 아니라 t2v(6000) 워밍
  })
})
