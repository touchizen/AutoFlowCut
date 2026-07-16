import { app, BrowserWindow, WebContentsView, ipcMain, shell, protocol, net, powerSaveBlocker, Notification, safeStorage, globalShortcut } from 'electron'
import http from 'node:http'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync as execSyncRaw } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { shouldCreateWindowOnActivate } from './appActivation.js'
import { registerFilesystemIPC } from './ipc/filesystem.js'
import { registerAuthIPC } from './ipc/auth.js'
import { registerCapcutIPC } from './ipc/capcut.js'
import { registerPremiereIPC } from './ipc/premiere.js'
import { registerVrewIPC } from './ipc/vrew.js'
import { registerMcpIPC } from './ipc/mcp.js'
import { registerGenaiIPC } from './ipc/genai-api.js'
import { registerStoryIPC } from './ipc/story-api.js'
import { registerTtsIPC } from './ipc/tts-api.js'
import * as llmClaude from './api/llm/llmClaude.js'
import * as llmCodex from './api/llm/llmCodex.js'
import { createStoryLlmRouter } from './api/llm/storyLlmRouter.js'
import { loadMetaPrompt } from './api/llm/metaPrompts.js'
import { createKeyStore } from './api/keyStore.js'
import { createMultiKeyStore } from './api/keyStoreMulti.js'
import { createTtsAdapter } from './api/tts/index.js'
import { getTypecastKey } from './api/tts/typecastKey.js'
import { readCredentialsKey } from './api/tts/credentialsKey.js'
import { createSfxAdapter } from './api/sfx/index.js'
import { createVoiceGenderCache } from './api/tts/voiceGenderCache.js'
import { applyGenderOverlay } from './api/tts/genderOverlay.js'
import { createVoicePreviewService } from './api/tts/voicePreviewService.js'
import { ssrfSafeFetch } from './api/net/ssrfSafeFetch.js'
import { voiceKey } from '../src/utils/voiceKey.js'
import { registerLayoutIPC, setLayoutMode, setSplitRatio, setModalVisible, updateBounds } from './ipc/layout.js'
import { createModeController } from './ipc/mode.js'
import { openApiSpec, getSwaggerHtml } from './api-docs.js'
import { setupAppMenuAndUpdater, noteProjectActivated, setMenuLocale } from './updater.js'
import { initSentryMain } from './sentry-init.js'
import { registerFlowAPIIPC } from './ipc/flow-api.js'
import { registerVideoIPC } from './ipc/video.js'
import { registerCharacterIPC } from './ipc/character.js'
import { buildFlowInjectPayload, flowInjectClearPayload } from './flow-inject-payload.js'
import { captureApiOrigin, resolveApiBase } from './flow-api-base.js'
import { registerDomIPC } from './ipc/dom.js'
import { createSharedHelpers } from './ipc/shared.js'
import { routeReportResponse, isFlowFrameOrigin } from './reportResponseRouter.js'
import { FLOW_PAGE_INJECTION } from './flow-page-injection.js'
import { FLOW_SETTINGS_DUMPER } from './flow-settings-dumper.js'
import { FLOW_DOM_DUMP_PROBE, buildDomDumpFilename } from './flow-dom-dump.js'
import { createFlowDiagSink } from './flow-diag.js'
import * as Sentry from '@sentry/electron/main'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Force the display name so dev-mode submenu items ("About …", "Quit …", etc.)
// match the productName from electron-builder. Has no effect on the bold app
// title in macOS menu bar (that comes from the Electron binary's Info.plist
// in dev; the packaged build sets it correctly).
app.setName('AutoFlowCut')

// macOS About 패널 + Dock 아이콘
// (app.dock은 whenReady 이후에만 사용 가능 → 아래로 옮김)
const __filename_main = fileURLToPath(import.meta.url)
const __dirname_main = path.dirname(__filename_main)
// dock.setIcon 은 nativeImage 로 로드 — .icns 디코딩이 불안정해 실패한다(dev 에서
// "Failed to load image" 경고). PNG 를 쓴다(프로덕션 .app 번들 아이콘은 electron-builder 가
// 별도 .icns 로 처리하므로 무관).
const APP_ICON_PATH = path.join(__dirname_main, '..', 'assets', 'icon.png')
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
    credits: 'AutoFlowCut — Google Gemini/Veo → CapCut automation',
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
const sentryMain = initSentryMain()

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
// 렌더러가 app:project-activated로 마지막 보고한 작업 폴더 — story:open의 projectPath가
// 이 하위인지 검증하는 데 쓰인다(story-api.js의 getActiveWorkFolder dep).
let activeWorkFolder = null

let capturedProjectId = null // Flow 네트워크에서 자동 캡처된 projectId
let capturedApiOrigin = null // #R33: Flow 가 실제로 쓴 생성 API origin(region 대응). null 이면 BASE_API_URL fallback.
let pendingGeneration = null // DOM-triggered generation 응답 캡처용 Promise resolver (이미지) — 동기 모드
const pendingGenerations = new Map() // 비동기 모드용 다중 생성 추적 (key: generationId)
// DOM 에서 이미 수집(배정)한 결과 이미지 mediaId 집합 — flow-api(비동기)와 character(동기 @멘션)
//   양쪽이 공유해, 혼합 배치에서 한 경로가 수집한 이미지를 다른 경로가 또 매칭하는 race 를 막는다.
const collectedMediaIds = new Set()
let pendingVideoGeneration = null // DOM-triggered video generation 응답 캡처용 Promise resolver
let enterToolClicked = false // Enter tool 버튼 클릭 완료 플래그 (무한루프 방지)
let consentClicked = false   // 동의 버튼 클릭 완료 플래그 (무한루프 방지)

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

  // Re-size the Flow WebContentsView whenever the window is resized (§3.4).
  // modeController is module-scope (created before app.whenReady) so it's always in scope here.
  mainWindow.on('resize', () => updateBounds(mainWindow, modeController.getFlowView()))
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

// TTS provider 멀티 키 저장소 (스펙 §6, M2a-3b) — genai|elevenlabs|typecast|anthropic.
const multiKeyStore = createMultiKeyStore({
  safeStorage,
  keysDir: path.join(app.getPath('userData'), 'keys'),
  fs: fsSync,
  path,
})
// TTS 어댑터 라우팅(화자별 엔진). provider별 키 소스:
//  - typecast: multiKeyStore 우선, 없으면 env/~/.typecast/credentials 폴백
//  - elevenlabs/googletts: multiKeyStore 우선, 없으면 env/~/.{service}/credentials 폴백
//  - gemini: genai(Gemini) 키 재사용
// 같은 어댑터를 story audio(합성)와 tts IPC(listVoices)가 공유(메모이즈).
const ttsFetch = (...a) => globalThis.fetch(...a)
const ttsKeyFor = {
  typecast: () => multiKeyStore.getKey('typecast') || getTypecastKey(),
  elevenlabs: () => multiKeyStore.getKey('elevenlabs') || readCredentialsKey('elevenlabs', 'ELEVENLABS_API_KEY'),
  googletts: () => multiKeyStore.getKey('googletts') || readCredentialsKey('googletts', 'GOOGLE_TTS_API_KEY'),
  gemini: () => genaiKeyStore.getKey(),
}
const ttsAdapters = {}
const ttsFor = (provider) => {
  const p = provider || 'typecast'
  if (!ttsKeyFor[p]) throw new Error(`Unsupported TTS provider: ${p}`)
  if (!ttsAdapters[p]) ttsAdapters[p] = createTtsAdapter(p, { getKey: ttsKeyFor[p], fetch: ttsFetch })
  return ttsAdapters[p]
}
// 성우 성별 캐시(app-global, provider:voiceId → gender) + 미리듣기 메타/서비스 (Task 8).
const voiceGenderCache = createVoiceGenderCache({ filePath: path.join(app.getPath('userData'), 'voice-gender.json') })
const voiceMetaCache = new Map() // 'provider:voiceId' -> { previewUrl, language }
const VOICE_META_CACHE_MAX = 5000
const voicePreviewService = createVoicePreviewService({
  cacheDir: path.join(app.getPath('userData'), 'voice-preview'),
  ttsFor,
  voiceMeta: (provider, voiceId) => voiceMetaCache.get(voiceKey(provider, voiceId)) || {},
  ssrfSafeFetch,
  fetch: globalThis.fetch,
})
registerTtsIPC(ipcMain, {
  keyStore: multiKeyStore,
  safeStorage,
  listVoices: async (provider, options) => {
    let raw
    try { raw = await ttsFor(provider).listVoices(options) } catch { return [] }
    // Enforce cap before filling so the just-fetched list's metadata always survives
    if (voiceMetaCache.size + raw.length > VOICE_META_CACHE_MAX) voiceMetaCache.clear()
    for (const v of raw) voiceMetaCache.set(voiceKey(provider, v.id), { previewUrl: v.previewUrl || null, language: v.language || 'ko' })
    try { return applyGenderOverlay(provider, raw, voiceGenderCache.get()) } catch { return raw }
  },
  previewVoice: (args) => voicePreviewService.getPreview(args),
  tagVoiceGender: (args) => voiceGenderCache.tag(args),
})

// M2b: SFX 어댑터 라우팅(sourceMode별). 키는 provider별 소스(elevenlabs는 tts와 동일 키 재사용).
const sfxKeyFor = {
  elevenlabs: () => multiKeyStore.getKey('elevenlabs') || readCredentialsKey('elevenlabs', 'ELEVENLABS_API_KEY'),
  library: () => null,
}
const sfxAdapters = {}
const sfxFor = (provider) => {
  const p = provider || 'elevenlabs'
  if (!sfxKeyFor[p]) throw new Error(`Unsupported SFX provider: ${p}`)
  if (!sfxAdapters[p]) sfxAdapters[p] = createSfxAdapter(p, { getKey: sfxKeyFor[p], fetch: ttsFetch })
  return sfxAdapters[p]
}

const storyLlm = createStoryLlmRouter({ claude: llmClaude, codex: llmCodex })

// Story pipeline IPC (script/scenes/audio/prompts 스텝 머신 + preload 브릿지).
registerStoryIPC(ipcMain, {
  keyStore: genaiKeyStore,
  getWindow: () => mainWindow,
  llm: storyLlm,
  loadMetaPrompt,
  getActiveWorkFolder: () => activeWorkFolder,
  tts: ttsFor('typecast'), // 기본 어댑터(동시성/폴백)
  ttsFor, // 화자별 provider 라우팅
  sfxFor, // M2b: sfx sourceMode별 라우팅
})

// Auth IPC (Google OAuth) — opens its own BrowserWindow; no Flow view dependency.
registerAuthIPC(ipcMain)

// CapCut IPC (path detection, project writing, app launch)
registerCapcutIPC(ipcMain)

// Premiere IPC (.prproj writing — gzipped XML)
registerPremiereIPC(ipcMain)

// MCP IPC (Claude Code MCP server registration)
registerMcpIPC(ipcMain)

// Vrew IPC (.vrew writing — local zip package)
registerVrewIPC(ipcMain)

// Flow WebContentsView factory — only called when mode:set('flow') is invoked.
// Lazy creation ensures API mode startup is unaffected.
// did-finish-load bootstrap is attached here directly so it fires on view creation.
function makeFlowView() {
  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:flow',
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'flow-preload.cjs'),
    },
  })

  // 페이지 console 로그를 main 콘솔에 forward (우리 prefix만 filtering)
  view.webContents.on('console-message', (_event, _level, message) => {
    if (message.includes('[Flow Inject]') || message.includes('[Flow Debug]') || message.includes('[autoflowcut')) {
      console.log('[Flow Page]', message)
    }
  })

  // 지역 제한 조기 감지 (did-navigate는 did-finish-load보다 먼저 발생)
  view.webContents.on('did-navigate', (_, url) => {
    if (url.includes('unsupported-country')) {
      console.log('[Flow] Region unavailable detected early (did-navigate)')
      const win = mainWindow
      if (win) win.webContents.send('flow-status', { loaded: true, url, loggedIn: false, unavailable: true })
    }
    const pidMatch = url.match(/\/project\/([a-f0-9-]{36})/)
    if (pidMatch) {
      capturedProjectId = pidMatch[1]
      console.log('[Flow API] ProjectId from navigation:', capturedProjectId)
    }
    const win = mainWindow
    if (win) win.webContents.send('flow-status', { loaded: true, url, loggedIn: url.includes('labs.google/fx') })
  })

  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[Flow] did-fail-load:', errorCode, errorDescription, validatedURL)
  })

  // SPA pushState/replaceState 내비게이션 캡처
  view.webContents.on('did-navigate-in-page', (_, url) => {
    console.log('[Flow] did-navigate-in-page:', url)
    const win = mainWindow
    if (win) win.webContents.send('flow-status', { loaded: true, url, loggedIn: url.includes('labs.google/fx') })
    const pidMatch = url.match(/\/project\/([a-f0-9-]{36})/)
    if (pidMatch) {
      if (!capturedProjectId) {
        capturedProjectId = pidMatch[1]
        console.log('[Flow API] ProjectId from SPA navigation:', capturedProjectId)
      }
      if (win) win.webContents.send('flow-status', { authenticated: true, url })
    }
    // Re-inject fetch monkey-patch on SPA navigation (guard flag ensures idempotency)
    view.webContents.executeJavaScript(FLOW_PAGE_INJECTION).catch(() => {})
  })

  // Flow 페이지 네트워크에서 projectId 자동 캡처
  view.webContents.session.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      if (details.url.includes('aisandbox') || details.url.includes('googleapis.com/v1')) {
        const pidMatch = details.url.match(/projects\/([a-f0-9-]{36})/)
        if (pidMatch && !capturedProjectId) {
          capturedProjectId = pidMatch[1]
          console.log('[Flow API] ProjectId captured from network:', capturedProjectId)
        }
        if (details.uploadData) {
          try {
            const body = details.uploadData.map(d => d.bytes?.toString()).join('')
            if (body) {
              const bodyPidMatch = body.match(/"projectId":"([a-f0-9-]{36})"/)
              if (bodyPidMatch && !capturedProjectId) {
                capturedProjectId = bodyPidMatch[1]
                console.log('[Flow API] ProjectId captured from body:', capturedProjectId)
              }
            }
          } catch {}
        }
      }
      callback({})
    }
  )

  // ─── did-finish-load bootstrap: injection / landing / consent / token / startup-gate / enter-tool ───
  view.webContents.on('did-finish-load', async () => {
    const url = view.webContents.getURL()
    console.log('[Flow] did-finish-load:', url)
    if (!url || url === 'about:blank') return

    // #R23-3: Flow 부트스트랩은 여러 await 를 거친다. 그 사이 사용자가 API 모드로 전환하면
    //   뷰는 detach 되지만 이 핸들러는 계속 돌아 consent/enter-tool 클릭·saved-project 로드 같은
    //   부수효과를 API 모드에서 실행한다(숨은 모드-전환 레이스). 각 부수효과 직전에 현재 모드를
    //   재확인해 중단한다.
    const flowDetached = () => modeController.getCurrentMode() !== 'flow'
    if (flowDetached()) { console.log('[Flow] bootstrap skipped — not in flow mode'); return }

    const unavailable = url.includes('unsupported-country')
    const win = mainWindow
    if (win) {
      win.webContents.send('flow-status', {
        loaded: true,
        url,
        loggedIn: url.includes('labs.google/fx'),
        unavailable,
      })
    }

    if (unavailable) {
      console.log('[Flow] Region unavailable detected — skipping auto-actions')
      return
    }

    // Inject fetch monkey-patch (idempotent — guard flag on page prevents double-patch)
    try {
      await view.webContents.executeJavaScript(FLOW_PAGE_INJECTION)
      console.log('[Flow] fetch monkey-patch injected')
    } catch (e) {
      console.warn('[Flow] fetch injection failed:', e.message)
    }

    try {
      await view.webContents.executeJavaScript(FLOW_SETTINGS_DUMPER)
      console.log('[Flow] settings dumper injected')
    } catch (e) {
      console.warn('[Flow] settings dumper injection failed:', e.message)
    }

    // 랜딩 페이지: "Create with Flow" 버튼 자동 클릭
    if (url.includes('labs.google')) {
      try {
        await new Promise(r => setTimeout(r, 1500))
        if (flowDetached()) { console.log('[Flow] landing auto-click skipped — mode switched'); return }
        const landingResult = await view.webContents.executeJavaScript(`
          (function() {
            const links = document.querySelectorAll('a, button, [role="button"]');
            for (const el of links) {
              const text = (el.textContent || '').trim().toLowerCase();
              if (text.includes('create with flow') || text.includes('flow로 만들기') || text.includes('flow 시작')) {
                el.click();
                return 'landing_clicked: ' + text.substring(0, 40);
              }
            }
            return null;
          })()
        `)
        if (landingResult) {
          console.log('[Flow] Auto-click landing:', landingResult)
          return // 페이지 전환 후 did-finish-load에서 다시 처리
        }
      } catch (e) {
        console.warn('[Flow] Landing auto-click error:', e.message)
      }
    }

    // Flow 페이지 로드 후: 동의 버튼 자동 클릭 → projectId 추출
    if (url.includes('labs.google/fx')) {
      if (consentClicked && (enterToolClicked || capturedProjectId)) {
        console.log('[Flow] Skipping all auto-actions (consent+project already done)')
        return
      }
      try {
        if (consentClicked) {
          console.log('[Flow] Consent already clicked, skipping...')
        } else {
          await new Promise(r => setTimeout(r, 1000))
          if (flowDetached()) { console.log('[Flow] consent auto-click skipped — mode switched'); return }
          const consentResult = await view.webContents.executeJavaScript(`
            (function() {
              const agreeKeywords = ['동의', '동의합니다', 'agree', 'i agree', 'accept', 'consent', 'got it', '확인'];
              const allButtons = document.querySelectorAll('button, [role="button"], a.button, input[type="submit"]');
              for (const b of allButtons) {
                const text = (b.textContent || b.value || '').trim().toLowerCase();
                if (agreeKeywords.some(k => text.includes(k))) {
                  b.click();
                  return 'consent_clicked: ' + text.substring(0, 40);
                }
              }
              const checkboxes = document.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
              for (const cb of checkboxes) {
                if (!cb.checked) {
                  cb.click();
                  cb.checked = true;
                  cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }
              for (const b of allButtons) {
                const text = (b.textContent || b.value || '').trim().toLowerCase();
                if (agreeKeywords.some(k => text.includes(k))) {
                  b.click();
                  return 'consent_after_checkbox: ' + text.substring(0, 40);
                }
              }
              return null;
            })()
          `)
          if (consentResult) {
            console.log('[Flow] Auto-consent:', consentResult)
            consentClicked = true
            await new Promise(r => setTimeout(r, 2000))
          }
        }
      } catch (e) {
        console.warn('[Flow] Consent auto-click error:', e.message)
      }
    }

    if (url.includes('labs.google/fx')) {
      try {
        if (flowDetached()) { console.log('[Flow] enter-tool bootstrap skipped — mode switched'); return }
        // 1단계: URL에서 /project/UUID 패턴 추출
        const pidMatch = url.match(/\/project\/([a-f0-9-]{36})/)
        if (pidMatch) {
          capturedProjectId = pidMatch[1]
          enterToolClicked = true
          console.log('[Flow API] ProjectId from URL:', capturedProjectId)
          if (win) win.webContents.send('flow-status', { authenticated: true, url })
          return
        }

        if (enterToolClicked || capturedProjectId) {
          console.log('[Flow API] Skipping Enter tool click (already clicked or projectId exists)')
          return
        }

        // 2단계: 토큰 확인 (로그인 여부 체크)
        const sessionData = await view.webContents.executeJavaScript(`
          fetch('${SESSION_URL}')
            .then(r => r.ok ? r.text() : null)
            .catch(() => null)
        `)
        if (!sessionData) {
          console.log('[Flow API] No session data — user not logged in yet')
          return
        }

        let parsed = null
        try { parsed = parseFlowResponse(sessionData) || JSON.parse(sessionData) } catch {}
        const token = parsed?.access_token || parsed?.accessToken
        if (!token) {
          console.log('[Flow API] No token in session — user not logged in')
          return
        }
        console.log('[Flow API] User logged in, token length:', token.length)
        if (win) win.webContents.send('flow-status', { authenticated: true, url: view.webContents.getURL() })

        // 3단계: 잠시 대기 — Flow SPA가 자동으로 프로젝트로 리다이렉트할 수 있음
        await new Promise(r => setTimeout(r, 2000))
        if (capturedProjectId) {
          console.log('[Flow API] ProjectId captured during wait:', capturedProjectId)
          return
        }

        const currentUrl = view.webContents.getURL()
        const currentPidMatch = currentUrl.match(/\/project\/([a-f0-9-]{36})/)
        if (currentPidMatch) {
          capturedProjectId = currentPidMatch[1]
          console.log('[Flow API] ProjectId from updated URL:', capturedProjectId)
          return
        }

        // 3.5단계: 시작 자동생성 게이트 — 렌더러가 저장된 flowProjectId 를 선언할 때까지 대기
        for (let waited = 0; modeController.getStartupDecision().action === 'wait' && waited < 30000; waited += 250) {
          await new Promise(r => setTimeout(r, 250))
          if (capturedProjectId) break
        }
        if (capturedProjectId) {
          console.log('[Flow API] Project entered during startup wait:', capturedProjectId)
          enterToolClicked = true
          return
        }
        if (flowDetached()) { console.log('[Flow] startup-gate side effects skipped — mode switched'); return }
        const startupDecision = modeController.getStartupDecision()
        if (startupDecision.action === 'open-saved') {
          const target = `${FLOW_URL}/project/${startupDecision.flowProjectId}`
          console.log('[Flow Project] startup: opening saved flow project (skip auto-create):', target)
          enterToolClicked = true
          await view.webContents.loadURL(target).catch((e) => console.warn('[Flow Project] startup open failed:', e.message))
          return
        }

        // 4단계: "Enter tool" 버튼 자동 클릭 → 프로젝트 생성
        if (flowDetached()) { console.log('[Flow] enter-tool click skipped — mode switched'); return }
        console.log('[Flow API] No project in URL, looking for Enter tool button...')
        const clicked = await view.webContents.executeJavaScript(`
          (function() {
            const allButtons = document.querySelectorAll('button');
            const iconButtons = [], textButtons = [];
            for (const b of allButtons) {
              const icons = b.querySelectorAll('i, span, mat-icon');
              icons.forEach(icon => { if (icon.textContent.trim()) iconButtons.push(icon.textContent.trim().substring(0, 30)); });
              if (icons.length === 0) textButtons.push(b.textContent.trim().substring(0, 50));
            }
            console.log('[Flow Debug] Icon buttons:', JSON.stringify(iconButtons));
            console.log('[Flow Debug] Text buttons:', textButtons.length);   // 버튼 텍스트는 페이지 콘텐츠 — 개수만
            console.log('[Flow Debug] Total buttons:', allButtons.length);

            try {
              const xr = document.evaluate(
                "//button[.//i[normalize-space(text())='add_2']] | (//button[.//i[normalize-space(.)='add_2']])",
                document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
              );
              if (xr.singleNodeValue) { xr.singleNodeValue.click(); return 'add_2_xpath'; }
            } catch {}

            for (const b of allButtons) {
              const icons = b.querySelectorAll('i, span.material-icons, span.material-symbols-outlined, mat-icon');
              for (const icon of icons) {
                const t = icon.textContent.trim();
                if (t === 'add_2' || t === 'add') { b.click(); return 'icon_' + t; }
              }
            }
            for (const b of allButtons) {
              const icons = b.querySelectorAll('i, span.material-icons, span.material-symbols-outlined');
              for (const icon of icons) {
                if (icon.textContent.trim() === 'arrow_forward') { b.click(); return 'arrow_forward'; }
              }
            }
            for (const b of allButtons) {
              const text = b.textContent.trim().toLowerCase();
              if (['start', '시작', 'enter', 'new', 'create', '새로 만들기', '새 프로젝트', '새프로젝트', '만들기'].some(k => text.includes(k))) {
                b.click(); return 'text_' + text.substring(0, 30);
              }
            }
            for (const b of allButtons) {
              const cls = b.className || '';
              if (cls.includes('primary') || cls.includes('filled') || cls.includes('cta')) {
                b.click(); return 'cta';
              }
            }
            return null;
          })()
        `).catch(() => null)

        if (clicked) {
          console.log('[Flow API] Clicked button:', clicked)
          enterToolClicked = true
        } else {
          console.log('[Flow API] Button not found')
        }

        if (clicked && !capturedProjectId) {
          console.log('[Flow API] Waiting for project creation after click...')
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500))
            if (capturedProjectId) {
              console.log('[Flow API] ProjectId captured after button click:', capturedProjectId)
              break
            }
            const pollUrl = view.webContents.getURL()
            const pollMatch = pollUrl.match(/\/project\/([a-f0-9-]{36})/)
            if (pollMatch) {
              capturedProjectId = pollMatch[1]
              console.log('[Flow API] ProjectId from polled URL:', capturedProjectId)
              break
            }
          }
        }

        if (!capturedProjectId) {
          console.warn('[Flow API] ProjectId not captured — will try from next API request')
          const lastResort = await view.webContents.executeJavaScript(`
            (function() {
              for (const s of document.querySelectorAll('script')) {
                const m = s.textContent.match(/"projectId"\\s*:\\s*"([a-f0-9-]{36})"/);
                if (m) return m[1];
              }
              try {
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  const val = localStorage.getItem(key);
                  if (val) {
                    const m = val.match(/([a-f0-9-]{36})/);
                    if (m && key.toLowerCase().includes('project')) return m[1];
                  }
                }
              } catch {}
              return null;
            })()
          `)
          if (lastResort) {
            capturedProjectId = lastResort
            console.log('[Flow API] ProjectId from last resort:', capturedProjectId)
          }
        }
      } catch (e) {
        console.warn('[Flow API] ProjectId auto-extraction error:', e.message)
      }
    }
  })

  // #R16-8: 초기 Flow 네비게이션 rejection 이 unhandled 로 새지 않게 catch.
  view.webContents.loadURL(FLOW_URL).catch((e) => console.warn('[Flow] initial loadURL failed:', e?.message))
  return view
}

// Mode controller wires mode:set IPC + lazy Flow view creation/attachment.
const modeController = createModeController(() => mainWindow, makeFlowView)
modeController.register(ipcMain)

// Layout, modal, sleep, open-external, show-in-folder IPC.
registerLayoutIPC(ipcMain, () => mainWindow, modeController.getFlowView)

// Agent 토글 not_found 진단 저장기 — 첫 실패 때 만든다. app.getPath 는 whenReady 이후에만
//   신뢰할 수 있는데 이 모듈 최상단은 그 전에 평가되므로, 여기서 미리 부르면 안 된다.
//   (실패해도 앱은 안 죽고 진단만 조용히 유실돼 — 정작 필요할 때 파일이 없는 최악의 실패 모드.)
// Flow DOM 스텝 실패 싱크 — 첫 실패 때 만든다. app.getPath 는 whenReady 이후에만 신뢰할 수
//   있는데 이 모듈 최상단은 그 전에 평가되므로, 여기서 미리 부르면 안 된다. (실패해도 앱은 안 죽고
//   진단만 조용히 유실돼 — 정작 필요할 때 아무것도 없는 최악의 실패 모드.)
let _flowDiagSink = null
function flowDiagSink() {
  if (!_flowDiagSink) {
    _flowDiagSink = createFlowDiagSink({
      captureMessage: sentryMain?.initialized ? Sentry.captureMessage : null,
      writeFile: (filePath, body) => fsSync.writeFileSync(filePath, body),
      desktopDir: app.getPath('desktop'),
      userDataDir: app.getPath('userData'),
    })
  }
  return _flowDiagSink
}

// === Shared Flow helpers (trustedClick, fetch, parse, extract, configureFlowMode) ===
const helpers = createSharedHelpers({
  getFlowView: modeController.getFlowView,
  getMainWindow: () => mainWindow,
  constants: {
    SESSION_URL, MEDIA_REDIRECT_URL, RECAPTCHA_SITE_KEY, RECAPTCHA_ACTION,
  },
  // Flow DOM 스텝 실패(셀렉터 깨짐)는 throw 가 아니라 {success:false} 로 반환돼 Sentry 가 여태
  //   한 번도 못 봤다 — 몇 명이 겪는지조차 몰라 제보 하나에 의존해야 했다. 이제 스스로 보고한다.
  onDomFailure: (step, detail) => flowDiagSink()(step, detail),
})
const {
  trustedClickOnFlowView, parseFlowResponse, sessionFetch, flowPageFetch,
  getRecaptchaToken, extractMediaIds, extractFifeUrls, extractBase64Images,
  fetchMediaAsBase64, configureFlowMode, switchFlowToVideoMode, applyAgentDefaults,
  ensureAgentOff, selectFlowModeTab,
} = helpers

// ─── Monkey-patch path: inject pending values into the Flow page ──────────────
// #R15-5: arming 결과를 반환한다(성공/실패) — 호출부(image/T2V/I2V)가 실패 시 생성을 중단해
//   미주입(잘못된 seed/aspect/ref/i2v) 요청이 나가지 않게 한다.
async function setFlowPageInject({ seed, aspectRatio, references, i2v, duration, videoModel, genTag }) {
  const flowView = modeController.getFlowView()
  if (!flowView) return { success: false, error: 'Flow view not ready' }
  // duration/videoModel 은 T2V OmniFlash 강제·길이최적화용 — 페이지측이 inject.duration/
  //   inject.videoModel 로 읽는다. 단일 contract(flow-inject-payload)로 set/clear 필드 일치.
  // #R35: genTag 는 seed 를 안 건드리고 요청↔생성 correlation 을 하기 위한 고유 태그(응답 보고에 실림).
  const payload = buildFlowInjectPayload({ seed, aspectRatio, references, i2v, duration, videoModel, genTag })
  try {
    // #R16-1: payload 를 쓰고 fetch 패치 설치 여부를 함께 확인한다 — 패치가 없으면(주입 무효)
    //   success 로 보고하지 않는다(호출부가 미주입 생성을 막을 수 있게).
    const patched = await flowView.webContents.executeJavaScript(
      `(function(){ window.__autoflowcut_inject__ = ${JSON.stringify(payload)}; return !!window.__autoflowcut_fetch_patched__ })()`
    )
    if (!patched) {
      console.warn('[Flow Inject] fetch patch not installed — inject would be ineffective')
      return { success: false, error: 'fetch patch not installed' }
    }
    console.log('[Flow Inject] __autoflowcut_inject__ set:', {
      seed: payload.seed, aspectRatio: payload.aspectRatio,
      refs: payload.references?.length ?? 0, i2v: !!payload.i2v,
    })
    return { success: true }
  } catch (e) {
    console.warn('[Flow Inject] setFlowPageInject failed:', e.message)
    return { success: false, error: e.message }
  }
}

async function clearFlowPageInject() {
  const flowView = modeController.getFlowView()
  if (!flowView) return
  try {
    await flowView.webContents.executeJavaScript(
      `window.__autoflowcut_inject__ = ${JSON.stringify(flowInjectClearPayload())}`
    )
  } catch (_) {}
}

// #R33: Flow 생성 API base 를 region 에 맞춰 동적 해석한다(우리가 직접 호출하는 uploadImage/
//   entities/video i2v·status·upscale 호스트). 우선순위:
//   (1) report-response 로 캡처한 origin → (2) 페이지가 stash 한 window.__autoflowcut_api_origin__
//   → (3) BASE_API_URL(하드코딩 fallback, 현재 동작과 동일 = 무회귀).
async function getApiBase() {
  if (!capturedApiOrigin) {
    try {
      const flowView = modeController.getFlowView()
      if (flowView) {
        const o = await flowView.webContents
          .executeJavaScript('window.__autoflowcut_api_origin__ || null')
          .catch(() => null)
        const cap = captureApiOrigin(o)
        if (cap) capturedApiOrigin = cap
      }
    } catch (_) {}
  }
  return resolveApiBase(capturedApiOrigin, BASE_API_URL)
}

// ─── flow:report-response — page monkey-patch → main ───────────────────────
// NOTE: flow:set-startup-project is registered by modeController.register(ipcMain) in mode.js.
// No duplicate handler here.

ipcMain.handle('flow:report-response', (event, payload) => {
  const flowView = modeController.getFlowView()
  if (!flowView || event.sender !== flowView.webContents) {
    return { ok: false, error: 'unauthorized sender' }
  }
  // #R23-2: sender webContents 일치만으론 부족 — view 가 다른 페이지로 네비게이트되면
  //   preload 브리지가 그대로 노출돼 생성 응답을 위조할 수 있다. 프레임 origin 을 Flow 로 제한.
  if (!isFlowFrameOrigin(event.senderFrame?.url)) {
    return { ok: false, error: 'unauthorized origin' }
  }
  // #R33: 페이지가 보낸 생성 API 요청의 origin 을 캡처해 직접 호출 호스트를 region 에 맞춘다.
  const _apiOrigin = captureApiOrigin(payload?.url)
  if (_apiOrigin) capturedApiOrigin = _apiOrigin
  return routeReportResponse(payload, {
    getPendingGeneration: () => pendingGeneration,
    setPendingGeneration: (v) => { pendingGeneration = v },
    pendingGenerations,
    getPendingVideoGeneration: () => pendingVideoGeneration,
    setPendingVideoGeneration: (v) => { pendingVideoGeneration = v },
  })
})

// Flow Agent(Maps 그라운딩) 모드 — 렌더러 설정(flowAgentOn)을 flow:set-agent-mode 로 push.
// generate 핸들러가 이 값으로 ensureAgentOn vs ensureAgentOff 를 분기한다. 기본 OFF.
let flowAgentOn = false
ipcMain.handle('flow:set-agent-mode', (_e, { on } = {}) => { flowAgentOn = !!on; return { ok: true, flowAgentOn } })

// ─── Flow API IPC handlers (all four modules) ───────────────────────────────
const flowAPIDeps = {
  getFlowView: modeController.getFlowView,
  getFlowAgentOn: () => flowAgentOn,
  // #R25-4: quota 를 쓰는 submit/upscale 핸들러가 API 모드에서 stale 호출로 Flow quota 를
  //   소모하지 않도록 현재 모드를 노출한다.
  getCurrentMode: modeController.getCurrentMode,
  getMainWindow: () => mainWindow,
  // Shared helpers
  ...helpers,
  // Inject state helpers
  setFlowPageInject,
  clearFlowPageInject,
  // #R33: region 대응 동적 API base (uploadImage/entities/video 직접 호출 호스트)
  getApiBase,
  // Pending generation state
  pendingGenerations,
  collectedMediaIds, // 공유 DOM 수집 de-dup (flow-api 비동기 + character 동기)
  getCapturedProjectId: () => capturedProjectId,
  setCapturedProjectId: (v) => { capturedProjectId = v },
  getPendingGeneration: () => pendingGeneration,
  setPendingGeneration: (v) => { pendingGeneration = v },
  getPendingVideoGeneration: () => pendingVideoGeneration,
  setPendingVideoGeneration: (v) => { pendingVideoGeneration = v },
  getEnterToolClicked: () => enterToolClicked,
  setEnterToolClicked: (v) => { enterToolClicked = v },
  // URL constants
  SESSION_URL, TOKEN_INFO_URL, FLOW_URL, MEDIA_REDIRECT_URL, UPLOAD_URL,
  API_HEADERS, GENERATE_URL, BASE_API_URL,
  VIDEO_T2V_URL, VIDEO_I2V_URL, VIDEO_I2V_START_END_URL, VIDEO_STATUS_URL, VIDEO_UPSCALE_URL,
}

registerFlowAPIIPC(ipcMain, flowAPIDeps)
registerVideoIPC(ipcMain, flowAPIDeps)
registerCharacterIPC(ipcMain, flowAPIDeps)
registerDomIPC(ipcMain, flowAPIDeps)

// Renderer reports the active project (with its work folder) so the native
// "Recent Projects" menu stays in MRU order and scoped to the current folder.
ipcMain.handle('app:project-activated', (event, { name, workFolder }) => {
  if (workFolder) activeWorkFolder = workFolder
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

        // POST /api/export-premiere — Premiere 프로젝트(.prproj) 내보내기
        if (req.method === 'POST' && pathname === '/api/export-premiere') {
          if (mainWindow) {
            const optionsJson = body ? JSON.stringify(JSON.parse(body)) : '{}'
            mainWindow.webContents.executeJavaScript(
              `(async () => { const r = await window.__mcpExportPremiere?.(${optionsJson}); return JSON.stringify(r || {}); })()`
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

  // 렌더러 언어 → 네이티브 메뉴 라벨 현지화 (I18nProvider 가 lang 변경 시 push).
  ipcMain.handle('app:set-locale', (_e, { lang } = {}) => { try { setMenuLocale(lang) } catch {} ; return { ok: true } })

  createWindow()

  // 진단: Cmd/Ctrl+Shift+E → 현재 Flow 웹뷰의 인터랙티브 요소 + bodyHTML 을 데스크톱에
  //   타임스탬프 JSON 파일로 덤프. 라이브 셀렉터(예: 에이전트 챗 패널 닫기 버튼)를 추측 없이
  //   실제 마크업에서 확보하려는 용도. (수동 콘솔 붙여넣기 대체)
  try {
    globalShortcut.register('CommandOrControl+Shift+E', () => { dumpFlowDomToFile() })
  } catch (e) { console.warn('[FlowDomDump] shortcut register failed:', e.message) }
  // #R36-diag: Flow 페이지 네트워크 캡처(window.__autoflowcut_net__)를 바탕화면 파일로 덤프.
  //   @멘션 T2V 응답 캡처 실패 진단용 — 실제 비디오 생성 요청의 url/reqBody 확인.
  try {
    globalShortcut.register('CommandOrControl+Shift+N', () => { dumpFlowNetToFile() })
  } catch (e) { console.warn('[FlowNetDump] shortcut register failed:', e.message) }
})

// #R36-diag: window.__autoflowcut_net__ (Flow 페이지가 쌓은 google 요청 로그)를 바탕화면 JSON 으로 저장.
async function dumpFlowNetToFile() {
  const flowView = modeController.getFlowView()
  if (!flowView) { console.warn('[FlowNetDump] Flow view not ready (flow 모드인지 확인)'); return }
  try {
    const net = await flowView.webContents.executeJavaScript('JSON.parse(JSON.stringify(window.__autoflowcut_net__ || []))')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filePath = path.join(app.getPath('desktop'), `autoflowcut-net-${stamp}.json`)
    fsSync.writeFileSync(filePath, JSON.stringify(net, null, 2))
    console.log('[FlowNetDump] wrote', net.length, 'entries →', path.basename(filePath))
    if (mainWindow) {
      // 렌더러 콘솔에 전체 경로를 주입하면 renderer Sentry 의 breadcrumb 으로 /Users/<계정>/… 이 나간다.
      //   파일명만 알려준다 — 어차피 바탕화면에 있다.
      try { mainWindow.webContents.executeJavaScript(`console.log('[FlowNetDump] saved: ${path.basename(filePath).replace(/'/g, "\\'")}')`) } catch {}
    }
  } catch (e) {
    console.warn('[FlowNetDump] dump failed:', e.message)
  }
}

async function dumpFlowDomToFile() {
  const flowView = modeController.getFlowView()
  if (!flowView) { console.warn('[FlowDomDump] Flow view not ready (flow 모드인지 확인)'); return }
  try {
    const probe = await flowView.webContents.executeJavaScript(FLOW_DOM_DUMP_PROBE)
    const filePath = path.join(app.getPath('desktop'), buildDomDumpFilename())
    fsSync.writeFileSync(filePath, JSON.stringify(probe, null, 2))
    console.log('[FlowDomDump] wrote', (probe.elements || []).length, 'elements →', path.basename(filePath))
    if (mainWindow) {
      // 렌더러 콘솔에 전체 경로를 주입하면 renderer Sentry 의 breadcrumb 으로 /Users/<계정>/… 이 나간다.
      //   파일명만 알려준다 — 어차피 바탕화면에 있다.
      try { mainWindow.webContents.executeJavaScript(`console.log('[FlowDomDump] saved: ${path.basename(filePath).replace(/'/g, "\\'")}')`) } catch {}
    }
  } catch (e) {
    console.warn('[FlowDomDump] dump failed:', e.message)
  }
}

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll() } catch {}
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  // #sentry: macOS 의 'activate' 는 app.whenReady 전에도 발생할 수 있다 — 그때 창을 만들면
  //   "Cannot create BrowserWindow before app is ready" 로 크래시한다. ready 가드를 순수 함수로 둔다.
  if (shouldCreateWindowOnActivate({ isReady: app.isReady(), openWindowCount: BrowserWindow.getAllWindows().length })) {
    createWindow()
  }
})
