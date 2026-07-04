/**
 * StoryView audio 패널 — audio 스텝 done이고 오디오 세그먼트가 있으면 타임라인(LiveTimeline)을
 * 렌더한다. story 세그먼트를 buildStoryAudioPackage로 화자별 voices audioPackage로 변환해 전달.
 * (LiveTimeline은 무거운 AudioTimeline을 렌더하므로 stub해서 통합 지점만 검증)
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({
  default: (props) => (
    <div data-testid="story-live-timeline" data-voices={String(props.audioPackage?.voices?.length ?? 0)} />
  ),
}))

import StoryView from '../../../src/components/story/StoryView.jsx'

const doneSeg = (id, speaker) => ({
  id, speaker, text: `t${id}`, status: 'done',
  startMs: 0, durationMs: 1000, audioPath: `/a/${id}.mp3`, type: 'narration',
})

const pipeline = (over = {}) => ({
  state: {
    steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'pending' } },
    speakers: [{ id: 'narrator', name: '나레이션' }],
  },
  scenes: [{ storyId: 'a', segments: [doneSeg('s1', 'narrator'), doneSeg('s2', 'narrator')] }],
  streamingText: '', scriptText: '', start: vi.fn(), abort: vi.fn(), openError: null, ttsPreview: vi.fn(),
  ...over,
})

describe('StoryView audio 타임라인', () => {
  it('audio done + 오디오 세그먼트 → 오디오 탭에서 타임라인 렌더(화자별 트랙)', () => {
    render(<StoryView pipeline={pipeline()} voices={[]} />)
    // audio done이면 currentStep=prompts라, 스텝퍼에서 '오디오' 탭을 눌러 audio 패널을 연다
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    const tl = screen.getByTestId('story-live-timeline')
    expect(tl).toBeTruthy()
    // narrator 1명 → voice 트랙 1개
    expect(tl.getAttribute('data-voices')).toBe('1')
  })

  it('audio 미완료(running)면 타임라인 미렌더', () => {
    const p = pipeline({
      state: { steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'running' }, prompts: { status: 'pending' } }, speakers: [] },
      scenes: [],
    })
    render(<StoryView pipeline={p} voices={[]} />)
    expect(screen.queryByTestId('story-live-timeline')).toBeNull()
  })

  it('오디오 세그먼트가 없으면(audioPath 전부 없음) 타임라인 미렌더', () => {
    const p = pipeline({
      scenes: [{ storyId: 'a', segments: [{ id: 's1', speaker: 'narrator', text: 't', status: 'pending', type: 'narration' }] }],
    })
    render(<StoryView pipeline={p} voices={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    expect(screen.queryByTestId('story-live-timeline')).toBeNull()
  })
})
