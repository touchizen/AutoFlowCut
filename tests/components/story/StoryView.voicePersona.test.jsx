import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

// 오디오 탭 등장인물 목록에 캐릭터 특징(appearance)을 표시(A1)하고,
// 캐릭터 성별↔성우 성별로 추천/경고(C: 있으면 추천, 없으면 폴백)한다.
const pipeline = (over = {}) => ({
  state: {
    steps: {
      script: { status: 'done' }, scenes: { status: 'done' },
      audio: { status: 'pending' }, prompts: { status: 'pending' },
    },
    speakers: [],
  },
  scenes: [{ storyId: 's1', segments: [{ speaker: 'rian', text: '대사', status: 'pending' }] }],
  streamingText: '',
  start: vi.fn(), abort: vi.fn(),
  ttsPreview: vi.fn(async () => ({ ok: true, segments: [] })),
  ...over,
})

const openAudioPanel = () => fireEvent.click(screen.getByRole('button', { name: '오디오' }))

describe('StoryView 오디오 탭 — 캐릭터 특징 표시 + 성우 추천', () => {
  it('A1: speaker.appearance를 등장인물 행에 표시한다', () => {
    const p = pipeline()
    p.state.speakers = [{ id: 'rian', name: '강리안', appearance: 'young woman, elegant, long black hair', voice: null }]
    const { container } = render(<StoryView pipeline={p} voices={[]} />)
    openAudioPanel()
    const panel = container.querySelector('.story-audio-panel')
    expect(within(panel).getByText('young woman, elegant, long black hair')).toBeInTheDocument()
  })

  it('A1: appearance가 없는 화자(나레이터)는 특징 줄을 렌더하지 않는다', () => {
    const p = pipeline()
    p.state.speakers = [{ id: 'narrator', name: '나레이션', appearance: null, voice: null }]
    const { container } = render(<StoryView pipeline={p} voices={[]} />)
    openAudioPanel()
    const row = container.querySelector('.story-voice-row')
    expect(row.querySelector('.story-voice-appearance')).toBeNull()
  })

  it('C-경고: 캐릭터는 여성인데 선택된 성우가 남성이면 불일치 경고를 표시한다', () => {
    const p = pipeline()
    p.state.speakers = [{ id: 'rian', name: '강리안', appearance: 'young woman, elegant', voice: { provider: 'typecast', voiceId: 'tc_male' } }]
    const voices = [{ id: 'tc_male', name: 'Joon', provider: 'typecast', gender: 'male', language: 'ko' }]
    const { container } = render(<StoryView pipeline={p} voices={voices} />)
    openAudioPanel()
    const row = container.querySelector('.story-voice-row')
    expect(within(row).getByText('⚠')).toBeInTheDocument()
  })

  it('C-경고: 캐릭터·성우 성별이 일치하면 경고를 표시하지 않는다', () => {
    const p = pipeline()
    p.state.speakers = [{ id: 'rian', name: '강리안', appearance: 'young woman, elegant', voice: { provider: 'typecast', voiceId: 'tc_fem' } }]
    const voices = [{ id: 'tc_fem', name: 'Yuna', provider: 'typecast', gender: 'female', language: 'ko' }]
    const { container } = render(<StoryView pipeline={p} voices={voices} />)
    openAudioPanel()
    const row = container.querySelector('.story-voice-row')
    expect(within(row).queryByText('⚠')).toBeNull()
  })

  it('C-폴백: 캐릭터 성별을 못 뽑으면(단서 없음) 경고하지 않는다', () => {
    const p = pipeline()
    p.state.speakers = [{ id: 'yuseo', name: '서윤', appearance: 'young low-rank staff officer, tired face', voice: { provider: 'typecast', voiceId: 'tc_male' } }]
    const voices = [{ id: 'tc_male', name: 'Joon', provider: 'typecast', gender: 'male', language: 'ko' }]
    const { container } = render(<StoryView pipeline={p} voices={voices} />)
    openAudioPanel()
    const row = container.querySelector('.story-voice-row')
    expect(within(row).queryByText('⚠')).toBeNull()
  })

  it('C-프리셋: 여성 캐릭터의 성우 모달을 열면 여성 세그먼트로 시작(여성 성우만 노출)', () => {
    const p = pipeline()
    p.state.speakers = [{ id: 'rian', name: '강리안', appearance: 'young woman, elegant', voice: null }]
    const voices = [
      { id: 'tc_fem', name: 'Yuna', provider: 'typecast', gender: 'female', language: 'ko' },
      { id: 'tc_male', name: 'Joon', provider: 'typecast', gender: 'male', language: 'ko' },
    ]
    render(<StoryView pipeline={p} voices={voices} />)
    openAudioPanel()
    fireEvent.click(screen.getByLabelText('강리안 목소리'))  // 성우 모달 오픈
    expect(screen.getByText('Yuna')).toBeInTheDocument()
    expect(screen.queryByText('Joon')).not.toBeInTheDocument()
  })
})
