// @vitest-environment node

/**
 * updater — auto-updater listener wiring & download confirmation
 *
 * Regression context: code review on this branch flagged three bugs:
 *   1. configureAutoUpdater() re-attaches listeners on every manual check,
 *      so update-downloaded fires the restart dialog (and quitAndInstall)
 *      once per accumulated listener.
 *   2. autoDownload was true while the comment claimed downloads should be
 *      gated behind a dialog — large NSIS/DMG payloads pulled silently.
 *   3. Comment ↔ behavior contradiction (covered by #2).
 *
 * These tests pin the fixed behavior:
 *   - listener registration is idempotent
 *   - autoDownload is false
 *   - "지금 다운로드" → downloadUpdate(); "나중에" → no download
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared mock fixtures, re-built per test (vi.resetModules + doMock).
let autoUpdaterMock
let dialogMock
let appMock
let menuMock
let handlers // captured listeners by event name

function makeMocks() {
  handlers = new Map()
  autoUpdaterMock = {
    autoDownload: true, // intentionally start as true to verify config flips it
    autoInstallOnAppQuit: false,
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    checkForUpdates: vi.fn(() => Promise.resolve()),
    downloadUpdate: vi.fn(() => Promise.resolve()),
    quitAndInstall: vi.fn(),
  }
  dialogMock = {
    showMessageBox: vi.fn(() => Promise.resolve({ response: 1 })),
  }
  appMock = {
    isPackaged: true,
    getVersion: () => '1.0.0',
    name: 'AutoFlowCut',
  }
  menuMock = {
    setApplicationMenu: vi.fn(),
    buildFromTemplate: vi.fn((tpl) => tpl),
  }
}

beforeEach(() => {
  vi.resetModules()
  makeMocks()

  vi.doMock('electron', () => ({
    app: appMock,
    Menu: menuMock,
    dialog: dialogMock,
    shell: { openExternal: vi.fn() },
  }))

  vi.doMock('electron-updater', () => ({
    default: { autoUpdater: autoUpdaterMock },
  }))
})

afterEach(() => {
  vi.doUnmock('electron')
  vi.doUnmock('electron-updater')
})

// Flush enough microtasks for chained .then() blocks in the SUT.
async function flushAsync() {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe('configureAutoUpdater — config flags', () => {
  it('autoDownload=false (사용자 확인 후 downloadUpdate 흐름)', async () => {
    const { setupAppMenuAndUpdater } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater()
    expect(autoUpdaterMock.autoDownload).toBe(false)
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(true)
  })
})

describe('configureAutoUpdater — idempotent listener registration', () => {
  it('수동 체크 N번 반복해도 listener는 1세트만 등록', async () => {
    const updater = await import('../../electron/updater.js')
    updater.setupAppMenuAndUpdater()

    const initialOnCalls = autoUpdaterMock.on.mock.calls.length
    expect(initialOnCalls).toBeGreaterThan(0)

    updater.checkForUpdatesManually()
    updater.checkForUpdatesManually()
    updater.checkForUpdatesManually()

    expect(autoUpdaterMock.on.mock.calls.length).toBe(initialOnCalls)
  })

  it('각 이벤트는 정확히 한 번만 등록', async () => {
    const updater = await import('../../electron/updater.js')
    updater.setupAppMenuAndUpdater()
    updater.checkForUpdatesManually()
    updater.checkForUpdatesManually()

    const events = autoUpdaterMock.on.mock.calls.map(([evt]) => evt)
    const counts = events.reduce((acc, e) => {
      acc[e] = (acc[e] || 0) + 1
      return acc
    }, {})
    for (const [event, count] of Object.entries(counts)) {
      expect(count, `event "${event}" registered ${count}x`).toBe(1)
    }
  })
})

describe('update-available — download confirmation', () => {
  it('"지금 다운로드" 선택 시 downloadUpdate() 호출', async () => {
    let resolveDialog
    dialogMock.showMessageBox = vi.fn(
      () => new Promise((r) => { resolveDialog = r })
    )
    const { setupAppMenuAndUpdater } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater()

    const onAvailable = handlers.get('update-available')
    expect(onAvailable).toBeDefined()
    onAvailable({ version: '1.0.1' })

    expect(dialogMock.showMessageBox).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()

    resolveDialog({ response: 0 })
    await flushAsync()

    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('"나중에" 선택 시 downloadUpdate() 호출 안 함', async () => {
    let resolveDialog
    dialogMock.showMessageBox = vi.fn(
      () => new Promise((r) => { resolveDialog = r })
    )
    const { setupAppMenuAndUpdater } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater()

    const onAvailable = handlers.get('update-available')
    onAvailable({ version: '1.0.1' })
    resolveDialog({ response: 1 })
    await flushAsync()

    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
  })

  it('이미 다운로드 중이면 update-available 다이얼로그 띄우지 않음 (중복 가드)', async () => {
    dialogMock.showMessageBox = vi.fn(() => Promise.resolve({ response: 0 }))
    const { setupAppMenuAndUpdater } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater()

    const onAvailable = handlers.get('update-available')
    onAvailable({ version: '1.0.1' })
    await flushAsync()

    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)
    dialogMock.showMessageBox.mockClear()

    onAvailable({ version: '1.0.1' })
    await flushAsync()

    expect(dialogMock.showMessageBox).not.toHaveBeenCalled()
  })
})

describe('update-downloaded — restart dialog', () => {
  it('"지금 재시작" 선택 시 quitAndInstall() 호출', async () => {
    let resolveDialog
    dialogMock.showMessageBox = vi.fn(
      () => new Promise((r) => { resolveDialog = r })
    )
    const { setupAppMenuAndUpdater } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater()

    const onDownloaded = handlers.get('update-downloaded')
    onDownloaded({ version: '1.0.1' })
    resolveDialog({ response: 0 })
    await flushAsync()

    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('"나중에" 선택 시 quitAndInstall() 호출 안 함', async () => {
    let resolveDialog
    dialogMock.showMessageBox = vi.fn(
      () => new Promise((r) => { resolveDialog = r })
    )
    const { setupAppMenuAndUpdater } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater()

    const onDownloaded = handlers.get('update-downloaded')
    onDownloaded({ version: '1.0.1' })
    resolveDialog({ response: 1 })
    await flushAsync()

    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  })
})

describe('manualCheck — gating', () => {
  it('dev 모드에서는 체크 다이얼로그만 띄우고 checkForUpdates 호출 안 함', async () => {
    appMock.isPackaged = false
    const { setupAppMenuAndUpdater, checkForUpdatesManually } = await import('../../electron/updater.js')
    setupAppMenuAndUpdater()
    checkForUpdatesManually()

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(dialogMock.showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('packaged 모드에서 수동 체크는 checkForUpdates 호출', async () => {
    const { checkForUpdatesManually } = await import('../../electron/updater.js')
    // setupAppMenuAndUpdater 없이 직접 manual — configure는 manualCheck가 호출
    checkForUpdatesManually()

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.autoDownload).toBe(false)
  })
})
