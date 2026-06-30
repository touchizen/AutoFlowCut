/**
 * useMenuActions — bridges the native File menu to renderer actions.
 *
 * The native menu lives in the Electron main process; this hook wires it to
 * the renderer:
 *  - listens for `menu:action` events (New Project / Open Project),
 *  - notifies the main process whenever the active project changes so the
 *    "Recent Projects" submenu stays current.
 *
 * @param {object}   params
 * @param {string?}  params.activeProject - current project name (null in Flow mode)
 * @param {string?}  params.workFolder    - current work folder path (null in Flow mode)
 * @param {Function} params.onNewProject  - invoked for the "New Project" item
 * @param {Function} params.onOpenProject - invoked with a name for a Recent item
 * @param {Function} [params.onShowModeSelector] - invoked for the "생성 모드 선택…" item (re-shows the picker)
 * @param {boolean}  [params.busy] - true while a batch is running; the native
 *   "생성 모드 선택…" item resets the mode (unmounts the running app via
 *   ModeGate), so it is dropped while busy to avoid abandoning in-flight
 *   generations. The in-app ModeToggle already disables switching while busy;
 *   this closes the same hole on the native-menu path.
 */

import { useEffect, useRef } from 'react'

export function useMenuActions({ activeProject, workFolder, onNewProject, onOpenProject, onShowModeSelector, busy }) {
  // Keep the latest callbacks reachable without re-subscribing the IPC listener
  // on every render (the callbacks are usually fresh closures each render).
  const handlersRef = useRef({ onNewProject, onOpenProject, onShowModeSelector, busy })
  handlersRef.current = { onNewProject, onOpenProject, onShowModeSelector, busy }

  // Subscribe once to native menu actions.
  useEffect(() => {
    const off = window.electronAPI?.onMenuAction?.((data) => {
      if (!data) return
      if (data.action === 'new-project') {
        handlersRef.current.onNewProject?.()
      } else if (data.action === 'open-project' && data.name) {
        handlersRef.current.onOpenProject?.(data.name)
      } else if (data.action === 'show-mode-selector') {
        // Destructive: resets mode → unmounts the running app. Refuse mid-run.
        if (handlersRef.current.busy) return
        handlersRef.current.onShowModeSelector?.()
      }
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [])

  // Push the active project + its work folder to the main process so Recent
  // Projects stays MRU and scoped to the current folder. The work folder is
  // part of the report: a recent entry is only safe to reopen within the
  // folder it belongs to.
  useEffect(() => {
    if (activeProject && workFolder) {
      window.electronAPI?.notifyProjectActivated?.(activeProject, workFolder)
    }
  }, [activeProject, workFolder])
}
