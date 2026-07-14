import { app, Menu, dialog, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { loadRecentProjects, saveRecentProjects, mergeRecent } from './recent-projects.js'
import { getMenuLabels } from './menuLabels.js'

const { autoUpdater } = electronUpdater

// Native-menu wiring. The menu lives in the main process but its "New Project"
// and "Recent Projects" items must reach the renderer, so we keep a getter for
// the main window and the current MRU list at module scope. currentWorkFolder
// is the work folder of the most recently activated project — the Recent
// submenu only ever lists projects from it, since opening a recent from a
// different folder would silently create an empty same-named project.
let getMainWindowRef = () => null
let recentProjects = []
let currentWorkFolder = null
// 렌더러가 app:set-locale 로 push 하는 현재 언어 — 메뉴 라벨 현지화용. 기본 en.
let currentLang = 'en'

// AppX (Microsoft Store) builds update through the Store, not electron-updater.
// process.windowsStore is true when running as a packaged AppX.
const isAppx = process.platform === 'win32' && !!process.windowsStore

// dev 감지. app.isPackaged 는 electron 바이너리 이름을 'AutoFlowCut' 로 패치
// (scripts/patch-electron-name.cjs)하면 dev 에서도 true 로 오판한다(basename !== 'electron').
// 그래서 dev 가드가 뚫려 checkForUpdates 가 실행되고 app-update.yml(패키지 빌드에만 존재)을
// 못 찾아 ENOENT 가 났다. vite-plugin-electron 이 dev 에서만 설정하는 VITE_DEV_SERVER_URL 을
// 신뢰 신호로 쓴다(main.js 의 dev 판정과 동일).
const isDev = !!process.env.VITE_DEV_SERVER_URL || !app.isPackaged

let manualCheckInProgress = false
let updateDownloadInProgress = false
let updateDownloaded = false
let updaterConfigured = false

function log(...args) {
  try { console.log('[Updater]', ...args) } catch {}
}

function label(key, params = {}) {
  let value = getMenuLabels(currentLang)[key] || getMenuLabels('en')[key] || key
  for (const [name, replacement] of Object.entries(params)) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
}

function configureAutoUpdater() {
  // Idempotent — listeners must be registered exactly once. Without this guard,
  // each manualCheck() re-attaches handlers and update-downloaded fires the
  // restart dialog (and quitAndInstall) once per accumulated listener.
  if (updaterConfigured) return
  updaterConfigured = true

  // No auto-download — confirm via dialog before pulling the NSIS/DMG payload.
  // User confirmation triggers autoUpdater.downloadUpdate().
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => log('checking…'))
  autoUpdater.on('update-available', (info) => {
    log('available:', info?.version)
    manualCheckInProgress = false
    if (updateDownloadInProgress || updateDownloaded) return
    dialog
      .showMessageBox({
        type: 'question',
        title: label('updateTitle'),
        message: label('updateAvailable', { version: info?.version }),
        detail: `${label('currentVersion', { version: app.getVersion() })}\n\n${label('downloadPrompt')}`,
        buttons: [label('downloadNow'), label('later')],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response !== 0) return
        updateDownloadInProgress = true
        autoUpdater.downloadUpdate().catch(() => {
          updateDownloadInProgress = false
          log('download failed')
          dialog.showMessageBox({
            type: 'error',
            title: 'AutoFlowCut',
            message: label('updateDownloadFailed'),
            buttons: [label('ok')],
          })
        })
      })
  })
  autoUpdater.on('update-not-available', (info) => {
    log('not available (current is latest):', info?.version)
    if (manualCheckInProgress) {
      manualCheckInProgress = false
      dialog.showMessageBox({
        type: 'info',
        title: 'AutoFlowCut',
        message: label('latestVersion'),
        detail: label('currentVersion', { version: app.getVersion() }),
        buttons: [label('ok')],
      })
    }
  })
  autoUpdater.on('error', () => {
    log('error')
    if (manualCheckInProgress) {
      manualCheckInProgress = false
      dialog.showMessageBox({
        type: 'error',
        title: 'AutoFlowCut',
        message: label('updateCheckFailed'),
        buttons: [label('ok')],
      })
    }
  })
  autoUpdater.on('download-progress', (p) => {
    log(`downloading ${Math.round(p.percent)}% (${Math.round(p.bytesPerSecond / 1024)} KB/s)`)
  })
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true
    updateDownloadInProgress = false
    manualCheckInProgress = false
    log('downloaded:', info?.version)
    dialog
      .showMessageBox({
        type: 'question',
        title: label('updateTitle'),
        message: label('updateReady', { version: info?.version }),
        detail: label('restartInstallPrompt'),
        buttons: [label('restartNow'), label('later')],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
  })
}

function startAutoCheck() {
  if (isAppx) {
    log('AppX build detected — skipping auto-update (Microsoft Store handles updates)')
    return
  }
  if (isDev) {
    log('dev mode — skipping auto-update check')
    return
  }
  configureAutoUpdater()
  // Small delay so UI is ready before any dialog appears.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => log('initial check failed'))
  }, 3000)
}

function manualCheck() {
  if (isAppx) {
    dialog.showMessageBox({
      type: 'info',
      title: 'AutoFlowCut',
      message: label('storeVersion'),
      detail: label('storeUpdates'),
      buttons: [label('ok')],
    })
    return
  }
  if (isDev) {
    dialog.showMessageBox({
      type: 'info',
      title: 'AutoFlowCut',
      message: label('devUpdateUnavailable'),
      buttons: [label('ok')],
    })
    return
  }
  if (updateDownloaded) {
    dialog
      .showMessageBox({
        type: 'question',
        title: label('updateTitle'),
        message: label('updateAlreadyDownloaded'),
        buttons: [label('restartNow'), label('later')],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
      })
    return
  }
  if (manualCheckInProgress) {
    log('manual check already in progress')
    return
  }
  manualCheckInProgress = true
  configureAutoUpdater()
  autoUpdater.checkForUpdates().catch(() => {
    manualCheckInProgress = false
    log('manual check failed')
    dialog.showMessageBox({
      type: 'error',
      title: 'AutoFlowCut',
      message: label('updateCheckFailed'),
      buttons: [label('ok')],
    })
  })
}

// Forward a native-menu command to the renderer. No-op until the window exists.
function sendMenuAction(action, payload = {}) {
  const mw = getMainWindowRef()
  mw?.webContents?.send('menu:action', { action, ...payload })
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin'
  const appName = app.name || 'AutoFlowCut'
  const L = getMenuLabels(currentLang)

  const checkForUpdatesItem = {
    label: L.checkForUpdates,
    click: () => manualCheck(),
  }

  const macAppMenu = {
    label: appName,
    submenu: [
      { role: 'about' },
      checkForUpdatesItem,
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }

  // Only offer projects from the current work folder — see currentWorkFolder.
  const folderRecents = recentProjects.filter((e) => e.workFolder === currentWorkFolder)
  const recentSubmenu = folderRecents.length
    ? folderRecents.map((e) => ({
        label: e.name,
        click: () => sendMenuAction('open-project', { name: e.name }),
      }))
    : [{ label: L.recentEmpty, enabled: false }]

  const fileMenu = {
    label: 'File',
    submenu: [
      {
        label: 'New Project',
        accelerator: 'CmdOrCtrl+N',
        click: () => sendMenuAction('new-project'),
      },
      { type: 'separator' },
      { label: 'Recent Projects', submenu: recentSubmenu },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  }

  const editMenu = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? [
            { role: 'pasteAndMatchStyle' },
            { role: 'delete' },
            { role: 'selectAll' },
          ]
        : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
    ],
  }

  const viewMenu = {
    label: 'View',
    submenu: [
      {
        label: L.showModeSelector,
        click: () => sendMenuAction('show-mode-selector'),
      },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }

  const windowMenu = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }]
        : [{ role: 'close' }]),
    ],
  }

  const helpSubmenu = [
    {
      label: L.github,
      click: () => shell.openExternal('https://github.com/touchizen/AutoFlowCut'),
    },
    {
      label: L.reportIssue,
      click: () => shell.openExternal('https://github.com/touchizen/AutoFlowCut/issues'),
    },
  ]
  // On Windows there's no app menu, so add "Check for Updates" under Help.
  if (!isMac) {
    helpSubmenu.unshift(checkForUpdatesItem, { type: 'separator' })
  }

  const helpMenu = { role: 'help', submenu: helpSubmenu }

  const template = isMac
    ? [macAppMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu]
    : [fileMenu, editMenu, viewMenu, windowMenu, helpMenu]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function sameRecent(a, b) {
  return (
    a.length === b.length &&
    a.every((e, i) => e.name === b[i].name && e.workFolder === b[i].workFolder)
  )
}

/**
 * Record a project as recently-activated and refresh the Recent Projects
 * submenu. Called from the main process when the renderer sends
 * `app:project-activated`. Rebuilds the menu when the list or the current
 * work folder changes (the submenu is filtered by work folder).
 * @param {string} name
 * @param {string} workFolder - absolute path of the project's work folder
 */
export function noteProjectActivated(name, workFolder) {
  const prevWorkFolder = currentWorkFolder
  if (typeof workFolder === 'string' && workFolder.trim()) {
    currentWorkFolder = workFolder.trim()
  }
  const next = mergeRecent(recentProjects, { name, workFolder })
  const listChanged = !sameRecent(next, recentProjects)
  if (listChanged) {
    recentProjects = next
    saveRecentProjects(recentProjects)
  }
  if (listChanged || currentWorkFolder !== prevWorkFolder) {
    buildAppMenu()
  }
}

/**
 * @param {() => (import('electron').BrowserWindow | null)} [getMainWindow]
 */
export function setupAppMenuAndUpdater(getMainWindow = () => null) {
  getMainWindowRef = getMainWindow
  recentProjects = loadRecentProjects()
  buildAppMenu()
  startAutoCheck()
}

/**
 * 렌더러(I18nProvider)가 app:set-locale 로 push 한 언어로 메뉴 라벨을 현지화.
 * 바뀐 경우에만 메뉴를 다시 그린다.
 * @param {string} lang
 */
export function setMenuLocale(lang) {
  if (!lang || lang === currentLang) return
  currentLang = lang
  buildAppMenu()
}

export { manualCheck as checkForUpdatesManually }
