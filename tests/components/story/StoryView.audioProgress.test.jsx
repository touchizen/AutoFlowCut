/**
 * D: audio 생성 중에도 세그먼트 목록(테이블)을 보여주고, pipeline.segmentProgress로 각 세그먼트가
 * 대기→진행 중→완료로 실시간 표시된다.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))

import StoryView from '../../../src/components/story/StoryView.jsx'

const seg = (id, speaker, status = 'pending') => ({ id, speaker, text: `문장${id}`, status, type: 'narration' })

const pipeline = (over = {}) => ({
  state: {
    steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'running', updatedAt: new Date(0).toISOString() }, prompts: { status: 'pending' } },
    speakers: [{ id: 'narrator', name: '나레이션' }],
  },
  scenes: [{ storyId: 'a', segments: [seg('s1', 'narrator'), seg('s2', 'narrator')] }],
  streamingText: '', scriptText: '', start: vi.fn(), abort: vi.fn(), openError: null, ttsPreview: vi.fn(),
  segmentProgress: {},
  ...over,
})

describe('StoryView D — audio 생성 중 실시간 진행', () => {
  it('audio running 중에도 세그먼트 목록(문장 텍스트)이 보인다', () => {
    render(<StoryView pipeline={pipeline()} voices={[]} />)
    expect(screen.getByText('문장s1')).toBeTruthy()
    expect(screen.getByText('문장s2')).toBeTruthy()
  })

  it('segmentProgress가 세그먼트 status를 실시간 덮어쓴다(s1 완료, s2 진행 중)', () => {
    const p = pipeline({ segmentProgress: { s1: 'done', s2: 'running' } })
    render(<StoryView pipeline={p} voices={[]} />)
    // 세그먼트 테이블 안의 status 셀로 좁혀서 확인(스텝퍼 배지와 텍스트 겹침 방지)
    const table = document.querySelector('.story-readonly-table')
    expect(table).toBeTruthy()
    expect(table.textContent).toContain('완료')     // s1 progress=done
    expect(table.textContent).toContain('진행 중')  // s2 progress=running
  })
})
