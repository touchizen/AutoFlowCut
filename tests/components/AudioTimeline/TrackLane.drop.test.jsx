/**
 * TrackLane drag-and-drop tests
 *
 * - narration/sfx 라인만 mp3 드롭 accept
 * - image/subtitle/voice 라인은 preventDefault 안 함 → 패널 레벨로 bubbling
 * - 드롭 x좌표 → timecodeMs 계산 (lane 내부 좌표 / pxPerMs)
 * - dragOver 시 is-drop-target 클래스
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, createEvent } from '@testing-library/react'
import TrackLane from '../../../src/components/AudioTimeline/TrackLane'

// File 객체 생성 헬퍼
function makeFile(name) {
  return new File(['fake-content'], name, { type: 'audio/mpeg' })
}

// jsdom의 DragEvent init은 clientX/dataTransfer를 안 받음 → createEvent + 직접 할당
function fireDragEvent(el, type, { files = [], types = ['Files'], clientX = 0, clientY = 0 } = {}) {
  const event = createEvent[type](el, {})
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, types, dropEffect: 'none', setData: vi.fn() },
    configurable: true,
  })
  Object.defineProperty(event, 'clientX', { value: clientX, configurable: true })
  Object.defineProperty(event, 'clientY', { value: clientY, configurable: true })
  return fireEvent(el, event)
}

describe('TrackLane drag-and-drop', () => {
  const narrationTrack = { id: 'narration', role: 'narration', acceptsDrop: 'audio', variant: 'audio', clips: [] }
  const sfxTrack = { id: 'sfx', role: 'sfx', acceptsDrop: 'audio', variant: 'audio', clips: [] }
  const imageTrack = { id: 'image', role: 'image', variant: 'block', clips: [] }

  it('narration 트랙 + mp3 드롭 → onTrackDrop 호출 (trackRole=narration)', () => {
    const onTrackDrop = vi.fn()
    const { container } = render(
      <TrackLane
        track={narrationTrack}
        width={800}
        height={64}
        pxPerMs={0.04}
        onTrackDrop={onTrackDrop}
        onTrackDragOver={vi.fn()}
      />
    )
    const lane = container.querySelector('.atl-lane')
    expect(lane).toBeInTheDocument()
    expect(lane.getAttribute('data-accepts-drop')).toBe('audio')

    // bounding rect mock — getBoundingClientRect가 0,0,0,0이라 left=100, width=800으로 설정
    lane.getBoundingClientRect = () => ({ left: 100, top: 0, right: 900, bottom: 64, width: 800, height: 64 })

    const mp3 = makeFile('voice.mp3')
    fireDragEvent(lane, 'drop', { files: [mp3], clientX: 100, clientY: 30 })

    expect(onTrackDrop).toHaveBeenCalledTimes(1)
    expect(onTrackDrop.mock.calls[0][0].trackRole).toBe('narration')
    expect(onTrackDrop.mock.calls[0][0].files).toEqual([mp3])
    expect(onTrackDrop.mock.calls[0][0].timecodeMs).toBe(0) // clientX == rect.left → xInLane=0
  })

  it('sfx 트랙 + x좌표 → timecodeMs 계산 (x=200px, pxPerMs=0.04 → 5000ms)', () => {
    const onTrackDrop = vi.fn()
    const { container } = render(
      <TrackLane
        track={sfxTrack}
        width={800}
        height={64}
        pxPerMs={0.04}
        onTrackDrop={onTrackDrop}
        onTrackDragOver={vi.fn()}
      />
    )
    const lane = container.querySelector('.atl-lane')
    lane.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 64, width: 800, height: 64 })

    const mp3 = makeFile('boom.mp3')
    fireDragEvent(lane, 'drop', { files: [mp3], clientX: 200, clientY: 30 })

    expect(onTrackDrop).toHaveBeenCalledTimes(1)
    expect(onTrackDrop.mock.calls[0][0].trackRole).toBe('sfx')
    expect(onTrackDrop.mock.calls[0][0].timecodeMs).toBe(5000)
  })

  it('image 트랙 + mp3 드롭 → onTrackDrop 호출 안 됨 (acceptsDrop 없음)', () => {
    const onTrackDrop = vi.fn()
    const { container } = render(
      <TrackLane
        track={imageTrack}
        width={800}
        height={64}
        pxPerMs={0.04}
        onTrackDrop={onTrackDrop}
        onTrackDragOver={vi.fn()}
      />
    )
    const lane = container.querySelector('.atl-lane')
    expect(lane.getAttribute('data-accepts-drop')).toBeNull()

    const mp3 = makeFile('voice.mp3')
    fireDragEvent(lane, 'drop', { files: [mp3], clientX: 100 })

    expect(onTrackDrop).not.toHaveBeenCalled()
  })

  it('dragOver 시 onTrackDragOver 호출 + dragOverTrackId 일치하면 is-drop-target 클래스', () => {
    const onTrackDragOver = vi.fn()
    const { container, rerender } = render(
      <TrackLane
        track={narrationTrack}
        width={800}
        pxPerMs={0.04}
        onTrackDrop={vi.fn()}
        onTrackDragOver={onTrackDragOver}
        dragOverTrackId={null}
      />
    )
    const lane = container.querySelector('.atl-lane')
    expect(lane.className).not.toMatch(/is-drop-target/)

    fireDragEvent(lane, 'dragOver')
    expect(onTrackDragOver).toHaveBeenCalledWith('narration')

    // 부모가 state 갱신 → dragOverTrackId가 'narration'이 되었다고 가정
    rerender(
      <TrackLane
        track={narrationTrack}
        width={800}
        pxPerMs={0.04}
        onTrackDrop={vi.fn()}
        onTrackDragOver={onTrackDragOver}
        dragOverTrackId={'narration'}
      />
    )
    const laneAfter = container.querySelector('.atl-lane')
    expect(laneAfter.className).toMatch(/is-drop-target/)
  })

  it('mp3 외 파일 (e.g., srt) 드롭 → onTrackDrop 호출 안 됨', () => {
    const onTrackDrop = vi.fn()
    const { container } = render(
      <TrackLane
        track={sfxTrack}
        width={800}
        pxPerMs={0.04}
        onTrackDrop={onTrackDrop}
        onTrackDragOver={vi.fn()}
      />
    )
    const lane = container.querySelector('.atl-lane')
    lane.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 64, width: 800, height: 64 })

    const srt = new File(['1\n00:00:00\nhi'], 'sub.srt', { type: 'text/plain' })
    fireDragEvent(lane, 'drop', { files: [srt], clientX: 100 })

    expect(onTrackDrop).not.toHaveBeenCalled()
  })
})
