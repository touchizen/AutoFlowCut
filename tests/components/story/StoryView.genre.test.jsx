import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

// 슬라이스5(§v2.8 B1): 제목 경로 [시작]은 synopsis 게이트(generateSynopsis)로 진입한다.
function makePipeline(generateSynopsis) {
  return { state: { steps: {} }, streamingText: '', start: vi.fn(), generateSynopsis, abort: () => {}, scenes: [], openError: null }
}

describe('StoryView 장르 드롭다운', () => {
  it('장르 select에서 고른 값이 options.genre로 전달된다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByLabelText('장르'), { target: { value: 'dark-history' } })
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ genre: 'dark-history' }),
    }))
  })
})
