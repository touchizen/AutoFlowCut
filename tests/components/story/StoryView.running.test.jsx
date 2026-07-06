/**
 * 씬 분리 / 프롬프트 스텝이 running 일 때 진행 중 표시(.story-running: 초시계 애니메이션 +
 * 경과 시간)를 패널에 렌더한다. 시작 시각은 running 스텝의 updatedAt(stepMachine 이 running
 * 진입 시 기록)을 쓴다. "진행 중" 텍스트는 스텝퍼 배지에도 있으므로 패널 컨테이너(.story-running)로 검증한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

const pipeline = (over = {}) => ({
  state: {
    steps: {
      script: { status: 'pending' }, scenes: { status: 'pending' },
      audio: { status: 'pending' }, prompts: { status: 'pending' },
    },
  },
  scenes: [],
  streamingText: '',
  scriptText: '',
  start: vi.fn(), abort: vi.fn(), openError: null,
  ...over,
})

// running 스텝을 주입한 새 pipeline 을 만든다(불변 업데이트 — rerender 로 상태 전이 시뮬레이션).
const withRunning = (p, step, agoMs) => ({
  ...p,
  state: {
    ...p.state,
    steps: { ...p.state.steps, [step]: { status: 'running', updatedAt: new Date(Date.now() - agoMs).toISOString() } },
  },
})

describe('StoryView 진행 중 표시(.story-running: 초시계 + 경과시간)', () => {
  it('씬 분리 running 이면 패널에 초시계와 경과 시간을 표시한다', () => {
    const p = pipeline()
    p.state.steps.script = { status: 'done' }
    // setup 화면에서 하단 '씬 분리 실행'(scenes pending → 활성) 클릭 → scriptPhase 해제, scenes 패널로
    const { rerender } = render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리 실행' }))
    // start 는 mock 이므로 running 상태를 rerender 로 주입한다
    rerender(<StoryView pipeline={withRunning(p, 'scenes', 3000)} />)

    const running = document.querySelector('.story-running')
    expect(running).toBeTruthy()
    expect(running.querySelector('.stopwatch-icon')).toBeTruthy()
    // 선택된 씬 분리 단위(기본 scene)와 기준 요약을 함께 보여준다
    expect(running.textContent).toMatch(/씬 기준/)
    // 진행 중이면 "결과 없음" 힌트는 나오지 않는다
    expect(screen.queryByText(/씬 분리 결과가 아직 없습니다/)).toBeNull()
  })

  it('씬 분리 running 이면 상세 진행 로그를 스크롤 패널에 표시한다', () => {
    const p = pipeline({
      progressLog: [
        { step: 'scenes', phase: 'script-save', message: '편집 대본 저장', at: '2026-07-06T00:00:00.000Z' },
        { step: 'scenes', phase: 'split-request', message: 'LLM 씬 분리 요청', at: '2026-07-06T00:00:01.000Z' },
      ],
    })
    p.state.steps.script = { status: 'done' }
    p.state.steps.scenes = { status: 'running', updatedAt: new Date(Date.now() - 3000).toISOString() }

    render(<StoryView pipeline={p} />)

    const log = document.querySelector('.story-progress-log')
    expect(log).toBeTruthy()
    expect(log.textContent).toContain('편집 대본 저장')
    expect(log.textContent).toContain('LLM 씬 분리 요청')
  })

  it('문장 기준(segment)이면 씬 분리 진행 화면에 문장 기준 요약을 표시한다', () => {
    const p = pipeline()
    p.state.input = { options: { sceneGranularity: 'segment' } }
    p.state.steps.script = { status: 'done' }
    const { rerender } = render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리 실행' }))
    rerender(<StoryView pipeline={withRunning(p, 'scenes', 2000)} />)
    expect(document.querySelector('.story-running').textContent).toMatch(/문장 기준/)
  })

  // F1(Codex): scenes/prompts가 running 상태로 재오픈되면(scriptText 있어 scriptPhase 초기 editor)
  // 대본 스트리밍 화면이 아니라 진행 표시(.story-running)를 우선 보여야 한다. 사용자 클릭(viewedStep) 전 기준.
  it('scenes running 상태로 재오픈되면(클릭 전) 대본 화면이 아니라 진행 표시가 보인다', () => {
    const p = pipeline({ scriptText: '이미 쓴 대본' })
    p.state.steps.script = { status: 'done' }
    p.state.steps.scenes = { status: 'running', updatedAt: new Date(Date.now() - 2000).toISOString() }
    render(<StoryView pipeline={p} />)
    expect(document.querySelector('.story-running')).toBeTruthy()
    expect(screen.queryByTestId('story-editor')).toBeNull()
  })

  // 재리뷰 F1: scenes running 재오픈 시 진행 화면 + 하단 컨트롤(중단)이 함께 보여야 한다.
  it('scenes running 재오픈 시 하단 컨트롤(중단 버튼)이 보인다', () => {
    const p = pipeline({ scriptText: '대본' })
    p.state.steps.script = { status: 'done' }
    p.state.steps.scenes = { status: 'running', updatedAt: new Date(Date.now() - 1000).toISOString() }
    render(<StoryView pipeline={p} />)
    expect(document.querySelector('.story-controls')).toBeTruthy()
    expect(screen.getByRole('button', { name: /중단/ })).toBeTruthy()
  })

  // 재리뷰 F2: scenes running 중 대본 탭을 눌러도 빈 스트리밍이 아니라 편집기가 보여야 한다.
  it('scenes running 중 대본 탭을 누르면 빈 스트리밍이 아니라 대본 편집기가 보인다', () => {
    const p = pipeline({ scriptText: '이미 쓴 대본' })
    p.state.steps.script = { status: 'done' }
    p.state.steps.scenes = { status: 'running', updatedAt: new Date().toISOString() }
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    // script는 running이 아니므로 스트리밍 preview가 아니라 편집기(PromptInput)여야 한다
    expect(document.querySelector('.story-script-stream')).toBeNull()
    expect(screen.getByTestId('story-editor')).toBeTruthy()
  })

  // 재리뷰3: scenes running 중 대본 탭 → 편집기는 보이되(F2), downstream이 도는 중이므로 하단은
  // 3버튼(새 start)이 아니라 중단(abort) 이어야 한다. (editor controls는 isRunning 기준)
  it('scenes running 중 대본 탭에서 3버튼이 아니라 중단 버튼이 보인다(abort 유지)', () => {
    const p = pipeline({ scriptText: '대본' })
    p.state.steps.script = { status: 'done' }
    p.state.steps.scenes = { status: 'running', updatedAt: new Date().toISOString() }
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    expect(screen.getByRole('button', { name: /중단/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '분리시작' })).toBeNull()
  })

  it('프롬프트 running 이면 패널에 초시계와 경과 시간을 표시한다', () => {
    const p = pipeline()
    p.state.steps.script = { status: 'done' }
    p.state.steps.scenes = { status: 'done' }
    p.state.steps.audio = { status: 'done' }  // M2a-3: audio done → currentStep=prompts
    const { rerender } = render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '프롬프트 실행' }))
    rerender(<StoryView pipeline={withRunning(p, 'prompts', 5000)} />)

    const running = document.querySelector('.story-running')
    expect(running).toBeTruthy()
    expect(running.querySelector('.stopwatch-icon')).toBeTruthy()
  })
})
