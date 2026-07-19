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

const sceneEvent = (over = {}) => ({
  projectToken: 'tok1',
  operationId: 'scene-op-1',
  kind: 'scene-delta',
  ...over,
})

describe('useStoryPipeline scene-delta preview', () => {
  it('started gate 뒤 같은 op의 scene만 좌표별 누적하고 stale/ungated delta를 버린다', async () => {
    const { result } = await openHook()

    act(() => listeners['story:progress'](sceneEvent({
      chunkIndex: 0,
      localSceneNo: 0,
      scene: { summary: 'UNGATED', segments: [] },
    })))
    expect(result.current.previewScenes).toEqual({})

    act(() => listeners['story:progress'](sceneEvent({ phase: 'started' })))
    act(() => listeners['story:progress'](sceneEvent({
      chunkIndex: 1,
      localSceneNo: 0,
      scene: { summary: 'CHUNK-1', segments: [] },
    })))
    act(() => listeners['story:progress'](sceneEvent({
      chunkIndex: 0,
      localSceneNo: 2,
      scene: { summary: 'CHUNK-0', segments: [] },
    })))
    act(() => listeners['story:progress'](sceneEvent({
      operationId: 'stale-op',
      chunkIndex: 0,
      localSceneNo: 1,
      scene: { summary: 'STALE', segments: [] },
    })))

    expect(result.current.previewScenes).toEqual({
      '1:0': { chunkIndex: 1, localSceneNo: 0, scene: { summary: 'CHUNK-1', segments: [] } },
      '0:2': { chunkIndex: 0, localSceneNo: 2, scene: { summary: 'CHUNK-0', segments: [] } },
    })
  })

  it.each(['done', 'error', 'pending'])('scenes %s story:state는 preview/gate를 지우고 late delta를 막는다', async (status) => {
    const { result } = await openHook()
    act(() => listeners['story:progress'](sceneEvent({ phase: 'started' })))
    act(() => listeners['story:progress'](sceneEvent({
      chunkIndex: 0,
      localSceneNo: 0,
      scene: { summary: 'GHOST', segments: [] },
    })))

    act(() => listeners['story:state']({
      projectToken: 'tok1',
      operationId: 'scene-op-1',
      state: { steps: { scenes: { status } } },
      scenes: [{ sceneNo: 1, summary: 'FINAL', segments: [] }],
    }))
    expect(result.current.previewScenes).toEqual({})

    act(() => listeners['story:progress'](sceneEvent({
      chunkIndex: 0,
      localSceneNo: 1,
      scene: { summary: 'TOO-LATE', segments: [] },
    })))
    expect(result.current.previewScenes).toEqual({})
  })

  it('terminal story:state에서 preview가 이미 비었으면 같은 객체 참조를 유지한다', async () => {
    const { result } = await openHook()
    const emptyPreview = result.current.previewScenes

    act(() => listeners['story:state']({
      projectToken: 'tok1',
      operationId: 'scene-op-1',
      state: { steps: { scenes: { status: 'done' } } },
    }))

    expect(result.current.previewScenes).toBe(emptyPreview)
  })

  it('projectPath 전환 시 preview map과 scene op gate를 리셋한다', async () => {
    const { result, rerender } = await openHook()
    act(() => listeners['story:progress'](sceneEvent({ phase: 'started' })))
    act(() => listeners['story:progress'](sceneEvent({
      chunkIndex: 0,
      localSceneNo: 0,
      scene: { summary: 'GHOST', segments: [] },
    })))
    expect(result.current.previewScenes).not.toEqual({})

    rerender({ projectPath: '/other' })
    expect(result.current.previewScenes).toEqual({})

    act(() => listeners['story:progress']?.(sceneEvent({
      chunkIndex: 0,
      localSceneNo: 1,
      scene: { summary: 'LATE', segments: [] },
    })))
    expect(result.current.previewScenes).toEqual({})
  })

  it('scene-delta는 표시 전용 — durable scenes/onPushScenes를 절대 건드리지 않는다', async () => {
    const onPushScenes = vi.fn()
    const rendered = renderHook(
      ({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes }),
      { initialProps: { projectPath: '/p' } },
    )
    await act(() => rendered.result.current.open())
    const { result } = rendered

    act(() => listeners['story:progress'](sceneEvent({ phase: 'started' })))
    act(() => listeners['story:progress'](sceneEvent({
      chunkIndex: 0,
      localSceneNo: 0,
      scene: { summary: 'GHOST', segments: [{ type: 'narration', speaker: 's1', text: 'hi' }] },
    })))

    // preview에만 쌓이고 durable scenes는 비어 있어야 한다.
    expect(result.current.previewScenes['0:0']?.scene?.summary).toBe('GHOST')
    expect(result.current.scenes).toEqual([])
    expect(onPushScenes).not.toHaveBeenCalled()
  })
})
