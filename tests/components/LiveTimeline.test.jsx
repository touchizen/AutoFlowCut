import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// AudioTimeline 은 무겁고(useVideoPosters 등) — mock 으로 대체해 wiring 만 검증.
const captured = { props: null }
vi.mock('../../src/components/AudioTimeline/AudioTimeline', () => ({
  default: (props) => { captured.props = props; return <div data-testid="audio-timeline" /> },
}))

import LiveTimeline from '../../src/components/LiveTimeline'

describe('LiveTimeline', () => {
  it('scenes/srt/audioPackage 를 AudioTimeline 으로 전달 + compact 모드', () => {
    const scenes = [{ id: 's1' }]
    const srt = [{ startMs: 0, endMs: 1000 }]
    render(
      <LiveTimeline scenes={scenes} srtEntries={srt} audioPackage={null} onSceneSelect={vi.fn()} />
    )
    expect(captured.props.scenes).toEqual(scenes)
    expect(captured.props.srtEntries).toEqual(srt)
    // 하단 도크는 좁으므로 큰 프리뷰 패널을 접는다.
    expect(captured.props.compact).toBe(true)
  })

  it('클립 선택 시 sceneRef 로 onSceneSelect 호출', () => {
    const onSceneSelect = vi.fn()
    render(<LiveTimeline scenes={[]} srtEntries={[]} audioPackage={null} onSceneSelect={onSceneSelect} />)
    const scene = { id: 's9' }
    captured.props.onClipSelect({ id: 'img-s9', sceneRef: scene })
    expect(onSceneSelect).toHaveBeenCalledWith(scene)
  })

  it('sceneRef 없는 클립 선택은 무시(크래시 없음)', () => {
    const onSceneSelect = vi.fn()
    render(<LiveTimeline scenes={[]} srtEntries={[]} audioPackage={null} onSceneSelect={onSceneSelect} />)
    captured.props.onClipSelect({ id: 'sub-1' })
    expect(onSceneSelect).not.toHaveBeenCalled()
  })

  it('unmount 시 onPlayingChange(false) 로 상단 모니터 정지 통보 (재생 잔류 방지)', () => {
    const onPlayingChange = vi.fn()
    const { unmount } = render(
      <LiveTimeline scenes={[]} srtEntries={[]} audioPackage={null} onSceneSelect={vi.fn()} onPlayingChange={onPlayingChange} />
    )
    onPlayingChange.mockClear() // mount 시 발화 무시, unmount 만 검증
    unmount()
    expect(onPlayingChange).toHaveBeenCalledWith(false)
  })
})
