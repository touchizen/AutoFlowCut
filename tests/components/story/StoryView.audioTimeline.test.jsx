/**
 * StoryView audio 패널 — audio 스텝 done이고 오디오 세그먼트가 있으면 타임라인(LiveTimeline)을
 * 렌더한다. story 세그먼트를 buildStoryAudioPackage로 화자별 voices audioPackage로 변환해 전달.
 * (LiveTimeline은 무거운 AudioTimeline을 렌더하므로 stub해서 통합 지점만 검증)
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({
  default: (props) => (
    <div
      data-testid="story-live-timeline"
      data-voices={String(props.audioPackage?.voices?.length ?? 0)}
      data-srt={String(props.srtEntries?.length ?? 0)}
      data-second-srt-start={String(props.srtEntries?.[1]?.startMs ?? '')}
    />
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

  it('오디오 탭 타임라인에 story 세그먼트 기준 자막 위치를 넘긴다', () => {
    const p = pipeline({
      scenes: [{ storyId: 'a', segments: [
        { ...doneSeg('s1', 'narrator'), text: 'A', startMs: 0, durationMs: 1000 },
        { ...doneSeg('s2', 'narrator'), text: 'B', startMs: 1000, durationMs: 700 },
      ] }],
    })
    render(<StoryView pipeline={p} voices={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    const tl = screen.getByTestId('story-live-timeline')
    expect(tl.getAttribute('data-srt')).toBe('2')
    expect(tl.getAttribute('data-second-srt-start')).toBe('1000')
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

// 게이트가 `audio.status === 'done'` 이면 **부분 실행이 영영 타임라인을 못 본다**: "이 화자만 생성"은
// 설계상 조립을 건너뛰고 done 을 안 찍는다(반쪽 타임라인·manifest 가 생기면 안 되므로). 그러면
// "나레이터만 먼저 확인" 이라는 그 기능의 목적이 무너진다. 부분재시도(다른 화자 TTS 실패)도 같다 —
// 실측(무한야담ep02): 나레이터 237개가 잘려 있는데 audio 는 pending 이라 화면에 아무것도 없었다.
// 오디오가 있으면 보여준다. export 는 audio.status==='done' 게이트가 따로 막으므로 새지 않는다.
describe('StoryView audio 타임라인 — 아직 done 이 아닌 실행', () => {
  const partial = (status) => pipeline({
    state: {
      steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status }, prompts: { status: 'pending' } },
      speakers: [{ id: 'narrator', name: '나레이션' }],
    },
    // 부분 실행/부분재시도가 남기는 모양: audioPath 는 있고 startMs 는 없다(조립을 건너뛰었다).
    scenes: [{ storyId: 'a', segments: [
      { id: 's1', speaker: 'narrator', text: 't1', status: 'done', durationMs: 1000, audioPath: '/a/s1.mp3', type: 'narration' },
      { id: 's2', speaker: 'narrator', text: 't2', status: 'done', durationMs: 2000, audioPath: '/a/s2.mp3', type: 'narration' },
    ] }],
  })

  it.each(['pending', 'error'])('audio 가 %s 여도 잘린 오디오가 있으면 타임라인을 보여준다', (status) => {
    render(<StoryView pipeline={partial(status)} voices={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    const tl = screen.getByTestId('story-live-timeline')
    expect(tl.getAttribute('data-voices')).toBe('1')
  })

  it('오디오가 하나도 없으면 여전히 안 보여준다 — 빈 타임라인은 소음이다', () => {
    render(<StoryView pipeline={pipeline({
      state: {
        steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'pending' }, prompts: { status: 'pending' } },
        speakers: [{ id: 'narrator', name: '나레이션' }],
      },
      scenes: [{ storyId: 'a', segments: [{ id: 's1', speaker: 'narrator', text: 't', type: 'narration' }] }],
    })} voices={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    expect(screen.queryByTestId('story-live-timeline')).toBeNull()
  })
})
