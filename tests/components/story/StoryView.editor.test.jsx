/**
 * Task 9 — 대본 작업 화면(editor): 버튼 상태 + 제목 자동생성 + 이어쓰기 + 분리시작 +
 * 재오픈 phase 승격 (스펙 §1.B/§2/§3/§4/§5).
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
  scriptText: '대본 본문',
  start: vi.fn(), abort: vi.fn(), openError: null,
  generateTitle: vi.fn().mockResolvedValue({ title: '자동 제목' }),
  ...over,
})

// 폼 미변경 시 editor 핸들러가 실어 보내는 "현재 설정" options (스펙 R3-3).
const defaultOptions = {
  genre: 'bespoke', language: 'ko', engine: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'off', lengthValue: '10', lengthUnit: 'min', sceneGranularity: 'scene', sceneMinSec: 5, sceneMaxSec: 10, reviewLoop: false,
}

describe('StoryView editor 버튼 상태 (§1.B)', () => {
  it('대기 상태: [다시쓰기][이어쓰기][분리시작] 3버튼(설정으로는 0번 설정 탭으로 대체), 중단 없음', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByRole('button', { name: '다시쓰기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이어쓰기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '분리시작' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /설정으로/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /중단/ })).toBeNull()
  })

  it('생성 중(isRunning): [중단]만 — 클릭 시 abort 호출', () => {
    const p = pipeline({ streamingText: '생성중...' })
    p.state.steps.script.status = 'running'
    render(<StoryView pipeline={p} />)
    expect(screen.queryByRole('button', { name: '다시쓰기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '이어쓰기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '분리시작' })).toBeNull()
    const abortBtns = screen.getAllByRole('button', { name: /중단/ })
    expect(abortBtns).toHaveLength(1)
    fireEvent.click(abortBtns[0])
    expect(p.abort).toHaveBeenCalled()
  })

  it('scriptText가 공백뿐이면 [다시쓰기][이어쓰기][분리시작] 비활성 (R4-1)', () => {
    // 빈 대본 상태의 editor — 빈 대본 가드. (슬라이스5: 제목 [시작]은 synopsis 게이트로 가므로
    // 스텝퍼의 대본 탭으로 editor에 직접 진입해 검증한다.)
    const p = pipeline({ scriptText: '' })
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시쓰기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '이어쓰기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '분리시작' })).toBeDisabled()
  })

  it('0번 설정 탭 클릭 → setup 화면으로, scriptText는 유지된다', () => {
    render(<StoryView pipeline={pipeline()} />)
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    // setup의 붙여넣기 textarea에 기존 대본 유지
    expect(screen.getByPlaceholderText(/붙여넣/)).toHaveValue('대본 본문')
  })

  it('editor의 PromptInput은 hideTip — 💡 tip이 없다', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByTestId('prompt-textarea-wrap')).toBeInTheDocument()
    expect(screen.queryByText(/💡/)).toBeNull()
  })
})

describe('StoryView 다시쓰기 (§2/§3/§5)', () => {
  it('제목이 있으면 generateTitle 없이 그 제목으로 start("script", {input,options})', async () => {
    const p = pipeline()
    p.state.input = { type: 'title', title: '기존 제목' }
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '다시쓰기' }))
    await waitFor(() => expect(p.start).toHaveBeenCalledWith('script', {
      input: { type: 'title', title: '기존 제목' },
      options: defaultOptions,
    }))
    expect(p.generateTitle).not.toHaveBeenCalled()
  })

  it('제목이 비면 generateTitle(scriptText, currentOptions) 먼저 → 반환 title(로컬 변수)로 start', async () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '다시쓰기' }))
    await waitFor(() => expect(p.start).toHaveBeenCalledWith('script', {
      input: { type: 'title', title: '자동 제목' },
      options: defaultOptions,
    }))
    expect(p.generateTitle).toHaveBeenCalledWith('대본 본문', defaultOptions)
    // 제목 state에도 반영 — 0번 설정 탭에서 확인
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(screen.getByPlaceholderText('제목')).toHaveValue('자동 제목')
  })

  it('generateTitle 실패 시 start를 부르지 않는다(진행 중단)', async () => {
    const p = pipeline({ generateTitle: vi.fn().mockRejectedValue(new Error('boom')) })
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '다시쓰기' }))
    await waitFor(() => expect(p.generateTitle).toHaveBeenCalled())
    expect(p.start).not.toHaveBeenCalled()
  })
})

describe('StoryView 이어쓰기 (§4)', () => {
  it('클릭 시 baseScript 스냅샷으로 start("script", {continue, options}) — generateTitle 안 부름', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '이어쓰기' }))
    expect(p.generateTitle).not.toHaveBeenCalled()
    expect(p.start).toHaveBeenCalledWith('script', { continue: '대본 본문', options: defaultOptions })
  })

  it('이어쓰기 스트리밍 중에는 baseScript + streamingText를 preview로 표시한다', () => {
    const p = pipeline()
    const { container, rerender } = render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '이어쓰기' }))
    // main이 running + delta를 보내오는 상태로 갱신
    const running = pipeline({ streamingText: ' 이어진 델타', start: p.start, abort: p.abort, generateTitle: p.generateTitle })
    running.state.steps.script.status = 'running'
    rerender(<StoryView pipeline={running} />)
    const stream = container.querySelector('.story-script-stream')
    expect(stream).toBeInTheDocument()
    expect(stream.textContent).toBe('대본 본문 이어진 델타')
  })

  it('다시쓰기 스트리밍은 baseScript 접두 없이 streamingText만 표시한다', async () => {
    const p = pipeline()
    p.state.input = { type: 'title', title: '기존 제목' }
    const { container, rerender } = render(<StoryView pipeline={p} />)
    // 먼저 이어쓰기로 baseScript가 남았다가
    fireEvent.click(screen.getByRole('button', { name: '이어쓰기' }))
    // 다시쓰기를 누르면 접두가 초기화돼야 한다
    fireEvent.click(screen.getByRole('button', { name: '다시쓰기' }))
    await waitFor(() => expect(p.start).toHaveBeenCalledTimes(2))
    const running = pipeline({ streamingText: '새 대본', start: p.start, abort: p.abort, generateTitle: p.generateTitle })
    running.state.input = { type: 'title', title: '기존 제목' }
    running.state.steps.script.status = 'running'
    rerender(<StoryView pipeline={running} />)
    expect(container.querySelector('.story-script-stream').textContent).toBe('새 대본')
  })
})

describe('StoryView 분리시작 (§2/§0.4)', () => {
  it('대본 탭에서 분리시작하면 start가 pending이어도 즉시 scenes 패널로 전환한다', async () => {
    let resolveStart
    const pendingStart = new Promise((resolve) => { resolveStart = resolve })
    const p = pipeline({
      start: vi.fn(() => pendingStart),
      scenes: [{ storyId: 's1', segments: [{ speaker: '나레이션', text: '어느 날' }] }],
    })
    p.state.input = { type: 'title', title: '기존 제목' }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)

    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '분리시작' }))

    await waitFor(() => expect(p.start).toHaveBeenCalledWith('scenes', {
      scriptOverride: '대본 본문', options: defaultOptions, title: '기존 제목',
    }))
    expect(resolveStart).toBeTypeOf('function')
    expect(screen.queryByTestId('story-editor')).toBeNull()
    expect(screen.getByText('화자')).toBeTruthy()
  })

  it('start가 실패해도 scenes 패널에 남아 분리를 다시 실행할 수 있다', async () => {
    const p = pipeline({
      start: vi.fn().mockRejectedValue(new Error('boom')),
      scenes: [{ storyId: 's1', segments: [{ speaker: '나레이션', text: '어느 날' }] }],
    })
    p.state.input = { type: 'title', title: '기존 제목' }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)

    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    fireEvent.click(screen.getByRole('button', { name: '분리시작' }))

    await waitFor(() => expect(p.start).toHaveBeenCalled())
    expect(screen.queryByTestId('story-editor')).toBeNull()
    expect(screen.getByText('화자')).toBeTruthy()
    expect(screen.getByRole('button', { name: '씬 분리 실행' })).toBeEnabled()
  })

  // 위 테스트는 최초 분리(scenes=pending)라 currentStep 이 이미 'scenes' 다 — viewedStep 이 뭐든
  // scenes 패널이 나온다. 즉 catch 가 viewedStep='scenes' 를 **유지**하는지는 안 고정된다.
  // 그게 중요한 건 **재분리**다: scenes/audio 가 done 이면 currentStep 이 그 뒤라, 실패 후
  // viewedStep 을 놓으면 사용자가 엉뚱한 패널로 튕긴다. 'scenes' 를 고른 이유가 바로 이거다.
  it('재분리에서 start가 실패하면 뒤 패널로 튕기지 않고 scenes 에 남는다', async () => {
    const p = pipeline({
      start: vi.fn().mockRejectedValue(new Error('boom')),
      scenes: [{ storyId: 's1', segments: [{ speaker: '나레이션', text: '어느 날' }] }],
    })
    p.state.input = { type: 'title', title: '기존 제목' }
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.steps.audio.status = 'done' // currentStep 은 prompts — viewedStep 을 놓으면 그리로 튄다
    render(<StoryView pipeline={p} />)

    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    fireEvent.click(screen.getByRole('button', { name: '분리시작' }))

    await waitFor(() => expect(p.start).toHaveBeenCalled())
    expect(screen.queryByTestId('story-editor')).toBeNull()
    expect(screen.getByText('화자'), 'scenes 패널에 남아야 한다').toBeTruthy()
  })

  it('제목이 있으면 generateTitle 없이 start("scenes", {scriptOverride, options}) + editor 해제', async () => {
    const p = pipeline({
      scenes: [{ storyId: 's1', segments: [{ speaker: '나레이션', text: '어느 날' }] }],
    })
    p.state.input = { type: 'title', title: '기존 제목' }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '분리시작' }))
    await waitFor(() =>
      expect(p.start).toHaveBeenCalledWith('scenes', { scriptOverride: '대본 본문', options: defaultOptions, title: '기존 제목' }))
    expect(p.generateTitle).not.toHaveBeenCalled()
    // scriptPhase 해제 → scenes 패널로 진행
    expect(screen.queryByTestId('story-editor')).toBeNull()
    expect(screen.getByText('화자')).toBeTruthy()
  })

  it('제목이 비어도 generateTitle 없이 즉시 start("scenes") (제목은 미전달)', async () => {
    const p = pipeline()
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '분리시작' }))
    await waitFor(() => expect(p.start).toHaveBeenCalledWith('scenes', {
      scriptOverride: '대본 본문', options: defaultOptions, title: undefined,
    }))
    // C: 씬분리는 제목 자동생성(LLM)을 타지 않는다 — 임포트 경로에서 전환이 제목 생성 대기에
    //   막히던 원인을 제거. 제목은 선택 메타데이터라 비어 있으면 넘기지 않는다.
    expect(p.generateTitle).not.toHaveBeenCalled()
  })

  it('제목이 비고 generateTitle이 실패할 상황이어도 분리는 막히지 않는다(제목 생성 시도 안 함)', async () => {
    const p = pipeline({ generateTitle: vi.fn().mockRejectedValue(new Error('boom')) })
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '분리시작' }))
    await waitFor(() => expect(p.start).toHaveBeenCalledWith('scenes', expect.objectContaining({ scriptOverride: '대본 본문' })))
    // 제목 생성을 아예 시도하지 않으므로 그 실패가 분리를 막지 못한다.
    expect(p.generateTitle).not.toHaveBeenCalled()
  })
})

describe('StoryView 재오픈 phase 승격 (Task 7 인계)', () => {
  it('open 응답이 늦게 도착해 pipeline.scriptText가 채워지면 setup → editor로 승격한다', () => {
    const { rerender } = render(<StoryView pipeline={pipeline({ scriptText: '' })} />)
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    rerender(<StoryView pipeline={pipeline({ scriptText: '늦게 복원된 대본' })} />)
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('story-setup')).toBeNull()
  })

  it('사용자가 0번 설정 탭으로 명시적으로 setup에 온 경우에는 승격하지 않는다', () => {
    const { rerender } = render(<StoryView pipeline={pipeline({ scriptText: '대본 v1' })} />)
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    // 뒤늦은 커밋으로 pipeline.scriptText가 바뀌어도 setup 유지
    rerender(<StoryView pipeline={pipeline({ scriptText: '대본 v2' })} />)
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    expect(screen.queryByTestId('story-editor')).toBeNull()
  })
})
