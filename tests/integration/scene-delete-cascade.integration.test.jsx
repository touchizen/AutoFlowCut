/**
 * E2E: deleting a scene cascades to framePairs without polluting other owners.
 *
 * Pre-existing bug scenario:
 *   scenes = [scene_1, scene_2, scene_3, scene_4]
 *   framePairs = [fp owning scene_1, scene_2, scene_3, scene_4]
 *   Delete scene_2 → without cascade, after reindex scene_3 becomes scene_2,
 *   then framePair pointing to "scene_3" (which is now scene_2) corrupts.
 *
 * Post-fix behavior verified:
 *   - Stable IDs (no reindex)
 *   - Cascade (the framePair owning scene_2 is removed)
 *   - Surviving framePair owners still point to their original scenes
 *   - Adding new scene after delete uses next unused number (no reuse)
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

describe('Integration — scene delete cascade preserves other owners', () => {
  it('delete scene_2 → fp owning scene_2 removed; fp_1, fp_3, fp_4 still point to correct scenes', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([
        { id: 'scene_1', duration: 3 },
        { id: 'scene_2', duration: 3 },
        { id: 'scene_3', duration: 3 },
        { id: 'scene_4', duration: 3 },
      ])
    })

    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1' },
      { id: 'fp_2', ownerSceneId: 'scene_2' },
      { id: 'fp_3', ownerSceneId: 'scene_3' },
      { id: 'fp_4', ownerSceneId: 'scene_4' },
    ]

    let next
    act(() => {
      next = result.current.deleteScene('scene_2', framePairs)
    })

    // Scene IDs survive (no reindex). scene_2 gone, others unchanged.
    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_3', 'scene_4'])

    // fp_2 removed (cascade). fp_1, fp_3, fp_4 unchanged.
    expect(next).toEqual([
      { id: 'fp_1', ownerSceneId: 'scene_1' },
      { id: 'fp_3', ownerSceneId: 'scene_3' },
      { id: 'fp_4', ownerSceneId: 'scene_4' },
    ])

    // fp_3 still points to the SAME scene it always did (no cross-contamination)
    const scene_3_after = result.current.scenes.find(s => s.id === 'scene_3')
    expect(scene_3_after).toBeDefined()
    expect(scene_3_after.id).toBe('scene_3')
  })

  it('adding scene after delete uses next unused number, not the gap', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([
        { id: 'scene_1', duration: 3 },
        { id: 'scene_2', duration: 3 },
        { id: 'scene_3', duration: 3 },
      ])
    })
    act(() => { result.current.deleteScene('scene_2', []) })
    act(() => { result.current.addScene() })
    // New scene = scene_4 (NOT scene_2 reused)
    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_3', 'scene_4'])
  })

  it('reference equality: returns same framePairs ref when nothing owned deleted scene', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([{ id: 'scene_1', duration: 3 }])
    })
    const framePairs = [
      { id: 'fp_x', ownerSceneId: 'scene_99' },  // owns a different (nonexistent) scene
    ]
    let next
    act(() => {
      next = result.current.deleteScene('scene_1', framePairs)
    })
    expect(next).toBe(framePairs)  // same reference — caller can skip setState
  })
})
