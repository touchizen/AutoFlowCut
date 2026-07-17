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
import ko from '../../../src/locales/ko.js'

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

// 정책이 바뀌었다: 안 맞아도 **대략 잘라 놓고 경고**(사용자 결정). 그러면 실행은 성공(done)으로
// 끝나는데, 로그 패널이 running/error 에서만 렌더되면 그 경고가 **완료되는 순간 사라진다** —
// 사용자는 어느 조각이 보간됐는지, 남의 자리를 물어왔는지 알 방법이 없다. "경고 주면 내가 보고
// 편집하지"가 성립하려면 완료 후에도 남아야 한다.
describe('⑤ 오디오 — 성공했지만 경고가 있는 실행', () => {
  const DONE = { status: 'done', updatedAt: '2026-07-17T00:00:00.000Z' }
  const warnLog = (message) => [{ step: 'audio', level: 'warn', at: '2026-07-17T00:00:00.000Z', message }]

  it('보간 경고는 완료 후에도 화면에 남는다 — 사라지면 확인할 방법이 없다', () => {
    render(<StoryView pipeline={pipeline({
      state: {
        steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: DONE, prompts: { status: 'pending' } },
        speakers: [{ id: 'narrator', name: '나레이션' }],
      },
      progressLog: warnLog('narrator: 자막에서 못 찾은 세그먼트 1/2개 중 1개를 보간함 (n2 8.0-12.0초) — 구간을 확인하세요'),
    })} voices={[]} />)
    openAudioPanel()
    const log = screen.getByTestId('audio-progress-log')
    expect(log.textContent).toContain('보간함')
    expect(log.textContent).toContain('n2')
  })

  it('남의 자리 오디오 경고도 완료 후에 남는다', () => {
    render(<StoryView pipeline={pipeline({
      state: {
        steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: DONE, prompts: { status: 'pending' } },
        speakers: [{ id: 'narrator', name: '나레이션' }],
      },
      progressLog: warnLog('narrator: 자막에 있는 다른 화자 대사 1개가 대본과 어긋남'),
    })} voices={[]} />)
    openAudioPanel()
    expect(screen.getByTestId('audio-progress-log').textContent).toContain('어긋남')
  })

  // 경고 없이 깨끗하게 끝난 실행(ep02 실측이 이 경우 — 237/237 exact)에 로그 패널을 띄우면
  // 정상에 소음을 얹는 것이다. 그러면 경고가 경고로 안 읽힌다.
  it('경고가 없으면 완료 후 로그 패널을 띄우지 않는다 — 정상에 소음을 얹지 않는다', () => {
    render(<StoryView pipeline={pipeline({
      state: {
        steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: DONE, prompts: { status: 'pending' } },
        speakers: [{ id: 'narrator', name: '나레이션' }],
      },
      progressLog: [{ step: 'audio', level: 'info', at: '2026-07-17T00:00:00.000Z', message: 'narrator: 자막에서 237/237개 구간 찾음' }],
    })} voices={[]} />)
    openAudioPanel()
    expect(screen.queryByTestId('audio-progress-log')).toBeNull()
  })
})

// 보간된 조각은 **화면에서 찾을 수 있어야** 한다. 경고 로그는 메모리라 start()마다 지워지고
// (전체 실행은 audio 완료 직후 prompts 를 시작한다) 재오픈하면 없다. 영속된 approx 를 목록에
// 띄워야 "대략 잘라 놓고 경고, 네가 보고 편집" 정책이 실제로 성립한다.
describe('⑤ 오디오 — 보간된 세그먼트 표시', () => {
  const withSegs = (segments) => pipeline({
    state: {
      steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done', updatedAt: '2026-07-17T00:00:00.000Z' }, prompts: { status: 'pending' } },
      speakers: [{ id: 'narrator', name: '나레이션' }],
    },
    scenes: [{ storyId: 'a', segments }],
    progressLog: [], // 로그는 이미 지워졌다 — 그래도 찾을 수 있어야 한다
  })

  it('approx 세그먼트에 표시가 붙는다 — 로그가 지워져도 어느 조각인지 안다', () => {
    render(<StoryView pipeline={withSegs([
      { id: 's1', speaker: 'narrator', text: '정확히 맞은 것', type: 'narration', status: 'done' },
      { id: 's2', speaker: 'narrator', text: '보간된 것', type: 'narration', status: 'done', approx: true },
    ])} voices={[]} />)
    openAudioPanel()
    expect(screen.getByTestId('seg-mark-s2')).toBeTruthy()
    expect(screen.queryByTestId('seg-mark-s1'), '정확히 맞은 건 표시하지 않는다').toBeNull()
  })

  // needsReview 는 approx 와 **다른 사실**이다: approx = "근처로 잘랐다"(보간), needsReview =
  // "남의 자리일 수 있다". 같은 문구를 쓰면 툴팁이 거짓말이 된다.
  it('needsReview 는 보간과 다른 사유로 표시한다 — 툴팁이 거짓이면 안 된다', () => {
    render(<StoryView pipeline={withSegs([
      { id: 's1', speaker: 'narrator', text: '남의 자리일 수 있음', type: 'narration', status: 'done', needsReview: true },
    ])} voices={[]} />)
    openAudioPanel()
    const mark = screen.getByTestId('seg-mark-s1')
    expect(mark.getAttribute('title')).toContain(ko.story.audio.needsReviewHint)
    expect(mark.getAttribute('title')).not.toContain(ko.story.audio.approxHint)
  })
})
