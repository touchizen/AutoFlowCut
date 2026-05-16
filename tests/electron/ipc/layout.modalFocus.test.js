// @vitest-environment node

/**
 * app:set-modal-visible IPC handler — keyboard focus restore.
 *
 * Regression: opening a modal shrinks the Flow WebContentsView to 0×0 but
 * does NOT release native keyboard focus. Electron does not auto-transfer
 * focus between sibling WebContentsViews, so the modal's <input> received
 * no keystrokes (typing into "Project name" did nothing — Windows).
 * Fix: explicitly focus the main window webContents when a modal opens.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn(), isStarted: vi.fn(() => false) },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

import { registerLayoutIPC } from '../../../electron/ipc/layout.js'

function setup() {
  const handlers = {}
  const ipcMain = { handle: vi.fn((channel, fn) => { handlers[channel] = fn }) }

  const focus = vi.fn()
  const setBounds = vi.fn()
  const mainWindow = {
    webContents: { focus, send: vi.fn() },
    getContentBounds: () => ({ width: 1200, height: 800 }),
    contentView: {},
  }
  const flowView = { setBounds, webContents: {} }

  registerLayoutIPC(ipcMain, () => mainWindow, () => flowView)
  return { handlers, focus, setBounds }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('app:set-modal-visible', () => {
  it('restores keyboard focus to the main renderer when a modal opens', async () => {
    const { handlers, focus } = setup()

    await handlers['app:set-modal-visible']({}, { visible: true })

    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('does not steal focus when a modal closes', async () => {
    const { handlers, focus } = setup()

    await handlers['app:set-modal-visible']({}, { visible: false })

    expect(focus).not.toHaveBeenCalled()
  })

  it('collapses the Flow view to 0×0 while a modal is visible', async () => {
    const { handlers, setBounds } = setup()

    await handlers['app:set-modal-visible']({}, { visible: true })

    expect(setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('survives a missing main window without throwing', async () => {
    const handlers = {}
    const ipcMain = { handle: vi.fn((channel, fn) => { handlers[channel] = fn }) }
    registerLayoutIPC(ipcMain, () => null, () => null)

    const result = await handlers['app:set-modal-visible']({}, { visible: true })

    expect(result).toEqual({ success: true })
  })
})
