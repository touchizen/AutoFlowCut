// 슬라이스4(v1 §3.4 + §v2.8 M1): useStoryPipeline synopsis 배선 —
// generateSynopsis/confirmSynopsis side action + story:synopsis-delta 구독(전용 synopsisActiveOpRef
// 필터, 기존 activeOpRef 재사용 금지) + story:state hydrate 필드 노출 + 프로젝트 전환 리셋.
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
    storyConfirmSynopsis: vi.fn(async () => ({ ok: true, operationId: 'op-c' })),
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

describe('useStoryPipeline generateSynopsis / confirmSynopsis', () => {
  it('generateSynopsis(params)가 projectToken + params로 storyGenerateSynopsis를 호출한다', async () => {
    const { result } = await openHook()
    await act(() => result.current.generateSynopsis({ type: 'title', title: '흥부전', options: { language: 'ko' } }))
    expect(window.electronAPI.storyGenerateSynopsis).toHaveBeenCalledWith({
      projectToken: 'tok1', type: 'title', title: '흥부전', options: { language: 'ko' },
    })
  })

  it('generateSynopsis 진행 중 synopsisGenerating=true, 완료 후 false', async () => {
    let resolveGen
    window.electronAPI.storyGenerateSynopsis = vi.fn(() => new Promise((r) => { resolveGen = r }))
    const { result } = await openHook()
    let p
    act(() => { p = result.current.generateSynopsis({ type: 'title', title: 't' }) })
    expect(result.current.synopsisGenerating).toBe(true)
    await act(async () => { resolveGen({ synopsisMd: '#', characters: [] }); await p })
    expect(result.current.synopsisGenerating).toBe(false)
  })

  it('generateSynopsis가 {error}를 반환하면 synopsisError로 노출한다', async () => {
    window.electronAPI.storyGenerateSynopsis = vi.fn(async () => ({ error: 'busy' }))
    const { result } = await openHook()
    await act(() => result.current.generateSynopsis({ type: 'title', title: 't' }))
    expect(result.current.synopsisError).toBe('busy')
    expect(result.current.synopsisGenerating).toBe(false)
  })

  it('generateSynopsis invoke가 reject해도 synopsisError로 흡수한다', async () => {
    window.electronAPI.storyGenerateSynopsis = vi.fn(async () => { throw new Error('llm down') })
    const { result } = await openHook()
    await act(() => result.current.generateSynopsis({ type: 'title', title: 't' }))
    expect(result.current.synopsisError).toContain('llm down')
    expect(result.current.synopsisGenerating).toBe(false)
  })

  it('재호출 시 이전 synopsisError를 초기화한다', async () => {
    window.electronAPI.storyGenerateSynopsis = vi.fn(async () => ({ error: 'busy' }))
    const { result } = await openHook()
    await act(() => result.current.generateSynopsis({ type: 'title', title: 't' }))
    expect(result.current.synopsisError).toBe('busy')
    window.electronAPI.storyGenerateSynopsis = vi.fn(async () => ({ synopsisMd: '#', characters: [] }))
    await act(() => result.current.generateSynopsis({ type: 'title', title: 't' }))
    expect(result.current.synopsisError).toBeNull()
  })

  it('confirmSynopsis(params)가 projectToken + params로 storyConfirmSynopsis를 호출한다', async () => {
    const { result } = await openHook()
    const chars = [{ id: '민수', name: '민수', gender: 'male', age: '20대', role: '주인공', appearance: 'a' }]
    let r
    await act(async () => { r = await result.current.confirmSynopsis({ synopsisMd: '# 확정', characters: chars }) })
    expect(window.electronAPI.storyConfirmSynopsis).toHaveBeenCalledWith({
      projectToken: 'tok1', synopsisMd: '# 확정', characters: chars,
    })
    expect(r).toEqual({ ok: true, operationId: 'op-c' })
  })
})

describe('useStoryPipeline story:synopsis-delta 구독 (전용 synopsisActiveOpRef)', () => {
  it('started 신호로 활성 op를 세팅하고 그 op의 delta만 synopsisStreamingText로 누적한다', async () => {
    const { result } = await openHook()
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'syn1', phase: 'started', text: '' }))
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'syn1', text: '옛날 ' }))
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'STALE', text: 'XX' }))
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'syn1', text: '옛적에' }))
    expect(result.current.synopsisStreamingText).toBe('옛날 옛적에')
  })

  it('새 started 신호가 오면 누적을 리셋하고 새 op로 전환한다 (regenerate)', async () => {
    const { result } = await openHook()
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'syn1', phase: 'started', text: '' }))
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'syn1', text: '첫 시놉' }))
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'syn2', phase: 'started', text: '' }))
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'syn1', text: '늦은 델타' }))
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'syn2', text: '새 시놉' }))
    expect(result.current.synopsisStreamingText).toBe('새 시놉')
  })

  it('synopsis-delta는 기존 activeOpRef(running step 기반)와 무관하게 동작한다', async () => {
    const { result } = await openHook()
    // running step story:state가 기존 activeOpRef를 'op-step'으로 세팅
    act(() => listeners['story:state']({ projectToken: 'tok1', operationId: 'op-step', state: { steps: { script: { status: 'running' } } } }))
    // synopsis op는 별도 — started + delta가 그대로 누적돼야 한다
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'syn1', phase: 'started', text: '' }))
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'syn1', text: '시놉' }))
    expect(result.current.synopsisStreamingText).toBe('시놉')
    // 대본 streamingText에는 섞이지 않는다
    expect(result.current.streamingText).toBe('')
  })

  it('토큰 불일치 synopsis-delta는 drop한다', async () => {
    const { result } = await openHook()
    act(() => listeners['story:synopsis-delta']({ projectToken: 'OTHER', operationId: 'syn1', phase: 'started', text: '' }))
    act(() => listeners['story:synopsis-delta']({ projectToken: 'OTHER', operationId: 'syn1', text: 'XX' }))
    expect(result.current.synopsisStreamingText).toBe('')
  })
})

describe('useStoryPipeline synopsis hydrate 필드', () => {
  it('story:state의 synopsisText/hasSynopsis/characters/charactersConfirmed를 노출한다', async () => {
    const { result } = await openHook()
    const characters = [{ id: '민수', name: '민수', gender: 'male', age: '20대', role: '주인공', appearance: 'a' }]
    act(() => listeners['story:state']({
      projectToken: 'tok1',
      state: { steps: {} },
      synopsisText: '# 저장된 시놉',
      hasSynopsis: true,
      characters,
      charactersConfirmed: true,
    }))
    expect(result.current.synopsisText).toBe('# 저장된 시놉')
    expect(result.current.hasSynopsis).toBe(true)
    expect(result.current.characters).toEqual(characters)
    expect(result.current.charactersConfirmed).toBe(true)
  })

  it('synopsis 필드가 없는 story:state는 기존 값을 유지한다', async () => {
    const { result } = await openHook()
    act(() => listeners['story:state']({
      projectToken: 'tok1', state: { steps: {} }, synopsisText: '# 시놉', hasSynopsis: true, characters: [], charactersConfirmed: false,
    }))
    act(() => listeners['story:state']({ projectToken: 'tok1', state: { steps: { script: { status: 'running' } } } }))
    expect(result.current.synopsisText).toBe('# 시놉')
    expect(result.current.hasSynopsis).toBe(true)
    expect(result.current.charactersConfirmed).toBe(false)
  })

  it('open() 응답의 synopsis 필드를 hydrate한다', async () => {
    window.electronAPI.storyOpen = vi.fn(async () => ({
      projectToken: 'tok1', state: { steps: {} },
      synopsisText: '# 오픈 시놉', hasSynopsis: true,
      characters: [{ name: '민수', appearance: 'a' }], charactersConfirmed: false,
    }))
    window.electronAPI.storyGetState = vi.fn(async () => ({
      steps: {},
      synopsisText: '# 최신 시놉', hasSynopsis: true,
      characters: [{ name: '영희', appearance: 'b' }], charactersConfirmed: true,
    }))
    const { result } = await openHook()
    expect(result.current.synopsisText).toBe('# 최신 시놉')
    expect(result.current.characters).toEqual([{ name: '영희', appearance: 'b' }])
    expect(result.current.charactersConfirmed).toBe(true)
  })
})

describe('useStoryPipeline synopsis 프로젝트 전환 리셋', () => {
  it('projectPath 변경 시 synopsis 로컬 상태와 활성 op를 리셋한다', async () => {
    const { result, rerender } = await openHook()
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'syn1', phase: 'started', text: '' }))
    act(() => listeners['story:synopsis-delta']({ projectToken: 'tok1', operationId: 'syn1', text: '시놉' }))
    act(() => listeners['story:state']({
      projectToken: 'tok1', state: { steps: {} }, synopsisText: '# 시놉', hasSynopsis: true,
      characters: [{ name: '민수', appearance: 'a' }], charactersConfirmed: true,
    }))
    expect(result.current.synopsisStreamingText).toBe('시놉')

    rerender({ projectPath: '/other' })

    expect(result.current.synopsisStreamingText).toBe('')
    expect(result.current.synopsisText).toBe('')
    expect(result.current.hasSynopsis).toBe(false)
    expect(result.current.characters).toEqual([])
    expect(result.current.charactersConfirmed).toBeUndefined()
    expect(result.current.synopsisError).toBeNull()
    expect(result.current.synopsisGenerating).toBe(false)

    // 옛 프로젝트 op의 늦은 delta는 (토큰 무효화로) drop — 새 상태를 오염시키지 않는다
    act(() => listeners['story:synopsis-delta']?.({ projectToken: 'tok1', operationId: 'syn1', text: '늦은' }))
    expect(result.current.synopsisStreamingText).toBe('')
  })
})
