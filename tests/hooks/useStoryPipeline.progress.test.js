/**
 * D: story:progress(audio-segment) 이벤트를 받아 segmentProgress(segId→status)로 노출.
 * StoryView 목록이 audio 생성 중 세그먼트 상태를 실시간 표시하는 데 쓴다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStoryPipeline } from '../../src/hooks/useStoryPipeline.js'

function installApi() {
  const handlers = {}
  window.electronAPI = {
    onStoryEvent: (ch, fn) => { handlers[ch] = fn; return () => {} },
    storyOpen: async () => ({ projectToken: 'TOK', state: {}, scenes: [] }),
    storyGetState: async () => ({}),
    storyStart: async () => ({ operationId: 'op2' }),
    storyAbort: async () => {},
  }
  return handlers
}

describe('useStoryPipeline — segmentProgress(story:progress)', () => {
  beforeEach(() => installApi())

  it('audio-segment progress를 segId→status로 누적한다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })

    act(() => handlers['story:progress']({ projectToken: 'TOK', kind: 'audio-segment', segId: 's1', status: 'running' }))
    act(() => handlers['story:progress']({ projectToken: 'TOK', kind: 'audio-segment', segId: 's1', status: 'done' }))
    act(() => handlers['story:progress']({ projectToken: 'TOK', kind: 'audio-segment', segId: 's2', status: 'running' }))

    expect(result.current.segmentProgress).toEqual({ s1: 'done', s2: 'running' })
  })

  it('다른 projectToken의 progress는 무시', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })

    act(() => handlers['story:progress']({ projectToken: 'STALE', kind: 'audio-segment', segId: 's1', status: 'done' }))
    expect(result.current.segmentProgress).toEqual({})
  })
})
