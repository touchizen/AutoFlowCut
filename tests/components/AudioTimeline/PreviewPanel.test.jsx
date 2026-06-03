/**
 * PreviewPanel — hiddenRoles(트랙 View off)로 이미지/자막/비디오 렌더를 끄는지.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PreviewPanel from '../../../src/components/AudioTimeline/PreviewPanel'

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
})
