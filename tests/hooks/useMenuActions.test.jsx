/**
 * useMenuActions — native File menu ↔ renderer bridge
 *
 * Verifies the contract with the main process:
 *  - `menu:action` events route to onNewProject / onOpenProject,
 *  - the active project + its work folder are reported via
 *    notifyProjectActivated so the "Recent Projects" submenu stays MRU and
 *    scoped to the current work folder,
 *  - the IPC listener is cleaned up on unmount.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
vi.mock('../../src/components/Toast', () => ({
  toast: { warning: vi.fn() },
}))

import { useMenuActions } from '../../src/hooks/useMenuActions'
import { toast } from '../../src/components/Toast'

let menuCallback
let unsubscribe
let notifyProjectActivated

const noop = () => {}

beforeEach(() => {
  menuCallback = null
  unsubscribe = vi.fn()
  notifyProjectActivated = vi.fn()
  toast.warning.mockClear()
  window.electronAPI = {
    onMenuAction: vi.fn((cb) => {
      menuCallback = cb
      return unsubscribe
    }),
    notifyProjectActivated,
  }
})

describe('useMenuActions', () => {
  it('routes the "new-project" action to onNewProject', () => {
    const onNewProject = vi.fn()
    renderHook(() =>
      useMenuActions({ activeProject: 'p', workFolder: '/wf', onNewProject, onOpenProject: noop }),
    )

    menuCallback({ action: 'new-project' })

    expect(onNewProject).toHaveBeenCalledTimes(1)
  })

  it('routes the "show-mode-selector" action to onShowModeSelector', () => {
    const onShowModeSelector = vi.fn()
    renderHook(() =>
      useMenuActions({ activeProject: 'p', workFolder: '/wf', onNewProject: noop, onOpenProject: noop, onShowModeSelector }),
    )

    menuCallback({ action: 'show-mode-selector' })

    expect(onShowModeSelector).toHaveBeenCalledTimes(1)
  })

  it('drops the destructive "show-mode-selector" action while busy', () => {
    const onShowModeSelector = vi.fn()
    const { rerender } = renderHook(
      ({ busy }) =>
        useMenuActions({
          activeProject: 'p',
          workFolder: '/wf',
          onNewProject: noop,
          onOpenProject: noop,
          onShowModeSelector,
          busy,
        }),
      { initialProps: { busy: true } },
    )

    // Native menu fires mid-run (busy) → must NOT abandon the in-flight batch.
    menuCallback({ action: 'show-mode-selector' })
    expect(onShowModeSelector).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledTimes(1)

    // Once idle, the same action is honored.
    rerender({ busy: false })
    menuCallback({ action: 'show-mode-selector' })
    expect(onShowModeSelector).toHaveBeenCalledTimes(1)
  })

  it('rejects New, Open, and mode selector actions while busy and warns for each attempt', () => {
    const onNewProject = vi.fn()
    const onOpenProject = vi.fn()
    const onShowModeSelector = vi.fn()
    renderHook(() =>
      useMenuActions({
        activeProject: 'p',
        workFolder: '/wf',
        onNewProject,
        onOpenProject,
        onShowModeSelector,
        busy: true,
      }),
    )

    menuCallback({ action: 'new-project' })
    menuCallback({ action: 'open-project', name: 'x' })
    menuCallback({ action: 'show-mode-selector' })

    expect(onNewProject).not.toHaveBeenCalled()
    expect(onOpenProject).not.toHaveBeenCalled()
    expect(onShowModeSelector).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledTimes(3)
  })

  it('routes the "open-project" action to onOpenProject with the name', () => {
    const onOpenProject = vi.fn()
    renderHook(() =>
      useMenuActions({ activeProject: 'p', workFolder: '/wf', onNewProject: noop, onOpenProject }),
    )

    menuCallback({ action: 'open-project', name: 'my-project' })

    expect(onOpenProject).toHaveBeenCalledWith('my-project')
  })

  it('ignores an open-project action with no name', () => {
    const onOpenProject = vi.fn()
    renderHook(() =>
      useMenuActions({ activeProject: 'p', workFolder: '/wf', onNewProject: noop, onOpenProject }),
    )

    menuCallback({ action: 'open-project' })
    menuCallback(null)
    menuCallback({ action: 'unknown' })

    expect(onOpenProject).not.toHaveBeenCalled()
  })

  it('reports the active project and its work folder on mount', () => {
    renderHook(() =>
      useMenuActions({ activeProject: 'alpha', workFolder: '/wfA', onNewProject: noop, onOpenProject: noop }),
    )

    expect(notifyProjectActivated).toHaveBeenCalledWith('alpha', '/wfA')
  })

  it('re-reports when the active project changes', () => {
    const { rerender } = renderHook(
      ({ p }) =>
        useMenuActions({ activeProject: p, workFolder: '/wfA', onNewProject: noop, onOpenProject: noop }),
      { initialProps: { p: 'alpha' } },
    )
    rerender({ p: 'beta' })

    expect(notifyProjectActivated).toHaveBeenNthCalledWith(1, 'alpha', '/wfA')
    expect(notifyProjectActivated).toHaveBeenNthCalledWith(2, 'beta', '/wfA')
  })

  it('re-reports when the work folder changes but the project name stays', () => {
    const { rerender } = renderHook(
      ({ wf }) =>
        useMenuActions({ activeProject: 'same', workFolder: wf, onNewProject: noop, onOpenProject: noop }),
      { initialProps: { wf: '/wfA' } },
    )
    rerender({ wf: '/wfB' })

    expect(notifyProjectActivated).toHaveBeenNthCalledWith(1, 'same', '/wfA')
    expect(notifyProjectActivated).toHaveBeenNthCalledWith(2, 'same', '/wfB')
  })

  it('does not report when there is no active project (Flow mode)', () => {
    renderHook(() =>
      useMenuActions({ activeProject: null, workFolder: '/wfA', onNewProject: noop, onOpenProject: noop }),
    )

    expect(notifyProjectActivated).not.toHaveBeenCalled()
  })

  it('does not report when the work folder is unknown', () => {
    renderHook(() =>
      useMenuActions({ activeProject: 'p', workFolder: null, onNewProject: noop, onOpenProject: noop }),
    )

    expect(notifyProjectActivated).not.toHaveBeenCalled()
  })

  it('uses the latest callbacks without re-subscribing the IPC listener', () => {
    const firstNew = vi.fn()
    const secondNew = vi.fn()
    const { rerender } = renderHook(
      ({ cb }) =>
        useMenuActions({ activeProject: 'p', workFolder: '/wf', onNewProject: cb, onOpenProject: noop }),
      { initialProps: { cb: firstNew } },
    )
    rerender({ cb: secondNew })

    menuCallback({ action: 'new-project' })

    expect(window.electronAPI.onMenuAction).toHaveBeenCalledTimes(1)
    expect(firstNew).not.toHaveBeenCalled()
    expect(secondNew).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes from menu actions on unmount', () => {
    const { unmount } = renderHook(() =>
      useMenuActions({ activeProject: 'p', workFolder: '/wf', onNewProject: noop, onOpenProject: noop }),
    )
    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not throw when electronAPI is unavailable', () => {
    delete window.electronAPI
    expect(() =>
      renderHook(() =>
        useMenuActions({ activeProject: 'p', workFolder: '/wf', onNewProject: noop, onOpenProject: noop }),
      ),
    ).not.toThrow()
  })
})
