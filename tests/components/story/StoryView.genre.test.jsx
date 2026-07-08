import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

// 슬라이스5(§v2.8 B1): 제목 경로 [시작]은 synopsis 게이트(generateSynopsis)로 진입한다.
function makePipeline(generateSynopsis) {
  return { state: { steps: {} }, streamingText: '', start: vi.fn(), generateSynopsis, abort: () => {}, scenes: [], openError: null }
}

describe('StoryView 장르 드롭다운 (언어별 옵션)', () => {
  it('ko: 야담·맞춤형만 노출(dark-history 없음), 고른 값이 options.genre로 전달', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    // 기본 언어 ko → 야담·맞춤형만
    expect(screen.getByRole('option', { name: '야담' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '맞춤형' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '다크 히스토리' })).toBeNull()
    fireEvent.change(screen.getByLabelText('장르'), { target: { value: 'yadam' } })
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ genre: 'yadam' }),
    }))
  })

  it('en: Dark History·Bespoke 노출(yadam 없음)', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    expect(screen.getByRole('option', { name: '다크 히스토리' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '야담' })).toBeNull()
    fireEvent.change(screen.getByLabelText('장르'), { target: { value: 'dark-history' } })
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ genre: 'dark-history' }),
    }))
  })

  it('언어를 ko→en으로 바꾸면 야담이 무효라 bespoke로 리셋된다', () => {
    const gen = vi.fn().mockResolvedValue({})
    render(<StoryView pipeline={makePipeline(gen)} />)
    fireEvent.change(screen.getByLabelText('장르'), { target: { value: 'yadam' } })
    fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'en' } })
    expect(screen.getByLabelText('장르')).toHaveValue('bespoke')
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ genre: 'bespoke' }),
    }))
  })
})
