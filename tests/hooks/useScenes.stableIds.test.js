/**
 * useScenes — stable scene ID tests
 * IDs must survive delete/move (no renumbering).
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

// Mock fileSystemAPI
import { vi } from 'vitest'
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  }
}))

describe('useScenes — stable scene IDs', () => {
  it('addScene allocates sequential IDs starting from scene_1', () => {
    const { result } = renderHook(() => useScenes())

    act(() => { result.current.addScene() })
    expect(result.current.scenes[0].id).toBe('scene_1')

    act(() => { result.current.addScene() })
    expect(result.current.scenes[1].id).toBe('scene_2')

    act(() => { result.current.addScene() })
    expect(result.current.scenes[2].id).toBe('scene_3')
  })

  it('deleteScene does NOT renumber surviving IDs', () => {
    const { result } = renderHook(() => useScenes())

    act(() => {
      result.current.addScene()
      result.current.addScene()
      result.current.addScene()
    })

    act(() => { result.current.deleteScene('scene_2', []) })

    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_3'])
  })

  it('addScene after delete uses next unused number (max + 1)', () => {
    const { result } = renderHook(() => useScenes())

    act(() => {
      result.current.addScene()
      result.current.addScene()
      result.current.addScene()
    })
    act(() => { result.current.deleteScene('scene_2', []) })
    act(() => { result.current.addScene() })

    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_3', 'scene_4'])
  })

  it('moveScene does NOT renumber IDs (positions shift, IDs stay)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.addScene()
      result.current.addScene()
      result.current.addScene()
    })

    act(() => { result.current.moveScene(0, 2) })

    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_2', 'scene_3', 'scene_1'])
  })

  it('recalculateTimes updates startTime/endTime but keeps IDs', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.addScene()
      result.current.addScene()
    })
    expect(result.current.scenes[0].startTime).toBe(0)
    expect(result.current.scenes[0].endTime).toBeGreaterThan(0)
    expect(result.current.scenes[1].startTime).toBe(result.current.scenes[0].endTime)
    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_2'])
  })

  it('initializes ID counter from max of loaded scenes (legacy project)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([
        { id: 'scene_1', duration: 3, startTime: 0, endTime: 3 },
        { id: 'scene_5', duration: 3, startTime: 3, endTime: 6 },
      ])
    })
    act(() => { result.current.addScene() })
    const newSceneId = result.current.scenes.find(s => !['scene_1', 'scene_5'].includes(s.id))?.id
    expect(newSceneId).toBe('scene_6')
  })

  it('counter REBASES on project switch (direct setScenes replacement)', () => {
    // Regression: previously counter only "advanced". After loading project A
    // with scene_100, switching to project B (lower max) leaked scene_101
    // into project B. Direct setScenes(arr) is treated as a project switch.
    const { result } = renderHook(() => useScenes())

    // Load project A with scene_100
    act(() => {
      result.current.setScenes([
        { id: 'scene_100', duration: 3, startTime: 0, endTime: 3 },
      ])
    })
    // Counter is at 101 now

    // Switch to project B (fresh, max scene_2)
    act(() => {
      result.current.setScenes([
        { id: 'scene_1', duration: 3, startTime: 0, endTime: 3 },
        { id: 'scene_2', duration: 3, startTime: 3, endTime: 6 },
      ])
    })

    // Add scene — should be scene_3, NOT scene_101
    act(() => { result.current.addScene() })
    const newSceneId = result.current.scenes.find(s => !['scene_1', 'scene_2'].includes(s.id))?.id
    expect(newSceneId).toBe('scene_3')
  })

  it('counter does NOT rebase on functional setScenes (in-session edits preserve monotonicity)', () => {
    const { result } = renderHook(() => useScenes())

    // Add 3 scenes, delete middle one → counter is at 4
    act(() => {
      result.current.addScene()   // scene_1
      result.current.addScene()   // scene_2
      result.current.addScene()   // scene_3
      result.current.deleteScene('scene_2', [])
    })
    // scenes = [scene_1, scene_3]

    // Functional update (e.g., updateScene) shouldn't rebase counter to 4
    act(() => {
      result.current.setScenes(prev => prev.map(s => ({ ...s, status: 'done' })))
    })

    // Counter still at 4 → next add is scene_4 (NOT scene_4 collision-checked)
    act(() => { result.current.addScene() })
    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_3', 'scene_4'])
  })

  it('clearScenes rebases counter to 1 (empty replacement)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.addScene()  // scene_1
      result.current.addScene()  // scene_2
      result.current.clearScenes()
    })
    act(() => { result.current.addScene() })
    // After clear, counter resets — new scene is scene_1, not scene_3
    expect(result.current.scenes[0].id).toBe('scene_1')
  })
})
