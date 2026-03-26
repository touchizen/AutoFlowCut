import { app, BrowserWindow, WebContentsView, ipcMain, shell, protocol, net, powerSaveBlocker } from 'electron'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { registerFilesystemIPC } from './ipc/filesystem.js'
import { registerAuthIPC } from './ipc/auth.js'
import { registerCapcutIPC } from './ipc/capcut.js'
import { registerFlowAPIIPC } from './ipc/flow-api.js'
import { registerVideoIPC } from './ipc/video.js'
import { registerDomIPC } from './ipc/dom.js'
import { createSharedHelpers } from './ipc/shared.js'
import { openApiSpec, getSwaggerHtml } from './api-docs.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
let flowView = null
let layoutMode = 'split-left' // 'split-left' | 'split-right' | 'split-top' | 'split-bottom'
let splitRatio = 0.5   // 0.2 ~ 0.8
let modalVisible = false // 모달이 열려있으면 Flow 뷰를 숨김 (네이티브 뷰는 CSS z-index로 가릴 수 없음)
let capturedProjectId = null // Flow 네트워크에서 자동 캡처된 projectId
let pendingGeneration = null // DOM-triggered generation 응답 캡처용 Promise resolver (이미지) — 동기 모드
let mcpHttpServer = null // MCP HTTP 서버 인스턴스
const pendingGenerations = new Map() // 비동기 모드용 다중 생성 추적 (key: generationId)
let pendingVideoGeneration = null // DOM-triggered video generation 응답 캡처용 Promise resolver
let pendingReferenceImages = null // CDP Fetch 인터셉션용 레퍼런스 이미지 (mediaId 배열)
let pendingI2VInjection = null // CDP Fetch 인터셉션용 I2V startImage 주입 데이터
let enterToolClicked = false // Enter tool 버튼 클릭 완료 플래그 (무한루프 방지)
let consentClicked = false   // 동의 버튼 클릭 완료 플래그 (무한루프 방지)
let powerSaveBlockerId = null // 화면 꺼짐/절전 방지 blocker ID

// === Shared helpers (trustedClick, fetch, parse, extract, configureFlowMode) ===
const helpers = createSharedHelpers({
  getFlowView: () => flowView,
  getMainWindow: () => mainWindow,
  constants: {
    SESSION_URL, MEDIA_REDIRECT_URL, RECAPTCHA_SITE_KEY, RECAPTCHA_ACTION,
  },
})
const {
  trustedClickOnFlowView, parseFlowResponse, sessionFetch, flowPageFetch,
  getRecaptchaToken, extractMediaIds, extractFifeUrls, extractBase64Images,
  fetchMediaAsBase64, configureFlowMode, switchFlowToVideoMode,
} = helpers

// Update Flow view bounds based on layout mode
function updateBounds() {
  if (!mainWindow || !flowView) return

  // 모달이 열려있으면 Flow 뷰를 숨김 (WebContentsView는 네이티브 레이어라 CSS로 가릴 수 없음)
  if (modalVisible) {
    flowView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    return
  }

  const { width, height } = mainWindow.getContentBounds()
  const GAP = 3  // 리사이저 바 절반 (6px / 2) — Flow 뷰와 App 사이 gap

  if (layoutMode === 'split-left') {
    // Flow 왼쪽, App 오른쪽
    const splitPos = Math.round(width * splitRatio)
    flowView.setBounds({ x: 0, y: 0, width: splitPos - GAP, height })
  } else if (layoutMode === 'split-right') {
    // Flow 오른쪽, App 왼쪽
    const splitPos = Math.round(width * splitRatio)
    flowView.setBounds({ x: width - splitPos + GAP, y: 0, width: splitPos - GAP, height })
  } else if (layoutMode === 'split-top') {
    // Flow 상단, App 하단
    const splitPos = Math.round(height * splitRatio)
    flowView.setBounds({ x: 0, y: 0, width, height: splitPos - GAP })
  } else if (layoutMode === 'split-bottom') {
    // Flow 하단, App 상단
    const splitPos = Math.round(height * splitRatio)
    flowView.setBounds({ x: 0, y: height - splitPos + GAP, width, height: splitPos - GAP })
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    title: 'AutoFlowCut',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false  // 로컬 file:// 이미지 로드 허용
    }
  })

  // 화면 꺼짐/절전 방지 기본 ON
  powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep')

  // Create Flow WebContentsView with persistent session
  flowView = new WebContentsView({
    webPreferences: {
      partition: 'persist:flow',
      contextIsolation: true,
      webSecurity: false,  // 비디오 API를 페이지 컨텍스트에서 호출할 때 CORS 허용
    }
  })
  mainWindow.contentView.addChildView(flowView)

  // Load Flow
  flowView.webContents.loadURL(FLOW_URL)

  // 지역 제한 조기 감지 (did-navigate는 did-finish-load보다 먼저 발생)
  flowView.webContents.on('did-navigate', (_, url) => {
    if (url.includes('unsupported-country')) {
      console.log('[Flow] Region unavailable detected early (did-navigate)')
      mainWindow.webContents.send('flow-status', {
        loaded: true, url, loggedIn: false, unavailable: true
      })
    }
  })

  flowView.webContents.on('did-finish-load', async () => {
    const url = flowView.webContents.getURL()
    console.log('[Flow] did-finish-load:', url)
    // 지역 제한 감지 (URL 기반 — localization 무관)
    const unavailable = url.includes('unsupported-country')

    mainWindow.webContents.send('flow-status', {
      loaded: true,
      url,
      loggedIn: url.includes('labs.google/fx'),
      unavailable
    })

    if (unavailable) {
      console.log('[Flow] Region unavailable detected — skipping auto-actions')
      return
    }

    // 랜딩 페이지: "Create with Flow" 버튼 자동 클릭
    if (url.includes('labs.google')) {
      try {
        await new Promise(r => setTimeout(r, 1500))
        const landingResult = await flowView.webContents.executeJavaScript(`
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
      // 0단계: 동의/약관 버튼 자동 클릭 (Google Labs 초기 동의 화면 처리)
      // 이미 동의했거나 프로젝트가 있으면 스킵
      if (consentClicked && (enterToolClicked || capturedProjectId)) {
        console.log('[Flow] Skipping all auto-actions (consent+project already done)')
        return
      }
      try {
        if (consentClicked) {
          console.log('[Flow] Consent already clicked, skipping...')
        } else {
        await new Promise(r => setTimeout(r, 1000)) // 페이지 렌더링 대기
        const consentResult = await flowView.webContents.executeJavaScript(`
          (function() {
            // 동의 버튼 텍스트 패턴 (한국어/영어)
            const agreeKeywords = ['동의', '동의합니다', 'agree', 'i agree', 'accept', 'consent', 'got it', '확인'];
            const allButtons = document.querySelectorAll('button, [role="button"], a.button, input[type="submit"]');
            for (const b of allButtons) {
              const text = (b.textContent || b.value || '').trim().toLowerCase();
              if (agreeKeywords.some(k => text.includes(k))) {
                b.click();
                return 'consent_clicked: ' + text.substring(0, 40);
              }
            }
            // Material Design 체크박스 + 동의 버튼 패턴
            const checkboxes = document.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
            for (const cb of checkboxes) {
              if (!cb.checked) {
                cb.click();
                cb.checked = true;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            // 체크박스 클릭 후 다시 동의 버튼 검색
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
          await new Promise(r => setTimeout(r, 2000)) // 동의 후 페이지 전환 대기
        }
        } // end of if (!consentClicked)
      } catch (e) {
        console.warn('[Flow] Consent auto-click error:', e.message)
      }
    }

    if (url.includes('labs.google/fx')) {
      try {
        // 1단계: URL에서 /project/UUID 패턴 추출
        const pidMatch = url.match(/\/project\/([a-f0-9-]{36})/)
        if (pidMatch) {
          capturedProjectId = pidMatch[1]
          enterToolClicked = true // 이미 프로젝트 안에 있으므로 다시 클릭 불필요
          console.log('[Flow API] ProjectId from URL:', capturedProjectId)
          mainWindow.webContents.send('flow-status', {
            authenticated: true,
            url
          })
          return
        }

        // 이미 Enter tool 클릭했으면 또 클릭하지 않음 (무한루프 방지)
        if (enterToolClicked || capturedProjectId) {
          console.log('[Flow API] Skipping Enter tool click (already clicked or projectId exists)')
          return
        }

        // 2단계: 토큰 확인 (로그인 여부 체크) — executeJavaScript 사용 (검증된 방식)
        const sessionData = await flowView.webContents.executeJavaScript(`
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
        mainWindow.webContents.send('flow-status', {
          authenticated: true,
          url: flowView.webContents.getURL()
        })

        // 3단계: 잠시 대기 — Flow SPA가 자동으로 프로젝트로 리다이렉트할 수 있음
        await new Promise(r => setTimeout(r, 2000))
        if (capturedProjectId) {
          console.log('[Flow API] ProjectId captured during wait:', capturedProjectId)
          return
        }

        // URL 다시 확인 (SPA 내비게이션으로 변경됐을 수 있음)
        const currentUrl = flowView.webContents.getURL()
        const currentPidMatch = currentUrl.match(/\/project\/([a-f0-9-]{36})/)
        if (currentPidMatch) {
          capturedProjectId = currentPidMatch[1]
          console.log('[Flow API] ProjectId from updated URL:', capturedProjectId)
          return
        }

        // 4단계: "Enter tool" 버튼 자동 클릭 → 프로젝트 생성
        // AutoFlow도 동일한 방식으로 projectId를 얻음 (clickNewProjectButton)
        // SPA가 완전히 렌더링될 때까지 재시도 (최대 15초)
        console.log('[Flow API] No project in URL, looking for Enter tool button...')

        let clicked = null
        for (let retry = 0; retry < 6 && !capturedProjectId; retry++) {
          if (retry > 0) {
            await new Promise(r => setTimeout(r, 2000))
            // 재시도 중 capturedProjectId가 설정됐을 수 있음
            if (capturedProjectId) break
            // URL에 projectId가 추가됐을 수 있음
            const retryUrl = flowView.webContents.getURL()
            const retryMatch = retryUrl.match(/\/project\/([a-f0-9-]{36})/)
            if (retryMatch) {
              capturedProjectId = retryMatch[1]
              console.log('[Flow API] ProjectId from URL during retry:', capturedProjectId)
              break
            }
          }

          // New Project 버튼 찾기 + 클릭 (AutoFlow: icon='add_2')
          clicked = await flowView.webContents.executeJavaScript(`
            (function() {
              const allButtons = document.querySelectorAll('button');
              // 디버그 로깅
              if (${retry} === 0) {
                const iconButtons = [], textButtons = [];
                for (const b of allButtons) {
                  const icons = b.querySelectorAll('i, span, mat-icon');
                  icons.forEach(icon => { if (icon.textContent.trim()) iconButtons.push(icon.textContent.trim().substring(0, 30)); });
                  if (icons.length === 0) textButtons.push(b.textContent.trim().substring(0, 50));
                }
                console.log('[Flow Debug] Icon buttons:', JSON.stringify(iconButtons));
                console.log('[Flow Debug] Text buttons:', JSON.stringify(textButtons.slice(0, 10)));
                console.log('[Flow Debug] Total buttons:', allButtons.length);
              }

              // 방법 1: add_2 아이콘 버튼 (AutoFlow에서 확인된 실제 XPath)
              try {
                const xr = document.evaluate(
                  "//button[.//i[normalize-space(text())='add_2']] | (//button[.//i[normalize-space(.)='add_2']])",
                  document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                );
                if (xr.singleNodeValue) { xr.singleNodeValue.click(); return 'add_2_xpath'; }
              } catch {}

              // 방법 2: icon 텍스트 'add_2' 직접 탐색
              for (const b of allButtons) {
                const icons = b.querySelectorAll('i, span.material-icons, span.material-symbols-outlined, mat-icon');
                for (const icon of icons) {
                  const t = icon.textContent.trim();
                  if (t === 'add_2' || t === 'add') {
                    b.click(); return 'icon_' + t;
                  }
                }
              }
              // 방법 3: arrow_forward 아이콘 (구버전 호환)
              for (const b of allButtons) {
                const icons = b.querySelectorAll('i, span.material-icons, span.material-symbols-outlined');
                for (const icon of icons) {
                  if (icon.textContent.trim() === 'arrow_forward') {
                    b.click(); return 'arrow_forward';
                  }
                }
              }
              // 방법 4: 텍스트 버튼
              for (const b of allButtons) {
                const text = b.textContent.trim().toLowerCase();
                if (['start', '시작', 'enter', 'new', 'create', '새로 만들기', '새 프로젝트', '새프로젝트', '만들기'].some(k => text.includes(k))) {
                  b.click(); return 'text_' + text.substring(0, 30);
                }
              }
              // 방법 5: primary/filled 버튼
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
            console.log('[Flow API] Clicked button (retry ' + retry + '):', clicked)
            enterToolClicked = true // 무한루프 방지
            break
          }
          console.log('[Flow API] Button not found, retry', retry + 1, '/ 6')
        }

        if (clicked && !capturedProjectId) {
          console.log('[Flow API] Waiting for project creation after click...')
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500))
            if (capturedProjectId) {
              console.log('[Flow API] ProjectId captured after button click:', capturedProjectId)
              break
            }
            const pollUrl = flowView.webContents.getURL()
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
          // 페이지 스크립트/localStorage에서 마지막 시도
          const lastResort = await flowView.webContents.executeJavaScript(`
            (function() {
              // 스크립트 태그에서 projectId
              for (const s of document.querySelectorAll('script')) {
                const m = s.textContent.match(/"projectId"\\s*:\\s*"([a-f0-9-]{36})"/);
                if (m) return m[1];
              }
              // localStorage에서 projectId
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
  flowView.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Flow] did-fail-load:', errorCode, errorDescription, validatedURL)
  })
  flowView.webContents.on('did-navigate', (event, url) => {
    console.log('[Flow] did-navigate:', url)
    mainWindow.webContents.send('flow-status', {
      loaded: true, url, loggedIn: url.includes('labs.google/fx')
    })
    const pidMatch = url.match(/\/project\/([a-f0-9-]{36})/)
    if (pidMatch) {
      capturedProjectId = pidMatch[1]
      console.log('[Flow API] ProjectId from navigation:', capturedProjectId)
    }
  })
  // SPA pushState/replaceState 내비게이션 캡처 (Flow는 SPA)
  flowView.webContents.on('did-navigate-in-page', (event, url) => {
    console.log('[Flow] did-navigate-in-page:', url)
    mainWindow.webContents.send('flow-status', {
      loaded: true, url, loggedIn: url.includes('labs.google/fx')
    })
    const pidMatch = url.match(/\/project\/([a-f0-9-]{36})/)
    if (pidMatch) {
      if (!capturedProjectId) {
        capturedProjectId = pidMatch[1]
        console.log('[Flow API] ProjectId from SPA navigation:', capturedProjectId)
      }
      mainWindow.webContents.send('flow-status', {
        authenticated: true,
        url
      })
    }
  })

  // Debugger 프로토콜: projectId 자동 추출 + batchGenerateImages 응답 캡처
  try {
    flowView.webContents.debugger.attach('1.3')
    flowView.webContents.debugger.sendCommand('Network.enable')
    const requestUrlMap = {}
    const requestMethodMap = {} // requestId → HTTP method (GET/POST/OPTIONS)
    const responseStatusMap = {} // requestId → HTTP status
    const requestSentTimeMap = {} // requestId → 요청 시작 시간 (stale 응답 필터링용)

    flowView.webContents.debugger.on('message', (event, method, params) => {
      // ========== Fetch.requestPaused — 레퍼런스 이미지 주입 ==========
      // CDP Fetch 도메인: 나가는 요청을 가로채서 body 수정 후 계속 전송
      if (method === 'Fetch.requestPaused') {
        const reqUrl = params.request?.url || ''
        // Case 1: 레퍼런스 이미지 주입 (이미지 생성)
        if (pendingReferenceImages && pendingReferenceImages.length > 0 && reqUrl.includes('batchGenerateImages')) {
          try {
            const body = JSON.parse(params.request.postData || '{}')
            // requests[] 배열의 각 요청에 imageInputs 추가
            if (body.requests) {
              for (const req of body.requests) {
                if (!req.imageInputs) req.imageInputs = []
                for (const ref of pendingReferenceImages) {
                  req.imageInputs.push({
                    imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE',
                    name: ref.mediaId
                  })
                }
              }
            }
            const modifiedPostData = Buffer.from(JSON.stringify(body)).toString('base64')
            flowView.webContents.debugger.sendCommand('Fetch.continueRequest', {
              requestId: params.requestId,
              postData: modifiedPostData
            })
            console.log('[Flow API] [Fetch] Injected', pendingReferenceImages.length,
              'references into batchGenerateImages request')
            pendingReferenceImages = null  // 한 번만 주입 (다음 요청은 그대로 통과)
          } catch (e) {
            console.error('[Flow API] [Fetch] Reference injection error:', e.message)
            flowView.webContents.debugger.sendCommand('Fetch.continueRequest', {
              requestId: params.requestId
            })
          }
        }
        // Case 2: I2V startImage 주입 (T2V 요청을 I2V로 변환)
        else if (pendingI2VInjection && reqUrl.includes('batchAsyncGenerateVideo')) {
          const reqMethod = params.request?.method || ''
          // OPTIONS 프리플라이트는 수정 없이 통과 (pendingI2VInjection 유지)
          if (reqMethod === 'OPTIONS') {
            console.log('[Flow Video I2V] [Fetch] OPTIONS preflight — pass through')
            flowView.webContents.debugger.sendCommand('Fetch.continueRequest', {
              requestId: params.requestId
            })
          } else {
            try {
              const body = JSON.parse(params.request.postData || '{}')
              const hasEndImage = !!pendingI2VInjection.endImageMediaId

              // T2V → I2V 모델 키 변환 (SHORT 키 사용 — Flow 페이지가 실제로 쓰는 형식)
              // 참고: AutoFlow 확장은 _ultra_relaxed 접미사 사용하지만, Flow 웹은 짧은 키 사용
              const T2V_TO_I2V_MODEL_MAP = {
                // landscape (16:9) 모델
                'veo_3_1_t2v_fast_ultra_relaxed': 'veo_3_1_i2v_s_fast_fl',
                'veo_3_1_t2v_fast': 'veo_3_1_i2v_s_fast_fl',
                // portrait/square 모델
                'veo_3_1_t2v_fast_portrait_ultra_relaxed': 'veo_3_1_i2v_s_fast',
                'veo_3_1_t2v_fast_portrait': 'veo_3_1_i2v_s_fast',
                // quality 모델
                'veo_3_1_t2v_quality_ultra_relaxed': 'veo_3_1_i2v_quality',
                'veo_3_1_t2v_quality': 'veo_3_1_i2v_quality',
              }
              // 기본 cropCoordinates (전체 이미지)
              const defaultCrop = { top: 0, left: 0, bottom: 1, right: 1 }

              if (body.requests) {
                for (const req of body.requests) {
                  // 모델 키 변환
                  const originalModel = req.videoModelKey
                  const i2vModel = T2V_TO_I2V_MODEL_MAP[originalModel]
                  if (i2vModel) {
                    req.videoModelKey = i2vModel
                  } else {
                    // 매핑에 없는 모델 → 기본 landscape I2V
                    console.warn('[Flow Video I2V] [Fetch] Unknown T2V model:', originalModel, '→ fallback to veo_3_1_i2v_s_fast_fl')
                    req.videoModelKey = 'veo_3_1_i2v_s_fast_fl'
                  }
                  // startImage + cropCoordinates 주입
                  req.startImage = {
                    mediaId: pendingI2VInjection.startImageMediaId,
                    cropCoordinates: defaultCrop
                  }
                  if (hasEndImage) {
                    req.endImage = {
                      mediaId: pendingI2VInjection.endImageMediaId,
                      cropCoordinates: defaultCrop
                    }
                  }
                  console.log('[Flow Video I2V] [Fetch] Model:', originalModel, '→', req.videoModelKey,
                    '| injecting startImage' + (hasEndImage ? ' + endImage' : ''))
                }
              }
              const modifiedPostData = Buffer.from(JSON.stringify(body)).toString('base64')
              // I2V 엔드포인트로 URL 변경
              const targetUrl = hasEndImage
                ? pendingI2VInjection.i2vStartEndUrl   // batchAsyncGenerateVideoStartAndEndImage
                : pendingI2VInjection.i2vUrl            // batchAsyncGenerateVideoStartImage
              flowView.webContents.debugger.sendCommand('Fetch.continueRequest', {
                requestId: params.requestId,
                url: targetUrl,
                postData: modifiedPostData
              })
              console.log('[Flow Video I2V] [Fetch] Injected startImage (' +
                pendingI2VInjection.startImageMediaId?.substring(0, 8) + ')' +
                (hasEndImage ? ' + endImage (' + pendingI2VInjection.endImageMediaId?.substring(0, 8) + ')' : '') +
                ' → ' + targetUrl.split('/v1/')[1])
              console.log('[Flow Video I2V] [Fetch] Modified body:', JSON.stringify(body).substring(0, 800))
              pendingI2VInjection = null  // 한 번만 주입 (POST에서만 소비)
            } catch (e) {
              console.error('[Flow Video I2V] [Fetch] Injection error:', e.message)
              flowView.webContents.debugger.sendCommand('Fetch.continueRequest', {
                requestId: params.requestId
              })
            }
          }
        } else {
          // 대상이 아닌 요청 → 수정 없이 통과
          flowView.webContents.debugger.sendCommand('Fetch.continueRequest', {
            requestId: params.requestId
          })
        }
        return  // Fetch 이벤트는 여기서 처리 완료
      }

      // ========== Network 이벤트 ==========
      // 요청 URL 기록 + 시작 시간 기록 + HTTP 메서드 기록
      if (method === 'Network.requestWillBeSent') {
        requestUrlMap[params.requestId] = params.request?.url || ''
        requestMethodMap[params.requestId] = params.request?.method || ''
        requestSentTimeMap[params.requestId] = params.wallTime || (Date.now() / 1000)
        // 🔍 비디오 생성 요청 body 캡처 (모델 키 + 이미지 구조 확인용)
        const sentUrl = params.request?.url || ''
        if (sentUrl.includes('batchAsyncGenerateVideo') && params.request?.method === 'POST' && params.request?.postData) {
          try {
            const sentBody = JSON.parse(params.request.postData)
            const req0 = sentBody?.requests?.[0] || {}
            console.log('[Flow Video DEBUG] Request to:', sentUrl.split('/v1/')[1])
            console.log('[Flow Video DEBUG] videoModelKey:', req0.videoModelKey)
            console.log('[Flow Video DEBUG] aspectRatio:', req0.aspectRatio)
            console.log('[Flow Video DEBUG] startImage:', JSON.stringify(req0.startImage || null))
            console.log('[Flow Video DEBUG] endImage:', JSON.stringify(req0.endImage || null))
            console.log('[Flow Video DEBUG] paygateTier:', sentBody?.clientContext?.userPaygateTier)
          } catch {}
        }
      }

      // HTTP 상태 코드 기록 + projectId 캡처
      if (method === 'Network.responseReceived') {
        responseStatusMap[params.requestId] = params.response?.status
        if (!capturedProjectId) {
          const url = params.response?.url || ''
          const pidMatch = url.match(/projects\/([a-f0-9-]{36})/)
          if (pidMatch) {
            capturedProjectId = pidMatch[1]
            console.log('[Flow API] ProjectId from response URL:', capturedProjectId)
          }
        }
      }

      // 네트워크 요청 실패 → 실패도 응답 카운트에 포함 (멀티 이미지: 일부 실패 가능)
      if (method === 'Network.loadingFailed' && pendingGeneration) {
        const reqUrl = requestUrlMap[params.requestId] || ''
        const failMethod = requestMethodMap[params.requestId] || ''
        if (reqUrl.includes('batchGenerateImages') && failMethod !== 'OPTIONS') {
          // Stale 응답 필터링
          const reqSentAt = requestSentTimeMap[params.requestId] || 0
          if (pendingGeneration.setAt && reqSentAt < pendingGeneration.setAt) {
            console.log('[Flow API] [NetCapture] Skipping STALE batchGenerateImages failure',
              '(reqSentAt:', reqSentAt.toFixed(3), ', setAt:', pendingGeneration.setAt.toFixed(3), ')')
            return
          }
          pendingGeneration.responses.push({ error: true, message: params.errorText || 'Network request failed' })
          console.error('[Flow API] [NetCapture] batchGenerateImages FAILED (' +
            pendingGeneration.responses.length + '/' + pendingGeneration.expectedCount + '):', params.errorText)

          if (pendingGeneration.responses.length >= pendingGeneration.expectedCount) {
            console.log('[Flow API] [NetCapture] All responses collected (with failures) — resolving')
            const saved = pendingGeneration
            pendingGeneration = null
            if (saved.collectionTimer) clearTimeout(saved.collectionTimer)
            // 성공 응답이 하나라도 있으면 error: false
            const hasSuccess = saved.responses.some(r => !r.error)
            saved.resolve(hasSuccess
              ? { error: false, responses: saved.responses }
              : { error: true, message: 'All image generations failed' })
          }
        }
      }

      // 네트워크 요청 실패 → 비동기 모드 (pendingGenerations Map)
      if (method === 'Network.loadingFailed' && pendingGenerations.size > 0) {
        const reqUrl = requestUrlMap[params.requestId] || ''
        const failMethod = requestMethodMap[params.requestId] || ''
        if (reqUrl.includes('batchGenerateImages') && failMethod !== 'OPTIONS') {
          const reqSentAt = requestSentTimeMap[params.requestId] || 0
          let matchId = null
          let matchSetAt = -Infinity
          for (const [id, gen] of pendingGenerations) {
            if (!gen.completed && gen.setAt <= reqSentAt && gen.setAt > matchSetAt) {
              matchId = id
              matchSetAt = gen.setAt
            }
          }
          if (matchId) {
            const g = pendingGenerations.get(matchId)
            g.responses.push({ error: true, message: params.errorText || 'Network request failed' })
            console.error('[Flow API] [AsyncCapture] batchGenerateImages FAILED for gen:',
              matchId.substring(0, 8), '(' + g.responses.length + '/' + g.expectedCount + ')')
            if (g.responses.length >= g.expectedCount) {
              g.completed = true
              if (g.collectionTimer) clearTimeout(g.collectionTimer)
            }
          }
        }
      }

      // 비디오 API 요청 실패 처리
      if (method === 'Network.loadingFailed' && pendingVideoGeneration) {
        const reqUrl = requestUrlMap[params.requestId] || ''
        const failMethod = requestMethodMap[params.requestId] || ''
        if (reqUrl.includes('batchAsyncGenerateVideo') && failMethod !== 'OPTIONS') {
          const reqSentAt = requestSentTimeMap[params.requestId] || 0
          if (pendingVideoGeneration.setAt && reqSentAt < pendingVideoGeneration.setAt) return
          console.error('[Flow API] [VideoCapture] Video API request FAILED:', params.errorText)
          const saved = pendingVideoGeneration
          pendingVideoGeneration = null
          saved.resolve({ error: true, message: params.errorText || 'Video API request failed' })
        }
      }

      // 응답 body 가져오기 (projectId 추출 + DOM 생성 결과 캡처)
      if (method === 'Network.loadingFinished' && params.requestId) {
        const reqUrl = requestUrlMap[params.requestId] || ''
        const httpStatus = responseStatusMap[params.requestId]

        // batchGenerateImages 응답 → DOM-triggered generation 결과 캡처 (멀티 이미지 수집)
        // ⚠️ OPTIONS 프리플라이트 요청은 무시 (body 없어서 getResponseBody 실패함)
        const reqMethod = requestMethodMap[params.requestId] || ''
        if (pendingGeneration && reqUrl.includes('batchGenerateImages') && reqMethod !== 'OPTIONS') {
          // Stale 응답 필터링: pendingGeneration 설정 이전에 시작된 요청은 무시
          const reqSentAt = requestSentTimeMap[params.requestId] || 0
          if (pendingGeneration.setAt && reqSentAt < pendingGeneration.setAt) {
            console.log('[Flow API] [NetCapture] Skipping STALE batchGenerateImages response',
              '(reqSentAt:', reqSentAt.toFixed(3), ', setAt:', pendingGeneration.setAt.toFixed(3),
              ', diff:', ((pendingGeneration.setAt - reqSentAt) * 1000).toFixed(0), 'ms)')
            return
          }
          console.log('[Flow API] [NetCapture] ✅ ACCEPTED batchGenerateImages response',
            '(reqSentAt:', reqSentAt.toFixed(3), ', setAt:', pendingGeneration.setAt.toFixed(3),
            ', diff:', ((reqSentAt - pendingGeneration.setAt) * 1000).toFixed(0), 'ms after)')

          flowView.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
            .then(result => {
              if (result?.body && pendingGeneration) {
                pendingGeneration.responses.push({ error: false, body: result.body, status: httpStatus })
                console.log('[Flow API] [NetCapture] batchGenerateImages response collected (' +
                  pendingGeneration.responses.length + '/' + pendingGeneration.expectedCount +
                  ') HTTP', httpStatus, ', length:', result.body.length)

                // 예상 개수만큼 모았으면 즉시 resolve
                if (pendingGeneration.responses.length >= pendingGeneration.expectedCount) {
                  console.log('[Flow API] [NetCapture] All', pendingGeneration.expectedCount, 'responses collected — resolving')
                  const saved = pendingGeneration
                  pendingGeneration = null
                  if (saved.collectionTimer) clearTimeout(saved.collectionTimer)
                  saved.resolve({ error: false, responses: saved.responses })
                } else {
                  // 아직 더 남음 — 30초 타이머로 대기 (이미지 생성은 최대 20-30초 소요 가능)
                  if (pendingGeneration.collectionTimer) clearTimeout(pendingGeneration.collectionTimer)
                  pendingGeneration.collectionTimer = setTimeout(() => {
                    if (pendingGeneration) {
                      console.log('[Flow API] [NetCapture] Collection timer fired — resolving with',
                        pendingGeneration.responses.length, '/', pendingGeneration.expectedCount, 'responses')
                      const saved = pendingGeneration
                      pendingGeneration = null
                      saved.resolve({ error: false, responses: saved.responses })
                    }
                  }, 30000)
                }
              }
            })
            .catch(err => {
              console.warn('[Flow API] [NetCapture] getResponseBody failed:', err.message)
              // getResponseBody 실패도 카운트에 포함
              if (pendingGeneration) {
                pendingGeneration.responses.push({ error: true, message: err.message })
                if (pendingGeneration.responses.length >= pendingGeneration.expectedCount) {
                  const saved = pendingGeneration
                  pendingGeneration = null
                  if (saved.collectionTimer) clearTimeout(saved.collectionTimer)
                  saved.resolve({ error: false, responses: saved.responses })
                }
              }
            })
        }
        // batchGenerateImages 응답 → 비동기 모드 (pendingGenerations Map)
        else if (pendingGenerations.size > 0 && reqUrl.includes('batchGenerateImages') && reqMethod !== 'OPTIONS') {
          const reqSentAt = requestSentTimeMap[params.requestId] || 0
          // 타임스탬프 기반 매칭: reqSentAt >= gen.setAt인 것 중 가장 늦은(가장 가까운) generation
          let matchId = null
          let matchSetAt = -Infinity
          for (const [id, gen] of pendingGenerations) {
            if (!gen.completed && gen.setAt <= reqSentAt && gen.setAt > matchSetAt) {
              matchId = id
              matchSetAt = gen.setAt
            }
          }
          if (matchId) {
            const gen = pendingGenerations.get(matchId)
            console.log('[Flow API] [AsyncCapture] ✅ batchGenerateImages → gen:', matchId.substring(0, 8),
              '(reqSentAt:', reqSentAt.toFixed(3), ', setAt:', gen.setAt.toFixed(3), ')')
            flowView.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
              .then(result => {
                if (result?.body && pendingGenerations.has(matchId)) {
                  const g = pendingGenerations.get(matchId)
                  g.responses.push({ error: false, body: result.body, status: httpStatus })
                  console.log('[Flow API] [AsyncCapture] Response collected (' +
                    g.responses.length + '/' + g.expectedCount + ') for gen:', matchId.substring(0, 8))
                  if (g.responses.length >= g.expectedCount) {
                    g.completed = true
                    if (g.collectionTimer) clearTimeout(g.collectionTimer)
                    console.log('[Flow API] [AsyncCapture] Generation COMPLETED:', matchId.substring(0, 8))
                  } else {
                    // 30초 타이머
                    if (g.collectionTimer) clearTimeout(g.collectionTimer)
                    g.collectionTimer = setTimeout(() => {
                      if (pendingGenerations.has(matchId)) {
                        const gg = pendingGenerations.get(matchId)
                        if (!gg.completed) {
                          gg.completed = true
                          console.log('[Flow API] [AsyncCapture] Timer fired — marking completed with',
                            gg.responses.length, '/', gg.expectedCount, 'for gen:', matchId.substring(0, 8))
                        }
                      }
                    }, 30000)
                  }
                }
              })
              .catch(err => {
                console.warn('[Flow API] [AsyncCapture] getResponseBody failed:', err.message)
                if (pendingGenerations.has(matchId)) {
                  const g = pendingGenerations.get(matchId)
                  g.responses.push({ error: true, message: err.message })
                  if (g.responses.length >= g.expectedCount) {
                    g.completed = true
                    if (g.collectionTimer) clearTimeout(g.collectionTimer)
                  }
                }
              })
          }
        }
        // 비디오 API 응답 캡처 (DOM-triggered video generation)
        else if (pendingVideoGeneration && reqUrl.includes('batchAsyncGenerateVideo') && reqMethod !== 'OPTIONS') {
          const reqSentAt = requestSentTimeMap[params.requestId] || 0
          if (pendingVideoGeneration.setAt && reqSentAt < pendingVideoGeneration.setAt) {
            console.log('[Flow API] [VideoCapture] Skipping STALE video response')
            return
          }
          console.log('[Flow API] [VideoCapture] ✅ ACCEPTED video API response, HTTP', httpStatus)

          flowView.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
            .then(result => {
              if (result?.body && pendingVideoGeneration) {
                console.log('[Flow API] [VideoCapture] Video response body captured, length:', result.body.length)
                if (httpStatus >= 400) {
                  console.error('[Flow API] [VideoCapture] ❌ Error response body:', result.body.substring(0, 500))
                }
                const saved = pendingVideoGeneration
                pendingVideoGeneration = null
                saved.resolve({ error: httpStatus >= 400, body: result.body, status: httpStatus })
              }
            })
            .catch(err => {
              console.warn('[Flow API] [VideoCapture] getResponseBody failed:', err.message)
              if (pendingVideoGeneration) {
                const saved = pendingVideoGeneration
                pendingVideoGeneration = null
                saved.resolve({ error: true, message: err.message })
              }
            })
        }
        // projectId 추출 (아직 없을 때만)
        else if (!capturedProjectId && reqUrl.includes('aisandbox-pa.googleapis.com')) {
          flowView.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
            .then(result => {
              if (result?.body) {
                const match = result.body.match(/"projectId"\s*:\s*"([a-f0-9-]{36})"/)
                if (match && !capturedProjectId) {
                  capturedProjectId = match[1]
                  console.log('[Flow API] ProjectId CAPTURED:', capturedProjectId)
                }
              }
            })
            .catch(() => {})
        }
      }
    })
    console.log('[Flow] Debugger attached for projectId + response capture')
  } catch (e) {
    console.warn('[Flow] Debugger attach failed:', e.message)
  }

  // Flow 페이지의 네트워크 요청에서 projectId 자동 캡처 + 로깅
  flowView.webContents.session.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      if (details.url.includes('aisandbox') || details.url.includes('googleapis.com/v1')) {
        console.log('[Flow Network]', details.method, details.url)
        // projectId 자동 캡처 (URL에서)
        const pidMatch = details.url.match(/projects\/([a-f0-9-]{36})/)
        if (pidMatch && !capturedProjectId) {
          capturedProjectId = pidMatch[1]
          console.log('[Flow API] ProjectId captured from network:', capturedProjectId)
        }
        // request body에서도 projectId 캡처
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

  // Handle window resize — update view bounds
  mainWindow.on('resize', updateBounds)

  // Split 레이아웃 적용
  updateBounds()

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

// Auth IPC (Google OAuth)
registerAuthIPC(ipcMain, () => flowView)

// CapCut IPC (path detection, project writing, app launch)
registerCapcutIPC(ipcMain)

// Tab switching
// Layout mode
ipcMain.handle('app:set-layout', (event, { mode, ratio }) => {
  layoutMode = mode || 'split-left'
  if (ratio !== undefined) splitRatio = Math.max(0.2, Math.min(0.8, ratio))
  updateBounds()
  if (mainWindow) {
    mainWindow.webContents.send('layout-changed', { mode: layoutMode, splitRatio })
  }
  return { success: true, mode: layoutMode, splitRatio }
})

// Split ratio update (drag) — renderer에서 계산된 ratio를 직접 받음
ipcMain.handle('app:update-split', (event, { ratio }) => {
  if (!mainWindow) return
  splitRatio = Math.max(0.2, Math.min(0.8, ratio))
  updateBounds()
  return { success: true, splitRatio }
})

// Get current layout
ipcMain.handle('app:get-layout', () => {
  return { mode: layoutMode, splitRatio }
})

// Modal visibility — Flow 뷰를 일시적으로 숨기거나 복원
ipcMain.handle('app:set-modal-visible', (event, { visible }) => {
  modalVisible = visible
  updateBounds()
  return { success: true }
})

// 화면 꺼짐/절전 방지
ipcMain.handle('app:set-prevent-sleep', (event, { enabled }) => {
  if (enabled) {
    if (powerSaveBlockerId === null || !powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    }
  } else {
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId)
      powerSaveBlockerId = null
    }
  }
  return { success: true, enabled }
})

ipcMain.handle('app:get-prevent-sleep', () => {
  return { enabled: powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId) }
})

// Open external URL
ipcMain.handle('app:open-external', (event, { url }) => {
  shell.openExternal(url)
  return { success: true }
})

// Reveal file in Finder / Explorer
ipcMain.handle('app:show-in-folder', (event, { filePath }) => {
  shell.showItemInFolder(filePath)
  return { success: true }
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
                const settings = JSON.parse(localStorage.getItem('flow2capcut_settings') || '{}')
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
          if (mainWindow && sceneId) {
            mainWindow.webContents.send('mcp-update', {
              type: 'generate-scene',
              sceneId: sceneId
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
            try {
              const parsed = JSON.parse(body)
              styleId = parsed.styleId || null
            } catch {}
            mainWindow.webContents.send('mcp-update', { type: 'start-scene-batch', styleId })
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, message: 'Scene batch generation started', styleId }))
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
            try {
              const parsed = JSON.parse(body)
              styleId = parsed.styleId || null
            } catch {}
            mainWindow.webContents.send('mcp-update', { type: 'start-ref-batch', styleId })
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, message: 'Reference batch generation started', styleId }))
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

// === Flow API IPC (image generation, media fetch, token, reference upload) ===
const flowAPIDeps = {
  getFlowView: () => flowView,
  getMainWindow: () => mainWindow,
  trustedClickOnFlowView,
  sessionFetch,
  flowPageFetch,
  parseFlowResponse,
  getRecaptchaToken,
  extractMediaIds,
  extractFifeUrls,
  extractBase64Images,
  fetchMediaAsBase64,
  configureFlowMode,
  getCapturedProjectId: () => capturedProjectId,
  setCapturedProjectId: (v) => { capturedProjectId = v },
  getPendingGeneration: () => pendingGeneration,
  setPendingGeneration: (v) => { pendingGeneration = v },
  pendingGenerations,  // 비동기 모드용 Map (직접 참조)
  getPendingReferenceImages: () => pendingReferenceImages,
  setPendingReferenceImages: (v) => { pendingReferenceImages = v },
  getEnterToolClicked: () => enterToolClicked,
  setEnterToolClicked: (v) => { enterToolClicked = v },
  SESSION_URL, TOKEN_INFO_URL, FLOW_URL, MEDIA_REDIRECT_URL, UPLOAD_URL,
  API_HEADERS, GENERATE_URL, BASE_API_URL,
}
registerFlowAPIIPC(ipcMain, flowAPIDeps)

// === Video Generation IPC (T2V, I2V, status polling) ===
const videoDeps = {
  getFlowView: () => flowView,
  getMainWindow: () => mainWindow,
  trustedClickOnFlowView,
  sessionFetch,
  flowPageFetch,
  parseFlowResponse,
  getRecaptchaToken,
  configureFlowMode,
  switchFlowToVideoMode,
  getCapturedProjectId: () => capturedProjectId,
  setCapturedProjectId: (v) => { capturedProjectId = v },
  getPendingVideoGeneration: () => pendingVideoGeneration,
  setPendingVideoGeneration: (v) => { pendingVideoGeneration = v },
  getPendingI2VInjection: () => pendingI2VInjection,
  setPendingI2VInjection: (v) => { pendingI2VInjection = v },
  SESSION_URL, VIDEO_T2V_URL, VIDEO_I2V_URL, VIDEO_I2V_START_END_URL, VIDEO_STATUS_URL, VIDEO_UPSCALE_URL,
  API_HEADERS, FLOW_URL,
}
registerVideoIPC(ipcMain, videoDeps)

// === DOM Mode IPC (navigation, script execution, prompt injection, scanning) ===
const domDeps = {
  getFlowView: () => flowView,
  getMainWindow: () => mainWindow,
  trustedClickOnFlowView,
  FLOW_URL,
  getCapturedProjectId: () => capturedProjectId,
  setCapturedProjectId: (v) => { capturedProjectId = v },
}
registerDomIPC(ipcMain, domDeps)

// === Custom Protocol: local-resource:// ===
// 로컬 파일을 렌더러에서 안전하게 로드하기 위한 커스텀 프로토콜
protocol.registerSchemesAsPrivileged([{
  scheme: 'local-resource',
  privileges: { bypassCSP: true, stream: true, supportFetchAPI: true, standard: true, secure: true }
}])

// === App Lifecycle ===
app.whenReady().then(() => {
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
