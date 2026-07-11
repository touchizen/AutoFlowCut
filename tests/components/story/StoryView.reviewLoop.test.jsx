/**
 * M3: 대본 자동 검토·수정 토글(setup 폼) + 진행 배지(reviewProgress).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'
import { I18nProvider } from '../../../src/hooks/useI18n.jsx'

afterEach(() => {
  localStorage.removeItem('autoflowcut_lang')
})

const pipeline = (over = {}) => ({
  state: {
    steps: { script: { status: 'pending' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } },
  },
  scenes: [], streamingText: '', scriptText: '', start: vi.fn(), abort: vi.fn(), openError: null,
  ...over,
})

describe('StoryView 대본 검토 토글 (M3)', () => {
  it('setup 폼에 단계별 검수 토글과 횟수 입력이 있고 기본 off', () => {
    render(<StoryView pipeline={pipeline()} />)
    for (const label of ['대본', '씬', '프롬프트']) {
      const cb = screen.getByRole('checkbox', { name: `${label} 자동 검수` })
      expect(cb).toBeInTheDocument()
      expect(cb.checked).toBe(false)
      expect(screen.getByRole('spinbutton', { name: `${label} 검수 횟수` })).toBeInTheDocument()
    }
  })

  // 슬라이스5(§v2.8 B1): 제목 경로 [시작]은 이제 synopsis 게이트(generateSynopsis)로 진입한다 —
  // options 플럼빙 검증도 generateSynopsis 페이로드로 이동.
  it('검수 컨트롤을 수정하면 options.review 객체로 시놉시스 생성 진입', () => {
    const generateSynopsis = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={pipeline({ generateSynopsis })} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '대본 자동 검수' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '대본 검수 횟수' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(generateSynopsis).toHaveBeenCalledWith(expect.objectContaining({
      type: 'title',
      options: expect.objectContaining({
        review: expect.objectContaining({
          script: { enabled: true, rounds: 2 },
        }),
      }),
    }))
    expect(generateSynopsis.mock.calls[0][0].options.reviewLoop).toBeUndefined()
  })

  it('검수 컨트롤을 안 만지면 options.reviewLoop=false를 유지하고 review는 생략', () => {
    const generateSynopsis = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={pipeline({ generateSynopsis })} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(generateSynopsis).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ reviewLoop: false }),
    }))
    expect(generateSynopsis.mock.calls[0][0].options.review).toBeUndefined()
  })

  it('hydrate legacy reviewLoop=true는 사용자가 안 만지면 그대로 보존', () => {
    const generateSynopsis = vi.fn().mockResolvedValue({})
    const p = pipeline({ generateSynopsis })
    p.state.input = { type: 'title', title: 'T', options: { reviewLoop: true } }
    render(<StoryView pipeline={p} />)
    expect(screen.getByRole('checkbox', { name: '대본 자동 검수' }).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(generateSynopsis.mock.calls[0][0].options.reviewLoop).toBe(true)
    expect(generateSynopsis.mock.calls[0][0].options.review).toBeUndefined()
  })

  it('씬 분리 탭에서 수동 검수를 실행하면 reviewOnly와 횟수를 전달', () => {
    const start = vi.fn()
    const p = pipeline({ start, scriptText: '대본', scenes: [{ storyId: 's1', segments: [{ speaker: 'narrator', text: '본문' }] }] })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '씬 검수 횟수' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '씬 검수' }))
    expect(start).toHaveBeenCalledWith('scenes', expect.objectContaining({
      reviewOnly: true,
      review: { scenes: { enabled: true, rounds: 2 } },
    }))
  })

  it('씬 분리 탭의 수동 검수 컨트롤은 대본 탭처럼 하단 버튼 줄에 있다', () => {
    const p = pipeline({ scriptText: '대본', scenes: [{ storyId: 's1', segments: [{ speaker: 'narrator', text: '본문' }] }] })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    const { container } = render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))

    const controls = container.querySelector('.story-controls')
    expect(controls).toBeTruthy()
    expect(within(controls).getByText('자동검수')).toBeInTheDocument()
    expect(within(controls).getByText('검수')).toBeInTheDocument()
    expect(controls.contains(screen.getByRole('button', { name: '씬 검수' }))).toBe(true)
    // 씬분리(done) 탭의 하단 primary는 그 탭 액션(씬 재분리) — 오디오 실행으로 안 샘
    expect(controls.contains(screen.getByRole('button', { name: /씬 재분리/ }))).toBe(true)
  })

  it('대본 탭 수동 검수는 현재 editor 대본을 scriptOverride로 전달', () => {
    const start = vi.fn()
    const p = pipeline({ start, scriptText: '편집 중인 대본' })
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '대본 검수' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      reviewOnly: true,
      scriptOverride: '편집 중인 대본',
    }))
  })

  it('프롬프트 탭에서 수동 검수를 실행하면 reviewOnly와 횟수를 전달', () => {
    const start = vi.fn()
    const p = pipeline({ start, scriptText: '대본', scenes: [{ storyId: 's1', imagePrompt: 'IMG', videoPrompt: 'VID', segments: [] }] })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.steps.audio.status = 'done'
    p.state.steps.prompts.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '프롬프트' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '프롬프트 검수 횟수' }), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '프롬프트 검수' }))
    expect(start).toHaveBeenCalledWith('prompts', expect.objectContaining({
      reviewOnly: true,
      review: { prompts: { enabled: true, rounds: 3 } },
    }))
  })

  it('프롬프트 탭의 수동 검수 컨트롤은 대본 탭처럼 하단 버튼 줄에 있다', () => {
    const p = pipeline({ scriptText: '대본', scenes: [{ storyId: 's1', imagePrompt: 'IMG', videoPrompt: 'VID', segments: [] }] })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.steps.audio.status = 'done'
    p.state.steps.prompts.status = 'done'
    const { container } = render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '프롬프트' }))

    const controls = container.querySelector('.story-controls')
    expect(controls).toBeTruthy()
    expect(within(controls).getByText('자동검수')).toBeInTheDocument()
    expect(within(controls).getByText('검수')).toBeInTheDocument()
    expect(controls.contains(screen.getByRole('button', { name: '프롬프트 검수' }))).toBe(true)
    expect(controls.contains(screen.getByRole('button', { name: '프롬프트 다시 생성' }))).toBe(true)
  })

  it('I18nProvider가 있으면 검수 컨트롤 문구와 접근성 라벨을 locale 문자열로 렌더한다', () => {
    localStorage.setItem('autoflowcut_lang', 'en')
    render(
      <I18nProvider>
        <StoryView pipeline={pipeline()} />
      </I18nProvider>,
    )
    expect(screen.getByRole('checkbox', { name: 'Script auto review' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Script review rounds' })).toBeInTheDocument()
    expect(screen.getByText('Script review')).toBeInTheDocument()
  })

  it('프롬프트 자동 검수 설정 후 프롬프트 다시 생성하면 currentOptions를 전달', () => {
    const start = vi.fn()
    const p = pipeline({ start, scriptText: '대본', scenes: [{ storyId: 's1', imagePrompt: 'IMG', videoPrompt: 'VID', segments: [] }] })
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    p.state.steps.audio.status = 'done'
    p.state.steps.prompts.status = 'done'
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '프롬프트 자동 검수' }))
    fireEvent.click(screen.getByRole('button', { name: '프롬프트' }))
    fireEvent.click(screen.getByRole('button', { name: '프롬프트 다시 생성' }))
    expect(start).toHaveBeenCalledWith('prompts', expect.objectContaining({
      options: expect.objectContaining({
        review: expect.objectContaining({ prompts: expect.objectContaining({ enabled: true }) }),
      }),
    }))
  })
})

describe('StoryView 검토 진행 배지 (M3)', () => {
  const running = (reviewProgress) => {
    const p = pipeline({ streamingText: '초안...', reviewProgress })
    p.state.steps.script.status = 'running'
    return p
  }

  it('reviewing phase → "검토 중 N/M" 배지', () => {
    render(<StoryView pipeline={running({ round: 2, of: 3, phase: 'reviewing' })} />)
    expect(screen.getByText(/검토 중 2\/3/)).toBeInTheDocument()
  })
  it('revising phase → "수정 중 N/M" 배지', () => {
    render(<StoryView pipeline={running({ round: 1, of: 3, phase: 'revising' })} />)
    expect(screen.getByText(/수정 중 1\/3/)).toBeInTheDocument()
  })
  it('error phase → "검토 중단" 배지', () => {
    const p = pipeline({ scriptText: '대본', reviewProgress: { phase: 'error', error: 'boom' } })
    render(<StoryView pipeline={p} />)
    expect(screen.getByText(/검토 중단/)).toBeInTheDocument()
  })
  it('reviewProgress 없으면 배지 없음', () => {
    render(<StoryView pipeline={running(null)} />)
    expect(screen.queryByText(/검토 중|수정 중|검토 중단/)).toBeNull()
  })
})
