/**
 * 시놉시스 게이트 수동 검수 버튼 (spec 2026-07-10).
 * - 수동 전용: 설정 탭 자동검수 타겟은 3개 그대로, 시놉시스 패널엔 자동검수 체크박스 없음.
 * - 검수 중 draft 동결(textarea readOnly + 카드 disabled) → 결과가 사용자 편집을 덮어쓰지 않게.
 * - busy/aborted/undefined 응답은 draft를 건드리지 않는다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

afterEach(() => { localStorage.removeItem('autoflowcut_lang') })

const pipeline = (over = {}) => ({
  state: {
    steps: { script: { status: 'pending' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } },
  },
  scenes: [], streamingText: '', scriptText: '', start: vi.fn(), abort: vi.fn(), openError: null,
  generateSynopsis: vi.fn().mockResolvedValue({ synopsisMd: '원본 줄거리', characters: [{ name: '강리안', gender: 'male' }] }),
  reviewSynopsis: vi.fn().mockResolvedValue({ synopsisMd: '개선된 줄거리', characters: [{ name: '보라', gender: 'female' }], changed: true }),
  synopsisGenerating: false, synopsisReviewing: false, synopsisError: null,
  progressLog: [], reviewProgress: null,
  ...over,
})

// 제목 경로 [시작] → synopsis 게이트 진입.
async function enterSynopsis(p) {
  render(<StoryView pipeline={p} />)
  fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
  fireEvent.click(screen.getByRole('button', { name: '시작' }))
  await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
}

const draft = () => screen.getByRole('textbox', { name: '줄거리' })
const reviewBtn = () => screen.getByRole('button', { name: '시놉시스 검수' })

describe('시놉시스 패널 검수 컨트롤', () => {
  it('[검수] 버튼과 횟수 입력이 있고, 자동검수 체크박스는 없다', async () => {
    await enterSynopsis(pipeline())
    expect(reviewBtn()).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '시놉시스 검수 횟수' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '시놉시스 자동 검수' })).toBeNull()
  })

  it('설정 탭의 자동검수 타겟은 여전히 3개다 (시놉시스 미포함)', () => {
    render(<StoryView pipeline={pipeline()} />)
    for (const label of ['시나리오', '씬', '프롬프트']) {
      expect(screen.getByRole('checkbox', { name: `${label} 자동 검수` })).toBeInTheDocument()
    }
    expect(screen.queryByRole('checkbox', { name: '시놉시스 자동 검수' })).toBeNull()
  })

  it('draft가 비면 [검수]가 disabled', async () => {
    await enterSynopsis(pipeline({ generateSynopsis: vi.fn().mockResolvedValue({ synopsisMd: '', characters: [] }) }))
    expect(reviewBtn()).toBeDisabled()
  })

  it('검수 중이면 [검수]·[시놉시스 다시]·[확정]이 disabled고 draft가 동결된다', async () => {
    await enterSynopsis(pipeline({ synopsisReviewing: true }))
    expect(reviewBtn()).toBeDisabled()
    expect(screen.getByRole('button', { name: '시놉시스 다시' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /시나리오 생성/ })).toBeDisabled()
    expect(draft()).toHaveAttribute('readonly')
  })

  it('검수 중에도 textarea는 보인다 (스트림 뷰로 바뀌지 않는다)', async () => {
    await enterSynopsis(pipeline({ synopsisReviewing: true }))
    expect(draft()).toBeInTheDocument()
  })

  it('검수 중 [⏹ 중단]이 나타나고 abort를 부른다', async () => {
    const abort = vi.fn()
    await enterSynopsis(pipeline({ synopsisReviewing: true, abort }))
    const stop = screen.getByRole('button', { name: /중단/ })
    fireEvent.click(stop)
    expect(abort).toHaveBeenCalled()
  })
})

describe('검수 실행', () => {
  it('현재 draft와 정규화된 characterDrafts로 reviewSynopsis를 호출한다', async () => {
    const p = pipeline()
    await enterSynopsis(p)
    fireEvent.change(screen.getByRole('spinbutton', { name: '시놉시스 검수 횟수' }), { target: { value: '3' } })
    fireEvent.click(reviewBtn())

    await waitFor(() => expect(p.reviewSynopsis).toHaveBeenCalled())
    const arg = p.reviewSynopsis.mock.calls[0][0]
    expect(arg.synopsisMd).toBe('원본 줄거리')
    expect(arg.characters[0]).toMatchObject({ name: '강리안' })
    expect(arg.review).toEqual({ synopsis: { enabled: true, rounds: 3 } })
  })

  it('결과가 textarea와 등장인물 카드를 교체한다', async () => {
    const p = pipeline()
    await enterSynopsis(p)
    fireEvent.click(reviewBtn())
    await waitFor(() => expect(draft()).toHaveValue('개선된 줄거리'))
    expect(screen.getByDisplayValue('보라')).toBeInTheDocument()
  })

  it('{error:busy}는 draft와 등장인물을 건드리지 않는다', async () => {
    const p = pipeline({ reviewSynopsis: vi.fn().mockResolvedValue({ error: 'busy' }) })
    await enterSynopsis(p)
    fireEvent.click(reviewBtn())
    await waitFor(() => expect(p.reviewSynopsis).toHaveBeenCalled())
    expect(draft()).toHaveValue('원본 줄거리')
    expect(screen.getByDisplayValue('강리안')).toBeInTheDocument()
  })

  it('{aborted:true}는 draft를 건드리지 않는다 (error 키가 없다)', async () => {
    const p = pipeline({ reviewSynopsis: vi.fn().mockResolvedValue({ aborted: true }) })
    await enterSynopsis(p)
    fireEvent.click(reviewBtn())
    await waitFor(() => expect(p.reviewSynopsis).toHaveBeenCalled())
    expect(draft()).toHaveValue('원본 줄거리')
  })

  it('undefined 응답도 draft를 건드리지 않는다', async () => {
    const p = pipeline({ reviewSynopsis: vi.fn().mockResolvedValue(undefined) })
    await enterSynopsis(p)
    fireEvent.click(reviewBtn())
    await waitFor(() => expect(p.reviewSynopsis).toHaveBeenCalled())
    expect(draft()).toHaveValue('원본 줄거리')
  })
})

describe('검수 진행 표시', () => {
  it('reviewProgress 배지와 로그창(StoryRunning)이 시놉시스 패널에 뜬다', async () => {
    const p = pipeline({
      synopsisReviewing: true,
      reviewProgress: { target: 'synopsis', round: 1, of: 2, phase: 'revising' },
      progressLog: [
        { id: 'a', step: 'synopsis', message: '시놉시스 검수: 검토 중 1/2', level: 'info', at: '2026-07-10T00:00:00Z' },
        { id: 'b', step: 'scenes', message: '씬 검수: 검토 중 1/1', level: 'info', at: '2026-07-10T00:00:01Z' },
      ],
    })
    await enterSynopsis(p)
    expect(screen.getByText('수정 중 1/2')).toBeInTheDocument()
    expect(screen.getByText('시놉시스 검수: 검토 중 1/2')).toBeInTheDocument()
    // scenes 로그는 시놉시스 패널에 새면 안 된다.
    expect(screen.queryByText('씬 검수: 검토 중 1/1')).toBeNull()
  })
})
