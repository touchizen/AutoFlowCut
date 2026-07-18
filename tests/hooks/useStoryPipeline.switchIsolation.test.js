import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStoryPipeline } from '../../src/hooks/useStoryPipeline.js'

let listeners
beforeEach(() => {
  listeners = {}
  window.electronAPI = {
    storyOpen: vi.fn(async () => ({ projectToken: 'tok1', state: { steps: {} }, scenes: [{ storyId: 'a' }], scriptText: '복원대본' })),
    storyGetState: vi.fn(async () => ({ steps: {}, scenes: [{ storyId: 'a' }], scriptText: '복원대본' })),
    storyStart: vi.fn(async () => ({ operationId: 'op1' })),
    storyAbort: vi.fn(async () => ({})),
    storyPushAck: vi.fn(async () => ({})),
    onStoryEvent: vi.fn((ch, cb) => { listeners[ch] = cb; return () => delete listeners[ch] }),
  }
})

describe('useStoryPipeline 프로젝트 전환 격리 타이밍', () => {
  // Blocking/Codex: <StoryView key={storyProjectPath}>로 즉시 재마운트되는 StoryView는
  // 전환을 감지한 그 render의 pipeline 반환값으로 초기 폼/phase를 잡는다. 전환 감지 render가
  // 옛 프로젝트의 state/scriptText/scenes를 그대로 반환하면(effect의 리셋은 다음 tick), 새
  // 프로젝트가 옛 값으로 editor/title/options로 뜬다. 전환 감지 render에서 즉시 빈 값을 반환해야 한다.
  it('전환 감지 render에서 즉시 state=null / scriptText="" / scenes=[]를 반환한다', async () => {
    const renders = []
    const { result, rerender } = renderHook(
      ({ projectPath }) => {
        const p = useStoryPipeline({ projectPath, onPushScenes: vi.fn() })
        renders.push({ projectPath, state: p.state, streamingText: p.streamingText, scriptText: p.scriptText, scenes: p.scenes })
        return p
      },
      { initialProps: { projectPath: '/A' } },
    )
    await act(() => result.current.open())
    act(() => listeners['story:delta']({ projectToken: 'tok1', text: 'A 스트리밍' }))
    // A 프로젝트: editor 진입에 필요한 scriptText/state가 채워진 상태
    expect(result.current.scriptText).toBe('복원대본')
    expect(result.current.streamingText).toBe('A 스트리밍')

    renders.length = 0
    await act(async () => { rerender({ projectPath: '/B' }) })

    // 전환을 처음 감지한 render(B) — effect의 리셋 이전 — 에서 이미 빈 값을 반환해야 한다
    const firstB = renders.find((r) => r.projectPath === '/B')
    expect(firstB).toBeTruthy()
    expect(firstB.streamingText).toBe('')
    expect(firstB.scriptText).toBe('')
    expect(firstB.state).toBeNull()
    expect(firstB.scenes).toEqual([])
  })

  it('전환 effect flush 후 segmentProgress와 openError를 초기화한다', async () => {
    const { result, rerender } = renderHook(
      ({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes: vi.fn() }),
      { initialProps: { projectPath: '/A' } },
    )
    await act(() => result.current.open())
    act(() => listeners['story:progress']({
      projectToken: 'tok1',
      kind: 'audio-segment',
      segId: 's1-1',
      status: 'done',
    }))
    window.electronAPI.storyOpen.mockResolvedValueOnce({ error: 'A-open-error' })
    await act(() => result.current.open())
    expect(result.current.segmentProgress).toEqual({ 's1-1': 'done' })
    expect(result.current.openError).toBe('A-open-error')

    await act(async () => { rerender({ projectPath: '/B' }) })
    await act(async () => {})

    expect.soft(result.current.segmentProgress).toEqual({})
    expect.soft(result.current.openError).toBeNull()
  })
})
