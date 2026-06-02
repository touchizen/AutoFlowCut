import { app, BrowserWindow, ipcMain, shell, protocol, net, powerSaveBlocker, Notification, safeStorage } from 'electron'
import http from 'node:http'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync as execSyncRaw } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { registerFilesystemIPC } from './ipc/filesystem.js'
import { registerAuthIPC } from './ipc/auth.js'
import { registerCapcutIPC } from './ipc/capcut.js'
import { registerMcpIPC } from './ipc/mcp.js'
import { registerGenaiIPC } from './ipc/genai-api.js'
import { createKeyStore } from './api/keyStore.js'
import { registerLayoutIPC, setLayoutMode, setSplitRatio, setModalVisible } from './ipc/layout.js'
import { openApiSpec, getSwaggerHtml } from './api-docs.js'
import { setupAppMenuAndUpdater, noteProjectActivated } from './updater.js'
import { initSentryMain } from './sentry-init.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// CDP debugger attach 영구 비활성 (default).
// 이유: Flow 의 안티 디버깅이 debugger.attach 를 감지하면
//   - 비디오 element 가 페이지에서 사라짐
//   - status 응답에서 videoUrl 필드가 빠짐
//   - media.getMediaUrlRedirect 가 400 Internal Error
//   → 다운로드 흐름 전체가 깨짐.
// CDP 가 작동 안 하므로 다음 기능들도 함께 비활성됨:
//   - seed/aspectRatio/reference 자동 inject (Fetch.continueRequest)
//   - 응답 body 자동 캡처 (Network.responseReceived getResponseBody)
//   - Page.setDownloadBehavior (다운로드 path 자동 지정 — session.on('will-download') 로 대체 필요)
// inject 기능 자체는 별도 라운드에서 Flow UI 조작 (DOM) 으로 대체 작업 필요.
// 개발 시 강제 활성: AUTOFLOWCUT_ENABLE_CDP=1
const FLOW_AUTOMATION_DISABLED = process.env.AUTOFLOWCUT_ENABLE_CDP !== '1'
if (FLOW_AUTOMATION_DISABLED) {
  console.log('[Flow] CDP debugger disabled by default (anti-detect). Set AUTOFLOWCUT_ENABLE_CDP=1 to force.')
} else {
  console.log('[Flow] ⚠️ AUTOFLOWCUT_ENABLE_CDP=1 — CDP attach forced ON (debug mode, may trigger anti-debug block).')
}

// Force the display name so dev-mode submenu items ("About …", "Quit …", etc.)
// match the productName from electron-builder. Has no effect on the bold app
// title in macOS menu bar (that comes from the Electron binary's Info.plist
// in dev; the packaged build sets it correctly).
app.setName('AutoFlowCut')

// macOS About 패널 + Dock 아이콘
// (app.dock은 whenReady 이후에만 사용 가능 → 아래로 옮김)
const __filename_main = fileURLToPath(import.meta.url)
const __dirname_main = path.dirname(__filename_main)
const APP_ICON_PATH = path.join(__dirname_main, '..', 'assets', 'icon.icns')
const HAS_APP_ICON = fsSync.existsSync(APP_ICON_PATH)

// package.json에서 buildNumber 읽기 (dev/prod 모두 동일)
let BUILD_NUMBER = ''
try {
  const pkgPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'package.json')
    : path.join(__dirname_main, '..', 'package.json')
  if (fsSync.existsSync(pkgPath)) {
    const pkg = JSON.parse(fsSync.readFileSync(pkgPath, 'utf-8'))
    if (pkg.buildNumber != null) BUILD_NUMBER = String(pkg.buildNumber)
  }
} catch (e) {
  console.warn('[AutoFlowCut] buildNumber read failed:', e.message)
}

if (process.platform === 'darwin') {
  const verStr = BUILD_NUMBER
    ? `${app.getVersion()} (Build ${BUILD_NUMBER})`
    : app.getVersion()
  console.log('[AutoFlowCut] About →', verStr, '/ isPackaged:', app.isPackaged)
  app.setAboutPanelOptions({
    applicationName: 'AutoFlowCut',
    applicationVersion: verStr,
    copyright: '© Touchizen',
    credits: 'AutoFlowCut — Google Flow → CapCut automation',
  })
}

// === Safe console logger (prevents EPIPE crash when stdout pipe is broken) ===
const _origLog = console.log
const _origWarn = console.warn
const _origError = console.error
console.log = (...args) => { try { _origLog(...args) } catch {} }
console.warn = (...args) => { try { _origWarn(...args) } catch {} }
console.error = (...args) => { try { _origError(...args) } catch {} }

// === Uncaught Exception Handler (prevent EPIPE dialog) ===
process.on('uncaughtException', (err) => {
  if (err?.code === 'EPIPE' || err?.message?.includes('EPIPE')) {
    // Silently ignore EPIPE — stdout pipe is broken (expected when restarting dev server)
    return
  }
  // For other errors, log but don't crash
  try { _origError('[Main] Uncaught exception:', err) } catch {}
})

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') })

// Initialize Sentry as early as possible after env is loaded so subsequent
// errors are captured. No-op when ENABLE_SENTRY != '1' or DSN missing.
initSentryMain()

// === Flow API URLs ===
const FLOW_URL = 'https://labs.google/fx/tools/flow'
const SESSION_URL = 'https://labs.google/fx/api/auth/session'
const BASE_API_URL = 'https://aisandbox-pa.googleapis.com/v1'
const GENERATE_URL = `${BASE_API_URL}/flowMedia:batchGenerateImages`
const UPLOAD_URL = `${BASE_API_URL}/flow/uploadImage`
const MEDIA_REDIRECT_URL = 'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect'
const TOKEN_INFO_URL = 'https://www.googleapis.com/oauth2/v3/tokeninfo'
const VIDEO_T2V_URL = `${BASE_API_URL}/video:batchAsyncGenerateVideoText`
const VIDEO_I2V_URL = `${BASE_API_URL}/video:batchAsyncGenerateVideoStartImage`
const VIDEO_I2V_START_END_URL = `${BASE_API_URL}/video:batchAsyncGenerateVideoStartAndEndImage`
const VIDEO_STATUS_URL = `${BASE_API_URL}/video:batchCheckAsyncVideoGenerationStatus`
const VIDEO_UPSCALE_URL = `${BASE_API_URL}/video:batchAsyncGenerateVideoUpsampleVideo`
const RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV'
const RECAPTCHA_ACTION = 'generate'

const API_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://labs.google',
  'X-Kl-Ajax-Request': 'Ajax_Request'
}

let mainWindow = null
let mcpHttpServer = null // MCP HTTP 서버 인스턴스


// updateBounds → ipc/layout.js로 이동 (import로 사용)




function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    title: `AutoFlowCut v${app.getVersion()}`,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false  // 로컬 file:// 이미지 로드 허용
    }
  })

  // 화면 꺼짐/절전 방지 기본 ON (layout 모듈에서 관리하므로 IPC로 초기화)
  // registerLayoutIPC 등록 후 자동으로 IPC 핸들러가 처리하지만,
  // createWindow 시점에서 바로 켜야 하므로 직접 호출
  powerSaveBlocker.start('prevent-display-sleep')


  // Open DevTools in development (detached so it doesn't cover WebContentsView)
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  // Load the React app (Vite dev server or built files)
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

}

// === IPC Handlers ===

// File System IPC (Node.js fs operations)
registerFilesystemIPC(ipcMain)

// Google GenAI IPC (BYOK key management + Imagen/Veo official-API generation).
// Replaces Flow web reverse-engineering. Key is encrypted via OS keychain
// (safeStorage) and never leaves the main process.
const genaiKeyStore = createKeyStore({
  safeStorage,
  filePath: path.join(app.getPath('userData'), 'genai-key.enc'),
  fs: fsSync,
})
registerGenaiIPC(ipcMain, { keyStore: genaiKeyStore })

// Auth IPC (Google OAuth) — opens its own BrowserWindow; no Flow view dependency.
registerAuthIPC(ipcMain)

// CapCut IPC (path detection, project writing, app launch)
registerCapcutIPC(ipcMain)

// MCP IPC (Claude Code MCP server registration)
registerMcpIPC(ipcMain)

// Layout, modal, sleep, open-external, show-in-folder IPC.
// No Flow view anymore → getFlowView returns null (updateBounds no-ops on null).
registerLayoutIPC(ipcMain, () => mainWindow, () => null)

// Renderer reports the active project (with its work folder) so the native
// "Recent Projects" menu stays in MRU order and scoped to the current folder.
ipcMain.handle('app:project-activated', (event, { name, workFolder }) => {
  try { noteProjectActivated(name, workFolder) } catch (e) { console.warn('[AutoFlowCut] noteProjectActivated failed:', e.message) }
  return { success: true }
})

// OS-level notification (reCAPTCHA block alerts, etc.) — surfaces alerts when the app is backgrounded.
ipcMain.handle('notify:os', (_e, { title, body } = {}) => {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: String(title || 'AutoFlowCut'), body: String(body || '') }).show()
    }
  } catch (e) {
    console.warn('[notify:os] failed:', e.message)
  }
  return { ok: true }
})

// === MCP HTTP Server ===
function startMcpHttpServer(port) {
  if (mcpHttpServer) {
    mcpHttpServer.close()
    mcpHttpServer = null
  }

  mcpHttpServer = http.createServer((req, res) => {
    // CORS: localhost만 허용
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    // body 파싱
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', async () => {
      try {
        const url = new URL(req.url, `http://localhost:${port}`)
        const pathname = url.pathname

        // GET /api/docs — Swagger UI
        if (req.method === 'GET' && pathname === '/api/docs') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(getSwaggerHtml(port))
          return
        }

        // GET /api/openapi.json — OpenAPI 스펙
        if (req.method === 'GET' && pathname === '/api/openapi.json') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(openApiSpec))
          return
        }

        // GET /api/status — 서버 상태 확인
        if (req.method === 'GET' && pathname === '/api/status') {
          res.writeHead(200)
          res.end(JSON.stringify({ status: 'ok', app: 'AutoFlowCut' }))
          return
        }

        // GET /api/current-project — 현재 열린 프로젝트 경로 반환
        if (req.method === 'GET' && pathname === '/api/current-project') {
          try {
            const result = await mainWindow.webContents.executeJavaScript(`
              (() => {
                const settings = JSON.parse(localStorage.getItem('autoflowcut_settings') || '{}')
                const workFolder = localStorage.getItem('workFolderPath') || ''
                return { projectName: settings.projectName || '', workFolder }
              })()
            `)
            const projectDir = (result.workFolder && result.projectName)
              ? path.join(result.workFolder, result.projectName)
              : ''
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ projectName: result.projectName, projectDir }))
          } catch (err) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        // PATCH /api/current-project — 기존 프로젝트로 전환
        if (req.method === 'PATCH' && pathname === '/api/current-project') {
          try {
            const configPath = path.join(app.getPath('userData'), 'work-folder-config.json')
            let workFolder
            try {
              const config = JSON.parse(await fs.readFile(configPath, 'utf-8'))
              workFolder = config.path
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'No work folder configured.' }))
              return
            }
            const data = JSON.parse(body)
            const projectName = data.name
            if (!projectName) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'name required' }))
              return
            }
            const projectDir = path.join(workFolder, projectName)
            // 프로젝트 존재 확인
            try {
              await fs.access(projectDir)
            } catch {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: `Project "${projectName}" not found` }))
              return
            }
            // 앱에 프로젝트 오픈 알림 (renderer가 있으면)
            if (mainWindow) {
              mainWindow.webContents.send('mcp-update', { type: 'open-project', projectName, workFolder })
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, projectDir, projectName }))
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        // GET /api/references — 현재 레퍼런스 목록 요청 (renderer에서 가져옴)
        if (req.method === 'GET' && pathname === '/api/references') {
          if (mainWindow) {
            mainWindow.webContents.executeJavaScript(
              `JSON.stringify(window.__mcpGetReferences?.() || [])`
            ).then(result => {
              res.writeHead(200)
              res.end(result)
            }).catch(err => {
              res.writeHead(500)
              res.end(JSON.stringify({ error: err.message }))
            })
          } else {
            res.writeHead(503)
            res.end(JSON.stringify({ error: 'App not ready' }))
          }
          return
        }

        // GET /api/scenes — 현재 씬 목록 요청
        if (req.method === 'GET' && pathname === '/api/scenes') {
          if (mainWindow) {
            mainWindow.webContents.executeJavaScript(
              `JSON.stringify(window.__mcpGetScenes?.() || [])`
            ).then(result => {
              res.writeHead(200)
              res.end(result)
            }).catch(err => {
              res.writeHead(500)
              res.end(JSON.stringify({ error: err.message }))
            })
          } else {
            res.writeHead(503)
            res.end(JSON.stringify({ error: 'App not ready' }))
          }
          return
        }

        // POST /api/update — 데이터 업데이트 (renderer로 전달)
        if (req.method === 'POST' && pathname === '/api/update') {
          const data = JSON.parse(body)
          if (mainWindow) {
            mainWindow.webContents.send('mcp-update', data)
            res.writeHead(200)
            res.end(JSON.stringify({ success: true }))
          } else {
            res.writeHead(503)
            res.end(JSON.stringify({ error: 'App not ready' }))
          }
          return
        }

        // POST /api/generate-reference — 레퍼런스 이미지 생성 트리거 (fire-and-forget)
        if (req.method === 'POST' && pathname === '/api/generate-reference') {
          const data = JSON.parse(body)
          const idx = data.index
          const styleId = data.styleId || null
          if (mainWindow && typeof idx === 'number') {
            // IPC 방식: renderer에 생성 요청 전달
            mainWindow.webContents.send('mcp-update', {
              type: 'generate-reference',
              index: idx,
              styleId: styleId
            })
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, message: `Reference ${idx} generation triggered` }))
          } else {
            res.writeHead(400)
            res.end(JSON.stringify({ error: 'index required (number)' }))
          }
          return
        }

        // POST /api/generate-scene — 씬 이미지 생성 트리거
        if (req.method === 'POST' && pathname === '/api/generate-scene') {
          const data = JSON.parse(body)
          const sceneId = data.sceneId
          const styleId = data.styleId  // 선택 — undefined면 useSceneGeneration의 기존 동작 (style_tag fallback만)
          if (mainWindow && sceneId) {
            mainWindow.webContents.send('mcp-update', {
              type: 'generate-scene',
              sceneId: sceneId,
              styleId: styleId
            })
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, message: `Scene ${sceneId} generation triggered` }))
          } else {
            res.writeHead(400)
            res.end(JSON.stringify({ error: 'sceneId required' }))
          }
          return
        }

        // GET /api/batch-status — 배치 생성 진행 상태
        if (req.method === 'GET' && pathname === '/api/batch-status') {
          if (mainWindow) {
            mainWindow.webContents.executeJavaScript(
              `JSON.stringify(window.__mcpBatchStatus?.() || {})`
            ).then(result => {
              res.writeHead(200)
              res.end(result)
            }).catch(err => {
              res.writeHead(500)
              res.end(JSON.stringify({ error: err.message }))
            })
          } else {
            res.writeHead(503)
            res.end(JSON.stringify({ error: 'App not ready' }))
          }
          return
        }

        // POST /api/start-scene-batch — 씬 일괄 생성 시작
        if (req.method === 'POST' && pathname === '/api/start-scene-batch') {
          if (mainWindow) {
            let styleId = null
            let force = false
            try {
              const parsed = JSON.parse(body)
              styleId = parsed.styleId || null
              force = !!parsed.force  // 선택, 기본 false. true면 완료된 씬도 재생성 대상에.
            } catch {}
            mainWindow.webContents.send('mcp-update', { type: 'start-scene-batch', styleId, force })
            res.writeHead(200)
            // 응답에 styleId echo 안 함 — fire-and-forget이라 effective style은 renderer fallback이
            // 결정하므로(예: 첫 카드 자동 적용), main이 즉시 알 수 없음. 거짓 정보를 주는 것보다 안 주는 게 정직.
            res.end(JSON.stringify({ success: true, message: 'Scene batch generation started' }))
          } else {
            res.writeHead(503)
            res.end(JSON.stringify({ error: 'App not ready' }))
          }
          return
        }

        // POST /api/notify-qa — QA 진행 상황 알림 (상단 배너 업데이트)
        if (req.method === 'POST' && pathname === '/api/notify-qa') {
          if (mainWindow) {
            let payload = {}
            try { payload = JSON.parse(body) } catch {}
            mainWindow.webContents.send('mcp-update', { type: 'qa-progress', ...payload })
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } else {
            res.writeHead(503)
            res.end(JSON.stringify({ error: 'App not ready' }))
          }
          return
        }

        // POST /api/start-ref-batch — 레퍼런스 일괄 생성 시작
        if (req.method === 'POST' && pathname === '/api/start-ref-batch') {
          if (mainWindow) {
            let styleId = null
            let force = false
            try {
              const parsed = JSON.parse(body)
              styleId = parsed.styleId || null
              force = !!parsed.force  // 선택, 기본 false. true면 완료된 ref도 재생성 대상에.
            } catch {}
            mainWindow.webContents.send('mcp-update', { type: 'start-ref-batch', styleId, force })
            res.writeHead(200)
            // start-scene-batch와 동일 — effective style을 main이 즉시 알 수 없으므로 echo 안 함.
            res.end(JSON.stringify({ success: true, message: 'Reference batch generation started' }))
          } else {
            res.writeHead(503)
            res.end(JSON.stringify({ error: 'App not ready' }))
          }
          return
        }

        // POST /api/audio-refresh — 오디오 리뷰 새로고침 (폴더 재스캔 + 자동 언플래그)
        if (req.method === 'POST' && pathname === '/api/audio-refresh') {
          if (mainWindow) {
            mainWindow.webContents.executeJavaScript(
              `(async () => { await window.__mcpRefreshAudioReviews?.(); return JSON.stringify(window.__mcpGetAudioReviews?.() || {}); })()`
            ).then(result => {
              const reviews = JSON.parse(result)
              res.writeHead(200)
              res.end(JSON.stringify({ success: true, count: Object.keys(reviews).length, reviews }))
            }).catch(err => {
              res.writeHead(500)
              res.end(JSON.stringify({ error: err.message }))
            })
          } else {
            res.writeHead(503)
            res.end(JSON.stringify({ error: 'App not ready' }))
          }
          return
        }

        // GET /api/audio-reviews — 현재 오디오 리뷰 상태 조회
        if (req.method === 'GET' && pathname === '/api/audio-reviews') {
          if (mainWindow) {
            mainWindow.webContents.executeJavaScript(
              `JSON.stringify(window.__mcpGetAudioReviews?.() || {})`
            ).then(result => {
              const reviews = JSON.parse(result)
              res.writeHead(200)
              res.end(JSON.stringify({ count: Object.keys(reviews).length, reviews }))
            }).catch(err => {
              res.writeHead(500)
              res.end(JSON.stringify({ error: err.message }))
            })
          } else {
            res.writeHead(503)
            res.end(JSON.stringify({ error: 'App not ready' }))
          }
          return
        }

        // POST /api/audio-import — 오디오 패키지 로드 (폴더 경로 지정)
        if (req.method === 'POST' && pathname === '/api/audio-import') {
          if (mainWindow) {
            const { folderPath } = body ? JSON.parse(body) : {}
            if (!folderPath) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'folderPath required' }))
              return
            }
            mainWindow.webContents.executeJavaScript(
              `(async () => { const r = await window.__mcpImportAudio?.(${JSON.stringify(folderPath)}); return JSON.stringify(r || {}); })()`
            ).then(result => {
              const r = JSON.parse(result)
              res.writeHead(r.success ? 200 : 500)
              res.end(JSON.stringify(r))
            }).catch(err => {
              res.writeHead(500)
              res.end(JSON.stringify({ error: err.message }))
            })
          } else {
            res.writeHead(503)
            res.end(JSON.stringify({ error: 'App not ready' }))
          }
          return
        }

        // POST /api/export-capcut — CapCut 프로젝트 내보내기
        if (req.method === 'POST' && pathname === '/api/export-capcut') {
          if (mainWindow) {
            const optionsJson = body ? JSON.stringify(JSON.parse(body)) : '{}'
            mainWindow.webContents.executeJavaScript(
              `(async () => { const r = await window.__mcpExportCapcut?.(${optionsJson}); return JSON.stringify(r || {}); })()`
            ).then(result => {
              const r = JSON.parse(result)
              res.writeHead(r.success ? 200 : 500)
              res.end(JSON.stringify(r))
            }).catch(err => {
              res.writeHead(500)
              res.end(JSON.stringify({ error: err.message }))
            })
          } else {
            res.writeHead(503)
            res.end(JSON.stringify({ error: 'App not ready' }))
          }
          return
        }

        // ── 프로젝트 관리 API ──────────────────────────

        // GET /api/projects — 프로젝트 목록 조회
        if (req.method === 'GET' && pathname === '/api/projects') {
          try {
            const configPath = path.join(app.getPath('userData'), 'work-folder-config.json')
            let workFolder
            try {
              const config = JSON.parse(await fs.readFile(configPath, 'utf-8'))
              workFolder = config.path
            } catch {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'No work folder configured. Open the app and select a work folder first.' }))
              return
            }
            const entries = await fs.readdir(workFolder, { withFileTypes: true })
            const projects = []
            for (const e of entries) {
              if (!e.isDirectory()) continue
              const projJsonPath = path.join(workFolder, e.name, 'project.json')
              let hasProject = false
              try { await fs.access(projJsonPath); hasProject = true } catch {}
              projects.push({ name: e.name, hasProjectJson: hasProject })
            }
            projects.sort((a, b) => b.name.localeCompare(a.name))
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, workFolder, projects }))
          } catch (err) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        // POST /api/projects — 프로젝트 생성
        if (req.method === 'POST' && pathname === '/api/projects') {
          try {
            const configPath = path.join(app.getPath('userData'), 'work-folder-config.json')
            let workFolder
            try {
              const config = JSON.parse(await fs.readFile(configPath, 'utf-8'))
              workFolder = config.path
            } catch {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'No work folder configured.' }))
              return
            }
            const data = JSON.parse(body)
            const projectName = data.name
            if (!projectName) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'name required' }))
              return
            }
            const projectDir = path.join(workFolder, projectName)
            // 이미 존재하는지 확인
            try {
              await fs.access(projectDir)
              res.writeHead(409)
              res.end(JSON.stringify({ error: `Project "${projectName}" already exists` }))
              return
            } catch { /* 없으면 정상 */ }
            // 디렉토리 + 하위 폴더 생성
            for (const sub of ['scenes', 'scenes/history', 'references', 'references/history', 'images', 'images/history', 'videos', 'videos/history', 'sfx', 'sfx/history']) {
              await fs.mkdir(path.join(projectDir, sub), { recursive: true })
            }
            // 빈 project.json 생성
            const projectJson = { scenes: [], references: [], settings: { aspectRatio: '16:9', defaultDuration: 3 } }
            await fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify(projectJson, null, 2), 'utf-8')
            // 앱에 프로젝트 오픈 알림 (renderer가 있으면)
            if (mainWindow) {
              mainWindow.webContents.send('mcp-update', { type: 'open-project', projectName, workFolder })
            }
            res.writeHead(201)
            res.end(JSON.stringify({ success: true, projectDir, projectName }))
          } catch (err) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        // PUT /api/projects — 프로젝트 이름 변경
        if (req.method === 'PUT' && pathname === '/api/projects') {
          try {
            const configPath = path.join(app.getPath('userData'), 'work-folder-config.json')
            let workFolder
            try {
              const config = JSON.parse(await fs.readFile(configPath, 'utf-8'))
              workFolder = config.path
            } catch {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'No work folder configured.' }))
              return
            }
            const data = JSON.parse(body)
            const { oldName, newName } = data
            if (!oldName || !newName) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'oldName and newName required' }))
              return
            }
            const oldDir = path.join(workFolder, oldName)
            const newDir = path.join(workFolder, newName)
            try { await fs.access(oldDir) } catch {
              res.writeHead(404)
              res.end(JSON.stringify({ error: `Project "${oldName}" not found` }))
              return
            }
            try { await fs.access(newDir); res.writeHead(409); res.end(JSON.stringify({ error: `Project "${newName}" already exists` })); return } catch { /* ok */ }
            await fs.rename(oldDir, newDir)
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, oldName, newName }))
          } catch (err) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        // DELETE /api/projects — 프로젝트 삭제
        if (req.method === 'DELETE' && pathname === '/api/projects') {
          try {
            const configPath = path.join(app.getPath('userData'), 'work-folder-config.json')
            let workFolder
            try {
              const config = JSON.parse(await fs.readFile(configPath, 'utf-8'))
              workFolder = config.path
            } catch {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'No work folder configured.' }))
              return
            }
            const data = JSON.parse(body)
            const projectName = data.name
            if (!projectName) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'name required' }))
              return
            }
            const projectDir = path.join(workFolder, projectName)
            try { await fs.access(projectDir) } catch {
              res.writeHead(404)
              res.end(JSON.stringify({ error: `Project "${projectName}" not found` }))
              return
            }
            await fs.rm(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, deleted: projectName }))
          } catch (err) {
            // Windows EPERM fallback (OneDrive 등 파일 잠금 시)
            if (process.platform === 'win32' && err.code === 'EPERM') {
              try {
                const { execSync } = require('child_process')
                execSync(`rmdir /s /q "${projectDir}"`, { windowsHide: true })
                res.writeHead(200)
                res.end(JSON.stringify({ success: true, deleted: projectName }))
              } catch (fallbackErr) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: fallbackErr.message }))
              }
            } else {
              res.writeHead(500)
              res.end(JSON.stringify({ error: err.message }))
            }
          }
          return
        }

        // 404
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Not found' }))
      } catch (err) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: err.message }))
      }
    })
  })

  mcpHttpServer.on('error', (err) => {
    console.error('[MCP HTTP] Server error:', err.message)
  })

  mcpHttpServer.listen(port, '127.0.0.1', () => {
    console.log(`[MCP HTTP] Server started on http://127.0.0.1:${port}`)
  })
}

function stopMcpHttpServer() {
  if (mcpHttpServer) {
    mcpHttpServer.close(() => {
      console.log('[MCP HTTP] Server stopped')
    })
    mcpHttpServer = null
  }
}

ipcMain.handle('mcp:start-http', (event, { port }) => {
  startMcpHttpServer(port || 3210)
  return { success: true, port }
})

ipcMain.handle('mcp:stop-http', () => {
  stopMcpHttpServer()
  return { success: true }
})


// === Custom Protocol: local-resource:// ===
// 로컬 파일을 렌더러에서 안전하게 로드하기 위한 커스텀 프로토콜
protocol.registerSchemesAsPrivileged([{
  scheme: 'local-resource',
  privileges: { bypassCSP: true, stream: true, supportFetchAPI: true, standard: true, secure: true }
}])

// === Auto Setup Skills (Claude Code integration) ===
function copyDirSync(src, dest) {
  if (!fsSync.existsSync(src)) return
  fsSync.mkdirSync(dest, { recursive: true })
  for (const entry of fsSync.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fsSync.copyFileSync(srcPath, destPath)
    }
  }
}

function autoSetupSkills() {
  // Claude Code 존재 확인
  try {
    execSyncRaw('claude --version', { stdio: 'pipe', timeout: 5000 })
  } catch {
    return // Claude Code 없음 → 스킬 설치 불필요
  }

  const skillsSource = path.join(process.resourcesPath, 'skills')
  const skillsDest = path.join(os.homedir(), '.claude', 'skills')
  const markerFile = path.join(skillsDest, '.autoflowcut-installed')

  // 이미 설치되었고 버전이 같으면 스킵
  if (fsSync.existsSync(markerFile)) {
    try {
      const marker = JSON.parse(fsSync.readFileSync(markerFile, 'utf-8'))
      if (marker.version === app.getVersion()) return
    } catch { /* 마커 파일 손상 → 재설치 */ }
  }

  // 스킬 6개 복사 (engine + 5 slash commands)
  // 추가 시 skills/story-engine/metadata.json dependencies 와도 동기화할 것.
  fsSync.mkdirSync(skillsDest, { recursive: true })
  for (const skill of ['story-engine', 'story-new', 'story-execute', 'story-next', 'story-step', 'story-rewrite']) {
    const src = path.join(skillsSource, skill)
    if (fsSync.existsSync(src)) {
      copyDirSync(src, path.join(skillsDest, skill))
    }
  }

  // MCP 서버 등록
  const mcpPath = path.join(process.resourcesPath, 'mcp-server', 'index.js')
  try {
    execSyncRaw(`claude mcp add --scope user --transport stdio autoflowcut -- node "${mcpPath}"`, {
      stdio: 'pipe', timeout: 10000
    })
  } catch { /* Claude CLI 실패 시 무시 — 사용자가 수동 등록 가능 */ }

  // 마커 파일 (버전 포함)
  fsSync.writeFileSync(markerFile, JSON.stringify({
    version: app.getVersion(),
    installedAt: new Date().toISOString()
  }))
  console.log('[AutoFlowCut] Skills installed to ~/.claude/skills/')
}

// === App Lifecycle ===
app.whenReady().then(() => {
  // Dock 아이콘 (macOS, dev/prod 둘 다) — whenReady 이후에만 app.dock 사용 가능
  if (process.platform === 'darwin' && HAS_APP_ICON && app.dock) {
    try { app.dock.setIcon(APP_ICON_PATH) } catch (e) { console.warn('[AutoFlowCut] dock.setIcon failed:', e.message) }
  }

  // local-resource:// 프로토콜 핸들러 등록
  protocol.handle('local-resource', (request) => {
    // URL: local-resource://host/absolute/path/to/file
    // decodeURIComponent로 한글 경로 등 처리
    let filePath = decodeURIComponent(new URL(request.url).pathname)
    // Windows: /C:/path → C:/path
    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1)
    }
    return net.fetch(`file://${filePath}`)
  })

  // Claude Code 스킬 자동 설치 (앱 시작 시)
  try { autoSetupSkills() } catch (e) { console.warn('[AutoFlowCut] Skill setup failed:', e.message) }

  // Native menu + auto-updater (skips dev mode and AppX builds)
  try { setupAppMenuAndUpdater(() => mainWindow) } catch (e) { console.warn('[AutoFlowCut] Updater setup failed:', e.message) }

  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
