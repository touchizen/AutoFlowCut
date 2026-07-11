// 점수 게이트 폐기(phase:'rejected') — 수정본이 버려졌다는 사실은 조용히 넘어가면 안 된다.
// 폐기된 수정본의 점수는 배지에 안 올라가므로, 로그가 그 점수를 보는 유일한 곳이다.
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

describe('rejected 이벤트', () => {
  it('대본: 폐기 전후 점수를 warn 레벨로 로그에 남긴다', async () => {
    const { result } = await openHook()
    review({ target: 'script', round: 1, of: 4, phase: 'rejected', from: 85, to: 75 })
    expect(result.current.progressLog).toHaveLength(1)
    expect(result.current.progressLog[0]).toMatchObject({ step: 'script', level: 'warn' })
    expect(result.current.progressLog[0].message).toContain('수정본 폐기')
    expect(result.current.progressLog[0].message).toContain('85 → 75')
  })

  it('시놉시스: 같은 방식으로 남긴다', async () => {
    const { result } = await openHook()
    startSynopsisOp('syn-op')
    review({ target: 'synopsis', operationId: 'syn-op', round: 2, of: 4, phase: 'rejected', from: 60, to: 60 })
    expect(result.current.progressLog[0]).toMatchObject({ step: 'synopsis', level: 'warn' })
    expect(result.current.progressLog[0].message).toContain('수정본 폐기')
  })

  it("점수가 없어도 '수정본 폐기'는 남긴다", async () => {
    const { result } = await openHook()
    review({ target: 'script', round: 1, of: 2, phase: 'rejected' })
    expect(result.current.progressLog[0].message).toContain('수정본 폐기')
  })

  it('폐기된 수정본의 점수는 배지(reviewScores)에 올리지 않는다', async () => {
    const { result } = await openHook()
    review({ target: 'script', round: 1, of: 4, phase: 'scored', score: 85 })
    review({ target: 'script', round: 1, of: 4, phase: 'rejected', from: 85, to: 75 })
    expect(result.current.reviewScores).toEqual({ target: 'script', scores: [85] })
  })

  it('rejected는 error가 아니다 — reviewProgress를 error로 굳히지 않는다', async () => {
    const { result } = await openHook()
    review({ target: 'script', round: 1, of: 4, phase: 'rejected', from: 85, to: 75 })
    expect(result.current.reviewProgress?.phase).not.toBe('error')
  })
})
