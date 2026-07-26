/**
 * 설정 탭(0번) — 설정을 스텝퍼 독립 탭으로 분리. 대본 탭의 '설정으로' 버튼은 제거.
 * 설정 탭 클릭 → 설정 폼, 대본 탭 클릭 → 편집기.
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

const pillOf = (label) => screen.getByText(label).closest('.story-gate-tab, .story-rail-step')

describe('StoryView 설정 탭', () => {
  it('fresh(대본 없음) 상태에서 설정 pill이 active + 설정 폼 표시', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    expect(pillOf('설정').classList.contains('active')).toBe(true)
  })

  it('대본(editor)에서 설정 탭 클릭 → 설정 폼으로 이동', () => {
    render(<StoryView pipeline={pipeline({ scriptText: '복원된 대본' })} />)
    // 초기 editor
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
    // 설정 탭 클릭
    fireEvent.click(pillOf('설정'))
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    expect(screen.queryByTestId('story-editor')).toBeNull()
    expect(pillOf('설정').classList.contains('active')).toBe(true)
  })

  it('설정에서 대본 탭 클릭 → 편집기로 이동', () => {
    render(<StoryView pipeline={pipeline({ scriptText: '복원된 대본' })} />)
    fireEvent.click(pillOf('설정'))
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    fireEvent.click(pillOf('대본'))
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
  })

  it("대본 편집기에 '설정으로' 버튼이 없다(설정 탭으로 대체)", () => {
    render(<StoryView pipeline={pipeline({ scriptText: '복원된 대본' })} />)
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /설정으로/ })).toBeNull()
  })
})
