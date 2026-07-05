import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useStoryPipeline } from '../../src/hooks/useStoryPipeline.js'

let listeners
beforeEach(() => {
  listeners = {}
  window.electronAPI = {
    storyOpen: vi.fn(async () => ({ projectToken: 'tok1', state: { steps: {} }, scenes: [], scriptText: '복원대본' })),
    storyGetState: vi.fn(async () => ({ steps: {} })),
    storyStart: vi.fn(async () => ({ operationId: 'op1' })),
    storyAbort: vi.fn(async () => ({})),
    storyPushAck: vi.fn(async () => ({})),
    storyGenerateTitle: vi.fn(async () => ({ title: '생성된 제목' })),
    onStoryEvent: vi.fn((ch, cb) => { listeners[ch] = cb; return () => delete listeners[ch] }),
  }
})

describe('useStoryPipeline scriptText/generateTitle', () => {
  it('open 응답의 scriptText를 훅 상태로 반영한다', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    expect(result.current.scriptText).toBe('복원대본')
  })

  it('story:state의 scriptText를 훅 상태로 반영한다', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    act(() => listeners['story:state']({ projectToken: 'tok1', state: { steps: {} }, scriptText: '스트림대본' }))
    expect(result.current.scriptText).toBe('스트림대본')
  })

  it('scriptText 없는 story:state는 기존 값을 유지한다', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    act(() => listeners['story:state']({ projectToken: 'tok1', state: { steps: {} } }))
    expect(result.current.scriptText).toBe('복원대본')
  })

  it('projectPath 전환 시 scriptText를 초기화한다', async () => {
    const { result, rerender } = renderHook(
      ({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes: vi.fn() }),
      { initialProps: { projectPath: '/A' } },
    )
    await act(() => result.current.open())
    expect(result.current.scriptText).toBe('복원대본')
    await act(async () => { rerender({ projectPath: '/B' }) })
    expect(result.current.scriptText).toBe('')
  })

  it('generateTitle이 storyGenerateTitle을 projectToken/scriptMd/options로 호출하고 {title}을 반환한다', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    let ret
    const options = { engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' }
    await act(async () => { ret = await result.current.generateTitle('# 대본 마크다운', options) })
    expect(window.electronAPI.storyGenerateTitle).toHaveBeenCalledWith({ projectToken: 'tok1', scriptMd: '# 대본 마크다운', options })
    expect(ret).toEqual({ title: '생성된 제목' })
  })
})
