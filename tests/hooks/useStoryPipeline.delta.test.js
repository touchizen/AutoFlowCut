import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStoryPipeline } from '../../src/hooks/useStoryPipeline.js'

// electronAPI onStoryEvent 목: 핸들러를 캡처해 수동 발화
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

describe('useStoryPipeline delta 필터', () => {
  beforeEach(() => installApi())

  it('활성 op와 다른 operationId의 delta는 무시한다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    // running 스텝 story:state로 활성 op = 'op2' 설정
    act(() => handlers['story:state']({ projectToken: 'TOK', operationId: 'op2', state: { steps: { script: { status: 'running' } } } }))
    // 옛 op 'op1' 델타 → 무시
    act(() => handlers['story:delta']({ projectToken: 'TOK', operationId: 'op1', text: 'STALE' }))
    // 현재 op 'op2' 델타 → 반영
    act(() => handlers['story:delta']({ projectToken: 'TOK', operationId: 'op2', text: 'LIVE' }))
    expect(result.current.streamingText).toBe('LIVE')
  })
})
