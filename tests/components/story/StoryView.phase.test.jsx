/**
 * Task 7 — scriptText 단일 상태 + scriptPhase + displayStep 강제 + 폼 hydrate (스펙 §0/§1).
 * setup/editor 화면의 실제 마크업은 Task 8·9 — 여기서는 phase 골격 마커
 * (data-testid="story-setup"/"story-editor")와 라우팅/hydrate만 검증한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

const pipeline = (over = {}) => ({
  state: {
    steps: {
      script: { status: 'pending' }, scenes: { status: 'pending' },
      audio: { status: 'pending' }, prompts: { status: 'pending' },
    },
  },
  scenes: [],
  streamingText: '',
  scriptText: '',
  start: vi.fn(), abort: vi.fn(), openError: null,
  ...over,
})

describe('StoryView scriptPhase (Task 7)', () => {
  it('pipeline.scriptText가 있으면(재오픈 복원) 초기 phase=editor — 대본 작업 화면 마커', () => {
    render(<StoryView pipeline={pipeline({ scriptText: '복원된 대본' })} />)
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('story-setup')).toBeNull()
  })

  it('pipeline.scriptText가 없으면 초기 phase=setup — 설정 화면 마커', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    expect(screen.queryByTestId('story-editor')).toBeNull()
  })

  it('script done이어도 scriptPhase가 남아 있으면 displayStep=script (scenes 패널로 안 넘어감)', () => {
    const p = pipeline({
      scriptText: '완성 대본',
      scenes: [{ storyId: 's1', segments: [{ speaker: '나레이션', text: '어느 날' }] }],
    })
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    // currentStep은 scenes지만 대본 작업 화면 유지
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
    expect(screen.queryByText('화자')).toBeNull()
  })

  it('다음 스텝 실행(분리시작)을 하면 scriptPhase가 해제돼 scenes 패널로 진행한다', async () => {
    // Task 9: editor phase에서는 하단 제네릭 버튼 대신 패널 내 [분리시작]이 scenes를 실행한다.
    const p = pipeline({
      scriptText: '완성 대본',
      scenes: [{ storyId: 's1', segments: [{ speaker: '나레이션', text: '어느 날' }] }],
      generateTitle: vi.fn().mockResolvedValue({ title: '자동 제목' }),
    })
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '분리시작' }))
    await waitFor(() => expect(p.start).toHaveBeenCalledWith('scenes', expect.anything()))
    expect(screen.queryByTestId('story-editor')).toBeNull()
    expect(screen.getByText('화자')).toBeTruthy()
  })

  it('스텝퍼에서 done된 script를 클릭하면 scriptPhase=editor로 대본 작업 화면으로 돌아온다', () => {
    const p = pipeline({
      scriptText: '완성 대본',
      scenes: [{ storyId: 's1', segments: [{ speaker: '나레이션', text: '어느 날' }] }],
    })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    render(<StoryView pipeline={p} />)
    // 씬 분리 패널로 나갔다가
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    expect(screen.queryByTestId('story-editor')).toBeNull()
    expect(screen.getByText('화자')).toBeTruthy()
    // done된 대본 스텝 클릭 → editor 복귀
    fireEvent.click(screen.getByRole('button', { name: '시나리오' }))
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
  })

  it('setup 시작(제목 경로)을 누르면 synopsis phase로 전환된다(§v2.8 B1)', () => {
    const p = pipeline({ generateSynopsis: vi.fn().mockResolvedValue({}) })
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    expect(screen.queryByTestId('story-setup')).toBeNull()
  })
})

describe('StoryView 재마운트 격리 (App key={storyProjectPath} 근거)', () => {
  // App.jsx가 StoryView에 key={storyProjectPath}를 주는 이유: 프로젝트 전환 시 재마운트해
  // scriptPhase/폼 로컬 state를 새 프로젝트의 pipeline 값 기준으로 초기화한다. rerender(같은
  // 인스턴스)로는 리셋 안 되지만, key 변경은 새 인스턴스 마운트 = 아래처럼 각각 독립 계산이다.
  it('대본 있는 프로젝트(editor)와 빈 프로젝트(setup+기본폼)를 각각 독립 마운트하면 phase/폼이 섞이지 않는다', () => {
    // 프로젝트 A: 대본 + 제목/장르 채워짐 → editor
    const A = pipeline({ scriptText: 'A의 대본' })
    A.state.input = { type: 'title', title: 'A 제목', options: { genre: 'yadam' } }
    const { unmount } = render(<StoryView pipeline={A} />)
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
    unmount()
    // 프로젝트 B(빈): key 변경으로 새 인스턴스 마운트 → setup + 기본 폼(A 제목/장르 누수 없음)
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    expect(screen.queryByTestId('story-editor')).toBeNull()
    expect(screen.getByPlaceholderText('제목')).toHaveValue('')
    expect(screen.getByLabelText('장르')).toHaveValue('bespoke')
  })
})

describe('StoryView scriptText 단일 상태 (Task 7)', () => {
  it('editor의 PromptInput은 pipeline.scriptText를 초기값으로 렌더한다', () => {
    const text = '복원된 대본'
    render(<StoryView pipeline={pipeline({ scriptText: text })} />)
    expect(screen.getByTestId('prompt-textarea-wrap')).toBeInTheDocument()
    expect(screen.getByTestId('char-count')).toHaveTextContent(String(text.length))
  })

  it('pipeline.scriptText 변경(생성 완료 커밋/재오픈 지연 도착) 시 편집 상태가 동기화된다', () => {
    const { rerender } = render(<StoryView pipeline={pipeline({ scriptText: '초안' })} />)
    const committed = '저장된 최종 대본'
    rerender(<StoryView pipeline={pipeline({ scriptText: committed })} />)
    expect(screen.getByTestId('char-count')).toHaveTextContent(String(committed.length))
  })

  it('setup의 붙여넣기 텍스트도 scriptText 하나로 — 붙여넣고 시작하면 그 값이 pastedScript로 간다', async () => {
    const p = pipeline({ start: vi.fn().mockResolvedValue({}), generateSynopsis: vi.fn().mockResolvedValue({}) })
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/붙여넣/), { target: { value: '내가 쓴 대본' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(p.start).toHaveBeenCalledWith('script', expect.objectContaining({ pastedScript: '내가 쓴 대본' }))
    // 붙여넣기로 시작 → 등장인물 역추출 게이트(synopsis phase, §v2.8 B1)
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
  })
})

describe('StoryView 폼 hydrate (Task 7)', () => {
  const input = {
    type: 'title',
    title: '복원 제목',
    options: { genre: 'yadam', model: 'claude-sonnet-5', language: 'en', lengthValue: '7', lengthUnit: 'words' },
  }

  it('재오픈 시 state.input.title/options로 폼을 초기화한다', () => {
    const p = pipeline()
    p.state.input = input
    render(<StoryView pipeline={p} />)
    expect(screen.getByPlaceholderText('제목')).toHaveValue('복원 제목')
    expect(screen.getByLabelText('장르')).toHaveValue('yadam')
    expect(screen.getByLabelText('모델')).toHaveValue('claude:claude-sonnet-5')
    expect(screen.getByLabelText('언어')).toHaveValue('en')
    expect(screen.getByLabelText('대본 분량 값')).toHaveValue('1050')
    expect(screen.getByLabelText('대본 분량 단위')).toHaveValue('words')
  })

  it.each([
    ['words', '1', '150'],
    ['words', '7', '1050'],
    ['words', '10', '1500'],
    ['words', '60', '9000'],
    ['chars', '1', '330'],
    ['chars', '7', '2310'],
    ['chars', '10', '3300'],
    ['chars', '60', '19800'],
    ['words', '1500', '1500'],
    ['chars', '3300', '3300'],
  ])('legacy %s:%s hydrate → %s', (unit, value, expected) => {
    const p = pipeline()
    p.state.input = {
      type: 'title',
      title: '복원 제목',
      options: { language: unit === 'words' ? 'en' : 'ko', lengthValue: value, lengthUnit: unit },
    }
    render(<StoryView pipeline={p} />)
    expect(screen.getByLabelText('대본 분량 값')).toHaveValue(expected)
    expect(screen.getByLabelText('대본 분량 단위')).toHaveValue(unit)
  })

  it.each(['0', '-2', '', 'abc'])('legacy min:%s hydrate → 10분', (value) => {
    const p = pipeline()
    p.state.input = {
      type: 'title',
      title: '복원 제목',
      options: { language: 'ko', lengthValue: value, lengthUnit: 'min' },
    }
    render(<StoryView pipeline={p} />)
    expect(screen.getByLabelText('대본 분량 값')).toHaveValue('10')
    expect(screen.getByLabelText('대본 분량 단위')).toHaveValue('min')
  })

  it('새 UI가 저장한 1..60 words 값은 legacy minute-shaped 값으로 오인하지 않는다', () => {
    const p = pipeline()
    p.state.input = {
      type: 'title',
      title: '복원 제목',
      options: { language: 'en', lengthValue: '30', lengthUnit: 'words', lengthMode: 'unit' },
    }
    render(<StoryView pipeline={p} />)
    expect(screen.getByLabelText('대본 분량 값')).toHaveValue('30')
    expect(screen.getByLabelText('대본 분량 단위')).toHaveValue('words')
  })

  it('open 응답이 늦게 와도(state.input이 마운트 후 도착) 폼이 hydrate된다', () => {
    const { rerender } = render(<StoryView pipeline={pipeline({ state: null })} />)
    const p = pipeline()
    p.state.input = input
    rerender(<StoryView pipeline={p} />)
    expect(screen.getByPlaceholderText('제목')).toHaveValue('복원 제목')
    expect(screen.getByLabelText('모델')).toHaveValue('claude:claude-sonnet-5')
  })

  it('state.input이 없으면 기존 기본값(bespoke/opus/ko/10/min)을 유지한다', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByPlaceholderText('제목')).toHaveValue('')
    expect(screen.getByLabelText('장르')).toHaveValue('bespoke')
    expect(screen.getByLabelText('모델')).toHaveValue('claude:claude-opus-4-8')
    expect(screen.getByLabelText('언어')).toHaveValue('ko')
    expect(screen.getByLabelText('대본 분량 값')).toHaveValue('10')
    expect(screen.getByLabelText('대본 분량 단위')).toHaveValue('min')
  })
})
