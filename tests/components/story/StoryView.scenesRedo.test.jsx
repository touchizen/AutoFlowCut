/**
 * 씬분리(done) 탭을 보고 있으면 하단 primary가 "씬 재분리"가 되어 scenes를 재실행한다
 * (currentStep=audio로 새지 않음). 오디오/프롬프트 done 탭의 "다시 생성" 패턴과 일관.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))

import StoryView from '../../../src/components/story/StoryView.jsx'

const pipeline = (over = {}) => ({
  state: {
    steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'pending' }, prompts: { status: 'pending' } },
    input: { type: 'title', title: 'T' },
    speakers: [{ id: 'narrator', name: '나레이션' }],
  },
  scenes: [{ storyId: 'a', segments: [{ speaker: 'narrator', text: '어느 날' }] }],
  streamingText: '', scriptText: '대본 본문', start: vi.fn(), abort: vi.fn(), openError: null,
  ttsPreview: vi.fn(), generateTitle: vi.fn().mockResolvedValue({ title: 'T' }),
  ...over,
})

describe('StoryView 씬분리 탭 재분리 버튼', () => {
  it('scenes done + 씬분리 탭 → 하단이 "씬 재분리", 클릭 시 scenes 재실행(audio로 안 샘)', async () => {
    const start = vi.fn()
    render(<StoryView pipeline={pipeline({ start })} voices={[]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' })) // 스텝퍼 → viewedStep=scenes

    const btn = screen.getByRole('button', { name: /씬 재분리/ })
    fireEvent.click(btn)
    await waitFor(() => expect(start).toHaveBeenCalledWith('scenes', expect.objectContaining({ scriptOverride: '대본 본문' })))
    expect(start).not.toHaveBeenCalledWith('audio', expect.anything())
  })

  it('scenes done + 씬분리 탭 → 하단에 "▶ 진행"(오디오 실행) 라벨이 뜨지 않는다', () => {
    render(<StoryView pipeline={pipeline()} voices={[]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    // 오디오를 실행하는 generic 진행 버튼이 씬분리 탭에 새면 안 됨
    expect(screen.queryByRole('button', { name: /오디오 실행/ })).toBeNull()
  })
})
