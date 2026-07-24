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

  it('C: 제목이 없어도 씬분리가 제목 자동생성(LLM) 없이 즉시 시작된다(전환이 제목 생성에 안 막힘)', async () => {
    const start = vi.fn()
    // 제목 없음 → 예전엔 generateTitle을 기다려 전환이 막혔다. C에서는 제목을 안 만들고 바로 진행.
    const generateTitle = vi.fn().mockResolvedValue({ title: 'T' })
    const p = pipeline(mkSteps(), { start, generateTitle })
    p.state.input = { type: 'title', title: '' }
    render(<StoryView pipeline={p} voices={[]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '전체 진행' }))
    await waitFor(() => expect(start).toHaveBeenCalledWith('scenes', expect.objectContaining({ scriptOverride: '대본 본문' })))
    // 핵심: 제목 자동생성 LLM을 호출하지 않는다(이게 전환 지연의 원인이었다).
    expect(generateTitle).not.toHaveBeenCalled()
    // 빈 제목은 넘기지 않아 기존 state.input.title을 덮지 않는다.
    expect(start.mock.calls.find((c) => c[0] === 'scenes')[1].title).toBeUndefined()
  })

  it('stuck 방지: scenes enqueue가 실패(busy)하면 자동 진행이 멈춘다', async () => {
    const start = vi.fn().mockResolvedValue({ error: 'busy' })
    const p = pipeline(mkSteps(), { start })
    render(<StoryView pipeline={p} voices={[]} onClose={vi.fn()} />)
    const btn = screen.getByRole('button', { name: '전체 진행' })
    fireEvent.click(btn)
    await waitFor(() => expect(start).toHaveBeenCalledWith('scenes', expect.anything()))
    // enqueue 실패 → handleSplit false → autoRunning 해제(버튼 다시 활성, stuck 아님)
    await waitFor(() => expect(btn).not.toBeDisabled())
    expect(btn.textContent).toContain('전체 진행')
  })

  it('오디오 자동을 켜면 audio도 자동 실행 대상', async () => {
    const start = vi.fn()
    render(<StoryView pipeline={pipeline(mkSteps({ scenes: { status: 'done' } }), { start })} voices={[]} onClose={vi.fn()} />)
    // 오디오 자동 체크(currentStep=audio 탭 pill 안 인라인 자동 체크박스)
    const audioPill = screen.getByText('오디오').closest('.story-step-pill')
    fireEvent.click(audioPill.querySelector('input[type=checkbox]'))
    fireEvent.click(screen.getByRole('button', { name: /전체 진행/ }))
    await waitFor(() => expect(start).toHaveBeenCalledWith('audio', expect.anything()))
  })
})
