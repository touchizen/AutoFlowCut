/**
 * AudioPanel — 클립 클릭 → 상세 모달 분기 회귀 테스트
 *
 * 두 층으로 검증:
 *  1) Contract: AudioTimeline의 onClipSelect가 클립 타입별로 올바른 데이터(audioPath 유무) 전달
 *  2) Integration: 실제 AudioPanel을 렌더해 비오디오 클릭 시 모달이 진짜 안 열리는지 확인
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, fireEvent, waitFor, act } from '@testing-library/react'
import AudioTimeline from '../../src/components/AudioTimeline/AudioTimeline'
import AudioPanel from '../../src/components/AudioPanel'
import { I18nProvider } from '../../src/hooks/useI18n'

const render = (ui, options) => rtlRender(<I18nProvider>{ui}</I18nProvider>, options)

const audioPackage = {
  folderPath: '/audio',
  media: {
    video: { path: '/audio/narration.mp3', filename: 'narration.mp3', durationMs: 60000 },
  },
  voices: [
    {
      character: '소은',
      files: [
        { filename: 's_01.mp3', path: '/audio/소은/s_01.mp3', timecodeMs: 1000, durationMs: 2000 },
      ],
    },
  ],
  sfx: [],
}

const scenes = [
  { id: 'scene_1', imagePath: '/img/1.png', startTime: 0, endTime: 3, subtitle: 'first' },
]

const srtEntries = [
  { startMs: 0, endMs: 3000, text: 'sub one' },
]

beforeEach(() => {
  global.window.electronAPI = {
    readFileAbsolute: vi.fn().mockResolvedValue({ success: false }),
  }
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

// 클립을 클릭(짧은 pointerdown→pointerup)으로 시뮬레이션
function clickClip(el) {
  fireEvent.pointerDown(el, { button: 0, clientX: 100 })
  fireEvent(window, new PointerEvent('pointerup', { clientX: 100 }))
}

describe('onClipSelect contract — 클립 타입별 audioPath 유무', () => {
  it('이미지 클립 클릭 → onClipSelect는 audioPath 없는 clip 전달 (모달 띄우면 안 됨)', () => {
    const onClipSelect = vi.fn()
    const { container } = render(
      <AudioTimeline
        audioPackage={audioPackage}
        scenes={scenes}
        srtEntries={srtEntries}
        onClipSelect={onClipSelect}
      />
    )
    const imageClips = container.querySelectorAll('.atl-clip-block')
    expect(imageClips.length).toBeGreaterThan(0)
    clickClip(imageClips[0])
    expect(onClipSelect).toHaveBeenCalled()
    const clip = onClipSelect.mock.calls[0][0]
    expect(clip.audioPath).toBeFalsy()       // ★ 핵심
    expect(clip.imagePath).toBeTruthy()      // 이미지는 있음
  })

  it('자막 클립 클릭 → onClipSelect는 audioPath 없는 clip 전달', () => {
    const onClipSelect = vi.fn()
    const { container } = render(
      <AudioTimeline
        audioPackage={audioPackage}
        scenes={scenes}
        srtEntries={srtEntries}
        onClipSelect={onClipSelect}
      />
    )
    const textClips = container.querySelectorAll('.atl-clip-text')
    expect(textClips.length).toBeGreaterThan(0)
    clickClip(textClips[0])
    expect(onClipSelect).toHaveBeenCalled()
    const clip = onClipSelect.mock.calls[0][0]
    expect(clip.audioPath).toBeFalsy()
    expect(clip.label).toBeTruthy()
  })

  it('Audio 클립 클릭 → onClipSelect는 audioPath 있는 clip 전달', () => {
    const onClipSelect = vi.fn()
    const { container } = render(
      <AudioTimeline
        audioPackage={audioPackage}
        scenes={scenes}
        srtEntries={srtEntries}
        onClipSelect={onClipSelect}
      />
    )
    const audioClips = container.querySelectorAll('.atl-clip-audio')
    expect(audioClips.length).toBeGreaterThan(0)
    clickClip(audioClips[0])
    expect(onClipSelect).toHaveBeenCalled()
    const clip = onClipSelect.mock.calls[0][0]
    expect(clip.audioPath).toBeTruthy()      // ★ 핵심
  })
})

describe('AudioPanel integration — 실제 모달 DOM 동작', () => {
  const baseProps = {
    audioPackage,
    audioReviews: {},
    onSaveReview: vi.fn(),
    onBulkReview: vi.fn(),
    onRefresh: vi.fn(),
    onSaveTimecodeOverride: vi.fn(),
  }

  // Modal은 createPortal로 document.body에 렌더되므로 document.body로 쿼리
  const queryModal = () => document.body.querySelector('.audio-detail-modal')

  it('이미지 클립 클릭 후에도 audio-detail-modal이 DOM에 없음', async () => {
    const { container } = render(
      <AudioPanel {...baseProps} scenes={scenes} srtEntries={srtEntries} />
    )
    // 모달이 처음엔 없음
    expect(queryModal()).toBeNull()

    const imageClips = container.querySelectorAll('.atl-clip-block')
    expect(imageClips.length).toBeGreaterThan(0)
    clickClip(imageClips[0])

    await new Promise(r => setTimeout(r, 50))
    expect(queryModal()).toBeNull()
  })

  it('자막 클립 클릭 후에도 audio-detail-modal이 DOM에 없음', async () => {
    const { container } = render(
      <AudioPanel {...baseProps} scenes={scenes} srtEntries={srtEntries} />
    )
    const textClips = container.querySelectorAll('.atl-clip-text')
    expect(textClips.length).toBeGreaterThan(0)
    clickClip(textClips[0])

    await new Promise(r => setTimeout(r, 50))
    expect(queryModal()).toBeNull()
  })

  it('Audio 클립 클릭 시 audio-detail-modal이 DOM에 나타남', async () => {
    const { container } = render(
      <AudioPanel {...baseProps} scenes={scenes} srtEntries={srtEntries} />
    )
    const audioClips = container.querySelectorAll('.atl-clip-audio')
    expect(audioClips.length).toBeGreaterThan(0)
    await act(async () => {
      clickClip(audioClips[0])
      await new Promise(r => setTimeout(r, 50))
    })
    expect(queryModal()).toBeInTheDocument()
  })
})
