/**
 * useAutoSave — aspect ratio change triggers autosave
 *
 * Regression: settings.aspectRatio was missing from the effect deps, so
 * changing only the project format (16:9 <-> 9:16) never scheduled a save —
 * the new ratio lived in React/localStorage but never reached project.json.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutoSave } from '../../src/hooks/useAutoSave'

function baseProps(overrides = {}) {
  return {
    scenes: [{ id: 's1' }],
    references: [],
    videoScenes: [],
    framePairs: [],
    selectedStyleRefId: null,
    settings: { saveMode: 'folder', projectName: 'p', aspectRatio: '16:9' },
    generatingRefsCount: 0,
    isRunning: false,
    isRestoringRef: { current: false },
    saveCurrentProject: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useAutoSave — aspect ratio', () => {
  it('schedules a save when only the aspect ratio changes', () => {
    const save = vi.fn()
    const props = baseProps({ saveCurrentProject: save })
    const { rerender } = renderHook((p) => useAutoSave(p), { initialProps: props })
    vi.runAllTimers() // initial mount save
    save.mockClear()

    rerender({ ...props, settings: { ...props.settings, aspectRatio: '9:16' } })
    vi.runAllTimers()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not re-save when the deps are unchanged', () => {
    const save = vi.fn()
    const props = baseProps({ saveCurrentProject: save })
    const { rerender } = renderHook((p) => useAutoSave(p), { initialProps: props })
    vi.runAllTimers()
    save.mockClear()

    rerender({ ...props }) // new props object, identical dep values
    vi.runAllTimers()

    expect(save).not.toHaveBeenCalled()
  })

  it('skips autosave for an empty project', () => {
    const save = vi.fn()
    renderHook((p) => useAutoSave(p), {
      initialProps: baseProps({ scenes: [], saveCurrentProject: save }),
    })
    vi.runAllTimers()

    expect(save).not.toHaveBeenCalled()
  })
})

/**
 * useAutoSave — save failure visibility
 *
 * Regression: an autosave (which runs right after image generation) that
 * failed was swallowed silently — the image existed on disk but its metadata
 * never reached project.json. Failures now surface via onSaveError.
 */
describe('useAutoSave — save failure', () => {
  it('reports a failed autosave through onSaveError', async () => {
    const save = vi.fn().mockResolvedValue({ success: false, error: 'disk full' })
    const onSaveError = vi.fn()
    renderHook((p) => useAutoSave(p), {
      initialProps: baseProps({ saveCurrentProject: save, onSaveError }),
    })

    await vi.runAllTimersAsync()

    expect(onSaveError).toHaveBeenCalledWith('disk full')
  })

  it('does not report when the autosave succeeds', async () => {
    const save = vi.fn().mockResolvedValue({ success: true })
    const onSaveError = vi.fn()
    renderHook((p) => useAutoSave(p), {
      initialProps: baseProps({ saveCurrentProject: save, onSaveError }),
    })

    await vi.runAllTimersAsync()

    expect(onSaveError).not.toHaveBeenCalled()
  })

  it('reports a failure streak only once, then again after a success', async () => {
    const save = vi.fn().mockResolvedValue({ success: false, error: 'x' })
    const onSaveError = vi.fn()
    const props = baseProps({ saveCurrentProject: save, onSaveError })
    const { rerender } = renderHook((p) => useAutoSave(p), { initialProps: props })

    await vi.runAllTimersAsync()
    rerender({ ...props, scenes: [{ id: 's2' }] }) // another failing autosave
    await vi.runAllTimersAsync()
    expect(onSaveError).toHaveBeenCalledTimes(1) // streak — notified once

    save.mockResolvedValue({ success: true })     // a success resets the streak
    rerender({ ...props, scenes: [{ id: 's3' }] })
    await vi.runAllTimersAsync()

    save.mockResolvedValue({ success: false, error: 'y' }) // failing again notifies
    rerender({ ...props, scenes: [{ id: 's4' }] })
    await vi.runAllTimersAsync()
    expect(onSaveError).toHaveBeenCalledTimes(2)
  })
})
