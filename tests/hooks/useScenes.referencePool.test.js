import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

const character = { id: 'c1', name: 'Alice', type: 'character' }
const sceneRef = { id: 'r1', name: 'Forest', type: 'scene' }
const styleRef = { id: 'st1', name: 'Noir', type: 'style' }

describe('useScenes.getMatchingReferences — referencePool override', () => {
  it('hook closure references가 비어 있어도 override pool로 매칭한다 (초입 guard가 pool 기준)', () => {
    const { result } = renderHook(() => useScenes())
    // references는 비어 있는 상태
    const scene = { id: 's1', prompt: '', characters: 'Alice' }

    const matched = result.current.getMatchingReferences(scene, [character])

    expect(matched).toHaveLength(1)
    expect(matched[0].id).toBe('c1')
  })

  it('character / scene / style 태그 매칭 모두 override pool을 쓴다', () => {
    const { result } = renderHook(() => useScenes())
    const scene = { id: 's1', prompt: '', characters: 'Alice', scene_tag: 'Forest', style_tag: 'Noir' }

    const matched = result.current.getMatchingReferences(scene, [character, sceneRef, styleRef])

    expect(matched.map(r => r.id).sort()).toEqual(['c1', 'r1', 'st1'])
  })

  it('@mention 해석도 override pool을 쓴다', () => {
    const { result } = renderHook(() => useScenes())
    const scene = { id: 's1', prompt: '@Alice walks' }

    const matched = result.current.getMatchingReferences(scene, [character])

    expect(matched.map(r => r.id)).toEqual(['c1'])
  })

  it('override pool이 closure references를 이긴다 (stale closure 방지)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.updateReferences([{ id: 'stale', name: 'Alice', type: 'character' }]) })
    const scene = { id: 's1', prompt: '', characters: 'Alice' }

    const matched = result.current.getMatchingReferences(scene, [character])

    expect(matched.map(r => r.id)).toEqual(['c1'])
  })

  it('인자를 안 주면 기존대로 hook references를 쓴다 (기존 호출자 호환)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.updateReferences([character]) })
    const scene = { id: 's1', prompt: '', characters: 'Alice' }

    expect(result.current.getMatchingReferences(scene).map(r => r.id)).toEqual(['c1'])
  })

  it('pool이 비면 빈 배열이다', () => {
    const { result } = renderHook(() => useScenes())
    expect(result.current.getMatchingReferences({ id: 's1', characters: 'Alice' }, [])).toEqual([])
  })
})

describe('useScenes.scenesRef', () => {
  it('scenesRef를 export하고 setScenes 직후 동기적으로 최신 씬을 가리킨다', () => {
    const { result } = renderHook(() => useScenes())

    act(() => {
      result.current.setScenes([{ id: 's1', prompt: 'a' }])
      // act 블록 안 = effect flush 전. 여기서 이미 보여야 진짜 동기 갱신이다
      // (setScenes 래퍼가 _setScenes 앞에서 ref 를 쓴다 — useScenes.js:118).
      // act 밖에서만 단언하면 useEffect 폴백으로도 통과해 동기성을 증명하지 못한다.
      expect(result.current.scenesRef.current.map(s => s.id)).toEqual(['s1'])
    })

    expect(result.current.scenesRef.current.map(s => s.id)).toEqual(['s1'])
  })

  it('같은 tick 의 back-to-back setScenes 도 직전 결과를 본다 (M2 coordinator 가 의존하는 성질)', () => {
    const { result } = renderHook(() => useScenes())

    act(() => {
      result.current.setScenes([{ id: 's1', prompt: 'a' }])
      result.current.setScenes(prev => [...prev, { id: 's2', prompt: 'b' }])
      expect(result.current.scenesRef.current.map(s => s.id)).toEqual(['s1', 's2'])
    })

    expect(result.current.scenesRef.current.map(s => s.id)).toEqual(['s1', 's2'])
  })
})
