/**
 * B: audio 스텝이 done이고 오디오 탭을 보고 있으면 하단 primary 버튼이 "오디오 다시 생성"으로
 * 바뀌어 audio 스텝을 재실행한다(마지막 스텝 prompts로 새지 않음). + "닫기" 버튼으로 파이프라인
 * 을 나간다(onClose). "다시 생성"은 audio 스텝 재실행 — canReuse가 엔진/성우 바뀐 세그먼트만
 * 자동 재생성하므로 전체 강제가 아니다.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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

  it('audio 진행 중(running)이면 "오디오 다시 생성" 대신 기존 동작', () => {
    const p = pipeline({
      state: { steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'running' }, prompts: { status: 'pending' } }, speakers: [{ id: 'narrator', name: 'n' }] },
    })
    render(<StoryView pipeline={p} voices={[]} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /오디오 다시 생성/ })).toBeNull()
  })
})
