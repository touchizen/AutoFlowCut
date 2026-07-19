import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStoryPipeline } from '../../src/hooks/useStoryPipeline.js'

let listeners

beforeEach(() => {
  listeners = {}
  window.electronAPI = {
    storyOpen: vi.fn(async () => ({ projectToken: 'tok1', state: { steps: {} } })),
    storyGetState: vi.fn(async () => ({ steps: {} })),
    storyStart: vi.fn(async () => ({ operationId: 'op1' })),
    storyAbort: vi.fn(async () => ({})),
    storyPushAck: vi.fn(async () => ({})),
    onStoryEvent: vi.fn((channel, callback) => {
      listeners[channel] = callback
      return () => delete listeners[channel]
    }),
  }
})

async function openHook() {
  const rendered = renderHook(
    ({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes: vi.fn() }),
    { initialProps: { projectPath: '/p' } },
  )
  await act(() => rendered.result.current.open())
  return rendered
}

const promptEvent = (over = {}) => ({
  projectToken: 'tok1',
  operationId: 'prompt-op-1',
  kind: 'prompt-delta',
  ...over,
})

describe('useStoryPipeline prompt-delta preview', () => {
  it('started gate 뒤 같은 op의 sceneNo별 prompt만 누적하고 stale/ungated delta를 버린다', async () => {
    const { result } = await openHook()

    act(() => listeners['story:progress'](promptEvent({ sceneNo: 1, imagePrompt: 'UNGATED', videoPrompt: 'UNGATED' })))
    expect(result.current.previewPrompts).toEqual({})

    act(() => listeners['story:progress'](promptEvent({ phase: 'started' })))
    act(() => listeners['story:progress'](promptEvent({ sceneNo: 1, imagePrompt: 'IMG-1', videoPrompt: 'VID-1' })))
    act(() => listeners['story:progress'](promptEvent({ sceneNo: 2, imagePrompt: 'IMG-2', videoPrompt: 'VID-2' })))
    act(() => listeners['story:progress'](promptEvent({ operationId: 'stale-op', sceneNo: 1, imagePrompt: 'STALE', videoPrompt: 'STALE' })))

    expect(result.current.previewPrompts).toEqual({
      1: { imagePrompt: 'IMG-1', videoPrompt: 'VID-1' },
      2: { imagePrompt: 'IMG-2', videoPrompt: 'VID-2' },
    })
  })

  it('새 started는 map/op를 교체하고 최종 story:state는 preview와 gate를 지운다', async () => {
    const { result } = await openHook()
    act(() => listeners['story:progress'](promptEvent({ phase: 'started' })))
    act(() => listeners['story:progress'](promptEvent({ sceneNo: 1, imagePrompt: 'OLD', videoPrompt: 'OLD' })))

    act(() => listeners['story:progress'](promptEvent({ operationId: 'prompt-op-2', phase: 'started' })))
    act(() => listeners['story:progress'](promptEvent({ sceneNo: 2, imagePrompt: 'LATE', videoPrompt: 'LATE' })))
    act(() => listeners['story:progress'](promptEvent({ operationId: 'prompt-op-2', sceneNo: 2, imagePrompt: 'NEW', videoPrompt: 'NEW' })))
    expect(result.current.previewPrompts).toEqual({ 2: { imagePrompt: 'NEW', videoPrompt: 'NEW' } })

    act(() => listeners['story:state']({
      projectToken: 'tok1',
      operationId: 'prompt-op-2',
      state: { steps: { prompts: { status: 'done' } } },
      scenes: [{ sceneNo: 2, imagePrompt: 'FINAL', videoPrompt: 'FINAL' }],
    }))
    expect(result.current.previewPrompts).toEqual({})

    act(() => listeners['story:progress'](promptEvent({ operationId: 'prompt-op-2', sceneNo: 2, imagePrompt: 'TOO-LATE', videoPrompt: 'TOO-LATE' })))
    expect(result.current.previewPrompts).toEqual({})
  })

  it('projectPath 전환 시 preview map과 prompt op gate를 리셋한다', async () => {
    const { result, rerender } = await openHook()
    act(() => listeners['story:progress'](promptEvent({ phase: 'started' })))
    act(() => listeners['story:progress'](promptEvent({ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: 'VID' })))
    expect(result.current.previewPrompts).not.toEqual({})

    rerender({ projectPath: '/other' })
    expect(result.current.previewPrompts).toEqual({})

    act(() => listeners['story:progress']?.(promptEvent({ sceneNo: 1, imagePrompt: 'LATE', videoPrompt: 'LATE' })))
    expect(result.current.previewPrompts).toEqual({})
  })
})
