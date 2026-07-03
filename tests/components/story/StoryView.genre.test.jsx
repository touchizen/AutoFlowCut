import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

function makePipeline(start) {
  return { state: { steps: {} }, streamingText: '', start, abort: () => {}, scenes: [], openError: null }
}

describe('StoryView 장르 드롭다운', () => {
  it('장르 select에서 고른 값이 start options.genre로 전달된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByLabelText('장르'), { target: { value: 'dark-history' } })
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ genre: 'dark-history' }),
    }))
  })
})
