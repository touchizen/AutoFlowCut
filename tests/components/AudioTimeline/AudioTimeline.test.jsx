/**
 * AudioTimeline 컴포넌트 테스트
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import AudioTimeline from '../../../src/components/AudioTimeline/AudioTimeline'
import { I18nProvider } from '../../../src/hooks/useI18n'

// I18nProvider로 감싸는 render 헬퍼
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
        { filename: 's_02.mp3', path: '/audio/소은/s_02.mp3', timecodeMs: 5000, durationMs: 2000 },
      ],
    },
    {
      character: '곽 주사',
      files: [
        { filename: 'k_01.mp3', path: '/audio/곽 주사/k_01.mp3', timecodeMs: 8000, durationMs: 3000 },
      ],
    },
  ],
  sfx: [
    {
      category: '01_주판',
      files: [{ filename: 'a.mp3', path: '/sfx/a.mp3', timecodeMs: 2000, durationMs: 1000 }],
    },
  ],
}

const scenes = [
  { id: 'scene_1', image_path: '/img/1.png', start_time: '00:00', end_time: '00:03', subtitle: 'first' },
  { id: 'scene_2', image_path: '/img/2.png', start_time: '00:03', end_time: '00:06', subtitle: 'second' },
]

const srtEntries = [
  { startMs: 0,    endMs: 3000, text: 'subtitle one' },
  { startMs: 3000, endMs: 6000, text: 'subtitle two' },
]

beforeEach(() => {
  // window.electronAPI mock (audio 재생 시도 시 호출됨)
  global.window.electronAPI = {
    readFileAbsolute: vi.fn().mockResolvedValue({ success: false }),
  }
  // HTMLMediaElement.play 무력화 (jsdom은 audio 재생 미지원)
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

describe('AudioTimeline', () => {
  describe('빈 상태', () => {
    it('audioPackage가 null이면 아무것도 렌더하지 않음', () => {
      const { container } = render(
        <AudioTimeline audioPackage={null} scenes={[]} srtEntries={[]} />
      )
      expect(container.firstChild).toBeNull()
    })
  })

  describe('헤더', () => {
    it('타이틀과 현재/총 시간을 표시', () => {
      const { container } = render(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />
      )
      expect(screen.getByText('Audio Timeline')).toBeInTheDocument()
      // 헤더의 현재/총 시간 (TimeRuler 눈금 0:00/1:00과 구별)
      expect(container.querySelector('.atl-time-cur').textContent).toBe('0:00')
      expect(container.querySelector('.atl-time-total').textContent).toBe('1:00')
    })

    it('재생/정지 버튼 + 줌 컨트롤 표시', () => {
      const { container } = render(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />
      )
      expect(container.querySelector('.atl-play-btn').textContent).toBe('▶')
      expect(container.querySelector('.atl-stop-btn').textContent).toBe('⏹')
      expect(screen.getByText('100%')).toBeInTheDocument()
      expect(screen.getByText('−')).toBeInTheDocument()
      expect(screen.getByText('+')).toBeInTheDocument()
    })
  })

  describe('트랙 렌더링', () => {
    it('5개 메인 트랙 라벨 표시 (영어 locale 기준)', () => {
      render(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />)
      expect(screen.getByText('Image')).toBeInTheDocument()
      expect(screen.getByText('Subtitle')).toBeInTheDocument()
      expect(screen.getByText('Narration')).toBeInTheDocument()
      expect(screen.getByText('Voice')).toBeInTheDocument()
      expect(screen.getByText('SFX')).toBeInTheDocument()
    })

    it('Voice/SFX는 펼치기 가능 (▶ 아이콘)', () => {
      const { container } = render(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />
      )
      const expandIcons = container.querySelectorAll('.atl-expand')
      expect(expandIcons.length).toBe(2) // Voice + SFX
      // 기본은 접힘
      expandIcons.forEach(icon => expect(icon.textContent).toBe('▶'))
    })

    it('펼치기 전에는 sub-track (캐릭터/카테고리) 라벨이 안 보임', () => {
      render(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />)
      expect(screen.queryByText('소은')).not.toBeInTheDocument()
      expect(screen.queryByText('곽 주사')).not.toBeInTheDocument()
    })
  })

  describe('펼치기/접기', () => {
    it('Voice 라벨 클릭 시 캐릭터 sub-track이 나타남', () => {
      render(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />)
      fireEvent.click(screen.getByText('Voice'))
      expect(screen.getByText('소은')).toBeInTheDocument()
      expect(screen.getByText('곽 주사')).toBeInTheDocument()
    })

    it('펼친 상태에서 다시 클릭하면 접힘', () => {
      render(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />)
      const voiceLabel = screen.getByText('Voice')
      fireEvent.click(voiceLabel)
      expect(screen.getByText('소은')).toBeInTheDocument()
      fireEvent.click(voiceLabel)
      expect(screen.queryByText('소은')).not.toBeInTheDocument()
    })

    it('SFX도 펼치면 카테고리가 나타남', () => {
      render(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />)
      fireEvent.click(screen.getByText('SFX'))
      expect(screen.getByText('01_주판')).toBeInTheDocument()
    })
  })

  describe('줌 컨트롤', () => {
    it('+ 버튼 클릭 시 줌이 증가', () => {
      render(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />)
      const zoomInBtn = screen.getByText('+')
      fireEvent.click(zoomInBtn)
      // 100% × 1.4 = 140%
      expect(screen.getByText('140%')).toBeInTheDocument()
    })

    it('− 버튼 클릭 시 줌이 감소', () => {
      render(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />)
      const zoomOutBtn = screen.getByText('−')
      fireEvent.click(zoomOutBtn)
      // 100% / 1.4 ≈ 71%
      expect(screen.getByText('71%')).toBeInTheDocument()
    })

    it('줌 100% 리셋 버튼이 동작', () => {
      render(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />)
      // 먼저 줌 변경
      fireEvent.click(screen.getByText('+'))
      fireEvent.click(screen.getByText('+'))
      // 리셋
      fireEvent.click(screen.getByTitle('100%'))
      expect(screen.getByText('100%')).toBeInTheDocument()
    })
  })

  describe('클립 클릭/드래그', () => {
    it('클립 단순 클릭 시 onClipSelect 콜백이 호출됨', () => {
      const onClipSelect = vi.fn()
      const { container } = render(
        <AudioTimeline
          audioPackage={audioPackage}
          scenes={scenes}
          srtEntries={srtEntries}
          onClipSelect={onClipSelect}
        />
      )
      const clips = container.querySelectorAll('.atl-clip')
      expect(clips.length).toBeGreaterThan(0)
      // pointerdown → pointerup (drag 임계값 미만)
      fireEvent.pointerDown(clips[0], { button: 0, clientX: 100 })
      fireEvent(window, new PointerEvent('pointerup', { clientX: 100 }))
      expect(onClipSelect).toHaveBeenCalled()
      expect(onClipSelect.mock.calls[0][0]).toHaveProperty('startMs')
    })

    it('클립 드래그 시 onSaveTimecodeOverride가 호출됨 (relPath 있는 voice/sfx)', () => {
      const onSaveTimecodeOverride = vi.fn()
      const { container } = render(
        <AudioTimeline
          audioPackage={audioPackage}
          scenes={scenes}
          srtEntries={srtEntries}
          onSaveTimecodeOverride={onSaveTimecodeOverride}
        />
      )
      // voice 클립 찾기 (Voice 트랙 펼친 후)
      fireEvent.click(screen.getByText('Voice'))
      const voiceClips = container.querySelectorAll('.atl-clip-audio')
      // narration + voice clips 중 첫 번째 voice 찾기 (audioPath/relPath 있는 것)
      let dragged = false
      for (const clip of voiceClips) {
        fireEvent.pointerDown(clip, { button: 0, clientX: 100 })
        fireEvent(window, new PointerEvent('pointermove', { clientX: 200 })) // 100px 이동
        fireEvent(window, new PointerEvent('pointerup', { clientX: 200 }))
        if (onSaveTimecodeOverride.mock.calls.length > 0) {
          dragged = true
          break
        }
      }
      expect(dragged).toBe(true)
      const [relPath, newMs] = onSaveTimecodeOverride.mock.calls[0]
      expect(typeof relPath).toBe('string')
      expect(typeof newMs).toBe('number')
      expect(newMs).toBeGreaterThan(0)
    })
  })

  describe('키보드', () => {
    it('Escape 키 누르면 playhead가 0으로 리셋', () => {
      const { container } = render(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />
      )
      // Esc 발생
      fireEvent.keyDown(window, { code: 'Escape' })
      const playhead = container.querySelector('.atl-playhead')
      // playhead의 left가 0px여야 함
      expect(playhead.style.left).toBe('0px')
    })

    it('input/textarea에 포커스 있을 때는 스페이스/Esc 무시', () => {
      const onClipSelect = vi.fn()
      render(
        <div>
          <input data-testid="search" />
          <AudioTimeline
            audioPackage={audioPackage}
            scenes={scenes}
            srtEntries={srtEntries}
            onClipSelect={onClipSelect}
          />
        </div>
      )
      const input = screen.getByTestId('search')
      input.focus()
      // input에 focus된 채로 keydown — 동작 안 해야 함
      fireEvent.keyDown(input, { code: 'Space' })
      // 재생이 시작되면 readFileAbsolute가 불려야 하는데 안 불려야 함
      expect(global.window.electronAPI.readFileAbsolute).not.toHaveBeenCalled()
    })
  })

  describe('시간 눈금', () => {
    it('TimeRuler에 눈금이 그려짐', () => {
      const { container } = render(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />
      )
      const ticks = container.querySelectorAll('.atl-ruler-tick')
      // 60s 기간, pxPerSec = 40 → majorSec = 10s → tick 약 7개 (0,10,20,30,40,50,60)
      expect(ticks.length).toBeGreaterThan(0)
    })
  })

  describe('Playhead', () => {
    it('초기 playhead는 0px', () => {
      const { container } = render(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />
      )
      const playhead = container.querySelector('.atl-playhead')
      expect(playhead).toBeInTheDocument()
      expect(playhead.style.left).toBe('0px')
    })
  })
})
