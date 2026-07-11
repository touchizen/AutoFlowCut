/**
 * 검수(reviewOnly) 실행 중에는 콘텐츠가 그대로 보이고 하단에 진행 로그창이 뜬다 — 시놉시스 패널과
 * 같은 모양. 생성 실행은 현행 그대로(스트림/시계, 로그창 추가 없음).
 *
 * 검수는 델타를 흘리지 않으므로, 생성과 똑같이 스트림 뷰로 갈아끼우면 빈 상자가 뜬다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

afterEach(() => { localStorage.removeItem('autoflowcut_lang') })

const STEP = (over = {}) => ({ script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'done' }, ...over })

const SCENES = [{ sceneNo: 1, summary: '첫 씬', imagePrompt: 'IMG', videoPrompt: 'VID', segments: [{ id: 's1', speaker: 'narrator', text: '가나다', emotion: 'normal' }] }]

const pipeline = (over = {}) => ({
  state: { steps: STEP(), speakers: [{ id: 'narrator', name: '나레이션' }] },
  scenes: SCENES, streamingText: '', scriptText: '# 내 대본 본문', start: vi.fn(), abort: vi.fn(), openError: null,
  progressLog: [], reviewProgress: null,
  ...over,
})

const RUNNING_REVIEW = { status: 'running', updatedAt: '2026-07-10T00:00:00Z', reviewOnly: true }
const RUNNING_GEN = { status: 'running', updatedAt: '2026-07-10T00:00:00Z' }

const LOG = (step, message) => ({ id: `${step}-1`, step, message, level: 'info', at: '2026-07-10T00:00:01Z' })

const stream = (c) => c.querySelector('.story-script-stream')

describe('대본 검수 중', () => {
  const p = (over = {}) => pipeline({
    state: { steps: STEP({ script: RUNNING_REVIEW }), speakers: [] },
    progressLog: [LOG('script', '대본 검수: 검토 중 1/3')],
    reviewProgress: { target: 'script', round: 1, of: 3, phase: 'reviewing' },
    ...over,
  })

  it('대본이 빈 스트림 뷰로 교체되지 않는다', () => {
    const { container } = render(<StoryView pipeline={p()} />)
    expect(stream(container)).toBeNull()
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
  })

  it('하단에 진행 로그창이 뜬다', () => {
    render(<StoryView pipeline={p()} />)
    expect(screen.getByText('대본 검수: 검토 중 1/3')).toBeInTheDocument()
    expect(screen.getByText('검수 중')).toBeInTheDocument()
  })

  it('다른 스텝의 로그는 섞이지 않는다', () => {
    render(<StoryView pipeline={p({ progressLog: [LOG('script', '대본 검수: 검토 중 1/3'), LOG('scenes', '씬 검수: 검토 중 1/1')] })} />)
    expect(screen.queryByText('씬 검수: 검토 중 1/1')).toBeNull()
  })
})

describe('대본 생성 중 (현행 유지)', () => {
  it('스트림 뷰가 뜨고 검수 로그창은 없다', () => {
    const { container } = render(<StoryView pipeline={pipeline({
      state: { steps: STEP({ script: RUNNING_GEN }), speakers: [] },
      streamingText: '생성되는 본문',
    })} />)
    expect(stream(container)).toBeTruthy()
    expect(screen.queryByText('검수 중')).toBeNull()
  })
})

describe('씬 검수 중', () => {
  const p = () => pipeline({
    state: { steps: STEP({ scenes: RUNNING_REVIEW }), speakers: [{ id: 'narrator', name: '나레이션' }] },
    progressLog: [LOG('scenes', '씬 검수: 검토 중 1/1')],
  })

  it('씬 테이블이 그대로 보인다 (생성 중처럼 감춰지지 않는다)', () => {
    render(<StoryView pipeline={p()} />)
    // 씬 테이블은 #/화자/세그먼트 컬럼 — 헤더는 running(생성) 분기에선 렌더되지 않는다.
    expect(screen.getByText('화자')).toBeInTheDocument()
    expect(screen.queryByText('씬 분리 진행 중')).toBeNull()
  })

  it('하단에 검수 로그창이 뜬다', () => {
    render(<StoryView pipeline={p()} />)
    expect(screen.getByText('검수 중')).toBeInTheDocument()
    expect(screen.getByText('씬 검수: 검토 중 1/1')).toBeInTheDocument()
  })
})

describe('씬 생성 중 (현행 유지 — 기존 로그창 그대로)', () => {
  it('"씬 분리 진행 중" 라벨과 로그창이 유지된다', () => {
    render(<StoryView pipeline={pipeline({
      state: { steps: STEP({ scenes: RUNNING_GEN }), speakers: [] },
      progressLog: [LOG('scenes', '씬 분리 시작')],
    })} />)
    expect(screen.getByText('씬 분리 진행 중')).toBeInTheDocument()
    expect(screen.getByText('씬 분리 시작')).toBeInTheDocument()
    expect(screen.queryByText('검수 중')).toBeNull()
  })
})

describe('프롬프트 검수 중', () => {
  const p = () => pipeline({
    state: { steps: STEP({ prompts: RUNNING_REVIEW }), speakers: [] },
    progressLog: [LOG('prompts', '프롬프트 검수: 검토 중 1/1')],
  })

  it('프롬프트 표가 그대로 보인다', () => {
    render(<StoryView pipeline={p()} />)
    expect(screen.getByText('IMG')).toBeInTheDocument()
  })

  it('하단에 검수 로그창이 뜬다', () => {
    render(<StoryView pipeline={p()} />)
    expect(screen.getByText('검수 중')).toBeInTheDocument()
    expect(screen.getByText('프롬프트 검수: 검토 중 1/1')).toBeInTheDocument()
  })
})

describe('프롬프트 생성 중 (현행 유지)', () => {
  it('"프롬프트 생성 중"만 뜨고 검수 로그창은 없다', () => {
    render(<StoryView pipeline={pipeline({ state: { steps: STEP({ prompts: RUNNING_GEN }), speakers: [] } })} />)
    expect(screen.getByText('프롬프트 생성 중')).toBeInTheDocument()
    expect(screen.queryByText('검수 중')).toBeNull()
  })
})
