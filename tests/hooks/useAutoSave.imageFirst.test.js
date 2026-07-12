import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAutoSave } from '../../src/hooks/useAutoSave.js'

const fixedSceneState = {
  sceneMode: 'image-first',
  imageFirstVariant: 'storyboard',
  fixedSceneRevision: 'revision-1',
  fixedScenes: [{ storyId: 'story-1', rendererSceneId: 'scene_1', ordinal: 1 }],
}

function props(overrides = {}) {
  return {
    scenes: [{ id: 'scene_1' }],
    references: [],
    videoScenes: [],
    framePairs: [],
    selectedStyleRefId: null,
    srtTrack: [],
    audioFolderPath: null,
    fixedSceneState: null,
    settings: { saveMode: 'folder', projectName: 'P', aspectRatio: '16:9' },
    generatingRefsCount: 0,
    isRunning: false,
    isRestoringRef: { current: false },
    isImportingRef: { current: false },
    saveCurrentProject: vi.fn(async () => ({ success: true })),
    ...overrides,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useAutoSave image-first import window', () => {
  it('does not schedule/call save when the effect enters while importing', async () => {
    const saveCurrentProject = vi.fn()
    renderHook(() => useAutoSave(props({
      isImportingRef: { current: true },
      saveCurrentProject,
    })))

    // timer 예약 자체가 0이어야 한다 — runAllTimersAsync 뒤에 세면 큐가 이미 비어
    // 항상 0이라 effect-entry gate를 지워도 통과하는 동어반복 assertion이 된다.
    expect(vi.getTimerCount()).toBe(0)

    await vi.runAllTimersAsync()

    expect(saveCurrentProject).not.toHaveBeenCalled()
  })

  it('does not call save when a timer scheduled before the window fires inside it', async () => {
    const isImportingRef = { current: false }
    const saveCurrentProject = vi.fn()
    renderHook(() => useAutoSave(props({ isImportingRef, saveCurrentProject })))

    isImportingRef.current = true
    await vi.runAllTimersAsync()

    expect(saveCurrentProject).not.toHaveBeenCalled()
  })

  it('fixedSceneState change after release schedules the next autosave', async () => {
    const isImportingRef = { current: true }
    const saveCurrentProject = vi.fn()
    const initial = props({ isImportingRef, saveCurrentProject })
    const { rerender } = renderHook((p) => useAutoSave(p), { initialProps: initial })
    await vi.runAllTimersAsync()
    expect(saveCurrentProject).not.toHaveBeenCalled()

    isImportingRef.current = false
    rerender({ ...initial, fixedSceneState })
    await vi.runAllTimersAsync()

    expect(saveCurrentProject).toHaveBeenCalledTimes(1)
  })
})
