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

  it('step-log progress를 progressLog로 누적한다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    act(() => handlers['story:state']({ projectToken: 'TOK', operationId: 'op1', state: { steps: { scenes: { status: 'running' } } } }))

    act(() => handlers['story:progress']({
      projectToken: 'TOK',
      operationId: 'op1',
      kind: 'step-log',
      step: 'scenes',
      phase: 'split-request',
      message: 'LLM 씬 분리 요청',
      at: '2026-07-06T00:00:00.000Z',
    }))

    expect(result.current.progressLog).toEqual([
      expect.objectContaining({ step: 'scenes', phase: 'split-request', message: 'LLM 씬 분리 요청' }),
    ])
  })

  it('start()는 progressLog를 초기화한다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    act(() => handlers['story:state']({ projectToken: 'TOK', operationId: 'op1', state: { steps: { scenes: { status: 'running' } } } }))
    act(() => handlers['story:progress']({ projectToken: 'TOK', operationId: 'op1', kind: 'step-log', step: 'scenes', phase: 'x', message: '로그' }))
    expect(result.current.progressLog).toHaveLength(1)

    await act(async () => { await result.current.start('scenes', {}) })
    expect(result.current.progressLog).toEqual([])
  })

  it('start() 후 새 running state 전에도 이전 operationId가 새 로그를 막지 않는다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    act(() => handlers['story:state']({ projectToken: 'TOK', operationId: 'old-op', state: { steps: { scenes: { status: 'running' } } } }))

    await act(async () => { await result.current.start('scenes', {}) })
    act(() => handlers['story:progress']({ projectToken: 'TOK', operationId: 'new-op', kind: 'step-log', step: 'scenes', phase: 'split-request', message: '새 로그' }))

    expect(result.current.progressLog).toEqual([
      expect.objectContaining({ operationId: 'new-op', message: '새 로그' }),
    ])
  })

  it('audio-segment progress를 segId→status로 누적한다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })

    act(() => handlers['story:progress']({ projectToken: 'TOK', kind: 'audio-segment', segId: 's1', status: 'running' }))
    act(() => handlers['story:progress']({ projectToken: 'TOK', kind: 'audio-segment', segId: 's1', status: 'done' }))
    act(() => handlers['story:progress']({ projectToken: 'TOK', kind: 'audio-segment', segId: 's2', status: 'running' }))

    expect(result.current.segmentProgress).toEqual({ s1: 'done', s2: 'running' })
  })

  it('audio start()는 이전 실행의 segmentProgress를 초기화한다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    act(() => handlers['story:progress']({ projectToken: 'TOK', kind: 'audio-segment', segId: 's1-1', status: 'done' }))
    expect(result.current.segmentProgress).toEqual({ 's1-1': 'done' })

    await act(async () => { await result.current.start('audio', {}) })

    expect(result.current.segmentProgress).toEqual({})
  })

  it('다른 projectToken의 progress는 무시', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })

    act(() => handlers['story:progress']({ projectToken: 'STALE', kind: 'audio-segment', segId: 's1', status: 'done' }))
    expect(result.current.segmentProgress).toEqual({})
  })
})

describe('useStoryPipeline — reviewProgress(M3 script-review)', () => {
  beforeEach(() => installApi())

  const runningState = (op) => ({ projectToken: 'TOK', operationId: op, state: { steps: { script: { status: 'running' } } } })
  const doneState = (op) => ({ projectToken: 'TOK', operationId: op, state: { steps: { script: { status: 'done' } } } })

  it('script-review progress를 reviewProgress로 노출(round/of/phase)', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    act(() => handlers['story:state'](runningState('op1'))) // activeOp = op1
    act(() => handlers['story:progress']({ projectToken: 'TOK', operationId: 'op1', kind: 'script-review', round: 2, of: 3, phase: 'reviewing' }))
    expect(result.current.reviewProgress).toMatchObject({ round: 2, of: 3, phase: 'reviewing' })
  })

  it('generic review progress를 target과 함께 노출한다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    act(() => handlers['story:state'](runningState('op1'))) // activeOp = op1
    act(() => handlers['story:progress']({ projectToken: 'TOK', operationId: 'op1', kind: 'review', target: 'scenes', round: 1, of: 2, phase: 'reviewing' }))
    expect(result.current.reviewProgress).toMatchObject({ target: 'scenes', round: 1, of: 2, phase: 'reviewing' })
  })

  it('active review thinking을 노출하고 revising/stale 신호에서 정확히 관리한다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    act(() => handlers['story:state']({
      projectToken: 'TOK', operationId: 'op1', state: { steps: { scenes: { status: 'running', reviewOnly: true } } },
    }))

    act(() => handlers['story:progress']({
      projectToken: 'TOK', operationId: 'op1', kind: 'review', target: 'scenes', round: 1, of: 2, phase: 'reviewing',
    }))
    expect(result.current.reviewThinking).toBe(false)

    act(() => handlers['story:progress']({
      projectToken: 'TOK', operationId: 'stale-op', kind: 'review', target: 'scenes', round: 1, of: 2, phase: 'reviewing', thinking: true,
    }))
    expect(result.current.reviewThinking).toBe(false)

    act(() => handlers['story:progress']({
      projectToken: 'TOK', operationId: 'op1', kind: 'review', target: 'scenes', round: 1, of: 2, phase: 'reviewing', thinking: true,
    }))
    expect(result.current.reviewThinking).toBe(true)
    expect(result.current.reviewProgress).toMatchObject({ target: 'scenes', round: 1, of: 2, phase: 'reviewing' })

    act(() => handlers['story:progress']({
      projectToken: 'TOK', operationId: 'op1', kind: 'review', target: 'scenes', round: 1, of: 2, phase: 'revising',
    }))
    expect(result.current.reviewThinking).toBe(false)
    expect(result.current.reviewProgress).toMatchObject({ target: 'scenes', round: 1, of: 2, phase: 'revising' })
  })

  it('terminal story:state는 reviewThinking을 지운다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    act(() => handlers['story:state']({
      projectToken: 'TOK', operationId: 'op1', state: { steps: { prompts: { status: 'running', reviewOnly: true } } },
    }))
    act(() => handlers['story:progress']({
      projectToken: 'TOK', operationId: 'op1', kind: 'review', target: 'prompts', round: 1, of: 1, phase: 'reviewing', thinking: true,
    }))
    expect(result.current.reviewThinking).toBe(true)

    act(() => handlers['story:state']({
      projectToken: 'TOK', operationId: 'op1', state: { steps: { prompts: { status: 'done' } } },
    }))
    expect(result.current.reviewThinking).toBe(false)
    expect(result.current.reviewProgress).toBeNull()
  })

  it('terminal story:state(진행 없음)이면 reviewProgress를 지운다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    act(() => handlers['story:state'](runningState('op1')))
    act(() => handlers['story:progress']({ projectToken: 'TOK', operationId: 'op1', kind: 'script-review', round: 1, of: 3, phase: 'revising' }))
    act(() => handlers['story:state'](doneState('op1')))
    expect(result.current.reviewProgress).toBeNull()
  })

  it("phase='error'는 terminal story:state에도 남는다(검토 중단 배지 유지)", async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    act(() => handlers['story:state'](runningState('op1')))
    act(() => handlers['story:progress']({ projectToken: 'TOK', operationId: 'op1', kind: 'script-review', phase: 'error', error: 'boom' }))
    act(() => handlers['story:state'](doneState('op1')))
    expect(result.current.reviewProgress).toMatchObject({ phase: 'error' })
  })

  it('start()는 reviewProgress를 초기화한다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    act(() => handlers['story:state'](runningState('op1')))
    act(() => handlers['story:progress']({ projectToken: 'TOK', operationId: 'op1', kind: 'script-review', phase: 'error' }))
    await act(async () => { await result.current.start('script', {}) })
    expect(result.current.reviewProgress).toBeNull()
  })

  it('start()와 project switch는 reviewThinking을 초기화한다', async () => {
    const handlers = installApi()
    const rendered = renderHook(
      ({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes: async () => {} }),
      { initialProps: { projectPath: '/p' } },
    )
    await act(async () => { await rendered.result.current.open() })
    act(() => handlers['story:state']({
      projectToken: 'TOK', operationId: 'op1', state: { steps: { scenes: { status: 'running', reviewOnly: true } } },
    }))
    act(() => handlers['story:progress']({
      projectToken: 'TOK', operationId: 'op1', kind: 'review', target: 'scenes', round: 1, of: 1, phase: 'reviewing', thinking: true,
    }))
    expect(rendered.result.current.reviewThinking).toBe(true)

    await act(async () => { await rendered.result.current.start('scenes', {}) })
    expect(rendered.result.current.reviewThinking).toBe(false)

    act(() => handlers['story:state']({
      projectToken: 'TOK', operationId: 'op2', state: { steps: { scenes: { status: 'running', reviewOnly: true } } },
    }))
    act(() => handlers['story:progress']({
      projectToken: 'TOK', operationId: 'op2', kind: 'review', target: 'scenes', round: 1, of: 1, phase: 'reviewing', thinking: true,
    }))
    expect(rendered.result.current.reviewThinking).toBe(true)

    rendered.rerender({ projectPath: '/other' })
    expect(rendered.result.current.reviewThinking).toBe(false)
  })
})
