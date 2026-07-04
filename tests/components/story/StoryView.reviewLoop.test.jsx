/**
 * M3: 대본 자동 검토·수정 토글(setup 폼) + 진행 배지(reviewProgress).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

const pipeline = (over = {}) => ({
  state: {
    steps: { script: { status: 'pending' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } },
  },
  scenes: [], streamingText: '', scriptText: '', start: vi.fn(), abort: vi.fn(), openError: null,
  ...over,
})

describe('StoryView 대본 검토 토글 (M3)', () => {
  it('setup 폼에 검토 토글이 있고 기본 off', () => {
    render(<StoryView pipeline={pipeline()} />)
    const cb = screen.getByRole('checkbox', { name: /검토/ })
    expect(cb).toBeInTheDocument()
    expect(cb.checked).toBe(false)
  })

  it('토글 켜고 시작하면 options.reviewLoop=true로 script start', () => {
    const start = vi.fn()
    render(<StoryView pipeline={pipeline({ start })} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /검토/ }))
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ reviewLoop: true }),
    }))
  })

  it('토글 off(기본)면 options.reviewLoop=false', () => {
    const start = vi.fn()
    render(<StoryView pipeline={pipeline({ start })} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ reviewLoop: false }),
    }))
  })

  it('hydrate: state.input.options.reviewLoop=true면 토글 켜짐', () => {
    const p = pipeline()
    p.state.input = { type: 'title', title: 'T', options: { reviewLoop: true } }
    render(<StoryView pipeline={p} />)
    expect(screen.getByRole('checkbox', { name: /검토/ }).checked).toBe(true)
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
