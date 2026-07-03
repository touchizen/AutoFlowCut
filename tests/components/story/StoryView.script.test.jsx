import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

function pipelineWith(overrides) {
  return { state: { steps: {} }, streamingText: '', start: () => {}, abort: () => {}, scenes: [], openError: null, ...overrides }
}

describe('StoryView 대본 영역', () => {
  it('생성 중이 아니면 대본 편집을 PromptInput으로 렌더한다', () => {
    // Task 7: 대본 편집기는 editor phase에서 렌더 — scriptText가 있으면 editor로 진입한다.
    render(<StoryView pipeline={pipelineWith({ scriptText: '대본 본문' })} />)
    // PromptInput은 data-testid="prompt-textarea-wrap"를 렌더
    expect(screen.getByTestId('prompt-textarea-wrap')).toBeInTheDocument()
  })
  it('생성 중이면 스트리밍 div를 렌더한다(PromptInput 아님)', () => {
    const pipeline = pipelineWith({ state: { steps: { script: { status: 'running' } } }, streamingText: '생성중' })
    const { container } = render(<StoryView pipeline={pipeline} />)
    expect(container.querySelector('.story-script-stream')).toBeInTheDocument()
    expect(screen.queryByTestId('prompt-textarea-wrap')).toBeNull()
  })
})
