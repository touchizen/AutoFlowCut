/**
 * B: audio 스텝이 done이고 오디오 탭을 보고 있으면 하단 primary 버튼이 "오디오 다시 생성"으로
 * 바뀌어 audio 스텝을 재실행한다(마지막 스텝 prompts로 새지 않음). + "닫기" 버튼으로 파이프라인
 * 을 나간다(onClose). "다시 생성"은 audio 스텝 재실행 — canReuse가 엔진/성우 바뀐 세그먼트만
 * 자동 재생성하므로 전체 강제가 아니다.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))

import StoryView from '../../../src/components/story/StoryView.jsx'

const doneSeg = (id, speaker) => ({
  id, speaker, text: `t${id}`, status: 'done', startMs: 0, durationMs: 1000, audioPath: `/a/${id}.mp3`, type: 'narration',
})

const pipeline = (over = {}) => ({
  state: {
    steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'pending' } },
    speakers: [{ id: 'narrator', name: '나레이션' }],
  },
  scenes: [{ storyId: 'a', segments: [doneSeg('s1', 'narrator')] }],
  streamingText: '', scriptText: '', start: vi.fn(), abort: vi.fn(), openError: null, ttsPreview: vi.fn(),
  ...over,
})

describe('StoryView B — audio done 재생성/닫기', () => {
  it('audio done + 오디오 탭 → primary 버튼이 "오디오 다시 생성", 클릭 시 audio 재실행', () => {
    const start = vi.fn()
    render(<StoryView pipeline={pipeline({ start })} voices={[]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' })) // 스텝퍼 → viewedStep=audio

    const btn = screen.getByRole('button', { name: /오디오 다시 생성/ })
    fireEvent.click(btn)
    expect(start).toHaveBeenCalledWith('audio', expect.anything())
    // prompts로 새지 않는다
    expect(start).not.toHaveBeenCalledWith('prompts', expect.anything())
  })

  it('audio done + 오디오 탭 → "닫기" 버튼, 클릭 시 onClose 호출', () => {
    const onClose = vi.fn()
    render(<StoryView pipeline={pipeline()} voices={[]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))

    fireEvent.click(screen.getByRole('button', { name: /닫기/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('prompts done + 프롬프트 탭 → "프롬프트 다시 생성" 클릭 시 prompts 재실행 + 닫기', () => {
    const start = vi.fn()
    const onClose = vi.fn()
    const p = pipeline({
      start,
      state: { steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'done' } }, speakers: [{ id: 'narrator', name: 'n' }] },
    })
    render(<StoryView pipeline={p} voices={[]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '프롬프트' })) // 스텝퍼 → viewedStep=prompts

    fireEvent.click(screen.getByRole('button', { name: /프롬프트 다시 생성/ }))
    expect(start).toHaveBeenCalledWith('prompts', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: /닫기/ }))
    expect(onClose).toHaveBeenCalled()
  })

  it('audio 진행 중(running)이면 "오디오 다시 생성" 대신 기존 동작', () => {
    const p = pipeline({
      state: { steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'running' }, prompts: { status: 'pending' } }, speakers: [{ id: 'narrator', name: 'n' }] },
    })
    render(<StoryView pipeline={p} voices={[]} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /오디오 다시 생성/ })).toBeNull()
  })

  // 버그 회귀: 세그먼트 단위 재생성(↻)은 그 세그먼트만 다시 만드는 국소 액션이라 audio 뷰에
  // 머물러야 한다. STEP_ORDER=[script,scenes,audio,prompts]라 audio가 done이어도 currentStep은
  // 다음 미완료(prompts)를 가리키므로, 재생성 완료 후 setViewedStep(null)이면 화면이 prompts로
  // 새어 나간다. 성공 시에도 viewedStep을 'audio'로 유지해야 한다.
  it('세그먼트 재생성(↻) 완료 후에도 화면이 audio에 머문다(prompts로 새지 않음)', async () => {
    // start를 제어 가능한 promise로 — 재생성 완료(→ setViewedStep) 시점을 명확히 지나게 한다.
    let resolveStart
    const start = vi.fn(() => new Promise((r) => { resolveStart = r }))
    render(<StoryView pipeline={pipeline({ start })} voices={[]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' })) // 스텝퍼 → viewedStep=audio
    fireEvent.click(screen.getByRole('button', { name: 's1 재생성' })) // 세그먼트 ↻
    expect(start).toHaveBeenCalledWith('audio', expect.objectContaining({ regenerate: ['s1'] }))
    // 재생성 완료 → regenerateSegment의 setViewedStep이 실행된다. 이 경로를 반드시 지나야 버그가 드러난다.
    await act(async () => { resolveStart(undefined); await Promise.resolve() })
    // 완료 후에도 오디오 패널이 유지된다(버그면 displayStep이 prompts로 새어 이 버튼이 사라진다).
    expect(screen.getByRole('button', { name: /오디오 다시 생성/ })).toBeInTheDocument()
  })
})
