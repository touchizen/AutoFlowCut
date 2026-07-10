// 시놉시스 검수(spec 2026-07-10) 렌더러 배선.
// side action은 running step을 만들지 않으므로 step 기반 activeOpRef 필터에 걸리면 progress가
// 전부 버려진다 — synopsisActiveOpRef 기준으로 통과시켜야 한다. 소유권 토큰으로 재진입/
// 프로젝트 전환 경쟁도 막는다.
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
    storyGenerateSynopsis: vi.fn(async () => ({ synopsisMd: '# 시놉', characters: [] })),
    storyConfirmSynopsis: vi.fn(async () => ({ ok: true })),
    storyReviewSynopsis: vi.fn(async () => ({ synopsisMd: '개선본', characters: [], changed: true })),
    onStoryEvent: vi.fn((ch, cb) => { listeners[ch] = cb; return () => delete listeners[ch] }),
  }
})

async function openHook() {
  const rendered = renderHook(
    ({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes: vi.fn() }),
    { initialProps: { projectPath: '/p' } },
  )
  await act(() => rendered.result.current.open())
  return rendered
}

// started 신호가 synopsisActiveOpRef를 세팅한다.
const startSynopsisOp = (opId) => act(() => {
  listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: opId, phase: 'started', text: '' })
})

const sendReview = (payload) => act(() => {
  listeners['story:progress']({ projectToken: 'tok1', kind: 'review', target: 'synopsis', ...payload })
})

describe('useStoryPipeline.reviewSynopsis', () => {
  it('projectToken + params로 storyReviewSynopsis를 호출한다', async () => {
    const { result } = await openHook()
    await act(() => result.current.reviewSynopsis({ synopsisMd: 'S', characters: [], review: { synopsis: { enabled: true, rounds: 2 } } }))
    expect(window.electronAPI.storyReviewSynopsis).toHaveBeenCalledWith({
      projectToken: 'tok1', synopsisMd: 'S', characters: [], review: { synopsis: { enabled: true, rounds: 2 } },
    })
  })

  it('진행 중 synopsisReviewing=true, 완료 후 false', async () => {
    let release
    window.electronAPI.storyReviewSynopsis = vi.fn(() => new Promise((r) => { release = r }))
    const { result } = await openHook()
    let p
    act(() => { p = result.current.reviewSynopsis({ synopsisMd: 'S' }) })
    expect(result.current.synopsisReviewing).toBe(true)
    await act(async () => { release({ synopsisMd: 'x', characters: [] }); await p })
    expect(result.current.synopsisReviewing).toBe(false)
  })

  it('invoke rejection을 {error}로 변환하고 synopsisError를 세운다', async () => {
    window.electronAPI.storyReviewSynopsis = vi.fn(async () => { throw new Error('boom') })
    const { result } = await openHook()
    let r
    await act(async () => { r = await result.current.reviewSynopsis({ synopsisMd: 'S' }) })
    expect(r).toEqual({ error: 'boom' })
    expect(result.current.synopsisError).toBe('boom')
  })

  it('진짜 취소는 main이 {aborted:true}로 resolve한다 — synopsisError 없음', async () => {
    window.electronAPI.storyReviewSynopsis = vi.fn(async () => ({ aborted: true }))
    const { result } = await openHook()
    let r
    await act(async () => { r = await result.current.reviewSynopsis({ synopsisMd: 'S' }) })
    expect(r).toEqual({ aborted: true })
    expect(result.current.synopsisError).toBeNull()
  })

  // rejection은 전부 실제 에러다. 메시지에 'abort'가 들었다고 삼키면 SDK 실패가 조용히 묻힌다.
  it('메시지에 abort가 든 rejection도 에러로 노출한다', async () => {
    window.electronAPI.storyReviewSynopsis = vi.fn(async () => { throw new Error('Claude SDK failed: request aborted') })
    const { result } = await openHook()
    let r
    await act(async () => { r = await result.current.reviewSynopsis({ synopsisMd: 'S' }) })
    expect(r).toEqual({ error: 'Claude SDK failed: request aborted' })
    expect(result.current.synopsisError).toBe('Claude SDK failed: request aborted')
  })

  it('in-flight 중 재진입은 IPC 없이 {error:busy}를 돌려주고 synopsisReviewing을 유지한다', async () => {
    let release
    window.electronAPI.storyReviewSynopsis = vi.fn(() => new Promise((r) => { release = r }))
    const { result } = await openHook()
    let first
    act(() => { first = result.current.reviewSynopsis({ synopsisMd: 'S' }) })

    let second
    await act(async () => { second = await result.current.reviewSynopsis({ synopsisMd: 'S' }) })
    expect(second).toEqual({ error: 'busy' })
    expect(window.electronAPI.storyReviewSynopsis).toHaveBeenCalledTimes(1)
    expect(result.current.synopsisReviewing).toBe(true) // 첫 호출이 아직 소유

    await act(async () => { release({ synopsisMd: 'x', characters: [] }); await first })
    expect(result.current.synopsisReviewing).toBe(false)
  })
})

describe('시놉시스 review progress 이벤트', () => {
  it('synopsisActiveOpRef와 일치하면 step op 필터에 안 걸리고 progressLog에 쌓인다', async () => {
    const { result } = await openHook()
    startSynopsisOp('syn-op')
    sendReview({ operationId: 'syn-op', round: 1, of: 2, phase: 'reviewing' })

    expect(result.current.progressLog).toHaveLength(1)
    expect(result.current.reviewProgress).toMatchObject({ target: 'synopsis', round: 1, of: 2, phase: 'reviewing' })
  })

  it('stale operationId는 버린다', async () => {
    const { result } = await openHook()
    startSynopsisOp('syn-op')
    sendReview({ operationId: 'OLD', round: 1, of: 1, phase: 'reviewing' })
    expect(result.current.progressLog).toHaveLength(0)
  })

  it('로그 라벨이 "시놉시스 검수"다 (기본 폴백인 "시나리오 검수"가 아니라)', async () => {
    const { result } = await openHook()
    startSynopsisOp('syn-op')
    sendReview({ operationId: 'syn-op', round: 1, of: 1, phase: 'reviewing' })
    expect(result.current.progressLog[0].message).toContain('시놉시스 검수')
    expect(result.current.progressLog[0].message).not.toContain('시나리오')
  })

  it('로그 행의 step은 synopsis — scenes 로그로 새지 않는다', async () => {
    const { result } = await openHook()
    startSynopsisOp('syn-op')
    sendReview({ operationId: 'syn-op', round: 1, of: 1, phase: 'revising' })
    expect(result.current.progressLog[0].step).toBe('synopsis')
  })

  it('두 번째 검수는 이전 라운드의 로그 없이 시작한다', async () => {
    const { result } = await openHook()
    startSynopsisOp('syn-op')
    sendReview({ operationId: 'syn-op', round: 1, of: 1, phase: 'reviewing' })
    expect(result.current.progressLog).toHaveLength(1)

    await act(() => result.current.reviewSynopsis({ synopsisMd: 'S' }))
    expect(result.current.progressLog).toHaveLength(0)
  })

  it('reviewSynopsis가 끝나면 reviewProgress를 지우되 error 배지는 남긴다', async () => {
    const { result } = await openHook()

    // 정상 종료 → 배지 제거
    startSynopsisOp('op-a')
    sendReview({ operationId: 'op-a', round: 1, of: 1, phase: 'reviewing' })
    await act(() => result.current.reviewSynopsis({ synopsisMd: 'S' }))
    expect(result.current.reviewProgress).toBeNull()

    // error 배지는 settle 후에도 유지
    let release
    window.electronAPI.storyReviewSynopsis = vi.fn(() => new Promise((r) => { release = r }))
    let p
    act(() => { p = result.current.reviewSynopsis({ synopsisMd: 'S' }) })
    startSynopsisOp('op-b')
    sendReview({ operationId: 'op-b', phase: 'error', error: 'boom' })
    await act(async () => { release({ synopsisMd: 'x', characters: [] }); await p })
    expect(result.current.reviewProgress).toMatchObject({ phase: 'error' })
  })
})

// generateSynopsis도 같은 App-수명 훅에 살아 있어 review와 똑같은 경쟁에 노출된다.
describe('generateSynopsis 소유권', () => {
  it('전환 후 도착한 옛 generateSynopsis가 새 프로젝트의 synopsisGenerating/에러를 건드리지 않는다', async () => {
    let release
    window.electronAPI.storyGenerateSynopsis = vi.fn(() => new Promise((r) => { release = r }))
    const rendered = await openHook()
    let stale
    act(() => { stale = rendered.result.current.generateSynopsis({ type: 'title', title: 'A' }) })
    expect(rendered.result.current.synopsisGenerating).toBe(true)

    window.electronAPI.storyOpen = vi.fn(async () => ({ projectToken: 'tok2', state: { steps: {} } }))
    rendered.rerender({ projectPath: '/q' })
    await act(() => rendered.result.current.open())
    expect(rendered.result.current.synopsisGenerating).toBe(false)

    let release2
    window.electronAPI.storyGenerateSynopsis = vi.fn(() => new Promise((r) => { release2 = r }))
    let fresh
    act(() => { fresh = rendered.result.current.generateSynopsis({ type: 'title', title: 'B' }) })
    expect(rendered.result.current.synopsisGenerating).toBe(true)

    await act(async () => { release({ error: 'stale-token' }); await stale })
    expect(rendered.result.current.synopsisError).toBeNull()
    expect(rendered.result.current.synopsisGenerating).toBe(true) // 새 생성이 아직 소유

    await act(async () => { release2({ synopsisMd: 'z', characters: [] }); await fresh })
    expect(rendered.result.current.synopsisGenerating).toBe(false)
  })

  it('in-flight 중 재진입은 IPC 없이 {error:busy}', async () => {
    let release
    window.electronAPI.storyGenerateSynopsis = vi.fn(() => new Promise((r) => { release = r }))
    const { result } = await openHook()
    let first
    act(() => { first = result.current.generateSynopsis({ type: 'title', title: 'A' }) })
    let second
    await act(async () => { second = await result.current.generateSynopsis({ type: 'title', title: 'A' }) })
    expect(second).toEqual({ error: 'busy' })
    expect(window.electronAPI.storyGenerateSynopsis).toHaveBeenCalledTimes(1)
    await act(async () => { release({ synopsisMd: 'x', characters: [] }); await first })
  })

  // main은 synopsisController 하나로 생성/검수를 상호배제한다 — renderer도 같은 불변식을 갖는다.
  it('생성 중 검수를 누르면 IPC 없이 {error:busy}', async () => {
    let release
    window.electronAPI.storyGenerateSynopsis = vi.fn(() => new Promise((r) => { release = r }))
    const { result } = await openHook()
    let gen
    act(() => { gen = result.current.generateSynopsis({ type: 'title', title: 'A' }) })
    let rev
    await act(async () => { rev = await result.current.reviewSynopsis({ synopsisMd: 'S' }) })
    expect(rev).toEqual({ error: 'busy' })
    expect(window.electronAPI.storyReviewSynopsis).not.toHaveBeenCalled()
    await act(async () => { release({ synopsisMd: 'x', characters: [] }); await gen })
  })
})

describe('프로젝트 전환 경쟁', () => {
  it('전환 후 도착한 옛 프로젝트의 결과가 새 프로젝트 상태를 건드리지 않는다', async () => {
    let release
    window.electronAPI.storyReviewSynopsis = vi.fn(() => new Promise((r) => { release = r }))
    const rendered = await openHook()
    let stale
    act(() => { stale = rendered.result.current.reviewSynopsis({ synopsisMd: 'S' }) })
    expect(rendered.result.current.synopsisReviewing).toBe(true)

    // 프로젝트 전환 — 훅은 App에 살아있고 리셋만 돈다.
    window.electronAPI.storyOpen = vi.fn(async () => ({ projectToken: 'tok2', state: { steps: {} } }))
    rendered.rerender({ projectPath: '/q' })
    await act(() => rendered.result.current.open())
    expect(rendered.result.current.synopsisReviewing).toBe(false)

    // 새 프로젝트에서 검수 시작(소유권 획득)
    let release2
    window.electronAPI.storyReviewSynopsis = vi.fn(() => new Promise((r) => { release2 = r }))
    let fresh
    act(() => { fresh = rendered.result.current.reviewSynopsis({ synopsisMd: 'S2' }) })
    expect(rendered.result.current.synopsisReviewing).toBe(true)

    // 옛 프로젝트의 orphan이 stale-token으로 늦게 도착 → 새 프로젝트를 오염시키면 안 된다.
    await act(async () => { release({ error: 'stale-token' }); await stale })
    expect(rendered.result.current.synopsisError).toBeNull()
    expect(rendered.result.current.synopsisReviewing).toBe(true)

    await act(async () => { release2({ synopsisMd: 'z', characters: [] }); await fresh })
    expect(rendered.result.current.synopsisReviewing).toBe(false)
  })
})
