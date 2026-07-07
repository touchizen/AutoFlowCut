// 리서치 슬라이스(spec §3.6/§5): useStoryPipeline research 배선 —
// side action 호출(projectToken) + research hydrate 노출 + research-fetch 진행 + 전환 리셋.
// useStoryPipeline.synopsis.test.js 미러.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStoryPipeline } from '../../src/hooks/useStoryPipeline.js'

const RESEARCH = {
  confirmed: false,
  keyword: '야담',
  videos: [{ videoId: 'vidA', title: 'A', viewCount: 1 }],
  selectedVideoIds: ['vidA'],
  transcripts: { vidA: { ok: true, lang: 'ko', isAuto: false } },
  analysis: null,
  verifiedClaims: [],
}

let listeners
beforeEach(() => {
  listeners = {}
  window.electronAPI = {
    storyOpen: vi.fn(async () => ({ projectToken: 'tok1', state: { steps: {} } })),
    storyGetState: vi.fn(async () => ({ steps: {} })),
    storyStart: vi.fn(async () => ({ operationId: 'op1' })),
    storyAbort: vi.fn(async () => ({})),
    storyPushAck: vi.fn(async () => ({})),
    storyResearchSearch: vi.fn(async () => ({ videos: RESEARCH.videos })),
    storyResearchFetch: vi.fn(async () => ({ transcripts: [{ videoId: 'vidA', ok: true }] })),
    storyResearchAnalyze: vi.fn(async () => ({ analysis: { structure: [], claims: [], commonThemes: [] } })),
    storyResearchFactCheck: vi.fn(async () => ({ verifiedClaims: [] })),
    storyResearchCommit: vi.fn(async () => ({ ok: true })),
    storyResearchSkip: vi.fn(async () => ({ ok: true })),
    storyResearchSelect: vi.fn(async () => ({ ok: true })),
    onStoryEvent: vi.fn((ch, cb) => { listeners[ch] = cb; return () => delete listeners[ch] }),
  }
})

async function openHook(props = {}) {
  const rendered = renderHook(
    ({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes: vi.fn(), ...props }),
    { initialProps: { projectPath: '/p' } },
  )
  await act(() => rendered.result.current.open())
  return rendered
}

describe('useStoryPipeline research side action 호출', () => {
  it('여섯 액션이 projectToken + params로 브릿지를 호출한다', async () => {
    const { result } = await openHook()
    await act(() => result.current.researchSearch({ keyword: '야담', maxResults: 10 }))
    expect(window.electronAPI.storyResearchSearch).toHaveBeenCalledWith({ projectToken: 'tok1', keyword: '야담', maxResults: 10 })

    await act(() => result.current.researchFetchTranscripts({ videoIds: ['vidA'] }))
    expect(window.electronAPI.storyResearchFetch).toHaveBeenCalledWith({ projectToken: 'tok1', videoIds: ['vidA'] })

    await act(() => result.current.researchAnalyze({ videoIds: ['vidA'] }))
    expect(window.electronAPI.storyResearchAnalyze).toHaveBeenCalledWith({ projectToken: 'tok1', videoIds: ['vidA'] })

    await act(() => result.current.researchFactCheck())
    expect(window.electronAPI.storyResearchFactCheck).toHaveBeenCalledWith({ projectToken: 'tok1' })

    await act(() => result.current.researchCommit({ analysis: { structure: [] } }))
    expect(window.electronAPI.storyResearchCommit).toHaveBeenCalledWith({ projectToken: 'tok1', analysis: { structure: [] } })

    await act(() => result.current.researchSkip())
    expect(window.electronAPI.storyResearchSkip).toHaveBeenCalledWith({ projectToken: 'tok1' })
  })

  it('researchSelect(m5)가 projectToken + 선택/수동카드로 브릿지를 호출한다', async () => {
    const { result } = await openHook()
    await act(() => result.current.researchSelect({ selectedVideoIds: ['vidA'], manualVideos: [{ videoId: 'vidA' }] }))
    expect(window.electronAPI.storyResearchSelect).toHaveBeenCalledWith({
      projectToken: 'tok1', selectedVideoIds: ['vidA'], manualVideos: [{ videoId: 'vidA' }],
    })
  })
})

describe('useStoryPipeline research hydrate', () => {
  it('story:state의 research 필드를 노출하고, 없는 이벤트는 기존 값을 유지한다', async () => {
    const { result } = await openHook()
    act(() => listeners['story:state']({ projectToken: 'tok1', state: { steps: {} }, research: RESEARCH }))
    expect(result.current.research).toEqual(RESEARCH)
    act(() => listeners['story:state']({ projectToken: 'tok1', state: { steps: {} } }))
    expect(result.current.research).toEqual(RESEARCH)
  })

  it('story:research-state 이벤트로도 갱신된다 (§5 신규 채널)', async () => {
    const { result } = await openHook()
    act(() => listeners['story:research-state']({ projectToken: 'tok1', research: { ...RESEARCH, confirmed: true } }))
    expect(result.current.research.confirmed).toBe(true)
  })

  it('토큰 불일치 research-state는 drop한다', async () => {
    const { result } = await openHook()
    act(() => listeners['story:research-state']({ projectToken: 'OTHER', research: RESEARCH }))
    expect(result.current.research).toBeNull()
  })

  it('open()/getState 응답의 research를 hydrate한다', async () => {
    window.electronAPI.storyOpen = vi.fn(async () => ({ projectToken: 'tok1', state: { steps: {} }, research: RESEARCH }))
    window.electronAPI.storyGetState = vi.fn(async () => ({ steps: {}, research: { ...RESEARCH, confirmed: true } }))
    const { result } = await openHook()
    expect(result.current.research.confirmed).toBe(true)
    // state 객체에는 research가 섞이지 않는다 (hydrate extras 분리)
    expect(result.current.state.research).toBeUndefined()
  })
})

describe('useStoryPipeline research-fetch 진행 표시', () => {
  it('story:progress(kind=research-fetch)를 videoId→{status} 맵으로 누적한다 (activeOpRef와 무관)', async () => {
    const { result } = await openHook()
    // running step이 activeOpRef를 세팅해도 research-fetch는 drop되지 않아야 한다
    act(() => listeners['story:state']({ projectToken: 'tok1', operationId: 'op-step', state: { steps: { script: { status: 'running' } } } }))
    act(() => listeners['story:progress']({ projectToken: 'tok1', operationId: 'r-op', kind: 'research-fetch', videoId: 'vidA', status: 'running' }))
    act(() => listeners['story:progress']({ projectToken: 'tok1', operationId: 'r-op', kind: 'research-fetch', videoId: 'vidA', status: 'done' }))
    act(() => listeners['story:progress']({ projectToken: 'tok1', operationId: 'r-op', kind: 'research-fetch', videoId: 'vidB', status: 'error' }))
    expect(result.current.researchFetchProgress).toEqual({ vidA: { status: 'done' }, vidB: { status: 'error' } })
  })

  // m2(Fable R1): progress payload의 error 코드를 버리면 binary-not-found가 "자막 없음"으로만
  // 보여 설치 안내로 이어지지 않는다 — error를 함께 저장한다.
  it('progress의 error 코드를 함께 저장한다 (m2 — binary-not-found 설치 안내 재료)', async () => {
    const { result } = await openHook()
    act(() => listeners['story:progress']({ projectToken: 'tok1', kind: 'research-fetch', videoId: 'vidA', status: 'error', error: 'binary-not-found' }))
    expect(result.current.researchFetchProgress).toEqual({ vidA: { status: 'error', error: 'binary-not-found' } })
  })

  it('새 researchFetchTranscripts 호출 시 진행 맵을 리셋한다', async () => {
    const { result } = await openHook()
    act(() => listeners['story:progress']({ projectToken: 'tok1', kind: 'research-fetch', videoId: 'vidA', status: 'done' }))
    expect(result.current.researchFetchProgress).toEqual({ vidA: { status: 'done' } })
    await act(() => result.current.researchFetchTranscripts({ videoIds: ['vidB'] }))
    expect(result.current.researchFetchProgress).toEqual({})
  })
})

describe('useStoryPipeline research 프로젝트 전환 리셋', () => {
  it('projectPath 변경 시 research/진행 맵을 리셋한다', async () => {
    const { result, rerender } = await openHook()
    act(() => listeners['story:state']({ projectToken: 'tok1', state: { steps: {} }, research: RESEARCH }))
    act(() => listeners['story:progress']({ projectToken: 'tok1', kind: 'research-fetch', videoId: 'vidA', status: 'done' }))
    expect(result.current.research).toEqual(RESEARCH)

    rerender({ projectPath: '/other' })

    expect(result.current.research).toBeNull()
    expect(result.current.researchFetchProgress).toEqual({})
  })
})
