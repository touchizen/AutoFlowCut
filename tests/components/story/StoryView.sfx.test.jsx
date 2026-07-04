/**
 * M2b-5: audio 세그먼트 테이블이 sfx 세그먼트를 표시한다 — description을 세그먼트 열에,
 * 소스 선택 드롭다운(elevenlabs/library)을 노출하고, 선택 소스를 재생성 시 sfxSources로 전달한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))

import StoryView from '../../../src/components/story/StoryView.jsx'

const narr = (id, speaker) => ({ id, speaker, text: `t${id}`, status: 'done', startMs: 0, durationMs: 1000, audioPath: `/a/${id}.mp3`, type: 'narration' })
const sfx = (id, description, over = {}) => ({ id, type: 'sfx', description, status: 'done', startMs: 1000, durationMs: 800, audioPath: `/a/${id}.mp3`, ...over })

const pipeline = (over = {}) => ({
  state: {
    steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'pending' } },
    speakers: [{ id: 'narrator', name: '나레이션' }],
  },
  scenes: [{ storyId: 'a', segments: [narr('s1', 'narrator'), sfx('s2', 'door creaking open')] }],
  streamingText: '', scriptText: '', start: vi.fn(), abort: vi.fn(), openError: null, ttsPreview: vi.fn(),
  segmentProgress: {},
  ...over,
})

function renderAudio(p) {
  render(<StoryView pipeline={p} voices={[]} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '오디오' })) // 스텝퍼 → viewedStep=audio
}

function sfxRow(desc = 'door creaking open') {
  // description 텍스트를 담은 tr을 찾는다
  const cell = screen.getByText(desc)
  return cell.closest('tr')
}

describe('StoryView M2b-5 — sfx 세그먼트 표시/소스선택', () => {
  it('sfx 세그먼트는 description을 세그먼트 열에 표시', () => {
    renderAudio(pipeline())
    expect(screen.getByText('door creaking open')).toBeTruthy()
  })

  it('sfx 행에 소스 선택 드롭다운(elevenlabs/library)이 있다', () => {
    renderAudio(pipeline())
    const row = sfxRow()
    const select = within(row).getByRole('combobox')
    const opts = within(select).getAllByRole('option').map((o) => o.value)
    expect(opts).toContain('elevenlabs')
    expect(opts).toContain('library')
  })

  it('소스 변경 후 재생성 시 start("audio", { sfxSources: { s2: "library" } }) 전달', () => {
    const start = vi.fn()
    renderAudio(pipeline({ start }))
    const row = sfxRow()
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'library' } })
    // sfx 행 재생성(↻) 버튼
    fireEvent.click(within(row).getByRole('button', { name: /재생성|↻/ }))
    expect(start).toHaveBeenCalledWith('audio', expect.objectContaining({ sfxSources: { s2: 'library' } }))
  })

  it('소스 미변경이면 기본값(elevenlabs)이 드롭다운에 선택돼 있다', () => {
    renderAudio(pipeline())
    const row = sfxRow()
    expect(within(row).getByRole('combobox').value).toBe('elevenlabs')
  })

  it('세그먼트에 sourceMode가 영속돼 있으면 그 값을 초기 선택', () => {
    const p = pipeline({ scenes: [{ storyId: 'a', segments: [sfx('s2', 'thunder', { sourceMode: 'library' })] }] })
    renderAudio(p)
    const row = sfxRow('thunder')
    expect(within(row).getByRole('combobox').value).toBe('library')
  })

  it('Codex-Med: 같은 id가 재분리로 다른 description이 되면 옛 소스 오버라이드가 적용되지 않는다', () => {
    const start = vi.fn()
    const { rerender } = render(<StoryView pipeline={pipeline({ start })} voices={[]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    // s2(door creaking open)를 library로 변경
    fireEvent.change(within(sfxRow()).getByRole('combobox'), { target: { value: 'library' } })
    // 재분리: 같은 id s2가 다른 효과음(thunder)으로 바뀜
    const p2 = pipeline({ start, scenes: [{ storyId: 'a', segments: [narr('s1', 'narrator'), sfx('s2', 'thunder')] }] })
    rerender(<StoryView pipeline={p2} voices={[]} onClose={vi.fn()} />)
    const row = sfxRow('thunder')
    // 옛 선택(library)이 새 세그먼트에 잘못 적용되면 안 됨 → 기본값
    expect(within(row).getByRole('combobox').value).toBe('elevenlabs')
    // 재생성 시에도 stale override 미전달
    fireEvent.click(within(row).getByRole('button', { name: /재생성|↻/ }))
    const lastCall = start.mock.calls[start.mock.calls.length - 1]
    expect(lastCall[1].sfxSources).toBeUndefined()
  })

  it('Codex-Low: narration 없이 sfx만 있어도 오디오 타임라인(LiveTimeline)이 렌더', () => {
    const p = pipeline({ scenes: [{ storyId: 'a', segments: [sfx('s2', 'thunder')] }] })
    renderAudio(p)
    expect(screen.getByTestId('lt')).toBeTruthy()
  })

  it('sfx 행에도 테스트 버튼이 있고, 선택 소스를 sfxSources로 ttsPreview에 전달', async () => {
    const ttsPreview = vi.fn().mockResolvedValue({ segments: [] })
    renderAudio(pipeline({ ttsPreview }))
    const row = sfxRow()
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'library' } })
    fireEvent.click(within(row).getByRole('button', { name: /테스트/ }))
    expect(ttsPreview).toHaveBeenCalledWith(expect.objectContaining({ segmentIds: ['s2'], sfxSources: { s2: 'library' } }))
  })
})
