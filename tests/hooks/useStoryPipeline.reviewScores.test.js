// 검수 채점 이벤트(phase:'scored') 수집. 배지/진행상태를 오염시키면 안 된다 —
// reviewProgress는 검토/수정 단계만 나타내야 하고, 점수는 별도 누적이다.
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
    storyGenerateSynopsis: vi.fn(async () => ({})),
    storyConfirmSynopsis: vi.fn(async () => ({})),
    storyReviewSynopsis: vi.fn(async () => ({ synopsisMd: 'x', characters: [] })),
    onStoryEvent: vi.fn((ch, cb) => { listeners[ch] = cb; return () => delete listeners[ch] }),
  }
})

async function openHook() {
  const r = renderHook(({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes: vi.fn() }), { initialProps: { projectPath: '/p' } })
  await act(() => r.result.current.open())
  return r
}

const startSynopsisOp = (opId) => act(() => {
  listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: opId, phase: 'started', text: '' })
})
const review = (payload) => act(() => {
  listeners['story:progress']({ projectToken: 'tok1', kind: 'review', ...payload })
})

describe('reviewScores 누적', () => {
  it('시나리오: 라운드별 점수를 순서대로 쌓는다', async () => {
    const { result } = await openHook()
    review({ target: 'script', round: 1, of: 2, phase: 'scored', score: 72 })
    review({ target: 'script', round: 2, of: 2, phase: 'scored', score: 85 })
    expect(result.current.reviewScores).toEqual({ target: 'script', scores: [72, 85] })
  })

  it('시놉시스: synopsisActiveOpRef 경로로도 쌓인다', async () => {
    const { result } = await openHook()
    startSynopsisOp('syn-op')
    review({ target: 'synopsis', operationId: 'syn-op', round: 1, of: 1, phase: 'scored', score: 91 })
    expect(result.current.reviewScores).toEqual({ target: 'synopsis', scores: [91] })
  })

  it('scored 이벤트는 reviewProgress를 건드리지 않는다', async () => {
    const { result } = await openHook()
    review({ target: 'script', round: 1, of: 2, phase: 'reviewing' })
    review({ target: 'script', round: 1, of: 2, phase: 'scored', score: 72 })
    expect(result.current.reviewProgress).toMatchObject({ phase: 'reviewing', round: 1 })
  })

  it('scored 이벤트도 로그창에 한 줄 남긴다', async () => {
    const { result } = await openHook()
    review({ target: 'script', round: 1, of: 2, phase: 'scored', score: 72 })
    expect(result.current.progressLog).toHaveLength(1)
    expect(result.current.progressLog[0].message).toContain('72')
    expect(result.current.progressLog[0].step).toBe('script')
  })

  it('타겟이 바뀌면 새로 시작한다', async () => {
    const { result } = await openHook()
    review({ target: 'script', round: 1, of: 1, phase: 'scored', score: 72 })
    startSynopsisOp('syn-op')
    review({ target: 'synopsis', operationId: 'syn-op', round: 1, of: 1, phase: 'scored', score: 60 })
    expect(result.current.reviewScores).toEqual({ target: 'synopsis', scores: [60] })
  })

  it('start()가 점수를 초기화한다', async () => {
    const { result } = await openHook()
    review({ target: 'script', round: 1, of: 1, phase: 'scored', score: 72 })
    await act(() => result.current.start('script', {}))
    expect(result.current.reviewScores).toBeNull()
  })

  it('reviewSynopsis()가 점수를 초기화한다', async () => {
    const { result } = await openHook()
    review({ target: 'synopsis', round: 1, of: 1, phase: 'scored', score: 72 })
    await act(() => result.current.reviewSynopsis({ synopsisMd: 'S' }))
    expect(result.current.reviewScores).toBeNull()
  })

  it('프로젝트 전환 시 초기화된다', async () => {
    const r = await openHook()
    review({ target: 'script', round: 1, of: 1, phase: 'scored', score: 72 })
    window.electronAPI.storyOpen = vi.fn(async () => ({ projectToken: 'tok2', state: { steps: {} } }))
    r.rerender({ projectPath: '/q' })
    await act(() => r.result.current.open())
    expect(r.result.current.reviewScores).toBeNull()
  })
})
