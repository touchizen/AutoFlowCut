/**
 * useMenuActions — native File menu ↔ renderer bridge
 *
 * Verifies the contract with the main process:
 *  - `menu:action` events route to onNewProject / onOpenProject,
 *  - the active project is reported via notifyProjectActivated so the
 *    "Recent Projects" submenu stays MRU,
 *  - the IPC listener is cleaned up on unmount.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMenuActions } from '../../src/hooks/useMenuActions'

let menuCallback
let unsubscribe
let notifyProjectActivated

beforeEach(() => {
  menuCallback = null
  unsubscribe = vi.fn()
  notifyProjectActivated = vi.fn()
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
    renderHook(() => useMenuActions({ activeProject: 'p', onNewProject, onOpenProject: vi.fn() }))

    menuCallback({ action: 'new-project' })

    expect(onNewProject).toHaveBeenCalledTimes(1)
  })

  it('routes the "open-project" action to onOpenProject with the name', () => {
    const onOpenProject = vi.fn()
    renderHook(() => useMenuActions({ activeProject: 'p', onNewProject: vi.fn(), onOpenProject }))

    menuCallback({ action: 'open-project', name: 'my-project' })

    expect(onOpenProject).toHaveBeenCalledWith('my-project')
  })

  it('ignores an open-project action with no name', () => {
    const onOpenProject = vi.fn()
    renderHook(() => useMenuActions({ activeProject: 'p', onNewProject: vi.fn(), onOpenProject }))

    menuCallback({ action: 'open-project' })
    menuCallback(null)
    menuCallback({ action: 'unknown' })

    expect(onOpenProject).not.toHaveBeenCalled()
  })

  it('notifies the main process of the active project on mount', () => {
    renderHook(() => useMenuActions({ activeProject: 'alpha', onNewProject: vi.fn(), onOpenProject: vi.fn() }))

    expect(notifyProjectActivated).toHaveBeenCalledWith('alpha')
  })

  it('re-notifies when the active project changes', () => {
    const { rerender } = renderHook(
      ({ p }) => useMenuActions({ activeProject: p, onNewProject: vi.fn(), onOpenProject: vi.fn() }),
      { initialProps: { p: 'alpha' } },
    )
    rerender({ p: 'beta' })

    expect(notifyProjectActivated).toHaveBeenNthCalledWith(1, 'alpha')
    expect(notifyProjectActivated).toHaveBeenNthCalledWith(2, 'beta')
  })

  it('does not notify when there is no active project (Flow mode)', () => {
    renderHook(() => useMenuActions({ activeProject: null, onNewProject: vi.fn(), onOpenProject: vi.fn() }))

    expect(notifyProjectActivated).not.toHaveBeenCalled()
  })

  it('uses the latest callbacks without re-subscribing the IPC listener', () => {
    const firstNew = vi.fn()
    const secondNew = vi.fn()
    const { rerender } = renderHook(
      ({ cb }) => useMenuActions({ activeProject: 'p', onNewProject: cb, onOpenProject: vi.fn() }),
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
      useMenuActions({ activeProject: 'p', onNewProject: vi.fn(), onOpenProject: vi.fn() }),
    )
    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not throw when electronAPI is unavailable', () => {
    delete window.electronAPI
    expect(() =>
      renderHook(() => useMenuActions({ activeProject: 'p', onNewProject: vi.fn(), onOpenProject: vi.fn() })),
    ).not.toThrow()
  })
})
