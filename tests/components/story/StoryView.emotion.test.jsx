/**
 * 씬분리/오디오 탭 세그먼트를 2줄로 — 윗줄 대화, 아랫줄 (감정). 감정은 TTS에도 쓰이므로 눈으로 확인.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))

import StoryView from '../../../src/components/story/StoryView.jsx'

const pipeline = (over = {}) => ({
  state: {
    steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'pending' } },
    speakers: [{ id: 'narrator', name: '나레이션' }],
  },
  scenes: [{ storyId: 'a', segments: [
    { id: 's1', speaker: 'narrator', text: '한밤중이었다', emotion: 'sad', status: 'done', audioPath: '/a/s1.mp3', startMs: 0, durationMs: 1000, type: 'narration' },
    { id: 's2', speaker: 'seojun', text: '접니다', emotion: 'happy', status: 'done', audioPath: '/a/s2.mp3', startMs: 1000, durationMs: 1000, type: 'narration' },
  ] }],
  streamingText: '', scriptText: '대본', start: vi.fn(), abort: vi.fn(), openError: null, ttsPreview: vi.fn(),
  ...over,
})

describe('세그먼트 감정 2줄 표시 (화자만, 나레이터 제외)', () => {
  it('씬분리 탭: 화자 대사만 (감정), 나레이터는 감정 없음', () => {
    render(<StoryView pipeline={pipeline()} voices={[]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    const table = document.querySelector('.story-readonly-table')
    // 화자(seojun) 대사 → (기쁨)
    expect(within(table).getByText('접니다')).toBeTruthy()
    expect(within(table).getByText('(기쁨)')).toBeTruthy()
    // 나레이터 → 텍스트만, 감정 라벨 없음
    expect(within(table).getByText('한밤중이었다')).toBeTruthy()
    expect(within(table).queryByText('(슬픔)')).toBeNull()
  })

  it('오디오 탭: 화자만 (감정), 나레이터 제외', () => {
    render(<StoryView pipeline={pipeline()} voices={[]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    const panel = document.querySelector('.story-audio-panel')
    expect(within(panel).getByText('(기쁨)')).toBeTruthy()
    expect(within(panel).queryByText('(슬픔)')).toBeNull()
  })

  it('화자 emotion 없으면 기본 (평범) 표시', () => {
    const p = pipeline()
    p.scenes[0].segments[1].emotion = undefined // seojun(화자)
    render(<StoryView pipeline={p} voices={[]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    expect(document.querySelector('.story-readonly-table').textContent).toContain('(평범)')
  })
})
