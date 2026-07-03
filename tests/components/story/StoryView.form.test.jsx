import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

function makePipeline(start) {
  return { state: { steps: {} }, streamingText: '', start, abort: () => {}, scenes: [], openError: null }
}

describe('StoryView 폼 재구성', () => {
  it('모델 드롭다운 선택이 options.model로 전달된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('모델'), { target: { value: 'claude-sonnet-5' } })
    fireEvent.click(screen.getByRole('button', { name: '대본 생성' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ model: 'claude-sonnet-5' }),
    }))
  })
  it('길이 값+단위가 options.lengthValue/lengthUnit으로 전달된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('길이 값'), { target: { value: '6000' } })
    fireEvent.change(screen.getByLabelText('길이 단위'), { target: { value: 'chars' } })
    fireEvent.click(screen.getByRole('button', { name: '대본 생성' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ lengthValue: '6000', lengthUnit: 'chars' }),
    }))
  })
  it('기본 모델은 claude-opus-4-8, 기본 길이 10 min', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '대본 생성' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ model: 'claude-opus-4-8', lengthValue: '10', lengthUnit: 'min' }),
    }))
  })

  it('언어를 en으로 바꾸면 chars 단위가 words로 정규화된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('길이 단위'), { target: { value: 'chars' } })
    fireEvent.change(screen.getByPlaceholderText('언어'), { target: { value: 'en' } })
    fireEvent.click(screen.getByRole('button', { name: '대본 생성' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ lengthUnit: 'words' }),
    }))
  })

  it('언어를 ko로 바꾸면 words 단위가 chars로 정규화된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByPlaceholderText('언어'), { target: { value: 'en' } })
    fireEvent.change(screen.getByLabelText('길이 단위'), { target: { value: 'words' } })
    fireEvent.change(screen.getByPlaceholderText('언어'), { target: { value: 'ko' } })
    fireEvent.click(screen.getByRole('button', { name: '대본 생성' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ lengthUnit: 'chars' }),
    }))
  })

  it('min 단위는 언어를 바꿔도 유지된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.change(screen.getByPlaceholderText('언어'), { target: { value: 'en' } })
    fireEvent.click(screen.getByRole('button', { name: '대본 생성' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ lengthUnit: 'min' }),
    }))
  })
})
