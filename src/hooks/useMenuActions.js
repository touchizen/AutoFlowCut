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
 * @param {Function} params.onNewProject  - invoked for the "New Project" item
 * @param {Function} params.onOpenProject - invoked with a name for a Recent item
 */

import { useEffect, useRef } from 'react'

export function useMenuActions({ activeProject, onNewProject, onOpenProject }) {
  // Keep the latest callbacks reachable without re-subscribing the IPC listener
  // on every render (the callbacks are usually fresh closures each render).
  const handlersRef = useRef({ onNewProject, onOpenProject })
  handlersRef.current = { onNewProject, onOpenProject }

  // Subscribe once to native menu actions.
  useEffect(() => {
    const off = window.electronAPI?.onMenuAction?.((data) => {
      if (!data) return
      if (data.action === 'new-project') {
        handlersRef.current.onNewProject?.()
      } else if (data.action === 'open-project' && data.name) {
        handlersRef.current.onOpenProject?.(data.name)
      }
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [])

  // Push the active project to the main process so Recent Projects stays MRU.
  useEffect(() => {
    if (activeProject) {
      window.electronAPI?.notifyProjectActivated?.(activeProject)
    }
  }, [activeProject])
}
