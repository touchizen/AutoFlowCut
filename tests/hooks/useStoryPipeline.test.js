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
    storyListLlmOptions: vi.fn(async () => ({
      options: [{ id: 'codex:gpt-5.5', engine: 'codex', model: 'gpt-5.5', label: 'Codex GPT-5.5' }],
      defaultOption: { id: 'codex:gpt-5.5', engine: 'codex', model: 'gpt-5.5', label: 'Codex GPT-5.5' },
    })),
    onStoryEvent: vi.fn((ch, cb) => { listeners[ch] = cb; return () => delete listeners[ch] }),
  }
})

describe('useStoryPipeline', () => {
  it('storyListLlmOptions 결과를 pipeline catalog로 노출한다', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await waitFor(() => expect(result.current.llmOptions).toEqual([
      { id: 'codex:gpt-5.5', engine: 'codex', model: 'gpt-5.5', label: 'Codex GPT-5.5' },
    ]))
    expect(result.current.defaultLlmOption).toEqual({ id: 'codex:gpt-5.5', engine: 'codex', model: 'gpt-5.5', label: 'Codex GPT-5.5' })
  })

  it('storyListLlmOptions 브릿지가 없어도 hook이 동작한다', async () => {
    delete window.electronAPI.storyListLlmOptions
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    expect(result.current.llmOptions).toBeNull()
    expect(result.current.defaultLlmOption).toBeNull()
  })

  it('open 후 state 이벤트를 반영한다', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    act(() => listeners['story:state']({ projectToken: 'tok1', state: { steps: { script: { status: 'done' } } } }))
    expect(result.current.state.steps.script.status).toBe('done')
  })
  // Minor: 스텝이 running으로 전환될 때 stepMachine.start()는 story:state를 scenes 필드
  // 없이 먼저 emit한다(하류 리셋 알림용). scenes를 매번 p.scenes || []로 덮어쓰면 이미 표시
  // 중이던 씬 목록이 running 전환 순간 화면에서 사라진다 — scenes가 없는(undefined) 이벤트는
  // 기존 scenes를 유지해야 한다.
  it('scenes 수신 후 scenes 없는 state 이벤트를 받아도 scenes를 유지한다', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    act(() => listeners['story:state']({
      projectToken: 'tok1',
      state: { steps: { scenes: { status: 'done' } } },
      scenes: [{ storyId: 's1', segments: [{ speaker: 'a', text: 'hi' }] }],
    }))
    expect(result.current.scenes).toEqual([{ storyId: 's1', segments: [{ speaker: 'a', text: 'hi' }] }])

    // running 전환 emit — scenes 필드가 아예 없다
    act(() => listeners['story:state']({
      projectToken: 'tok1',
      state: { steps: { scenes: { status: 'pending' }, prompts: { status: 'running' } } },
    }))
    expect(result.current.scenes).toEqual([{ storyId: 's1', segments: [{ speaker: 'a', text: 'hi' }] }])
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

  it('pushCharacters 수신 → onPushCharacters 호출(ack 없음)', async () => {
    const onPushCharacters = vi.fn(async () => {})
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn(), onPushCharacters }))
    await act(() => result.current.open())
    await act(() => listeners['story:pushCharacters']({
      projectToken: 'tok1',
      operationId: 'op-char',
      storyCharacters: [{ name: '민수', appearance: '' }],
    }))
    expect(onPushCharacters).toHaveBeenCalledWith(expect.objectContaining({
      storyCharacters: [{ name: '민수', appearance: '' }],
    }))
    expect(window.electronAPI.storyPushAck).not.toHaveBeenCalled()
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

  // Important: Story 뷰 ②/④ 패널이 실데이터를 그리려면 scenes를 state와 별도 상태로 보관해야 한다.
  it('story:state 이벤트의 scenes를 별도 상태로 반영한다', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    act(() => listeners['story:state']({
      projectToken: 'tok1',
      state: { steps: { scenes: { status: 'done' } } },
      scenes: [{ storyId: 's1', segments: [{ speaker: 'a', text: 'hi' }] }],
    }))
    expect(result.current.scenes).toEqual([{ storyId: 's1', segments: [{ speaker: 'a', text: 'hi' }] }])
    // state 자체에는 scenes가 섞이지 않는다 (별도 상태)
    expect(result.current.state.scenes).toBeUndefined()
  })

  it('open()이 storyOpen/storyGetState가 반환한 scenes를 반영한다', async () => {
    window.electronAPI.storyOpen = vi.fn(async () => ({ projectToken: 'tok1', state: { steps: {} }, scenes: [{ storyId: 'a' }] }))
    window.electronAPI.storyGetState = vi.fn(async () => ({ steps: {}, scenes: [{ storyId: 'b' }] }))
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    expect(result.current.scenes).toEqual([{ storyId: 'b' }])
  })

  // HIGH/Codex: Story 뷰 밖(useStoryAutoOpen이 동작하지 않는 상태)에서 프로젝트가 전환돼도
  // useStoryPipeline은 App 레벨에 계속 마운트돼 있어 tokenRef가 옛 프로젝트 토큰을 유지한다.
  // 이후 늦게 도착하는 옛 프로젝트의 pushScenes가 새 프로젝트에 잘못 적용될 수 있다 — projectPath
  // 변경을 감지해 즉시 토큰을 drop하고 상태를 초기화해야 한다.
  it('projectPath 변경 시 옛 토큰을 즉시 drop하고 state/scenes/streamingText를 초기화한다', async () => {
    const onPushScenes = vi.fn(async () => {})
    const { result, rerender } = renderHook(
      ({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes }),
      { initialProps: { projectPath: '/A' } },
    )
    await act(() => result.current.open())
    expect(result.current.state).toEqual({ steps: {} })

    act(() => listeners['story:delta']({ projectToken: 'tok1', text: '스트리밍' }))
    expect(result.current.streamingText).toBe('스트리밍')

    rerender({ projectPath: '/B' })

    expect(result.current.state).toBeNull()
    expect(result.current.scenes).toEqual([])
    expect(result.current.streamingText).toBe('')
    expect(window.electronAPI.storyAbort).toHaveBeenCalledWith(expect.objectContaining({ projectToken: 'tok1' }))

    // 옛 프로젝트(A) 토큰으로 늦게 도착하는 pushScenes는 drop 되어야 한다
    await act(async () => {
      await listeners['story:pushScenes']?.({ projectToken: 'tok1', operationId: 'op-late', pushRevision: 9, scenes: [] })
    })
    expect(onPushScenes).not.toHaveBeenCalled()
  })

  // HIGH: rerender(전환)와 effect flush 사이의 프레임에 옛 프로젝트의 pushScenes가 도착하면,
  // tokenRef 무효화가 useEffect(passive)에 의존할 경우 아직 옛 토큰이 남아있어 이벤트가 통과하고
  // onPushRef.current는 이미 새 프로젝트의 onPushScenes를 가리켜 옛 씬이 새 프로젝트에 저장될 수
  // 있다. 렌더 본문에서 동기적으로 tokenRef를 무효화해야 이 창이 없어진다 — rerender 직후(=렌더는
  // 이미 실행됐지만, act로 감싸지 않아 이 시점까지의 effect flush 여부와 무관하게) 옛 토큰으로
  // pushScenes를 동기 발화해도 즉시 drop 되어야 한다.
  it('rerender 직후 옛 토큰의 pushScenes를 동기적으로 drop한다 (렌더 동기 무효화)', async () => {
    const onPushScenes = vi.fn(async () => {})
    const { result, rerender } = renderHook(
      ({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes }),
      { initialProps: { projectPath: '/A' } },
    )
    await act(() => result.current.open())

    rerender({ projectPath: '/B' })
    // act 밖에서 동기 발화 — rerender와 effect flush 사이 타이밍을 흉내낸다.
    listeners['story:pushScenes']?.({ projectToken: 'tok1', operationId: 'op-race', pushRevision: 1, scenes: [] })

    expect(onPushScenes).not.toHaveBeenCalled()
    expect(window.electronAPI.storyPushAck).not.toHaveBeenCalled()
  })

  it('projectPath가 변하지 않으면 토큰/상태를 초기화하지 않는다', async () => {
    const onPushScenes = vi.fn(async () => {})
    const { result, rerender } = renderHook(
      ({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes }),
      { initialProps: { projectPath: '/A' } },
    )
    await act(() => result.current.open())
    window.electronAPI.storyAbort.mockClear()

    rerender({ projectPath: '/A' })

    expect(window.electronAPI.storyAbort).not.toHaveBeenCalled()
    expect(result.current.state).toEqual({ steps: {} })
  })

  // Minor: open()이 in-flight인 동안 projectPath가 바뀌면(예: 사용자가 빠르게 다른 프로젝트로
  // 전환) 늦게 resolve된 옛 open() 응답이 tokenRef/state를 새 프로젝트 위로 덮어써서는 안 된다.
  // 호출 시점의 projectPath를 캡처해두고, resolve 시점에 현재 projectPath와 다르면 반영을 skip.
  it('open() 진행 중 projectPath가 바뀌면 늦게 resolve된 결과로 tokenRef/state를 갱신하지 않는다', async () => {
    let resolveOpen
    window.electronAPI.storyOpen = vi.fn(() => new Promise((resolve) => { resolveOpen = resolve }))
    const { result, rerender } = renderHook(
      ({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes: vi.fn() }),
      { initialProps: { projectPath: '/A' } },
    )

    let openPromise
    act(() => { openPromise = result.current.open() })

    // open() 응답이 아직 안 왔는데 프로젝트가 바뀜 (예: 사용자가 목록에서 다른 프로젝트 클릭)
    rerender({ projectPath: '/B' })
    window.electronAPI.storyAbort.mockClear()

    resolveOpen({ projectToken: 'tok-A-late', state: { steps: { script: { status: 'done' } } } })
    await act(async () => { await openPromise })

    // 늦게 도착한 A의 open 결과가 반영되지 않아야 한다
    expect(result.current.state).toBeNull()
    expect(result.current.scenes).toEqual([])
    // 반환된 토큰으로 즉시 abort 정리를 시도한다
    expect(window.electronAPI.storyAbort).toHaveBeenCalledWith(expect.objectContaining({ projectToken: 'tok-A-late' }))

    // 늦은 토큰으로 도착하는 이후 이벤트도 drop 되어야 한다(tokenRef가 갱신되지 않았으므로)
    act(() => listeners['story:state']?.({ projectToken: 'tok-A-late', state: { steps: { script: { status: 'error' } } } }))
    expect(result.current.state).toBeNull()
  })

  // Minor 7-⑵: story:open이 { error }를 반환하면(예: invalid-project-path) tokenRef/state를
  // 건드리지 않고 openError로 노출해 StoryView가 안내 배너를 렌더할 수 있게 한다.
  it('storyOpen이 error를 반환하면 openError로 노출하고 state/tokenRef를 건드리지 않는다', async () => {
    window.electronAPI.storyOpen = vi.fn(async () => ({ error: 'invalid-project-path' }))
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    const r = await act(() => result.current.open())
    expect(r.error).toBe('invalid-project-path')
    expect(result.current.openError).toBe('invalid-project-path')
    expect(result.current.state).toBeNull()
    expect(window.electronAPI.storyGetState).not.toHaveBeenCalled()
  })

  it('open이 성공하면 이전 openError를 초기화한다', async () => {
    window.electronAPI.storyOpen = vi.fn(async () => ({ error: 'invalid-project-path' }))
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    expect(result.current.openError).toBe('invalid-project-path')

    window.electronAPI.storyOpen = vi.fn(async () => ({ projectToken: 'tok1', state: { steps: {} } }))
    await act(() => result.current.open())
    expect(result.current.openError).toBeNull()
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
