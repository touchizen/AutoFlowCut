/**
 * 화자별 진행 표시 — 하단 전체 진행(초시계)에 더해, 오디오 탭 성우 행마다 "몇/몇 세그먼트 완성"을
 * 보여준다. 상태 판정은 세그먼트 목록과 같은 규칙(실시간 segmentProgress > 영속 seg.status).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))

import StoryView from '../../../src/components/story/StoryView.jsx'

const seg = (id, speaker, status = 'pending') => ({ id, speaker, text: `문장${id}`, status, type: 'narration' })

const pipeline = (over = {}) => ({
  state: {
    steps: {
      script: { status: 'done' }, scenes: { status: 'done' },
      audio: { status: 'done', updatedAt: new Date(0).toISOString() }, prompts: { status: 'pending' },
    },
    speakers: [{ id: 'narrator', name: '나레이션' }],
  },
  scenes: [{ storyId: 'a', segments: [seg('s1', 'narrator'), seg('s2', 'narrator'), seg('s3', 'narrator')] }],
  streamingText: '', scriptText: '', start: vi.fn(), abort: vi.fn(), openError: null, ttsPreview: vi.fn(),
  segmentProgress: {},
  ...over,
})

const openAudioPanel = () => fireEvent.click(screen.getByRole('button', { name: '오디오' }))

describe('StoryView — 화자별 진행 카운터', () => {
  it('오디오 완료 후 화자 행에 완성/전체 세그먼트 수를 보여준다', () => {
    const p = pipeline({ segmentProgress: { s1: 'done', s2: 'done', s3: 'done' } })
    render(<StoryView pipeline={p} voices={[]} />)
    openAudioPanel()
    expect(screen.getByTestId('voice-progress-narrator')).toHaveTextContent('3/3')
  })

  // seg.speaker는 id가 아니라 **이름/별칭**일 수 있다(나레이터는 {id:'narrator', name:'나레이션'}로
  // 시딩된다). 진행 Map을 원시 seg.speaker로 키잉하고 sp.id로 조회하면 주 화자에서 바로 어긋나
  // 전 세그먼트가 done인데도 배지가 통째로 사라진다. main의 findSpeakerByRef와 같은 정규화로 푼다.
  it('세그먼트가 화자를 이름으로 참조해도 배지가 나온다 — id 완전일치로 보면 안 된다', () => {
    const p = pipeline({
      scenes: [{ storyId: 'a', segments: [seg('s1', '나레이션'), seg('s2', '나레이션')] }],
      segmentProgress: { s1: 'done', s2: 'done' },
    })
    render(<StoryView pipeline={p} voices={[]} />)
    openAudioPanel()
    expect(screen.getByTestId('voice-progress-narrator')).toHaveTextContent('2/2')
  })

  it('이름 참조와 id 참조가 섞여도 한 화자로 합산한다', () => {
    const p = pipeline({
      scenes: [{ storyId: 'a', segments: [seg('s1', 'narrator'), seg('s2', '나레이션')] }],
      segmentProgress: { s1: 'done', s2: 'done' },
    })
    render(<StoryView pipeline={p} voices={[]} />)
    openAudioPanel()
    expect(screen.getByTestId('voice-progress-narrator')).toHaveTextContent('2/2')
  })

  // refKey 는 공백뿐인 참조를 'narrator' 로 접는다(화자 미지정 = 나레이터). 그래서 name 이 '   ' 인
  // 인물이 나레이터 별칭을 갖게 되고, 목록에서 나레이터보다 앞이면 **나레이터 세그먼트가 그 인물
  // 진행률로** 합쳐진다. main 의 speakerReferenceKeys 와 같은 방어가 renderer 에도 있어야 한다.
  it('이름이 공백뿐인 인물이 나레이터 세그먼트를 가로채지 않는다', () => {
    const p = pipeline({
      state: {
        steps: {
          script: { status: 'done' }, scenes: { status: 'done' },
          audio: { status: 'done', updatedAt: new Date(0).toISOString() }, prompts: { status: 'pending' },
        },
        speakers: [{ id: 'char', name: '   ' }, { id: 'narrator', name: '나레이션' }], // 인물이 앞
      },
      scenes: [{ storyId: 'a', segments: [seg('s1', 'narrator'), seg('s2', 'narrator')] }],
      segmentProgress: { s1: 'done', s2: 'done' },
    })
    render(<StoryView pipeline={p} voices={[]} />)
    openAudioPanel()
    expect(screen.getByTestId('voice-progress-narrator')).toHaveTextContent('2/2')
    expect(screen.queryByTestId('voice-progress-char')).toBeNull() // 인물이 가로채면 안 된다
  })

  it('일부만 완성됐으면(미완/오류) 숫자와 오류 표시가 함께 나온다', () => {
    const p = pipeline({ segmentProgress: { s1: 'done', s2: 'done', s3: 'error' } })
    render(<StoryView pipeline={p} voices={[]} />)
    openAudioPanel()
    const badge = screen.getByTestId('voice-progress-narrator')
    expect(badge).toHaveTextContent('2/3')
    expect(badge).toHaveTextContent('⚠1')
    expect(badge.className).not.toContain('done') // 전부 완성이 아니라 done 강조는 안 붙는다
  })

  it('영속 seg.status만 있어도(재오픈 후 segmentProgress 비었을 때) 카운트한다', () => {
    const p = pipeline({
      scenes: [{ storyId: 'a', segments: [seg('s1', 'narrator', 'done'), seg('s2', 'narrator', 'done')] }],
      segmentProgress: {},
    })
    render(<StoryView pipeline={p} voices={[]} />)
    openAudioPanel()
    expect(screen.getByTestId('voice-progress-narrator')).toHaveTextContent('2/2')
  })

  it('sfx 세그먼트는 화자 카운트에서 제외한다 — 화자 오디오가 아니다', () => {
    const p = pipeline({
      scenes: [{ storyId: 'a', segments: [
        seg('s1', 'narrator', 'done'),
        { id: 'f1', type: 'sfx', description: 'crow', status: 'done' },
      ] }],
      segmentProgress: {},
    })
    render(<StoryView pipeline={p} voices={[]} />)
    openAudioPanel()
    expect(screen.getByTestId('voice-progress-narrator')).toHaveTextContent('1/1') // sfx는 안 센다
  })
})
