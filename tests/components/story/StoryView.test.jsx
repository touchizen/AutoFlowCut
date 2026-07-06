import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

const pipeline = (over = {}) => ({
  state: {
    steps: {
      script: { status: 'pending' }, scenes: { status: 'pending' },
      audio: { status: 'pending' }, prompts: { status: 'pending' },
    },
    speakers: [],
  },
  scenes: [],
  streamingText: '',
  start: vi.fn(), abort: vi.fn(),
  ttsPreview: vi.fn(async () => ({ ok: true, segments: [] })),
  ...over,
})

describe('StoryView', () => {
  it('스텝퍼에 4단계와 상태 뱃지를 렌더한다', () => {
    const { container } = render(<StoryView pipeline={pipeline()} />)
    const labels = [...container.querySelectorAll('.story-step-name')].map((el) => el.textContent)
    expect(labels).toEqual(['설정', '대본', '씬 분리', '오디오', '프롬프트'])
  })
  it('제목 입력 후 시작하면 start("script")가 stepMachine이 기대하는 shape로 호출된다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/제목/), { target: { value: '운수 좋은 날' } })
    fireEvent.change(screen.getByLabelText('장르'), { target: { value: 'yadam' } })
    fireEvent.change(screen.getByLabelText('길이 값'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'ko' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    // stepMachine.steps.script는 params.input(type/title)과 params.options(genre/model/language/length)를
    // 분리해서 읽는다 — input에 genre/length/language를 섞어 넣으면 LLM opts로 전달되지 않아 무시된다.
    expect(p.start).toHaveBeenCalledWith('script', {
      input: { type: 'title', title: '운수 좋은 날' },
      options: { genre: 'yadam', language: 'ko', engine: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'off', lengthValue: '5', lengthUnit: 'min', sceneGranularity: 'scene', reviewLoop: false },
    })
  })

  it('옵션 미변경 시 기본값(장르 bespoke, 길이 10 min)이 options로 전달된다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/제목/), { target: { value: '제목만' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(p.start).toHaveBeenCalledWith('script', {
      input: { type: 'title', title: '제목만' },
      options: { genre: 'bespoke', language: 'ko', engine: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'off', lengthValue: '10', lengthUnit: 'min', sceneGranularity: 'scene', reviewLoop: false },
    })
  })
  it('script running이면 스트리밍 텍스트를 표시한다', () => {
    const p = pipeline({ streamingText: '옛날 옛적에...' })
    p.state.steps.script.status = 'running'
    render(<StoryView pipeline={p} />)
    expect(screen.getByText(/옛날 옛적에/)).toBeTruthy()
  })
  // M2a-3a: audio가 파이프라인 1급 스텝 — 씬 분리 done이면 다음 진행이 오디오 단계다.
  it('씬 분리 done이면 "오디오 실행"이 활성화되고 start("audio")를 호출한다', () => {
    const p = pipeline()
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    render(<StoryView pipeline={p} />)
    const btn = screen.getByRole('button', { name: /오디오 실행/ })
    fireEvent.click(btn)
    expect(p.start).toHaveBeenCalledWith('audio', {})
  })

  // M2a-3a: 오디오 패널은 세그먼트(화자/텍스트/상태)를 렌더한다.
  it('오디오 단계에서 세그먼트의 화자/텍스트/상태를 렌더한다', () => {
    const p = pipeline({
      scenes: [{ storyId: 's1', segments: [{ speaker: '나레이션', text: '어느 날', status: 'done' }] }],
    })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    const { container } = render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))  // 스텝퍼 오디오 탭(currentStep)
    const panel = container.querySelector('.story-audio-panel')
    expect(panel).toBeTruthy()
    expect(within(panel).getByText('나레이션')).toBeTruthy()
    expect(within(panel).getByText('어느 날')).toBeTruthy()
    expect(within(panel).getByText('완료')).toBeTruthy()  // seg.status done → 완료
  })

  // M2a-3b/Task 11: audio 패널에서 [성우 선택] 버튼 → VoicePicker 모달 → 카드 선택 →
  // [이 성우로 지정]으로 확정하면 speakers가 start('audio')에 실린다.
  it('화자별 목소리를 선택해 오디오 실행하면 speakers가 start("audio")에 전달된다', () => {
    const p = pipeline({
      scenes: [{ storyId: 's1', segments: [{ speaker: 'narrator', text: '어느 날', status: 'pending' }] }],
    })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.speakers = [{ id: 'narrator', name: '나레이션', voice: null }]
    const voices = [{ id: 'tc_joon', name: 'Joonkyu', language: 'ko', provider: 'typecast' }]
    render(<StoryView pipeline={p} voices={voices} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))  // audio 패널로
    fireEvent.click(screen.getByLabelText('나레이션 목소리'))  // [성우 선택] 버튼 → 모달 오픈
    fireEvent.click(screen.getByText('Joonkyu'))  // 카드 선택(임시)
    fireEvent.click(screen.getByRole('button', { name: /이 성우로 지정/ }))  // 확정 → 모달 닫힘
    fireEvent.click(screen.getByRole('button', { name: /오디오 실행/ }))
    expect(p.start).toHaveBeenCalledWith('audio', {
      speakers: [{ id: 'narrator', name: '나레이션', voice: { provider: 'typecast', voiceId: 'tc_joon' } }],
    })
  })

  // Task 11: 성우 검색(이름/특징)은 VoicePicker 내부 기능 — StoryView는 voices를 그대로 넘겨준다.
  it('VoicePicker 모달의 검색은 이름/특징으로 카드를 필터링한다', () => {
    const p = pipeline({
      scenes: [{ storyId: 's1', segments: [{ speaker: 'narrator', text: '어느 날', status: 'pending' }] }],
    })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.speakers = [{ id: 'narrator', name: '나레이션', voice: null }]
    const voices = [
      { id: 'liam', name: 'Liam', language: 'en', provider: 'elevenlabs', traits: ['male', 'energetic creator'] },
      { id: 'rachel', name: 'Rachel', language: 'multi', provider: 'elevenlabs', traits: ['female'] },
    ]
    render(<StoryView pipeline={p} voices={voices} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    fireEvent.click(screen.getByLabelText('나레이션 목소리'))
    fireEvent.change(screen.getByPlaceholderText(/검색|search/i), { target: { value: 'energetic' } })
    expect(screen.getByText('Liam')).toBeInTheDocument()
    expect(screen.queryByText('Rachel')).not.toBeInTheDocument()
  })

  // Codex M2a-3: 기본 성우(빈 옵션) 명시 선택은 기존 voice를 유지하지 말고 null로 비워야 한다
  // (backend defaultVoice로 폴백). `??`가 빈문자열을 "오버라이드 없음"으로 오인하던 버그.
  it('기본 성우(빈 옵션) 선택은 화자 voice를 null로 비운다', () => {
    const p = pipeline({ scenes: [{ storyId: 's1', segments: [{ speaker: 'narrator', text: 'x' }] }] })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.speakers = [{ id: 'narrator', name: '나레이션', voice: { provider: 'typecast', voiceId: 'tc_old' } }]
    const voices = [{ id: 'tc_new', name: 'New', language: 'ko', provider: 'typecast' }]
    render(<StoryView pipeline={p} voices={voices} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    fireEvent.click(screen.getByLabelText('나레이션 목소리'))
    // '기본 성우' 텍스트는 카드(grid 첫 항목)와 footer 선택 요약(<b>) 둘 다에 나타난다 —
    // DOM 순서상 카드가 먼저이므로 [0]이 클릭 대상 카드.
    fireEvent.click(screen.getAllByText('기본 성우')[0])
    fireEvent.click(screen.getByRole('button', { name: /이 성우로 지정/ }))
    fireEvent.click(screen.getByRole('button', { name: /오디오 실행/ }))
    expect(p.start).toHaveBeenCalledWith('audio', {
      speakers: [{ id: 'narrator', name: '나레이션', voice: null }],
    })
  })

  // M2a-3d: 세그먼트별 "재생성" 버튼 → start('audio', { regenerate:[id], speakers }).
  it('세그먼트 재생성 버튼은 해당 세그먼트만 regenerate로 start한다', () => {
    const p = pipeline({
      scenes: [{ storyId: 's1', segments: [{ id: 's1-1', speaker: 'narrator', text: '어느 날', status: 'done', audioPath: '/x/s1-1.wav' }] }],
    })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.speakers = [{ id: 'narrator', name: '나레이션', voice: { provider: 'typecast', voiceId: 'tc_a' } }]
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    fireEvent.click(screen.getByRole('button', { name: 's1-1 재생성' }))
    expect(p.start).toHaveBeenCalledWith('audio', {
      speakers: [{ id: 'narrator', name: '나레이션', voice: { provider: 'typecast', voiceId: 'tc_a' } }],
      regenerate: ['s1-1'],
    })
  })

  // 슬라이스1: 세그먼트 "테스트" 버튼 → 그 세그먼트만 ttsPreview로 합성(배치와 분리).
  it('세그먼트 테스트 버튼은 그 세그먼트만 화자 매핑과 함께 ttsPreview로 합성한다', async () => {
    const p = pipeline({
      scenes: [{ storyId: 's1', segments: [{ id: 's1-1', speaker: 'narrator', text: '어느 날', status: 'pending' }] }],
    })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.speakers = [{ id: 'narrator', name: '나레이션', voice: { provider: 'typecast', voiceId: 'tc_a' } }]
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    fireEvent.click(screen.getByRole('button', { name: 's1-1 테스트' }))
    await waitFor(() => expect(p.ttsPreview).toHaveBeenCalledWith({
      segmentIds: ['s1-1'],
      speakers: [{ id: 'narrator', name: '나레이션', voice: { provider: 'typecast', voiceId: 'tc_a' } }],
    }))
  })

  // M2a-3c: 세그먼트 미리듣기 버튼 → audioPath를 readFileAbsolute로 읽어 재생.
  it('세그먼트 미리듣기 버튼은 audioPath를 읽어 재생한다', async () => {
    window.electronAPI.readFileAbsolute.mockResolvedValue({ success: true, data: 'data:audio/wav;base64,AAA' })
    const p = pipeline({
      scenes: [{ storyId: 's1', segments: [{ id: 's1-1', speaker: 'narrator', text: '어느 날', status: 'done', audioPath: '/x/s1-1.wav' }] }],
    })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    fireEvent.click(screen.getByRole('button', { name: 's1-1 미리듣기' }))
    await waitFor(() => expect(window.electronAPI.readFileAbsolute).toHaveBeenCalledWith({ filePath: '/x/s1-1.wav' }))
  })

  // 슬라이스2/3/Task 11: 화자별로 엔진(provider)이 다른 카드를 선택 → 그 provider+voice로 start.
  // (모달에서는 카드 클릭 한 번이 엔진+목소리를 동시에 확정한다 — 별도 엔진 select 없음.)
  it('화자별로 엔진(provider)을 바꿔 선택하면 그 provider+voice로 start된다', () => {
    const p = pipeline({ scenes: [{ storyId: 's1', segments: [{ speaker: 'narrator', text: 'x' }] }] })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.speakers = [{ id: 'narrator', name: '나레이션', voice: null }]
    const voices = [
      { id: 'tc_a', name: 'Joonkyu', language: 'ko', provider: 'typecast' },
      { id: 'Kore', name: 'Kore', language: 'multi', provider: 'gemini' },
    ]
    render(<StoryView pipeline={p} voices={voices} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    fireEvent.click(screen.getByLabelText('나레이션 목소리'))
    fireEvent.click(screen.getByText('Kore'))
    fireEvent.click(screen.getByRole('button', { name: /이 성우로 지정/ }))
    fireEvent.click(screen.getByRole('button', { name: /오디오 실행/ }))
    expect(p.start).toHaveBeenCalledWith('audio', {
      speakers: [{ id: 'narrator', name: '나레이션', voice: { provider: 'gemini', voiceId: 'Kore' } }],
    })
  })

  it('Story 오디오 성우 선택 모달에는 Google TTS 카드가 나타나지 않는다', () => {
    const p = pipeline({ scenes: [{ storyId: 's1', segments: [{ speaker: 'narrator', text: 'x' }] }] })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.speakers = [{ id: 'narrator', name: '나레이션', voice: null }]
    const voices = [
      { id: 'tc_a', name: 'Joonkyu', language: 'ko', provider: 'typecast' },
      { id: 'ko-KR-Neural2-A', name: 'Neural2-A', language: 'ko-KR', provider: 'googletts' },
    ]
    render(<StoryView pipeline={p} voices={voices} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    fireEvent.click(screen.getByLabelText('나레이션 목소리'))
    expect(screen.getByText('Joonkyu')).toBeInTheDocument()
    expect(screen.queryByText('Neural2-A')).not.toBeInTheDocument()
    expect(screen.queryByText(/Google TTS/i)).not.toBeInTheDocument()
  })

  // M2a-3b: 화자(state.speakers)가 없으면(빈) start('audio',{}) — 빈 speakers로 덮어쓰지 않는다.
  it('화자가 없으면 오디오 실행은 start("audio", {})로 호출한다(빈 speakers 미전달)', () => {
    const p = pipeline()
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: /오디오 실행/ }))
    expect(p.start).toHaveBeenCalledWith('audio', {})
  })

  it('script done이면 다음 단계(씬 분리) 버튼이 현재 대본과 옵션으로 실행된다', async () => {
    const p = pipeline({ scriptText: '대본 본문' })
    p.state.input = { title: '기존 제목', options: {} }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    const btn = screen.getByRole('button', { name: /씬 분리 실행/ })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(p.start).toHaveBeenCalledWith('scenes', expect.objectContaining({
        scriptOverride: '대본 본문',
        title: '기존 제목',
        options: expect.objectContaining({ sceneGranularity: 'scene', reviewLoop: false }),
      }))
    })
  })
  // M1 스펙 §1 2번 경로: 대본을 직접 붙여넣어 LLM 없이 바로 시작할 수 있어야 한다.
  it('대본 붙여넣기 후 [시작] 클릭하면 pastedScript로 start된다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/붙여넣/), { target: { value: '내가 쓴 대본' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    // 임포트/붙여넣기 시작도 현재 설정+제목을 전부 커밋한다(기본값: genre bespoke, title 빈값).
    expect(p.start).toHaveBeenCalledWith('script', {
      pastedScript: '내가 쓴 대본',
      input: { type: 'pasted', title: '' },
      options: { genre: 'bespoke', language: 'ko', engine: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'off', lengthValue: '10', lengthUnit: 'min', sceneGranularity: 'scene', reviewLoop: false },
    })
  })

  it('제목·붙여넣기 둘 다 비어 있으면 [시작] 버튼이 비활성화된다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    expect(screen.getByRole('button', { name: '시작' })).toBeDisabled()
  })

  // Important: state.scenes/state.prompts는 존재하지 않는 필드였다 — pipeline.scenes(파생
  // 데이터, scenes.json 내용)를 별도로 받아 ②/④ 패널을 채운다.
  // Task 7: scriptPhase가 남아 있는 동안 displayStep이 script로 강제되므로, done된 스텝을
  // 스텝퍼에서 클릭해 해당 패널로 이동한 뒤 검증한다.
  it('씬 분리 단계에서 scenes의 세그먼트(화자/텍스트) 행을 렌더한다', () => {
    const p = pipeline({
      scenes: [{ storyId: 's1', segments: [{ speaker: '나레이션', text: '어느 날' }] }],
    })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    expect(screen.getByText('나레이션')).toBeTruthy()
    expect(screen.getByText('어느 날')).toBeTruthy()
  })

  it('프롬프트 단계에서 scenes의 imagePrompt/videoPrompt를 렌더한다', () => {
    const p = pipeline({
      scenes: [{ storyId: 's1', imagePrompt: 'IMG-1', videoPrompt: 'VID-1' }],
    })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.steps.prompts.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '프롬프트' }))
    expect(screen.getByText('IMG-1')).toBeTruthy()
    expect(screen.getByText('VID-1')).toBeTruthy()
  })

  it('에러 단계는 error 뱃지 + 재실행 버튼', () => {
    const p = pipeline()
    p.state.steps.script.status = 'error'
    p.state.steps.script.error = '429'
    render(<StoryView pipeline={p} />)
    expect(screen.getByText(/429/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /재실행/ })).toBeTruthy()
  })

  // Minor 7-⑴: done 상태 스텝은 스텝퍼에서 클릭해 해당 패널로 돌아가 볼 수 있어야 한다(현재
  // currentStep이 더 앞선 단계로 진행돼 있어도). 미완료 스텝은 아직 데이터가 없으므로 클릭 불가.
  // Task 7: scriptPhase가 남아 있는 동안은 대본 화면이 기본 — 스텝퍼 클릭으로 패널을 오간다.
  it('스텝퍼에서 done 상태 스텝을 클릭하면 해당 패널을 표시하고, 미완료 스텝은 클릭할 수 없다', () => {
    const p = pipeline({ scenes: [{ storyId: 's1', imagePrompt: 'IMG-1', videoPrompt: 'VID-1' }] })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    render(<StoryView pipeline={p} />)

    // Task 7: scriptPhase가 남아 있으므로 기본은 대본(script) 패널이다
    expect(screen.queryByText('IMG-1')).toBeNull()

    // M2a-3: '오디오'는 현재 진행 단계(currentStep)라 클릭 가능하고, 그보다 뒤인 미완료 '프롬프트'는 클릭 불가.
    expect(screen.getByRole('button', { name: '오디오' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '프롬프트' })).toBeNull()

    // done 상태인 '씬 분리' 스텝 클릭 → scriptPhase 해제 + 씬 분리 패널로 전환
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    expect(screen.queryByText('이미지 프롬프트')).toBeNull()
    expect(screen.getByText('화자')).toBeTruthy()

    // done 상태인 '대본' 스텝 클릭 → 대본 작업 화면(editor)으로 복귀
    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    expect(screen.getByTestId('story-editor')).toBeTruthy()
    expect(screen.queryByText('화자')).toBeNull()
  })

  // Minor 7-⑵: useStoryPipeline.open()이 실패(예: invalid-project-path)하면 pipeline.openError로
  // 노출되고, StoryView는 안내 배너를 렌더해 사용자가 원인을 알 수 있어야 한다.
  it('open 실패(openError) 시 안내 배너를 표시한다', () => {
    const p = pipeline({ openError: 'invalid-project-path' })
    render(<StoryView pipeline={p} />)
    expect(screen.getByText(/프로젝트 폴더를 열 수 없습니다/)).toBeTruthy()
    expect(screen.getByText(/invalid-project-path/)).toBeTruthy()
  })

  it('openError가 없으면 안내 배너를 렌더하지 않는다', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.queryByText(/프로젝트 폴더를 열 수 없습니다/)).toBeNull()
  })

  // 레이아웃 회귀 방지: 스텝퍼(상단 탭)와 하단 컨트롤(▶ 진행 등)은 스크롤 컨테이너
  // (.story-step-panel) 바깥의 story-view 직접 자식으로 렌더돼야 한다 — 그래야 CSS에서
  // 스텝퍼/컨트롤은 flex-shrink:0으로 고정, 패널만 overflow-y:auto로 스크롤할 수 있다.
  // 컨트롤을 패널 안으로 옮기면 다시 콘텐츠와 함께 스크롤되는 버그(스크롤 시 탭/버튼이 밀림)가 재발한다.
  it('레이아웃: 스텝퍼·하단 컨트롤은 스크롤 패널 바깥(story-view 직접 자식)에 분리 렌더된다', () => {
    const p = pipeline({ scenes: [{ storyId: 's1', imagePrompt: 'IMG-1', videoPrompt: 'VID-1' }] })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    const { container } = render(<StoryView pipeline={p} />)
    // scriptPhase 해제 → 하단 제네릭 컨트롤(story-controls) 노출 상태로 전환
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))

    const view = container.querySelector('.story-view')
    const stepper = container.querySelector('.story-stepper')
    const panel = container.querySelector('.story-step-panel')
    const controls = container.querySelector('.story-controls')

    // 고정 영역(스텝퍼·컨트롤)과 스크롤 영역(패널)은 모두 story-view의 직접 자식(형제)이어야 한다
    expect(stepper.parentElement).toBe(view)
    expect(panel.parentElement).toBe(view)
    expect(controls.parentElement).toBe(view)
    // 스크롤 대상 테이블은 패널 안에만 있고, 고정 컨트롤 영역에는 없어야 한다
    expect(panel.querySelector('.story-readonly-table')).toBeTruthy()
    expect(controls.querySelector('.story-readonly-table')).toBeNull()
  })

  // 네비게이션 회귀: 진행 대기(pending)인 현재 단계는 done 스텝을 보다가도 다시 볼 수 있어야 한다.
  // (버그: done 스텝만 clickable + 진행 액션이 viewedStep 미리셋 → 대기 단계로 못 돌아옴.)
  it('done 스텝(씬분리) 탭의 하단 버튼은 그 탭 액션(씬 재분리)이고, 다음 단계는 탭으로 이동한다', () => {
    const p = pipeline()
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.steps.audio.status = 'done'  // currentStep=prompts
    render(<StoryView pipeline={p} />)
    // 씬 분리(done) 탭 → scenes 패널. 하단은 '씬 재분리'(currentStep=prompts로 새지 않음)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    expect(screen.getByText('화자')).toBeTruthy()
    expect(screen.getByRole('button', { name: /씬 재분리/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '프롬프트 실행' })).toBeNull()
    // 프롬프트로 가려면 프롬프트 탭 클릭
    fireEvent.click(screen.getByRole('button', { name: '프롬프트' }))
    expect(screen.getByText('이미지 프롬프트')).toBeTruthy()
    expect(screen.queryByText('화자')).toBeNull()
  })

  it('진행 대기(pending)인 현재 단계 탭(프롬프트)도 스텝퍼에서 눌러 다시 볼 수 있다', () => {
    const p = pipeline()
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.steps.audio.status = 'done'  // M2a-3: audio done → prompts가 currentStep(pending)
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    expect(screen.getByText('화자')).toBeTruthy()
    // prompts 는 pending(currentStep) — 이제 클릭 가능해야 한다
    fireEvent.click(screen.getByRole('button', { name: '프롬프트' }))
    expect(screen.getByText('이미지 프롬프트')).toBeTruthy()
  })

  it('씬 분리(대기)도 대본(완료)을 본 뒤 다시 눌러 볼 수 있다', () => {
    const p = pipeline()
    p.state.steps.script.status = 'done'
    // scenes pending, currentStep=scenes
    render(<StoryView pipeline={p} />)
    // 대본(done) 탭 → editor
    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    expect(screen.getByTestId('story-editor')).toBeTruthy()
    // 씬 분리(currentStep, pending) 재클릭 → scenes 패널
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    expect(screen.getByText('화자')).toBeTruthy()
  })

  // F3(Codex): setup에서 문장 기준 선택 후 대본 생성/붙여넣기 시작 시에도 options에 sceneGranularity가
  // 실려야 한다 — 안 그러면 대본만 만들고 재오픈 시 기본 scene으로 hydrate되어 선택이 유실된다.
  it('대본 생성 시작(시작)에도 sceneGranularity가 options에 실린다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('씬 분리 단위'), { target: { value: 'segment' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(p.start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ sceneGranularity: 'segment' }),
    }))
  })

  // F2(Codex): 새 프로젝트(대본 대기)에서 '대본' 탭이 currentStep이라 클릭 가능해졌는데,
  // 클릭 시 무조건 editor로 보내면 제목/옵션/파일선택 setup이 사라지고 빈 editor만 남는 회귀.
  it('대본 대기(fresh) 상태: 처음엔 설정 폼, 대본 탭 클릭 → editor / 설정 탭 클릭 → setup', () => {
    const p = pipeline() // script pending, scriptText 없음
    render(<StoryView pipeline={p} />)
    // fresh 초기: 0번 설정 폼
    expect(screen.getByTestId('story-setup')).toBeTruthy()
    // 대본 탭은 이제 항상 editor(설정은 0번 탭이 담당)
    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    expect(screen.getByTestId('story-editor')).toBeTruthy()
    // 설정 탭으로 다시 설정 폼
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(screen.getByTestId('story-setup')).toBeTruthy()
    expect(screen.queryByTestId('story-editor')).toBeNull()
  })

  it('대본 done 상태에서 대본 탭을 누르면 editor로 복귀한다', () => {
    const p = pipeline({ scriptText: '이미 쓴 대본' })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    render(<StoryView pipeline={p} />)
    // 씬 분리 탭으로 갔다가
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    // 대본(done) 탭 클릭 → editor 복귀
    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    expect(screen.getByTestId('story-editor')).toBeTruthy()
  })

  // 10번: 씬 분리 탭(완료)에서 그 탭에 필요한 옵션(씬 분리 단위)을 바꿔 재분리할 수 있다.
  it('씬 분리 탭(완료)에서 씬 분리 단위를 바꿔 "다시 분리"하면 새 단위로 start된다', async () => {
    const p = pipeline({
      scenes: [{ storyId: 's1', segments: [{ speaker: 'narrator', text: '어느 날' }] }],
      scriptText: '대본 본문',
    })
    p.state.input = { title: '제목', options: {} }
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    // 씬 분리 탭 안의 재분리용 단위 드롭다운을 문장 기준으로 변경 → 하단 '씬 재분리'로 재분리
    fireEvent.change(screen.getByLabelText('씬 분리 단위 (재분리)'), { target: { value: 'segment' } })
    fireEvent.click(screen.getByRole('button', { name: /씬 재분리/ }))
    await waitFor(() => {
      expect(p.start).toHaveBeenCalledWith('scenes', expect.objectContaining({
        options: expect.objectContaining({ sceneGranularity: 'segment' }),
      }))
    })
  })
})
