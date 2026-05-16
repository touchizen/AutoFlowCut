// @vitest-environment node

/**
 * Native File menu — "Recent Projects" submenu wiring (electron/updater.js)
 *
 * Regression (P2): recent entries used to be bare project names. After the
 * user switched work folders, clicking a recent from the *old* folder hit
 * projectExists() === false against the current folder and silently opened an
 * empty same-named project. Fix: entries carry their work folder and the
 * submenu only ever lists projects from the current work folder.
 *
 * These tests pin: per-folder scoping, MRU order, and the menu→renderer IPC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let appMock
let menuMock
let lastTemplate // most recent template passed to Menu.buildFromTemplate
let sentMessages // { channel, payload } captured from mainWindow.webContents.send
let storeDir

function makeMocks() {
  lastTemplate = null
  sentMessages = []
  storeDir = mkdtempSync(path.join(tmpdir(), 'afc-menu-'))
  appMock = {
    isPackaged: false, // dev mode — setupAppMenuAndUpdater skips the update timer
    getVersion: () => '1.0.0',
    name: 'AutoFlowCut',
    getPath: () => storeDir, // isolated recent-projects.json per test
  }
  menuMock = {
    setApplicationMenu: vi.fn(),
    buildFromTemplate: vi.fn((tpl) => {
      lastTemplate = tpl
      return tpl
    }),
  }
}

const mainWindow = {
  webContents: {
    send: (channel, payload) => sentMessages.push({ channel, payload }),
  },
}

beforeEach(() => {
  vi.resetModules()
  makeMocks()
  vi.doMock('electron', () => ({
    app: appMock,
    Menu: menuMock,
    dialog: { showMessageBox: vi.fn(() => Promise.resolve({ response: 1 })) },
    shell: { openExternal: vi.fn() },
  }))
  vi.doMock('electron-updater', () => ({
    default: { autoUpdater: { autoDownload: true, autoInstallOnAppQuit: false, on: vi.fn() } },
  }))
})

afterEach(() => {
  vi.doUnmock('electron')
  vi.doUnmock('electron-updater')
  rmSync(storeDir, { recursive: true, force: true })
})

/** Recent Projects submenu labels from the most recent menu build. */
function recentLabels() {
  const file = lastTemplate.find((m) => m.label === 'File')
  const recent = file.submenu.find((i) => i.label === 'Recent Projects')
  return recent.submenu.map((i) => i.label)
}

describe('File menu — Recent Projects', () => {
  it('shows "(없음)" when no project has been activated', async () => {
    const { setupAppMenuAndUpdater } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater(() => mainWindow)

    expect(recentLabels()).toEqual(['(없음)'])
  })

  it('lists activated projects most-recent-first', async () => {
    const { setupAppMenuAndUpdater, noteProjectActivated } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater(() => mainWindow)

    noteProjectActivated('p1', '/folderA')
    noteProjectActivated('p2', '/folderA')

    expect(recentLabels()).toEqual(['p2', 'p1'])
  })

  it('scopes the submenu to the current work folder', async () => {
    const { setupAppMenuAndUpdater, noteProjectActivated } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater(() => mainWindow)

    noteProjectActivated('p1', '/folderA')
    noteProjectActivated('p2', '/folderA')
    // switch work folder — folderA recents must NOT leak into folderB's menu
    noteProjectActivated('x', '/folderB')

    expect(recentLabels()).toEqual(['x'])
    expect(recentLabels()).not.toContain('p1')
    expect(recentLabels()).not.toContain('p2')
  })

  it('restores a folder\'s own recents when switching back', async () => {
    const { setupAppMenuAndUpdater, noteProjectActivated } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater(() => mainWindow)

    noteProjectActivated('p1', '/folderA')
    noteProjectActivated('p2', '/folderA')
    noteProjectActivated('x', '/folderB')
    noteProjectActivated('p1', '/folderA') // back to folderA

    expect(recentLabels()).toEqual(['p1', 'p2'])
  })

  it('sends menu:action open-project with the chosen name', async () => {
    const { setupAppMenuAndUpdater, noteProjectActivated } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater(() => mainWindow)

    noteProjectActivated('p1', '/folderA')
    const file = lastTemplate.find((m) => m.label === 'File')
    const recent = file.submenu.find((i) => i.label === 'Recent Projects')
    recent.submenu[0].click()

    expect(sentMessages).toContainEqual({
      channel: 'menu:action',
      payload: { action: 'open-project', name: 'p1' },
    })
  })

  it('sends menu:action new-project for the New Project item', async () => {
    const { setupAppMenuAndUpdater } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater(() => mainWindow)

    const file = lastTemplate.find((m) => m.label === 'File')
    const newItem = file.submenu.find((i) => i.label === 'New Project')
    expect(newItem.accelerator).toBe('CmdOrCtrl+N')
    newItem.click()

    expect(sentMessages).toContainEqual({
      channel: 'menu:action',
      payload: { action: 'new-project' },
    })
  })

  it('rebuilds the menu when work folder changes (even with no list change)', async () => {
    const { setupAppMenuAndUpdater, noteProjectActivated } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater(() => mainWindow)

    noteProjectActivated('p1', '/folderA')
    const buildsBefore = menuMock.buildFromTemplate.mock.calls.length
    // same name re-activated under a different folder → list unchanged for A,
    // but currentWorkFolder flips, so the menu must rebuild
    noteProjectActivated('p1', '/folderB')

    expect(menuMock.buildFromTemplate.mock.calls.length).toBeGreaterThan(buildsBefore)
    expect(recentLabels()).toEqual(['p1']) // folderB's p1
  })
})
