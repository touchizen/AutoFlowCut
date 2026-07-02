import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
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

  // 회귀: main의 story:open 처리 중 maybeResendPush()가 재발신하는 story:pushScenes가
  // renderer의 storyOpen() resolve(=tokenRef 세팅) 전에 도착하면 토큰 불일치로 drop된다.
  // open() 완료 후 storyGetState()를 한 번 호출해 동일한 재발신 로직을 재실행시켜 복구한다.
  it('open() resolve 전에 도착한 pushScenes는 토큰 불일치로 drop된다', async () => {
    let resolveOpen
    window.electronAPI.storyOpen = vi.fn(() => new Promise((resolve) => { resolveOpen = resolve }))
    const onPushScenes = vi.fn(async () => {})
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes }))

    let openPromise
    act(() => { openPromise = result.current.open() })

    // storyOpen이 아직 resolve되지 않아 tokenRef.current가 null인 상태에서 pushScenes 도착
    await act(async () => {
      await listeners['story:pushScenes']?.({ projectToken: 'tok1', operationId: 'op-early', pushRevision: 1, scenes: [] })
    })
    expect(onPushScenes).not.toHaveBeenCalled()
    expect(window.electronAPI.storyPushAck).not.toHaveBeenCalled()

    resolveOpen({ projectToken: 'tok1', state: { steps: {} } })
    await act(async () => { await openPromise })
  })

  it('open() resolve 후 올바른 projectToken으로 storyGetState를 호출한다', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    expect(window.electronAPI.storyGetState).toHaveBeenCalledWith({ projectToken: 'tok1' })
  })

  it('storyGetState 재조회 시점에 재발신된 pushScenes(올바른 토큰)는 정상 처리 + ack(ok:true)', async () => {
    const onPushScenes = vi.fn(async () => {})
    window.electronAPI.storyGetState = vi.fn(async ({ projectToken }) => {
      // main의 getState 핸들러가 maybeResendPush()로 story:pushScenes를 재발신하는 상황을 시뮬레이션
      listeners['story:pushScenes']?.({ projectToken, operationId: 'op-resend', pushRevision: 2, scenes: [] })
      return { steps: {} }
    })
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes }))
    await act(() => result.current.open())

    await waitFor(() => expect(onPushScenes).toHaveBeenCalled())
    await waitFor(() => expect(window.electronAPI.storyPushAck).toHaveBeenCalledWith(
      expect.objectContaining({ projectToken: 'tok1', pushRevision: 2, ok: true }),
    ))
  })

  it('unmount 시 이벤트 리스너를 해제한다 — 이후 이벤트 발화는 무해하다', async () => {
    const onPushScenes = vi.fn(async () => {})
    const { result, unmount } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes }))
    await act(() => result.current.open())
    expect(listeners['story:state']).toBeTypeOf('function')

    unmount()

    expect(listeners['story:state']).toBeUndefined()
    expect(listeners['story:delta']).toBeUndefined()
    expect(listeners['story:pushScenes']).toBeUndefined()
    expect(() => listeners['story:state']?.({ projectToken: 'tok1', state: { steps: {} } })).not.toThrow()
    expect(onPushScenes).not.toHaveBeenCalled()
  })
})
