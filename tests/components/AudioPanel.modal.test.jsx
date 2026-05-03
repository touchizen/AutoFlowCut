/**
 * AudioPanel — 클립 클릭 → 상세 모달 분기 회귀 테스트
 *
 * 핵심 회귀 시나리오:
 *  - 이미지/자막 클립 클릭 시 오디오 상세 모달이 열리면 안 됨
 *    (내부 로직: AudioPanel onClipSelect에서 if (!clip.audioPath) return)
 *  - 모달의 씬 이미지는 imagePath / image_path / filePath 모두 지원해야 함
 *
 * AudioPanel 모달 DOM 동작은 비동기 useEffect(playAudio)와 얽혀있어
 * 여기선 onClipSelect로 흘러가는 clip 데이터 contract만 검증한다.
 * (AudioPanel의 if (!audioPath) return 분기는 코드 자체가 단순 조건이라
 *  이 contract만 보장되면 안전)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, fireEvent } from '@testing-library/react'
import AudioTimeline from '../../src/components/AudioTimeline/AudioTimeline'
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
