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
})
