import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  ...over,
})

describe('StoryView', () => {
  it('스텝퍼에 4단계와 상태 뱃지를 렌더한다', () => {
    render(<StoryView pipeline={pipeline()} />)
    // 대본 편집이 PromptInput 으로 바뀌며 placeholder("대본이 여기에 표시됩니다")도 "대본"을
    // 포함한다 — 스텝퍼 라벨만 겨냥하도록 정확 일치로 좁힌다.
    expect(screen.getByText('대본')).toBeTruthy()
    // '씬 분리'는 스텝퍼 라벨 — setup 의 '씬 분리 단위' 드롭다운 라벨과 겹치지 않게 정확 일치로 좁힌다.
    expect(screen.getByText('씬 분리')).toBeTruthy()
    expect(screen.getByText(/오디오/)).toBeTruthy()
    expect(screen.getByText(/프롬프트/)).toBeTruthy()
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
      options: { genre: 'yadam', language: 'ko', model: 'claude-opus-4-8', lengthValue: '5', lengthUnit: 'min' },
    })
  })

  it('옵션 미변경 시 기본값(장르 bespoke, 길이 10 min)이 options로 전달된다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/제목/), { target: { value: '제목만' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(p.start).toHaveBeenCalledWith('script', {
      input: { type: 'title', title: '제목만' },
      options: { genre: 'bespoke', language: 'ko', model: 'claude-opus-4-8', lengthValue: '10', lengthUnit: 'min' },
    })
  })
  it('script running이면 스트리밍 텍스트를 표시한다', () => {
    const p = pipeline({ streamingText: '옛날 옛적에...' })
    p.state.steps.script.status = 'running'
    render(<StoryView pipeline={p} />)
    expect(screen.getByText(/옛날 옛적에/)).toBeTruthy()
  })
  it('script done이면 다음 단계(씬 분리) 버튼이 활성화된다', () => {
    const p = pipeline()
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    const btn = screen.getByRole('button', { name: /씬 분리 실행/ })
    fireEvent.click(btn)
    expect(p.start).toHaveBeenCalledWith('scenes', expect.anything())
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
      options: { genre: 'bespoke', language: 'ko', model: 'claude-opus-4-8', lengthValue: '10', lengthUnit: 'min' },
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

    // 미완료(pending) 스텝인 '오디오'는 클릭 가능한 요소가 아니다
    expect(screen.queryByRole('button', { name: '오디오' })).toBeNull()

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
  it('done 스텝을 보다가 하단 진행을 누르면 진행 단계 패널로 화면이 이동한다', () => {
    const p = pipeline()
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    // currentStep=prompts(pending)
    render(<StoryView pipeline={p} />)
    // 씬 분리(done) 탭으로 이동 → scenes 패널
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    expect(screen.getByText('화자')).toBeTruthy()
    // 하단 '프롬프트 실행'(진행) → viewedStep 리셋되어 prompts 패널로 이동해야 한다
    fireEvent.click(screen.getByRole('button', { name: '프롬프트 실행' }))
    expect(screen.getByText('이미지 프롬프트')).toBeTruthy()
    expect(screen.queryByText('화자')).toBeNull()
  })

  it('진행 대기(pending)인 현재 단계 탭(프롬프트)도 스텝퍼에서 눌러 다시 볼 수 있다', () => {
    const p = pipeline()
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
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
    // 씬 분리 탭 안의 재분리용 단위 드롭다운을 문장 기준으로 변경
    fireEvent.change(screen.getByLabelText('씬 분리 단위 (재분리)'), { target: { value: 'segment' } })
    fireEvent.click(screen.getByRole('button', { name: '다시 분리' }))
    await waitFor(() => {
      expect(p.start).toHaveBeenCalledWith('scenes', expect.objectContaining({
        options: expect.objectContaining({ sceneGranularity: 'segment' }),
      }))
    })
  })
})
