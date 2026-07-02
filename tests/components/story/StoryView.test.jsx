import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

const pipeline = (over = {}) => ({
  state: {
    steps: {
      script: { status: 'pending' }, scenes: { status: 'pending' },
      audio: { status: 'pending' }, prompts: { status: 'pending' },
    },
    speakers: [],
  },
  streamingText: '',
  start: vi.fn(), abort: vi.fn(),
  ...over,
})

describe('StoryView', () => {
  it('스텝퍼에 4단계와 상태 뱃지를 렌더한다', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByText(/대본/)).toBeTruthy()
    expect(screen.getByText(/씬 분리/)).toBeTruthy()
    expect(screen.getByText(/오디오/)).toBeTruthy()
    expect(screen.getByText(/프롬프트/)).toBeTruthy()
  })
  it('제목 입력 후 시작하면 start("script")가 호출된다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/제목/), { target: { value: '운수 좋은 날' } })
    fireEvent.click(screen.getByRole('button', { name: /대본 생성/ }))
    expect(p.start).toHaveBeenCalledWith('script', expect.objectContaining({
      input: expect.objectContaining({ title: '운수 좋은 날' }),
    }))
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
  it('에러 단계는 error 뱃지 + 재실행 버튼', () => {
    const p = pipeline()
    p.state.steps.script.status = 'error'
    p.state.steps.script.error = '429'
    render(<StoryView pipeline={p} />)
    expect(screen.getByText(/429/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /재실행/ })).toBeTruthy()
  })
})
