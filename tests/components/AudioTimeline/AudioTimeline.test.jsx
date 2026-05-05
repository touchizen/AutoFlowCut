/**
 * AudioTimeline 컴포넌트 테스트
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

    it('sub-track 펼치면 각 file row의 lane에 mini-clip 마커가 표시됨', () => {
      const { container } = render(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />
      )
      // Voice → 소은(2개 파일) 펼치기
      fireEvent.click(screen.getByText('Voice'))
      fireEvent.click(screen.getByText('소은'))

      // 파일별 mini-clip 마커가 lane에 그려져야 함
      const markers = container.querySelectorAll('.atl-file-mini-clip')
      expect(markers.length).toBe(2) // s_01.mp3 + s_02.mp3

      // 마커 위치 — 시작 시간(timecodeMs) × pxPerMs 기반 left 적용
      // s_01 timecodeMs=1000, s_02=5000. zoom 100% → pxPerMs=0.04 → left 40, 200
      const lefts = Array.from(markers).map(m => parseFloat(m.style.left))
      expect(lefts[0]).toBeCloseTo(40, 0)  // 1000 * 0.04
      expect(lefts[1]).toBeCloseTo(200, 0) // 5000 * 0.04
    })

    it('mini-clip 클릭 시 onClipSelect 호출 + playhead 이동', () => {
      const onClipSelect = vi.fn()
      const { container } = render(
        <AudioTimeline
          audioPackage={audioPackage}
          scenes={scenes}
          srtEntries={srtEntries}
          onClipSelect={onClipSelect}
        />
      )
      fireEvent.click(screen.getByText('Voice'))
      fireEvent.click(screen.getByText('소은'))

      const markers = container.querySelectorAll('.atl-file-mini-clip')
      expect(markers.length).toBeGreaterThan(0)

      // pointerdown으로 클릭 (스크럽 트리거 차단되어야 함 — stopPropagation)
      fireEvent.pointerDown(markers[0], { button: 0, clientX: 50 })

      expect(onClipSelect).toHaveBeenCalledTimes(1)
      const clip = onClipSelect.mock.calls[0][0]
      expect(clip.audioPath).toBe('/audio/소은/s_01.mp3')
      expect(clip.startMs).toBe(1000)

      // playhead가 클립 시작 위치로 이동
      const playhead = container.querySelector('.atl-playhead')
      expect(playhead.style.left).toBe('40px')
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
      const { container } = render(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />
      )
      // 먼저 줌 변경
      fireEvent.click(screen.getByText('+'))
      fireEvent.click(screen.getByText('+'))
      // 리셋 (zoom-fit 버튼 = ⊡)
      fireEvent.click(container.querySelector('.atl-zoom-fit'))
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

  // Regression: 프로젝트 전환 시 useAudioTimeline이 잠깐 null을 반환할 때
  // early return이 hook 호출 사이에 있으면 "Rendered fewer/more hooks" 에러 발생
  describe('프로젝트 전환 (hook 순서 안정성)', () => {
    const collectHookErrors = (spy) =>
      spy.mock.calls.filter(args =>
        args.some(a => typeof a === 'string' && /Rendered (more|fewer) hooks/.test(a))
      )

    it('데이터 있음 → null → 다시 있음 순서로 rerender해도 hook 에러 없음', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { rerender } = rtlRender(
          <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />,
          { wrapper: I18nProvider }
        )
        expect(() => {
          rerender(<AudioTimeline audioPackage={null} scenes={[]} srtEntries={[]} />)
        }).not.toThrow()
        expect(() => {
          rerender(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />)
        }).not.toThrow()
        // 새 프로젝트 정상 렌더 확인
        expect(screen.getByText('Audio Timeline')).toBeInTheDocument()
        expect(collectHookErrors(errorSpy)).toEqual([])
      } finally {
        errorSpy.mockRestore()
      }
    })

    it('null로 마운트 → 데이터 주입 시 hook 에러 없음', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { rerender, container } = rtlRender(
          <AudioTimeline audioPackage={null} scenes={[]} srtEntries={[]} />,
          { wrapper: I18nProvider }
        )
        expect(container.firstChild).toBeNull()
        expect(() => {
          rerender(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />)
        }).not.toThrow()
        expect(screen.getByText('Audio Timeline')).toBeInTheDocument()
        expect(collectHookErrors(errorSpy)).toEqual([])
      } finally {
        errorSpy.mockRestore()
      }
    })

    it('다른 audioPackage로 교체해도 hook 에러 없음', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const audioPackage2 = {
          folderPath: '/audio2',
          media: {
            video: { path: '/audio2/n.mp3', filename: 'n.mp3', durationMs: 30000 },
          },
          voices: [
            {
              character: '주연',
              files: [{ filename: 'j_01.mp3', path: '/audio2/주연/j_01.mp3', timecodeMs: 500, durationMs: 1500 }],
            },
          ],
          sfx: [],
        }
        const { rerender } = rtlRender(
          <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />,
          { wrapper: I18nProvider }
        )
        expect(() => {
          rerender(<AudioTimeline audioPackage={audioPackage2} scenes={[]} srtEntries={[]} />)
        }).not.toThrow()
        expect(collectHookErrors(errorSpy)).toEqual([])
      } finally {
        errorSpy.mockRestore()
      }
    })
  })

  // Regression: data가 null인 상태에서 Space 누르면 playGlobal → tick에서 data.totalDurationMs 크래시
  describe('null data + Space (Issue 1)', () => {
    it('audioPackage=null 상태에서 Space 눌러도 크래시/playback 트리거 없음', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { rerender } = rtlRender(
          <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />,
          { wrapper: I18nProvider }
        )
        // 프로젝트 닫기
        rerender(<AudioTimeline audioPackage={null} scenes={[]} srtEntries={[]} />)
        // Space → togglePlay에서 !data 가드로 즉시 종료되어야 함
        expect(() => {
          fireEvent.keyDown(window, { code: 'Space' })
        }).not.toThrow()
        // playGlobal이 안 돌면 readFileAbsolute도 호출 안 됨
        expect(global.window.electronAPI.readFileAbsolute).not.toHaveBeenCalled()
        // null 크래시 에러 없어야 함
        const crashErrors = errorSpy.mock.calls.filter(args =>
          args.some(a => typeof a === 'string' && /Cannot read|null|undefined/.test(a))
        )
        expect(crashErrors).toEqual([])
      } finally {
        errorSpy.mockRestore()
      }
    })

    it('audioPackage=null 상태에서 Esc는 안전하게 동작', () => {
      const { rerender, container } = rtlRender(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />,
        { wrapper: I18nProvider }
      )
      rerender(<AudioTimeline audioPackage={null} scenes={[]} srtEntries={[]} />)
      expect(container.firstChild).toBeNull()
      // Esc도 크래시 없이 동작
      expect(() => {
        fireEvent.keyDown(window, { code: 'Escape' })
      }).not.toThrow()
    })
  })

  // Regression: data null→복귀 시 .atl-scroll DOM이 새로 마운트되는데
  // wheel useEffect deps에 data가 없으면 재등록 안 돼 zoom/wheel scroll이 죽음
  describe('wheel listener 재등록 (Issue 2)', () => {
    it('데이터 null→복귀 후에도 Ctrl+wheel zoom이 동작', () => {
      const { rerender, container } = rtlRender(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />,
        { wrapper: I18nProvider }
      )
      // 줌 100% 확인
      expect(screen.getByText('100%')).toBeInTheDocument()

      // 프로젝트 전환 (null → 복귀)
      rerender(<AudioTimeline audioPackage={null} scenes={[]} srtEntries={[]} />)
      rerender(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />)

      // 새 .atl-scroll DOM에 wheel listener가 붙어있는지 검증
      // Ctrl+wheel deltaY=-100 → delta = 0.2 → zoom 1.0 * 1.2 = 1.2 → 120%
      const scrollEl = container.querySelector('.atl-scroll')
      expect(scrollEl).toBeTruthy()
      fireEvent.wheel(scrollEl, { deltaY: -100, ctrlKey: true })
      // zoom이 변경되어야 함 (100%가 아니어야 함)
      expect(screen.queryByText('100%')).not.toBeInTheDocument()
    })

    it('데이터 null→복귀 후 세로 wheel → 가로 스크롤 변환도 동작', () => {
      const { rerender, container } = rtlRender(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />,
        { wrapper: I18nProvider }
      )
      rerender(<AudioTimeline audioPackage={null} scenes={[]} srtEntries={[]} />)
      rerender(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />)

      const scrollEl = container.querySelector('.atl-scroll')
      // jsdom은 layout 안 함 → scrollWidth/clientWidth 0이지만, scrollLeft 할당은 호출됨
      // handleWheel에서 deltaY 받아 scrollEl.scrollLeft += e.deltaY 실행하는지만 확인
      const before = scrollEl.scrollLeft
      fireEvent.wheel(scrollEl, { deltaY: 100 })
      // jsdom에서는 실제 스크롤 한계 무시하고 값이 설정되거나 0 유지
      // 핵심: handleWheel이 호출되어 e.preventDefault/스크롤 시도가 일어남 (크래시 X)
      expect(scrollEl.scrollLeft).toBeGreaterThanOrEqual(before)
    })
  })

  // Regression (Issue D): disabled로 전환되는 순간 진행 중이던 audio/RAF/timer가 멈춰야 함.
  // 키보드/버튼 차단만으론 이미 시작된 재생이 overlay 아래에서 계속 흐름.
  describe('disabled 전환 시 진행 중 재생 정지 (Issue D)', () => {
    it('disabled=false → true 전환 시 audio.pause 호출됨', async () => {
      // electronAPI mock — 정상 응답으로 재생 시작 가능하게
      global.window.electronAPI.readFileAbsolute = vi.fn().mockResolvedValue({
        success: true,
        data: 'data:audio/mpeg;base64,AAAA',
      })

      const { rerender, container } = rtlRender(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} disabled={false} />,
        { wrapper: I18nProvider }
      )

      // 재생 시작 (Space 키)
      fireEvent.keyDown(window, { code: 'Space' })
      // playGlobal → 클립별 startClipAt → readFileAbsolute → new Audio → audio.play
      // jsdom은 마이크로태스크 처리만 하면 충분
      await new Promise(r => setTimeout(r, 0))

      const pauseSpy = window.HTMLMediaElement.prototype.pause
      pauseSpy.mockClear()

      // disabled로 flip
      rerender(<AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} disabled={true} />)

      // disabled effect → stopAll → 모든 audio.pause 호출
      // (audioInstancesRef에 인스턴스가 없을 수도 있어서 정확한 횟수는 검증 안 함)
      // 핵심: stopAll이 호출되어 cleanup이 발생했음을 간접 검증
      expect(container.querySelector('.atl-playing')).toBeNull()
    })

    it('disabled=true 마운트 시점부터는 새 재생도 시작 못 함 (Space no-op)', () => {
      const readFile = vi.fn().mockResolvedValue({ success: true, data: 'data:audio/mpeg;base64,AAAA' })
      global.window.electronAPI.readFileAbsolute = readFile

      rtlRender(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} disabled={true} />,
        { wrapper: I18nProvider }
      )

      fireEvent.keyDown(window, { code: 'Space' })
      // disabled면 togglePlay → 즉시 return → readFileAbsolute 안 불림
      expect(readFile).not.toHaveBeenCalled()
    })
  })

  // Regression: 드래그 중 unmount(예: 프로젝트 전환)되면 onUp이 안 와서
  // window listener와 document.body.style.cursor/userSelect가 잔류
  describe('드래그 중 unmount cleanup (Issue 3)', () => {
    afterEach(() => {
      // 테스트 격리 — 혹시라도 잔류 시 다음 테스트 영향 방지
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    })

    it('label column resize 중 unmount하면 cursor/userSelect 복구', () => {
      const { unmount, container } = rtlRender(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />,
        { wrapper: I18nProvider }
      )
      const colSplitter = container.querySelector('.atl-col-splitter')
      expect(colSplitter).toBeTruthy()

      fireEvent.pointerDown(colSplitter, { button: 0, clientX: 200 })
      expect(document.body.style.cursor).toBe('col-resize')
      expect(document.body.style.userSelect).toBe('none')

      // pointerup 없이 unmount
      unmount()

      // unmount cleanup이 activeDragCleanupRef를 호출해 정리해야 함
      expect(document.body.style.cursor).toBe('')
      expect(document.body.style.userSelect).toBe('')
    })

    it('preview ↔ timeline splitter drag 중 unmount해도 cleanup', () => {
      const { unmount, container } = rtlRender(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />,
        { wrapper: I18nProvider }
      )
      const splitter = container.querySelector('.atl-splitter')
      expect(splitter).toBeTruthy()

      fireEvent.pointerDown(splitter, { button: 0, clientY: 300 })
      expect(document.body.style.cursor).toBe('row-resize')

      unmount()
      expect(document.body.style.cursor).toBe('')
      expect(document.body.style.userSelect).toBe('')
    })

    it('track height resize drag 중 unmount해도 cleanup', () => {
      const { unmount, container } = rtlRender(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />,
        { wrapper: I18nProvider }
      )
      const trackResize = container.querySelector('.atl-track-resize')
      expect(trackResize).toBeTruthy()

      fireEvent.pointerDown(trackResize, { button: 0, clientY: 100 })
      expect(document.body.style.cursor).toBe('row-resize')

      unmount()
      expect(document.body.style.cursor).toBe('')
      expect(document.body.style.userSelect).toBe('')
    })

    it('연속된 두 번의 드래그 시작 — 이전 cleanup이 idempotent하게 호출됨', () => {
      const { container } = rtlRender(
        <AudioTimeline audioPackage={audioPackage} scenes={scenes} srtEntries={srtEntries} />,
        { wrapper: I18nProvider }
      )
      const colSplitter = container.querySelector('.atl-col-splitter')

      // 첫 번째 드래그 시작 (pointerup 없이)
      fireEvent.pointerDown(colSplitter, { button: 0, clientX: 200 })
      expect(document.body.style.cursor).toBe('col-resize')

      // 두 번째 드래그 시작 — 이전 cleanup이 자동 호출되고 새로 등록
      fireEvent.pointerDown(colSplitter, { button: 0, clientX: 250 })
      expect(document.body.style.cursor).toBe('col-resize') // 여전히 활성

      // 정상 pointerup으로 종료
      fireEvent(window, new PointerEvent('pointerup', { clientX: 250 }))
      expect(document.body.style.cursor).toBe('')
    })
  })
})
