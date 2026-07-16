/**
 * ⑤ 오디오의 가져오기 진단이 실제로 화면에 도달하는지.
 *
 * 배너는 errorKind를 번역하면서 상세 메시지를 버린다(errorDisplay.js). 그래서 "자막이 8.0초
 * 지점부터 안 맞는다" 같은 정보는 **로그로** 가야 한다. 이 테스트가 없으면 진단을 정성껏 만들어
 * 놓고 아무 데도 안 보이는 상태가 조용히 유지된다(실제로 그랬다).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))

import StoryView from '../../../src/components/story/StoryView.jsx'

const AUDIO_ERROR = {
  status: 'error',
  errorKind: 'story-audio-import-unmatched',
  error: 'audio import: 3 subtitle char(s) claimed by no segment (first unclaimed subtitle at 8.0s)',
  updatedAt: '2026-07-17T00:00:00.000Z',
}

const pipeline = (over = {}) => ({
  state: {
    steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: AUDIO_ERROR, prompts: { status: 'pending' } },
    speakers: [{ id: 'narrator', name: '나레이션' }],
  },
  scenes: [{ storyId: 'a', segments: [{ id: 's1', speaker: 'narrator', text: 't', type: 'narration' }] }],
  streamingText: '', scriptText: '', start: vi.fn(), abort: vi.fn(), openError: null, ttsPreview: vi.fn(),
  pickAudioImportFile: vi.fn(), progressLog: [],
  ...over,
})

const openAudioPanel = () => fireEvent.click(screen.getByRole('button', { name: '오디오' }))

describe('⑤ 오디오 — 가져오기 진단 표시', () => {
  it('실패하면 진행 로그를 화면에 남긴다 — 배너만으론 어디를 고칠지 모른다', () => {
    render(<StoryView pipeline={pipeline({
      progressLog: [{ step: 'audio', level: 'error', at: '2026-07-17T00:00:00.000Z', message: 'narrator: 대본이 안 가져간 자막 3자 — 첫 위치 8.0초' }],
    })} voices={[]} />)
    openAudioPanel()
    expect(screen.getByTestId('audio-progress-log')).toHaveTextContent('첫 위치 8.0초')
  })

  it('다른 스텝 로그는 안 섞인다', () => {
    render(<StoryView pipeline={pipeline({
      progressLog: [
        { step: 'scenes', level: 'info', at: '2026-07-17T00:00:00.000Z', message: '씬 분리 로그' },
        { step: 'audio', level: 'error', at: '2026-07-17T00:00:00.000Z', message: '가져오기 실패 8.0초' },
      ],
    })} voices={[]} />)
    openAudioPanel()
    const log = screen.getByTestId('audio-progress-log')
    expect(log).toHaveTextContent('가져오기 실패')
    expect(log).not.toHaveTextContent('씬 분리 로그')
  })

  // 앱을 껐다 켜면 오류는 story.json에서 살아 돌아오지만 progressLog는 메모리라 비어 있다.
  // 그때 배너의 "진행 로그를 보세요"가 없는 로그를 가리키면 안 된다.
  it('로그가 비어도(재시작 후) 영속된 진단을 대신 보여준다', () => {
    render(<StoryView pipeline={pipeline({ progressLog: [] })} voices={[]} />)
    openAudioPanel()
    expect(screen.getByTestId('audio-progress-log')).toHaveTextContent('8.0s')
  })

  it('오디오가 실패하지 않았으면 로그 블록을 안 그린다', () => {
    render(<StoryView pipeline={pipeline({
      state: {
        steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'pending' } },
        speakers: [{ id: 'narrator', name: '나레이션' }],
      },
      progressLog: [{ step: 'audio', level: 'info', at: '2026-07-17T00:00:00.000Z', message: 'x' }],
    })} voices={[]} />)
    openAudioPanel()
    expect(screen.queryByTestId('audio-progress-log')).not.toBeInTheDocument()
  })
})
