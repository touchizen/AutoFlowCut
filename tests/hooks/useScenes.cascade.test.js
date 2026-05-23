import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

describe('useScenes — deleteScene cascade', () => {
  it('returns framePairs filtered to exclude the deleted scene\'s owners', () => {
    const { result } = renderHook(() => useScenes())

    act(() => {
      result.current.setScenes([
        { id: 'scene_1', prompt: 'a', duration: 3 },
        { id: 'scene_2', prompt: 'b', duration: 3 },
        { id: 'scene_3', prompt: 'c', duration: 3 },
      ])
    })

    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1' },
      { id: 'fp_2', ownerSceneId: 'scene_2' },
      { id: 'fp_3', ownerSceneId: 'scene_3' },
    ]

    let nextFramePairs
    act(() => {
      nextFramePairs = result.current.deleteScene('scene_2', framePairs)
    })

    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_3'])
    expect(nextFramePairs).toEqual([
      { id: 'fp_1', ownerSceneId: 'scene_1' },
      { id: 'fp_3', ownerSceneId: 'scene_3' },
    ])
  })

  it('preserves gallery-rooted framePairs (ownerSceneId=null) untouched', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([{ id: 'scene_1', duration: 3 }])
    })
    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1' },
      { id: 'fp_gallery', ownerSceneId: null, startSceneId: 'gallery::abc' },
    ]
    let nextFramePairs
    act(() => {
      nextFramePairs = result.current.deleteScene('scene_1', framePairs)
    })
    expect(nextFramePairs.map(fp => fp.id)).toEqual(['fp_gallery'])
  })

  it('returns the original framePairs reference when nothing to filter', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([{ id: 'scene_1', duration: 3 }])
    })
    const framePairs = [{ id: 'fp_other', ownerSceneId: 'scene_99' }]
    let nextFramePairs
    act(() => {
      nextFramePairs = result.current.deleteScene('scene_1', framePairs)
    })
    expect(nextFramePairs).toBe(framePairs)
  })
})
