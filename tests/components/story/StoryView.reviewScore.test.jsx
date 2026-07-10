/**
 * 검수 채점 배지 — 텍스트창 하단에 몰입감 점수. 라운드가 여럿이면 첫→마지막 변화를 보여준다.
 * 시놉시스 / 대본 두 곳.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

afterEach(() => { localStorage.removeItem('autoflowcut_lang') })

const STEP = (over = {}) => ({ script: { status: 'done' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' }, ...over })

// 배지는 span으로 쪼개져 있어 textContent에 공백이 없다 — 공백 무시하고 비교한다.
const scoreText = () => screen.getByTestId('review-score').textContent.replace(/\s+/g, '')

const pipeline = (over = {}) => ({
  state: { steps: STEP(), speakers: [] },
  scenes: [], streamingText: '', scriptText: '# 본문', start: vi.fn(), abort: vi.fn(), openError: null,
  progressLog: [], reviewProgress: null, reviewScores: null,
  ...over,
})

describe('대본 검수 점수', () => {
  it('여러 라운드면 첫→마지막 변화를 보여준다', () => {
    render(<StoryView pipeline={pipeline({ reviewScores: { target: 'script', scores: [72, 85] } })} />)
    expect(scoreText()).toBe('몰입감72→85')
  })

  // 별도 줄을 만들지 않고 편집기 하단 카운트 행(줄 수·자 수)에 얹는다.
  it('점수는 편집기 하단 카운트 행 안에 있다', () => {
    render(<StoryView pipeline={pipeline({ reviewScores: { target: 'script', scores: [72, 85] } })} />)
    expect(screen.getByTestId('review-score').closest('.prompt-input-footer')).not.toBeNull()
  })

  it('한 라운드면 점수 하나만 보여준다', () => {
    render(<StoryView pipeline={pipeline({ reviewScores: { target: 'script', scores: [91] } })} />)
    expect(scoreText()).toBe('몰입감91')
  })

  it('점수가 그대로면 화살표 없이 하나만 보여준다', () => {
    render(<StoryView pipeline={pipeline({ reviewScores: { target: 'script', scores: [80, 80] } })} />)
    expect(scoreText()).toBe('몰입감80')
  })

  it('점수가 없으면 배지가 없다', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.queryByTestId('review-score')).toBeNull()
  })

  it('다른 타겟(씬)의 점수는 대본에 뜨지 않는다', () => {
    render(<StoryView pipeline={pipeline({ reviewScores: { target: 'scenes', scores: [70] } })} />)
    expect(screen.queryByTestId('review-score')).toBeNull()
  })
})

describe('시놉시스 검수 점수', () => {
  const enterSynopsis = async (over = {}) => {
    const p = pipeline({
      state: { steps: STEP({ script: { status: 'pending' } }), speakers: [] },
      scriptText: '',
      generateSynopsis: vi.fn().mockResolvedValue({ synopsisMd: '줄거리', characters: [] }),
      reviewSynopsis: vi.fn(),
      ...over,
    })
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
  }

  it('시놉시스 패널 하단에 변화를 보여준다', async () => {
    await enterSynopsis({ reviewScores: { target: 'synopsis', scores: [60, 88] } })
    expect(scoreText()).toBe('몰입감60→88')
  })

  // 시놉시스도 대본과 같은 편집기 — 라인번호 gutter + 하단 줄 수·자 수 행, 점수도 그 행에.
  it('점수는 대본와 같은 카운트 행 안에 있다', async () => {
    await enterSynopsis({ reviewScores: { target: 'synopsis', scores: [60, 88] } })
    expect(screen.getByTestId('review-score').closest('.prompt-input-footer')).not.toBeNull()
  })

  it('시놉시스 편집기도 줄 수·자 수를 보여준다', async () => {
    await enterSynopsis()
    const footer = screen.getByTestId('story-synopsis').querySelector('.prompt-input-footer')
    expect(footer).not.toBeNull()
    expect(footer.querySelector('.line-count')).not.toBeNull()
    expect(footer.querySelector('[data-testid="char-count"]')).not.toBeNull()
  })

  it('대본 타겟 점수는 시놉시스 패널에 뜨지 않는다', async () => {
    await enterSynopsis({ reviewScores: { target: 'script', scores: [72] } })
    expect(screen.queryByTestId('review-score')).toBeNull()
  })
})
