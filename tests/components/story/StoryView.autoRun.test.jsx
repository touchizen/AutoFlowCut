/**
 * 자동 진행 — '전체 진행'이 자동=true 스텝을 순서대로 실행하고, 자동=false(오디오 기본)는 건너뛴다.
 * 각 스텝 완료를 감지해 다음으로 넘어가고, 남은 자동 스텝이 없으면 멈춘다.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))

import StoryView from '../../../src/components/story/StoryView.jsx'

const mkSteps = (over) => ({ script: { status: 'done' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' }, ...over })

const pipeline = (steps, over = {}) => ({
  state: { steps, input: { type: 'title', title: 'T' }, speakers: [{ id: 'narrator', name: '나레이션' }] },
  scenes: [{ storyId: 'a', segments: [{ speaker: 'narrator', text: '어느 날' }] }],
  streamingText: '', scriptText: '대본 본문', start: vi.fn(), abort: vi.fn(), openError: null,
  ttsPreview: vi.fn(), generateTitle: vi.fn().mockResolvedValue({ title: 'T' }),
  ...over,
})

describe('StoryView 자동 진행(전체 진행)', () => {
  it('전체 진행 → scenes 실행, scenes done되면 audio(자동off) 건너뛰고 prompts 실행, prompts done이면 멈춤', async () => {
    const start = vi.fn()
    const p0 = pipeline(mkSteps(), { start })
    const { rerender } = render(<StoryView pipeline={p0} voices={[]} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /전체 진행/ }))
    // 1) scenes 실행
    await waitFor(() => expect(start).toHaveBeenCalledWith('scenes', expect.objectContaining({ scriptOverride: '대본 본문' })))

    // 2) scenes done으로 상태 갱신 → audio(자동 off) 건너뛰고 prompts 실행
    rerender(<StoryView pipeline={pipeline(mkSteps({ scenes: { status: 'done' } }), { start })} voices={[]} onClose={vi.fn()} />)
    await waitFor(() => expect(start).toHaveBeenCalledWith('prompts', expect.anything()))
    expect(start).not.toHaveBeenCalledWith('audio', expect.anything())

    // 3) prompts done → 남은 자동 스텝 없음 → 더 이상 실행 안 함
    const start2 = vi.fn()
    rerender(<StoryView pipeline={pipeline(mkSteps({ scenes: { status: 'done' }, prompts: { status: 'done' } }), { start: start2 })} voices={[]} onClose={vi.fn()} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(start2).not.toHaveBeenCalled()
  })

  it('에러 발생 시 자동 진행이 멈춘다(다음 스텝 실행 안 함)', async () => {
    const start = vi.fn()
    const { rerender } = render(<StoryView pipeline={pipeline(mkSteps(), { start })} voices={[]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /전체 진행/ }))
    await waitFor(() => expect(start).toHaveBeenCalledWith('scenes', expect.anything()))
    // scenes 에러 → 멈춤
    const start2 = vi.fn()
    rerender(<StoryView pipeline={pipeline(mkSteps({ scenes: { status: 'error' } }), { start: start2 })} voices={[]} onClose={vi.fn()} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(start2).not.toHaveBeenCalledWith('prompts', expect.anything())
  })

  it('Codex-High: 오디오 스킵으로 prompts가 running이면 isRunning=true → 전체 진행 disabled', () => {
    // audio pending, prompts running (자동 진행이 audio 건너뛰고 prompts 실행 중)
    const p = pipeline(mkSteps({ scenes: { status: 'done' }, prompts: { status: 'running' } }))
    render(<StoryView pipeline={p} voices={[]} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /전체 진행/ })).toBeDisabled()
  })

  it('Codex-Med: 제목 자동생성 실패로 scenes를 못 시작하면 자동 진행이 멈춘다(stuck 방지)', async () => {
    const start = vi.fn()
    // 제목 없음 + generateTitle 실패 → resolveTitle null → handleSplit false → autoRunning 해제
    const p = pipeline(mkSteps(), { start, generateTitle: vi.fn().mockRejectedValue(new Error('boom')) })
    p.state.input = { type: 'title', title: '' }
    render(<StoryView pipeline={p} voices={[]} onClose={vi.fn()} />)
    const btn = screen.getByRole('button', { name: '전체 진행' })
    fireEvent.click(btn)
    // 실패 후 autoRunning이 풀려 버튼이 다시 활성(=stuck 아님)
    await waitFor(() => expect(btn).not.toBeDisabled())
    expect(btn.textContent).toContain('전체 진행') // '자동 진행 중'이 아님
    expect(start).not.toHaveBeenCalled()
  })

  it('오디오 자동을 켜면 audio도 자동 실행 대상', async () => {
    const start = vi.fn()
    render(<StoryView pipeline={pipeline(mkSteps({ scenes: { status: 'done' } }), { start })} voices={[]} onClose={vi.fn()} />)
    // 오디오 자동 체크(currentStep=audio 탭 pill의 자동 체크박스)
    const audioCol = screen.getByText('오디오').closest('.story-step-col')
    fireEvent.click(audioCol.querySelector('input[type=checkbox]'))
    fireEvent.click(screen.getByRole('button', { name: /전체 진행/ }))
    await waitFor(() => expect(start).toHaveBeenCalledWith('audio', expect.anything()))
  })
})
