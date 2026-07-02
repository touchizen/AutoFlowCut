import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useStoryPipeline } from '../../src/hooks/useStoryPipeline.js'

let listeners
beforeEach(() => {
  listeners = {}
  window.electronAPI = {
    storyOpen: vi.fn(async () => ({ projectToken: 'tok1', state: { steps: {} } })),
    storyStart: vi.fn(async () => ({ operationId: 'op1' })),
    storyAbort: vi.fn(async () => ({})),
    storyPushAck: vi.fn(async () => ({})),
    onStoryEvent: vi.fn((ch, cb) => { listeners[ch] = cb; return () => delete listeners[ch] }),
  }
})

describe('useStoryPipeline', () => {
  it('open 후 state 이벤트를 반영한다', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    act(() => listeners['story:state']({ projectToken: 'tok1', state: { steps: { script: { status: 'done' } } } }))
    expect(result.current.state.steps.script.status).toBe('done')
  })
  it('토큰 불일치 이벤트는 drop', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    act(() => listeners['story:state']({ projectToken: 'OTHER', state: { steps: { script: { status: 'done' } } } }))
    expect(result.current.state?.steps?.script?.status).not.toBe('done')
  })
  it('pushScenes 수신 → onPushScenes 성공 → ack(ok:true)', async () => {
    const onPushScenes = vi.fn(async () => {})
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes }))
    await act(() => result.current.open())
    await act(() => listeners['story:pushScenes']({ projectToken: 'tok1', operationId: 'op2', pushRevision: 1, scenes: [] }))
    await waitFor(() => expect(window.electronAPI.storyPushAck).toHaveBeenCalledWith(
      expect.objectContaining({ projectToken: 'tok1', pushRevision: 1, ok: true }),
    ))
  })
  it('onPushScenes 실패 → ack(ok:false)', async () => {
    const onPushScenes = vi.fn(async () => { throw new Error('save fail') })
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes }))
    await act(() => result.current.open())
    await act(() => listeners['story:pushScenes']({ projectToken: 'tok1', operationId: 'op2', pushRevision: 1, scenes: [] }))
    await waitFor(() => expect(window.electronAPI.storyPushAck).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, reason: expect.stringContaining('save fail') }),
    ))
  })
})
