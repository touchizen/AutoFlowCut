import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ProjectWorkflowPanel from '../../src/components/ProjectWorkflowPanel.jsx'

describe('ProjectWorkflowPanel', () => {
  it('workflowType을 복원 중이면 story 화면 대신 로딩 상태를 렌더한다', () => {
    render(
      <ProjectWorkflowPanel
        workflowType={undefined}
        shoppingProjectPath={null}
        shoppingPipeline={{}}
        storyContent={<div data-testid="story-view">StoryView</div>}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('프로젝트 유형을 확인하고 있습니다')
    expect(screen.queryByTestId('story-view')).toBeNull()
    expect(screen.queryByLabelText('상품 URL')).toBeNull()
  })

  it('shopping-short이면 ShoppingPanel을 렌더하고 StoryView는 렌더하지 않는다', () => {
    render(
      <ProjectWorkflowPanel
        workflowType="shopping-short"
        shoppingProjectPath="/work/shopping"
        shoppingPipeline={{
          state: { state: 'empty', snapshot: null },
          submitting: false,
          error: null,
          openError: null,
          submitProduct: vi.fn(),
        }}
        storyContent={<div data-testid="story-view">StoryView</div>}
      />,
    )

    expect(screen.getByLabelText('상품 URL')).toBeTruthy()
    expect(screen.queryByTestId('story-view')).toBeNull()
  })

  it('story이면 기존 StoryView를 렌더하고 ShoppingPanel은 렌더하지 않는다', () => {
    render(
      <ProjectWorkflowPanel
        workflowType="story"
        shoppingProjectPath={null}
        shoppingPipeline={{}}
        storyContent={<div data-testid="story-view">StoryView</div>}
      />,
    )

    expect(screen.getByTestId('story-view')).toBeTruthy()
    expect(screen.queryByLabelText('상품 URL')).toBeNull()
  })
})
