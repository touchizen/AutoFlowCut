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

  it('이미지 클립 선택 시 sceneRef 로 onSceneSelect 호출', () => {
    const onSceneSelect = vi.fn()
    render(<LiveTimeline scenes={[]} srtEntries={[]} audioPackage={null} onSceneSelect={onSceneSelect} />)
    const scene = { id: 's9' }
    captured.props.onClipSelect({ id: 'img-s9', role: 'image', sceneRef: scene })
    expect(onSceneSelect).toHaveBeenCalledWith(scene)
  })

  it('sceneRef 없는 클립 선택은 무시(크래시 없음)', () => {
    const onSceneSelect = vi.fn()
    render(<LiveTimeline scenes={[]} srtEntries={[]} audioPackage={null} onSceneSelect={onSceneSelect} />)
    captured.props.onClipSelect({ id: 'sub-1' })
    expect(onSceneSelect).not.toHaveBeenCalled()
  })

  it('T2V 비디오 클립 선택 시 onVideoSelect 호출 (이미지 모달 아님, videoPath 는 정규화된 clip.videoPath)', () => {
    const onSceneSelect = vi.fn()
    const onVideoSelect = vi.fn()
    render(<LiveTimeline scenes={[]} srtEntries={[]} audioPackage={null} onSceneSelect={onSceneSelect} onVideoSelect={onVideoSelect} />)
    // legacy snake path 만 있는 씬 — scene.videoT2VPath(camel) 은 없지만 clip.videoPath 는 정규화돼 채워짐.
    const scene = { id: 'scene_3', prompt: 'a sunset', videoT2V: 'blob:t2v', video_t2v_path: '/videos/t2v.mp4' }
    captured.props.onClipSelect({ id: 'vid-t2v-scene_3', role: 'video-t2v', videoPath: '/videos/t2v.mp4', sceneRef: scene })
    expect(onVideoSelect).toHaveBeenCalledWith({
      id: 't2v_3',
      prompt: 'a sunset',
      video: 'blob:t2v',
      videoPath: '/videos/t2v.mp4', // scene.videoT2VPath(undefined) 가 아니라 clip.videoPath
      status: 'complete',
      sceneId: 'scene_3',
      source: 't2v',
    })
    expect(onSceneSelect).not.toHaveBeenCalled()
  })

  it('I2V 비디오 클립 선택 시 framePair.id 기반 id + clip.videoPath 로 onVideoSelect 호출', () => {
    const onSceneSelect = vi.fn()
    const onVideoSelect = vi.fn()
    // fp.id(=fp_7) 가 scene 번호(5)와 어긋나는 케이스 — ownerSceneId 로 매핑해야 함(P1).
    const framePairs = [{ id: 'fp_7', ownerSceneId: 'scene_5' }]
    render(<LiveTimeline scenes={[]} srtEntries={[]} audioPackage={null} framePairs={framePairs} onSceneSelect={onSceneSelect} onVideoSelect={onVideoSelect} />)
    const scene = { id: 'scene_5', prompt: 'rain', videoI2V: 'blob:i2v', video_i2v_path: '/videos/i2v.mp4' }
    captured.props.onClipSelect({ id: 'vid-i2v-scene_5', role: 'video-i2v', videoPath: '/videos/i2v.mp4', sceneRef: scene })
    expect(onVideoSelect).toHaveBeenCalledWith({
      id: 'i2v_7', // scene 번호 5 가 아니라 owning framePair 의 7
      prompt: 'rain',
      video: 'blob:i2v',
      videoPath: '/videos/i2v.mp4', // clip.videoPath (legacy snake 정규화)
      status: 'complete',
      sceneId: 'scene_5',
      source: 'i2v',
      fpId: 'fp_7',
    })
    expect(onSceneSelect).not.toHaveBeenCalled()
  })

  it('I2V 클립인데 owning framePair 없으면 scene 번호로 폴백', () => {
    const onVideoSelect = vi.fn()
    render(<LiveTimeline scenes={[]} srtEntries={[]} audioPackage={null} framePairs={[]} onSceneSelect={vi.fn()} onVideoSelect={onVideoSelect} />)
    const scene = { id: 'scene_9', prompt: 'x', videoI2V: 'blob:i2v', videoI2VPath: '/v/i.mp4' }
    captured.props.onClipSelect({ id: 'vid-i2v-scene_9', role: 'video-i2v', videoPath: '/v/i.mp4', sceneRef: scene })
    expect(onVideoSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'i2v_9', fpId: undefined, source: 'i2v' }))
  })

  it('생성 중인 비디오 클립(videoPath null)은 onSceneSelect 로 폴백', () => {
    const onSceneSelect = vi.fn()
    const onVideoSelect = vi.fn()
    render(<LiveTimeline scenes={[]} srtEntries={[]} audioPackage={null} onSceneSelect={onSceneSelect} onVideoSelect={onVideoSelect} />)
    const scene = { id: 'scene_2' }
    captured.props.onClipSelect({ id: 'vid-t2v-scene_2', role: 'video-t2v', videoPath: null, generating: true, sceneRef: scene })
    expect(onSceneSelect).toHaveBeenCalledWith(scene)
    expect(onVideoSelect).not.toHaveBeenCalled()
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

  it('unmount 시 onHiddenRolesChange(빈 Set) 로 모니터 숨김 해제 (잔류 방지)', () => {
    // View off 후 bottom panel 을 timeline 밖으로 바꾸면 LiveTimeline unmount → App 의
    // monitorHiddenRoles 가 남아 상단 모니터가 계속 숨김 상태가 되는 걸 막는다(리뷰 P2).
    const onHiddenRolesChange = vi.fn()
    const { unmount } = render(
      <LiveTimeline scenes={[]} srtEntries={[]} audioPackage={null} onSceneSelect={vi.fn()} onHiddenRolesChange={onHiddenRolesChange} />
    )
    onHiddenRolesChange.mockClear()
    unmount()
    expect(onHiddenRolesChange).toHaveBeenCalledTimes(1)
    const arg = onHiddenRolesChange.mock.calls[0][0]
    expect(arg instanceof Set).toBe(true)
    expect(arg.size).toBe(0)
  })
})
