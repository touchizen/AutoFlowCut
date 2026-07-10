/**
 * 검수 채점 배지 — 텍스트창 하단에 몰입감 점수. 라운드가 여럿이면 첫→마지막 변화를 보여준다.
 * 시놉시스 / 시나리오 두 곳.
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

describe('시나리오 검수 점수', () => {
  it('여러 라운드면 첫→마지막 변화를 보여준다', () => {
    render(<StoryView pipeline={pipeline({ reviewScores: { target: 'script', scores: [72, 85] } })} />)
    expect(scoreText()).toBe('몰입감72→85')
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

  it('다른 타겟(씬)의 점수는 시나리오에 뜨지 않는다', () => {
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

  it('시나리오 타겟 점수는 시놉시스 패널에 뜨지 않는다', async () => {
    await enterSynopsis({ reviewScores: { target: 'script', scores: [72] } })
    expect(screen.queryByTestId('review-score')).toBeNull()
  })
})
