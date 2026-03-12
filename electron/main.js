import { app, BrowserWindow, WebContentsView, ipcMain, shell } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { registerFilesystemIPC } from './ipc/filesystem.js'
import { registerAuthIPC } from './ipc/auth.js'
import { registerCapcutIPC } from './ipc/capcut.js'

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
const VIDEO_STATUS_URL = `${BASE_API_URL}/video:batchCheckAsyncVideoGenerationStatus`
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
let pendingGeneration = null // DOM-triggered generation 응답 캡처용 Promise resolver (이미지)
let pendingVideoGeneration = null // DOM-triggered video generation 응답 캡처용 Promise resolver
let pendingReferenceImages = null // CDP Fetch 인터셉션용 레퍼런스 이미지 (mediaId 배열)
let enterToolClicked = false // Enter tool 버튼 클릭 완료 플래그 (무한루프 방지)
let consentClicked = false   // 동의 버튼 클릭 완료 플래그 (무한루프 방지)


/**
 * flowView를 일시적으로 보이게 한 후 sendInputEvent로 trusted click을 보내는 헬퍼
 * b.click()은 isTrusted: false라 Flow 페이지가 무시함 → sendInputEvent 필수
 * sendInputEvent는 viewport가 0x0이면 좌표가 의미없으므로 일시적으로 보이게 해야 함
 */
async function trustedClickOnFlowView(jsSelector) {
  if (!mainWindow || !flowView) return { success: false, error: 'No flowView' }

  // 1. 현재 bounds 저장
  const currentBounds = flowView.getBounds()
  const wasHidden = (currentBounds.width === 0 || currentBounds.height === 0)

  console.log('[TrustedClick] Current bounds:', currentBounds, 'wasHidden:', wasHidden)

  // 2. 숨겨져 있으면 일시적으로 보이게 (화면 밖에 배치해서 사용자가 안 보이게)
  if (wasHidden) {
    const { width, height } = mainWindow.getContentBounds()
    // 화면 밖 오른쪽에 배치 (사용자에게 보이지 않음)
    flowView.setBounds({ x: width + 5000, y: 0, width: width, height: height })
    await new Promise(r => setTimeout(r, 300)) // 레이아웃 업데이트 대기
  }

  try {
    // 3. 버튼에 focus() 먼저 + 좌표 가져오기
    const coords = await flowView.webContents.executeJavaScript(`
      (function() {
        const el = ${jsSelector};
        if (!el) return null;
        // 스크롤 후 좌표 확인
        el.scrollIntoView({ block: 'center' });
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          width: rect.width,
          height: rect.height,
          tag: el.tagName,
          disabled: el.disabled || false,
          visible: rect.width > 0 && rect.height > 0
        };
      })()
    `)

    if (!coords || coords.width === 0) {
      console.log('[TrustedClick] Button not found or zero-size:', coords)
      return { success: false, error: 'Button not found or zero-size' }
    }

    console.log('[TrustedClick] Button coords:', coords)

    const viewBounds = flowView.getBounds()
    console.log('[TrustedClick] View bounds during click:', viewBounds)

    // 좌표가 viewBounds 내인지 확인
    if (coords.x < 0 || coords.y < 0 || coords.x > viewBounds.width || coords.y > viewBounds.height) {
      console.warn('[TrustedClick] Coords outside view bounds! Adjusting...')
      // 뷰 범위 내로 클램핑
      coords.x = Math.max(1, Math.min(coords.x, viewBounds.width - 1))
      coords.y = Math.max(1, Math.min(coords.y, viewBounds.height - 1))
    }

    // 4. sendInputEvent로 trusted click (mouseMove → mouseDown → mouseUp)
    // mouseMove 먼저 보내서 hover 상태 생성
    flowView.webContents.sendInputEvent({ type: 'mouseMove', x: coords.x, y: coords.y })
    await new Promise(r => setTimeout(r, 100))
    flowView.webContents.sendInputEvent({ type: 'mouseDown', x: coords.x, y: coords.y, button: 'left', clickCount: 1 })
    await new Promise(r => setTimeout(r, 80))
    flowView.webContents.sendInputEvent({ type: 'mouseUp', x: coords.x, y: coords.y, button: 'left', clickCount: 1 })
    await new Promise(r => setTimeout(r, 200))

    console.log('[TrustedClick] Click events sent at (' + coords.x + ', ' + coords.y + ')')
    return { success: true, coords }
  } finally {
    // 5. 원래 bounds 복원
    if (wasHidden) {
      await new Promise(r => setTimeout(r, 500)) // 클릭 이벤트 처리 대기
      flowView.setBounds(currentBounds)
      console.log('[TrustedClick] Restored hidden bounds')
    }
  }
}

/**
 * XSSI prefix 제거 후 JSON 파싱
 * Flow API 응답에 ")]}'" 접두어가 붙을 수 있음
 */
function parseFlowResponse(text) {
  const cleaned = text.replace(/^\)\]\}',?\s*/, '').trim()
  if (!cleaned) return null

  try {
    return JSON.parse(cleaned)
  } catch {
    const first = cleaned.indexOf('{')
    const last = cleaned.lastIndexOf('}')
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1))
      } catch { /* fall through */ }
    }
    return null
  }
}

/**
 * Electron Session.fetch()를 사용하여 Chromium 네트워킹 스택으로 요청
 * - flowView 세션의 쿠키가 자동으로 포함됨 (credentials: 'include'와 동일)
 * - CORS 제약 없음 (main process에서 실행)
 * - Electron 28+ 필요 (현재 34.1.1)
 */
async function sessionFetch(url, options = {}) {
  const ses = flowView?.webContents?.session
  if (ses?.fetch) {
    try {
      return await ses.fetch(url, options)
    } catch (e) {
      console.warn('[Flow API] ses.fetch failed:', e.message, '- falling back to Node fetch')
    }
  }
  return fetch(url, options)
}

/**
 * Flow 페이지 컨텍스트 안에서 fetch 실행
 * reCAPTCHA 토큰의 origin과 API 요청 origin을 일치시키기 위해 필수
 * (main process의 sessionFetch는 origin이 달라 reCAPTCHA 검증 실패)
 */
async function flowPageFetch(url, { method = 'POST', headers = {}, body } = {}) {
  if (!flowView) throw new Error('Flow view not ready')

  // AutoFlow과 동일: fetch.call(window, ...) 패턴
  const result = await flowView.webContents.executeJavaScript(`
    (async function() {
      try {
        const _fetch = window.__afNativeFetch || window.__autoFlowNativeFetch || window.fetch;
        const resp = await _fetch.call(window, ${JSON.stringify(url)}, {
          method: ${JSON.stringify(method)},
          headers: ${JSON.stringify(headers)},
          body: ${JSON.stringify(body)}
        });
        const text = await resp.text().catch(() => '');
        return { ok: resp.ok, status: resp.status, text };
      } catch (e) {
        return { ok: false, status: 0, text: e.message };
      }
    })()
  `)

  return result
}

/**
 * Flow 페이지의 grecaptcha.enterprise를 사용하여 reCAPTCHA 토큰 획득
 * AutoFlow와 동일한 방식 (sidepanel.js:20097-20108)
 */
async function getRecaptchaToken() {
  if (!flowView) return ''
  try {
    const token = await flowView.webContents.executeJavaScript(`
      (async function() {
        try {
          const g = window.grecaptcha;
          if (!g || !g.enterprise || !g.enterprise.execute) return '';
          const token = await g.enterprise.execute(
            '${RECAPTCHA_SITE_KEY}',
            { action: '${RECAPTCHA_ACTION}' }
          );
          return String(token || '').trim();
        } catch (e) {
          console.warn('[reCAPTCHA] Failed:', e.message);
          return '';
        }
      })()
    `)
    if (token) {
      console.log('[Flow API] reCAPTCHA token obtained, length:', token.length)
    } else {
      console.warn('[Flow API] reCAPTCHA token empty — grecaptcha might not be loaded')
    }
    return token || ''
  } catch (e) {
    console.warn('[Flow API] reCAPTCHA execution error:', e.message)
    return ''
  }
}

/**
 * 응답에서 mediaId 추출
 */
function extractMediaIds(data) {
  const ids = []
  if (data.generatedMediaResults) {
    for (const result of data.generatedMediaResults) {
      if (result.mediaGenerationId) ids.push(result.mediaGenerationId)
      if (result.name) ids.push(result.name)
    }
  }
  if (data.responses) {
    for (const resp of data.responses) {
      if (resp.generatedImages) {
        for (const img of resp.generatedImages) {
          if (img.mediaGenerationId) ids.push(img.mediaGenerationId)
          if (img.name) ids.push(img.name)
        }
      }
    }
  }
  // batchGenerateImages 응답의 media[] 배열 처리
  if (data.media) {
    for (const item of data.media) {
      if (item.name) ids.push(item.name)
    }
  }
  return ids
}

/**
 * 응답에서 fifeUrl + mediaId 추출 (batchGenerateImages media[] 구조)
 * fifeUrl은 Google Storage 직접 URL — redirect 없이 바로 다운로드 가능
 * Returns: [{ fifeUrl, mediaId }]
 */
function extractFifeUrls(data) {
  const results = []
  if (data.media) {
    for (const item of data.media) {
      const fifeUrl = item?.image?.generatedImage?.fifeUrl
      const mediaId = item?.name || null
      if (fifeUrl) results.push({ fifeUrl, mediaId })
    }
  }
  return results
}

/**
 * 응답에서 base64 이미지 + mediaId 추출 (fallback)
 * Returns: [{ base64, mediaId }]
 */
function extractBase64Images(data) {
  const images = []
  if (data.responses) {
    for (const resp of data.responses) {
      if (resp.generatedImages) {
        for (const img of resp.generatedImages) {
          if (img.encodedImage) {
            images.push({
              base64: `data:image/png;base64,${img.encodedImage}`,
              mediaId: img.mediaGenerationId || img.name || null
            })
          }
        }
      }
    }
  }
  if (data.imagePanels) {
    for (const panel of data.imagePanels) {
      if (panel.generatedImages) {
        for (const img of panel.generatedImages) {
          if (img.encodedImage) {
            images.push({
              base64: `data:image/png;base64,${img.encodedImage}`,
              mediaId: img.mediaGenerationId || img.name || null
            })
          }
        }
      }
    }
  }
  return images
}

/**
 * mediaId로 실제 이미지 URL 가져와서 base64로 변환
 */
async function fetchMediaAsBase64(token, mediaId) {
  // Step 1: media redirect URL 가져오기
  const redirectUrl = `${MEDIA_REDIRECT_URL}?input=${encodeURIComponent(JSON.stringify({ json: { name: mediaId } }))}`
  const redirectRes = await sessionFetch(redirectUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  })

  if (!redirectRes.ok) {
    throw new Error(`Media redirect HTTP ${redirectRes.status}`)
  }

  const redirectText = await redirectRes.text()
  const redirectData = parseFlowResponse(redirectText)
  const mediaUrl = redirectData?.result?.data?.json?.url || redirectData?.result?.data?.json?.redirectUrl

  if (!mediaUrl) {
    throw new Error('No media URL in redirect response')
  }

  // Step 2: 실제 이미지 다운로드 → base64
  const mediaRes = await sessionFetch(mediaUrl)
  if (!mediaRes.ok) {
    throw new Error(`Media fetch HTTP ${mediaRes.status}`)
  }
  const buffer = await mediaRes.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  const contentType = mediaRes.headers?.get?.('content-type') || 'image/png'
  return `data:${contentType};base64,${base64}`
}

// Update Flow view bounds based on layout mode
function updateBounds() {
  if (!mainWindow || !flowView) return

  // 모달이 열려있으면 Flow 뷰를 숨김 (WebContentsView는 네이티브 레이어라 CSS로 가릴 수 없음)
  if (modalVisible) {
    flowView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    return
  }

  const { width, height } = mainWindow.getContentBounds()

  if (layoutMode === 'split-left') {
    // Flow 왼쪽, App 오른쪽
    const splitPos = Math.round(width * splitRatio)
    flowView.setBounds({ x: 0, y: 0, width: splitPos, height })
  } else if (layoutMode === 'split-right') {
    // Flow 오른쪽, App 왼쪽
    const splitPos = Math.round(width * splitRatio)
    flowView.setBounds({ x: width - splitPos, y: 0, width: splitPos, height })
  } else if (layoutMode === 'split-top') {
    // Flow 상단, App 하단
    const splitPos = Math.round(height * splitRatio)
    flowView.setBounds({ x: 0, y: 0, width, height: splitPos })
  } else if (layoutMode === 'split-bottom') {
    // Flow 하단, App 상단
    const splitPos = Math.round(height * splitRatio)
    flowView.setBounds({ x: 0, y: height - splitPos, width, height: splitPos })
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    title: 'AutoCraft Studio',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

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
  flowView.webContents.on('did-finish-load', async () => {
    const url = flowView.webContents.getURL()
    console.log('[Flow] did-finish-load:', url)
    mainWindow.webContents.send('flow-status', {
      loaded: true,
      url,
      loggedIn: url.includes('labs.google/fx')
    })

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
                if (['start', '시작', 'enter', 'new', '새로 만들기', '새 프로젝트', '새프로젝트'].some(k => text.includes(k))) {
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
    const pidMatch = url.match(/\/project\/([a-f0-9-]{36})/)
    if (pidMatch) {
      capturedProjectId = pidMatch[1]
      console.log('[Flow API] ProjectId from navigation:', capturedProjectId)
    }
  })
  // SPA pushState/replaceState 내비게이션 캡처 (Flow는 SPA)
  flowView.webContents.on('did-navigate-in-page', (event, url) => {
    console.log('[Flow] did-navigate-in-page:', url)
    const pidMatch = url.match(/\/project\/([a-f0-9-]{36})/)
    if (pidMatch && !capturedProjectId) {
      capturedProjectId = pidMatch[1]
      console.log('[Flow API] ProjectId from SPA navigation:', capturedProjectId)
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

// === Flow API IPC Handlers ===

// Extract Flow access token from session
ipcMain.handle('flow:extract-token', async () => {
  console.log('[Flow API] extract-token called')
  if (!flowView) return { success: false, error: 'Flow view not ready' }

  try {
    const sessionData = await flowView.webContents.executeJavaScript(`
      fetch('${SESSION_URL}')
        .then(r => r.ok ? r.text() : null)
        .catch(() => null)
    `)

    console.log('[Flow API] Session response (first 300):', sessionData?.substring(0, 300))

    if (!sessionData) {
      return { success: false, error: 'No session data. Please log in to Flow first.' }
    }

    // XSSI prefix 제거 후 JSON 파싱
    const parsed = parseFlowResponse(sessionData) || JSON.parse(sessionData)
    console.log('[Flow API] Session keys:', Object.keys(parsed || {}))

    const token = parsed?.access_token || parsed?.accessToken || null

    if (token) {
      console.log('[Flow API] Token extracted, length:', token.length)
      return { success: true, token, length: token.length }
    }
    console.warn('[Flow API] No token in session data')
    return { success: false, error: 'No token found. Please log in to Flow first.' }
  } catch (e) {
    console.error('[Flow API] extract-token error:', e.message)
    return { success: false, error: e.message }
  }
})

// Extract projectId from Flow page URL
// (capturedProjectId는 파일 상단에서 선언)

ipcMain.handle('flow:extract-project-id', async () => {
  if (!flowView) return { success: false, error: 'Flow view not ready' }

  // 이미 캡처된 projectId가 있으면 반환
  if (capturedProjectId) {
    return { success: true, projectId: capturedProjectId }
  }

  try {
    // 방법 1: URL에서 추출 (project/UUID 패턴)
    const url = flowView.webContents.getURL()
    const match = url.match(/project\/([a-f0-9-]{36})/)
    if (match) {
      capturedProjectId = match[1]
      return { success: true, projectId: capturedProjectId }
    }

    // 방법 2: Flow 페이지의 JS 컨텍스트에서 추출
    const pid = await flowView.webContents.executeJavaScript(`
      (function() {
        // URL에서 projectId 추출
        let m = location.href.match(/project\\/([a-f0-9-]{36})/);
        if (m) return m[1];
        // __flowConfig 등 글로벌 변수에서 추출 시도
        try {
          let scripts = document.querySelectorAll('script');
          for (let s of scripts) {
            let match = s.textContent.match(/"projectId":"([a-f0-9-]{36})"/);
            if (match) return match[1];
          }
        } catch {}
        return null;
      })()
    `)
    if (pid) {
      capturedProjectId = pid
      return { success: true, projectId: pid }
    }

    return { success: true, projectId: null }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// Get reCAPTCHA token from Flow page
ipcMain.handle('flow:get-recaptcha-token', async () => {
  const token = await getRecaptchaToken()
  return { success: !!token, token }
})

// Generate image via Flow API
ipcMain.handle('flow:generate-image', async (event, {
  token, prompt, aspectRatio, seed, model, projectId, referenceImages
}) => {
  console.log('[Flow API] generate-image:', { prompt: prompt?.substring(0, 50), model, aspectRatio })
  if (!prompt) return { success: false, error: 'No prompt' }
  if (!flowView) return { success: false, error: 'Flow view not ready' }

  // === DOM 자동화 + 네트워크 응답 인터셉트 ===
  // 페이지가 자체적으로 reCAPTCHA를 처리하므로 가장 안정적인 방법
  // ⚠️ cdpFetchEnabled를 try 밖에 선언 (esbuild가 try 안의 let을 finally에서 못 찾는 버그 회피)
  let cdpFetchEnabled = false
  try {
    console.log('[Flow API] [DOM+Net] Starting DOM-triggered generation')

    // 0. Flow 프로젝트 페이지 확인 (textarea가 있어야 DOM 자동화 가능)
    const currentUrl = flowView.webContents.getURL()
    console.log('[Flow API] [DOM+Net] Current Flow URL:', currentUrl)

    const hasProject = currentUrl.includes('/project/') || currentUrl.includes('/tools/flow/')
    const hasTextarea = await flowView.webContents.executeJavaScript(
      `!!(document.querySelector('textarea') || document.querySelector("div[role='textbox'][contenteditable='true']") || document.querySelector('[contenteditable="true"]'))`
    ).catch(() => false)

    console.log('[Flow API] [DOM+Net] hasProject:', hasProject, 'hasTextarea:', hasTextarea)

    if (!hasTextarea) {
      console.log('[Flow API] [DOM+Net] No textarea found — need to create/enter project')

      // Flow 랜딩 페이지면: Enter tool 버튼 클릭으로 프로젝트 생성
      if (!currentUrl.includes('/project/')) {
        // 이미 Flow 페이지가 아니면 로드
        if (!currentUrl.includes('labs.google/fx')) {
          console.log('[Flow API] Navigating to Flow...')
          await flowView.webContents.loadURL(FLOW_URL)
          await new Promise(r => setTimeout(r, 3000))
        }

        // Enter tool 버튼 찾기 + trusted click
        for (let attempt = 0; attempt < 8; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 2000))

          // 이미 프로젝트로 이동했는지 확인
          const checkUrl = flowView.webContents.getURL()
          if (checkUrl.includes('/project/')) {
            console.log('[Flow API] Already navigated to project:', checkUrl)
            break
          }

          // New Project 버튼 클릭 (AutoFlow: icon='add_2')
          const enterClicked = await flowView.webContents.executeJavaScript(`
            (function() {
              // XPath: add_2 아이콘 버튼 (AutoFlow 검증된 방식)
              try {
                const xr = document.evaluate(
                  "//button[.//i[normalize-space(text())='add_2']] | (//button[.//i[normalize-space(.)='add_2']])",
                  document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                );
                if (xr.singleNodeValue) { xr.singleNodeValue.click(); return 'add_2_xpath'; }
              } catch {}

              const allButtons = document.querySelectorAll('button');
              // icon 'add_2' 또는 'add'
              for (const b of allButtons) {
                const icons = b.querySelectorAll('i, span.material-icons, span.material-symbols-outlined');
                for (const icon of icons) {
                  const t = icon.textContent.trim();
                  if (t === 'add_2' || t === 'add' || t === 'arrow_forward') {
                    b.click(); return 'icon_' + t;
                  }
                }
              }
              // 텍스트 버튼
              for (const b of allButtons) {
                const text = b.textContent.trim().toLowerCase();
                if (['start', '시작', 'enter', 'new', '새로 만들기', '새 프로젝트', '새프로젝트'].some(k => text.includes(k))) {
                  b.click(); return 'text_' + text.substring(0, 30);
                }
              }
              console.log('[DOM] Buttons:', allButtons.length, Array.from(allButtons).slice(0,10).map(b => b.textContent.trim().substring(0,30)));
              return null;
            })()
          `).catch(() => null)

          if (enterClicked) {
            console.log('[Flow API] Enter tool button clicked:', enterClicked)
            enterToolClicked = true // 무한루프 방지

            // 프로젝트 생성 대기 (최대 15초)
            for (let w = 0; w < 30; w++) {
              await new Promise(r => setTimeout(r, 500))
              const projUrl = flowView.webContents.getURL()
              if (projUrl.includes('/project/')) {
                const m = projUrl.match(/\/project\/([a-f0-9-]{36})/)
                if (m) capturedProjectId = m[1]
                console.log('[Flow API] Project created:', projUrl)
                break
              }
            }
            break
          } else {
            console.log('[Flow API] Enter tool button not found, attempt', attempt + 1, '/ 8')
          }
        }
      }

      // 프로젝트 생성 후 textarea 재확인 (최대 10초)
      let textareaReady = false
      for (let w = 0; w < 10; w++) {
        await new Promise(r => setTimeout(r, 1000))
        textareaReady = await flowView.webContents.executeJavaScript(
          `!!(document.querySelector('textarea') || document.querySelector("div[role='textbox'][contenteditable='true']") || document.querySelector('[contenteditable="true"]'))`
        ).catch(() => false)
        if (textareaReady) {
          console.log('[Flow API] Textarea ready after project creation')
          break
        }
      }

      if (!textareaReady) {
        return { success: false, error: 'Flow project page not ready (no textarea found). Please check Flow tab.' }
      }
    }

    // 0.5. 토큰 자동 추출 (DOM 모드에서 token=null로 호출될 때)
    if (!token) {
      try {
        const sessionData = await flowView.webContents.executeJavaScript(
          `fetch('${SESSION_URL}').then(r => r.ok ? r.text() : null).catch(() => null)`
        )
        if (sessionData) {
          const parsed = parseFlowResponse(sessionData) || JSON.parse(sessionData)
          token = parsed?.access_token || parsed?.accessToken || null
          if (token) console.log('[Flow API] Auto-extracted token for media fetch, length:', token.length)
        }
      } catch (e) {
        console.warn('[Flow API] Token auto-extraction failed:', e.message)
      }
    }

    // 0.8. 이미지 모드 + 배치 x2 설정
    const modeResult = await configureFlowMode('IMAGE', 2)
    if (modeResult.success) {
      console.log('[Flow API] Image mode configured:', modeResult.method, 'batch:', modeResult.batch)
    } else {
      console.warn('[Flow API] Image mode config failed (continuing anyway):', modeResult.error)
    }

    // 0.9. CDP Fetch 인터셉션 설정 (레퍼런스 이미지 주입용)
    //   batchGenerateImages 요청을 가로채서 imageInputs에 레퍼런스 mediaId를 추가
    if (referenceImages && referenceImages.length > 0) {
      pendingReferenceImages = referenceImages
      try {
        await flowView.webContents.debugger.sendCommand('Fetch.enable', {
          patterns: [{ urlPattern: '*batchGenerateImages*', requestStage: 'Request' }]
        })
        cdpFetchEnabled = true
        console.log('[Flow API] [Fetch] Interception enabled for', referenceImages.length, 'references:',
          referenceImages.map(r => r.mediaId?.substring(0, 8)).join(', '))
      } catch (e) {
        console.warn('[Flow API] [Fetch] Fetch.enable failed:', e.message)
        pendingReferenceImages = null
      }
    }

    // 1. 네트워크 응답 캡처 Promise 설정
    // ★ pendingGeneration은 Generate 버튼 클릭 직후에 설정한다!
    //   프롬프트 주입 시 Slate의 input/change 이벤트가 Flow 자동생성을 트리거할 수 있음.
    //   pendingGeneration을 미리 설정하면 자동생성 응답이 캡처되고,
    //   실제 버튼 클릭의 응답은 무시되는 문제가 발생한다.
    let resolveGeneration = null
    let generationTimeout = null
    const responsePromise = new Promise((resolve) => {
      generationTimeout = setTimeout(() => {
        if (pendingGeneration) {
          pendingGeneration = null
          resolve({ error: true, message: 'Response timeout (120s)' })
        }
      }, 120000)
      resolveGeneration = resolve
    })

    // 2. 기존 blob URL 스냅샷 (fallback용)
    let existingBlobs = []
    try {
      existingBlobs = await flowView.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('img[src^="blob:"]')).map(img => img.src)`
      ) || []
    } catch {}

    // 3. 프롬프트 입력 (Slate.js 에디터 — AutoFlow 역공학)
    // execCommand 방식이 작동하려면 flowView가 보여야 함 (focus 필요)
    const promptBounds = flowView.getBounds()
    const promptWasHidden = (promptBounds.width === 0 || promptBounds.height === 0)
    if (promptWasHidden) {
      const { width, height } = mainWindow.getContentBounds()
      flowView.setBounds({ x: width + 5000, y: 0, width, height })
      await new Promise(r => setTimeout(r, 300))
      console.log('[Flow API] Temporarily showed flowView for Slate injection')
    }

    const promptResult = await flowView.webContents.executeJavaScript(`
      (async function() {
        const promptText = ${JSON.stringify(prompt)};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        // Slate editor 찾기
        let editor = document.querySelector("[data-slate-editor='true']");
        if (!editor) editor = document.querySelector("div[role='textbox'][contenteditable='true']:not(#af-bot-panel *)");
        if (!editor) editor = document.querySelector('[contenteditable="true"]:not([aria-hidden])');

        if (!editor) {
          return { success: false, error: 'Editor not found' };
        }

        const isSlate = !!(editor.matches?.("[data-slate-editor='true']") || editor.querySelector?.("[data-slate-node]"));
        console.log('[Prompt] Editor found, isSlate:', isSlate, 'tag:', editor.tagName);

        // ==== 방법 1: Slate React API — editor.apply() ====
        let slateSuccess = false;
        if (isSlate) {
          try {
            const reactKeys = Object.keys(editor).filter(k => k.startsWith('__react'));
            let slateEditor = null;
            for (const key of reactKeys) {
              const stack = [editor[key]];
              const visited = new Set();
              let guard = 0;
              while (stack.length > 0 && guard < 5000) {
                const node = stack.pop();
                guard++;
                if (!node || typeof node !== 'object' || visited.has(node)) continue;
                visited.add(node);
                const candidate =
                  node?.memoizedProps?.node || node?.memoizedProps?.editor ||
                  node?.pendingProps?.node || node?.pendingProps?.editor ||
                  node?.stateNode?.editor || node?.editor;
                if (candidate && typeof candidate.apply === 'function') {
                  slateEditor = candidate;
                  break;
                }
                if (node.child) stack.push(node.child);
                if (node.sibling) stack.push(node.sibling);
                if (node.return) stack.push(node.return);
                if (node.alternate) stack.push(node.alternate);
              }
              if (slateEditor) break;
            }

            if (slateEditor) {
              console.log('[Prompt] Found Slate editor via React fiber');
              // 기존 텍스트 삭제
              try {
                const existingText = slateEditor.children?.[0]?.children?.[0]?.text || '';
                if (existingText) {
                  slateEditor.apply({ type: 'remove_text', path: [0, 0], offset: 0, text: existingText });
                }
              } catch (e) { console.log('[Prompt] remove_text failed (ok):', e.message); }

              // 새 텍스트 삽입
              slateEditor.apply({ type: 'insert_text', path: [0, 0], offset: 0, text: promptText });
              if (typeof slateEditor.onChange === 'function') slateEditor.onChange();
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              editor.dispatchEvent(new Event('change', { bubbles: true }));
              await sleep(200);

              // 검증
              const modelText = (slateEditor.children?.[0]?.children?.[0]?.text || '').trim();
              if (modelText && modelText.includes(promptText.slice(0, 40))) {
                console.log('[Prompt] Slate API verified OK');
                slateSuccess = true;
              }
            }
          } catch (e) { console.log('[Prompt] Slate API failed:', e.message); }
        }

        // ==== 방법 2: document.execCommand('insertText') ====
        if (!slateSuccess) {
          console.log('[Prompt] Trying execCommand insertText...');
          try {
            editor.focus();
            editor.click();
            await sleep(100);

            if (isSlate) {
              const sel = window.getSelection();
              const range = document.createRange();
              const stringNodes = Array.from(editor.querySelectorAll('[data-slate-string]'))
                .map(n => n.firstChild).filter(n => n && n.nodeType === Node.TEXT_NODE);
              if (stringNodes.length > 0) {
                range.setStart(stringNodes[0], 0);
                const last = stringNodes[stringNodes.length - 1];
                range.setEnd(last, (last.textContent || '').length);
              } else {
                const zeroNode = Array.from(editor.querySelectorAll('[data-slate-zero-width]'))
                  .map(n => n.firstChild).find(n => n && n.nodeType === Node.TEXT_NODE);
                if (zeroNode) { range.setStart(zeroNode, 0); range.setEnd(zeroNode, (zeroNode.textContent || '').length); }
                else { range.selectNodeContents(editor); }
              }
              sel.removeAllRanges();
              sel.addRange(range);
            } else {
              document.execCommand('selectAll', false, null);
            }

            document.execCommand('delete', false, null);
            await sleep(50);

            try {
              editor.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true, cancelable: true, inputType: 'insertText', data: promptText
              }));
            } catch {}

            const inserted = document.execCommand('insertText', false, promptText);
            if (inserted) {
              try { editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: promptText })); } catch {}
              await sleep(200);
              const hasText = !!editor.querySelector?.('[data-slate-string]');
              const visibleText = (editor.innerText || editor.textContent || '').trim();
              if (hasText || visibleText.includes(promptText.slice(0, 20))) {
                console.log('[Prompt] execCommand verified OK');
                slateSuccess = true;
              }
            }
          } catch (e) { console.log('[Prompt] execCommand failed:', e.message); }
        }

        // ==== 방법 3: textarea fallback (Slate가 아닌 경우) ====
        if (!slateSuccess && !isSlate) {
          try {
            const tag = editor.tagName.toLowerCase();
            if (tag === 'textarea' || tag === 'input') {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
              if (setter) {
                setter.call(editor, '');
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                setter.call(editor, promptText);
                editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: promptText }));
                slateSuccess = true;
              }
            }
          } catch (e) { console.log('[Prompt] textarea setter failed:', e.message); }
        }

        if (!slateSuccess) return { success: false, error: 'All prompt injection methods failed' };
        await sleep(500);

        // Generate 버튼 disabled 체크
        try {
          const xr = document.evaluate("//button[.//i[text()='arrow_forward']]",
            document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          if (xr.singleNodeValue?.disabled) {
            return { success: false, error: 'Generate button disabled after injection', retry: true };
          }
        } catch {}

        return { success: true };
      })()
    `)

    // flowView 복원 (숨겨져 있었으면)
    if (promptWasHidden) {
      flowView.setBounds(promptBounds)
      await new Promise(r => setTimeout(r, 200))
    }

    console.log('[Flow API] [DOM+Net] Prompt injection result:', promptResult)
    if (!promptResult?.success) {
      clearTimeout(generationTimeout)
      return { success: false, error: promptResult?.error || 'Prompt injection failed' }
    }

    // 4. Generate 버튼 찾기 + Trusted Click
    // b.click()은 isTrusted: false라서 Flow 페이지가 무시함
    // → flowView를 일시적으로 보이게 한 후 sendInputEvent로 trusted click

    // 먼저 버튼 존재여부 + disabled 확인
    const btnCheck = await flowView.webContents.executeJavaScript(`
      (function() {
        // XPath (AutoFlow 검증된 방식)
        try {
          const xr = document.evaluate(
            "//button[.//i[text()='arrow_forward']] | (//button[.//i[normalize-space(text())='arrow_forward']])",
            document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
          );
          if (xr.singleNodeValue) {
            return { found: true, disabled: xr.singleNodeValue.disabled, method: 'xpath_arrow_forward' };
          }
        } catch {}

        // icon 텍스트로 찾기
        const iconNames = ['arrow_forward', 'send', 'play_arrow'];
        for (const b of document.querySelectorAll('button')) {
          const icons = b.querySelectorAll('i, span.material-icons, span.material-symbols-outlined, mat-icon');
          for (const icon of icons) {
            if (iconNames.includes(icon.textContent.trim())) {
              return { found: true, disabled: b.disabled, method: 'icon:' + icon.textContent.trim() };
            }
          }
        }

        // aria-label
        for (const b of document.querySelectorAll('button[aria-label]')) {
          const label = (b.getAttribute('aria-label') || '').toLowerCase();
          if (label.includes('generate') || label.includes('create') || label.includes('submit') || label.includes('send')) {
            return { found: true, disabled: b.disabled, method: 'aria:' + label };
          }
        }

        // 디버깅: 모든 버튼 아이콘 로깅
        const allBtns = document.querySelectorAll('button');
        const iconDebug = [];
        allBtns.forEach(b => {
          b.querySelectorAll('i, span.material-icons, span.material-symbols-outlined').forEach(icon => {
            iconDebug.push(icon.textContent.trim());
          });
        });
        console.log('[DOM] All button icons:', JSON.stringify(iconDebug));
        return { found: false, totalButtons: allBtns.length, icons: iconDebug.slice(0, 20) };
      })()
    `)

    console.log('[Flow API] [DOM+Net] Generate button check:', btnCheck)

    if (!btnCheck?.found) {
      clearTimeout(generationTimeout)
      return { success: false, error: 'Generate button not found' }
    }

    if (btnCheck.disabled) {
      // 버튼 disabled → 5초 대기 후 재확인
      console.log('[Flow API] [DOM+Net] Button disabled, waiting 5s...')
      await new Promise(r => setTimeout(r, 5000))
      const stillDisabled = await flowView.webContents.executeJavaScript(`
        (function() {
          try {
            const xr = document.evaluate(
              "//button[.//i[text()='arrow_forward']]",
              document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
            );
            return xr.singleNodeValue?.disabled ?? true;
          } catch { return true; }
        })()
      `)
      if (stillDisabled) {
        clearTimeout(generationTimeout)
        return { success: false, error: 'Generate button remained disabled' }
      }
    }

    // Trusted click via sendInputEvent (flowView를 일시적으로 보이게)
    // JS 셀렉터: XPath로 arrow_forward 버튼 찾기
    const generateBtnSelector = `(function() {
      try {
        const xr = document.evaluate(
          "//button[.//i[text()='arrow_forward']]",
          document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        if (xr.singleNodeValue && !xr.singleNodeValue.disabled) return xr.singleNodeValue;
      } catch {}
      // fallback: icon 이름으로
      for (const b of document.querySelectorAll('button')) {
        for (const icon of b.querySelectorAll('i')) {
          if (icon.textContent.trim() === 'arrow_forward' && !b.disabled) return b;
        }
      }
      return null;
    })()`

    const clickResult = await trustedClickOnFlowView(generateBtnSelector)
    console.log('[Flow API] [DOM+Net] Trusted click result:', clickResult)

    if (!clickResult?.success) {
      clearTimeout(generationTimeout)
      return { success: false, error: clickResult?.error || 'Failed to click Generate button' }
    }

    // ★ Generate 버튼 클릭 성공 직후 즉시 pendingGeneration 설정!
    //   버튼 클릭이 batchGenerateImages 요청을 트리거하므로,
    //   expectedImageCount 감지 전에 먼저 설정해야 CDP 핸들러가 응답을 캡처할 수 있다.
    //   2초 버퍼: 클릭과 네트워크 요청 사이의 wallTime 차이를 보정
    const generationSetAt = Date.now() / 1000 - 2  // 2초 전부터 유효 (stale 필터 보정)
    pendingGeneration = {
      setAt: generationSetAt,
      expectedCount: 1,              // 기본값 1, 아래에서 업데이트
      responses: [],
      collectionTimer: null,
      resolve: (result) => {
        clearTimeout(generationTimeout)
        if (pendingGeneration?.collectionTimer) clearTimeout(pendingGeneration.collectionTimer)
        resolveGeneration(result)
      }
    }
    console.log('[Flow API] [DOM+Net] pendingGeneration set IMMEDIATELY after click (setAt:',
      generationSetAt.toFixed(3), ')')

    // 예상 이미지 개수 감지 (x1/x2/x3/x4 선택 버튼에서)
    // pendingGeneration 설정 후에 실행 → expectedCount만 업데이트
    let expectedImageCount = 1
    try {
      expectedImageCount = await flowView.webContents.executeJavaScript(`
        (function() {
          // 방법 1: x1/x2/x3/x4 버튼에서 선택된 것 찾기
          const btns = Array.from(document.querySelectorAll('button'));
          const countBtns = btns.filter(b => /^x[1-4]$/.test(b.textContent.trim()));
          if (countBtns.length > 0) {
            for (const btn of countBtns) {
              const style = getComputedStyle(btn);
              const bg = style.backgroundColor;
              // 선택된 버튼은 밝은 배경색 (비선택은 투명 또는 어두운 색)
              const isSelected = btn.getAttribute('aria-pressed') === 'true'
                || btn.getAttribute('aria-selected') === 'true'
                || btn.classList.contains('selected')
                || btn.classList.contains('active')
                || (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
                    && !bg.includes('0.') && bg !== 'rgb(0, 0, 0)');
              if (isSelected) {
                console.log('[DOM] Detected selected image count button:', btn.textContent.trim(), 'bg:', bg);
                return parseInt(btn.textContent.trim().replace('x', ''));
              }
            }
            // fallback: 첫 번째 countBtn의 부모에서 aria/data 속성 체크
            console.log('[DOM] Count buttons found but no selected state detected, checking generate button text');
          }

          // 방법 2: Generate 버튼 텍스트에서 "x2", "x3", "x4" 추출
          for (const btn of btns) {
            const text = btn.textContent || '';
            const match = text.match(/x([2-4])/);
            if (match && (text.includes('arrow_forward') || text.includes('Nano') || text.includes('Imagen'))) {
              console.log('[DOM] Detected image count from generate button text:', match[1]);
              return parseInt(match[1]);
            }
          }

          return 1;
        })()
      `) || 1
    } catch (e) {
      console.warn('[Flow API] Failed to detect image count from DOM:', e.message)
      expectedImageCount = 1
    }

    // expectedCount 업데이트 (pendingGeneration이 이미 설정된 상태)
    if (pendingGeneration) {
      pendingGeneration.expectedCount = expectedImageCount
    }
    console.log('[Flow API] [DOM+Net] expectedCount updated to', expectedImageCount,
      ', waiting for API response(s)...')

    // 4. 네트워크 응답 대기
    const netResult = await responsePromise

    if (netResult.error) {
      console.warn('[Flow API] [DOM+Net] Network error/timeout:', netResult.message)
      // Fallback: blob 이미지 폴링 (최대 60초)
      console.log('[Flow API] [BlobPoll] Falling back to blob image polling...')
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000))
        try {
          const currentBlobs = await flowView.webContents.executeJavaScript(
            `Array.from(document.querySelectorAll('img[src^="blob:"]')).map(img => img.src)`
          ) || []
          const newBlobs = currentBlobs.filter(b => !existingBlobs.includes(b))
          if (newBlobs.length > 0) {
            console.log('[Flow API] [BlobPoll] New blob found:', newBlobs[0].substring(0, 50))
            const base64 = await flowView.webContents.executeJavaScript(`
              (async function() {
                try {
                  const res = await fetch(${JSON.stringify(newBlobs[0])});
                  const blob = await res.blob();
                  return new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                  });
                } catch { return null; }
              })()
            `)
            if (base64) return { success: true, images: [{ base64, mediaId: null }] }
          }
        } catch {}
      }
      return { success: false, error: netResult.message || 'Generation failed' }
    }

    // 5. 멀티 응답 파싱 — 각 응답에서 이미지 추출 후 결합
    const successResponses = (netResult.responses || []).filter(r => !r.error)
    const failedCount = (netResult.responses || []).filter(r => r.error).length
    console.log('[Flow API] [DOM+Net] Parsing', successResponses.length, 'successful responses (' +
      failedCount, 'failed)')

    // allImages: [{ base64, mediaId }] — mediaId 보존을 위해 객체 배열
    const allImages = []
    const allErrors = []

    for (const resp of successResponses) {
      const data = parseFlowResponse(resp.body)
      if (!data) {
        allErrors.push('Failed to parse response')
        continue
      }

      // 에러 체크
      if (data.error) {
        allErrors.push(data.error.message || JSON.stringify(data.error))
        continue
      }

      // base64 이미지 직접 추출 → [{ base64, mediaId }]
      const base64Images = extractBase64Images(data)
      if (base64Images.length > 0) {
        allImages.push(...base64Images)
        continue
      }

      // fifeUrl 직접 다운로드 시도 (가장 빠름) → [{ fifeUrl, mediaId }]
      const fifeResults = extractFifeUrls(data)
      if (fifeResults.length > 0) {
        console.log('[Flow API] Got fifeUrls from response:', fifeResults.length)
        for (const { fifeUrl, mediaId } of fifeResults) {
          try {
            const res = await sessionFetch(fifeUrl)
            if (!res.ok) throw new Error(`fifeUrl fetch HTTP ${res.status}`)
            const buffer = await res.arrayBuffer()
            const base64Raw = Buffer.from(buffer).toString('base64')
            const contentType = res.headers.get('content-type') || 'image/png'
            allImages.push({
              base64: `data:${contentType};base64,${base64Raw}`,
              mediaId
            })
          } catch (fifeErr) {
            console.warn('[Flow API] fifeUrl fetch failed:', fifeErr.message)
            allErrors.push(fifeErr.message)
          }
        }
        if (allImages.length > 0) continue
      }

      // mediaId fallback
      const mediaIds = extractMediaIds(data)
      if (mediaIds.length > 0) {
        console.log('[Flow API] Got mediaIds from response:', mediaIds)
        for (const id of mediaIds) {
          try {
            const base64 = await fetchMediaAsBase64(token, id)
            allImages.push({ base64, mediaId: id })
          } catch (fetchErr) {
            console.warn('[Flow API] mediaId fetch failed:', fetchErr.message)
            allErrors.push(fetchErr.message)
          }
        }
        continue
      }

      // 이 응답에서는 이미지를 찾을 수 없음
      console.warn('[Flow API] No images in response:', JSON.stringify(data).substring(0, 300))
      allErrors.push('No images in response')
    }

    console.log('[Flow API] [DOM+Net] Total images collected:', allImages.length,
      '(errors:', allErrors.length, ')')

    if (allImages.length > 0) {
      return { success: true, images: allImages }
    }

    // 모든 응답에서 이미지 추출 실패
    return { success: false, error: allErrors.join('; ') || 'No images generated (content may have been filtered)' }

  } catch (e) {
    console.error('[Flow API] [DOM+Net] Exception:', e.message)
    pendingGeneration = null
    return { success: false, error: e.message }
  } finally {
    // CDP Fetch 인터셉션 정리
    if (cdpFetchEnabled) {
      pendingReferenceImages = null
      try {
        await flowView.webContents.debugger.sendCommand('Fetch.disable')
        console.log('[Flow API] [Fetch] Interception disabled')
      } catch (e) {
        // Fetch.disable 실패해도 무시 (디버거 분리 등)
      }
    }
  }
})

// Fetch media by ID (mediaId → redirect → base64)
ipcMain.handle('flow:fetch-media', async (event, { token, mediaId }) => {
  if (!token) return { success: false, error: 'No token' }
  if (!mediaId) return { success: false, error: 'No mediaId' }

  try {
    const base64 = await fetchMediaAsBase64(token, mediaId)
    return { success: true, base64 }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// 비디오 URL 직접 다운로드 (status 응답에서 추출한 fifeUri/url)
ipcMain.handle('flow:download-video-url', async (event, { url, token }) => {
  if (!url) return { success: false, error: 'No URL' }

  try {
    console.log('[Flow VideoDownload] Fetching:', url.substring(0, 80))
    const headers = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await sessionFetch(url, { headers })
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` }
    }

    const buffer = await res.arrayBuffer()
    const contentType = res.headers?.get?.('content-type') || 'video/mp4'
    const base64 = `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`
    console.log('[Flow VideoDownload] ✅ Downloaded, size:', buffer.byteLength, 'type:', contentType)
    return { success: true, base64 }
  } catch (e) {
    console.error('[Flow VideoDownload] Error:', e.message)
    return { success: false, error: e.message }
  }
})

// DOM-based video download — AutoFlow downloadVideoAtResolution 방식
// 1. CDP Page.setDownloadBehavior → temp 디렉토리로 자동 저장
// 2. <video> 요소를 mediaId로 찾기 → hover → three-dot → download → 해상도 선택
// 3. temp 파일 읽기 → base64 반환
ipcMain.handle('flow:dom-download-video', async (event, { mediaId, resolution = '720p' }) => {
  if (!flowView) return { success: false, error: 'Flow view not ready' }
  if (!mediaId) return { success: false, error: 'No mediaId' }

  console.log('[Flow DOMDownload] Starting DOM download — mediaId:', mediaId?.substring(0, 30), 'resolution:', resolution)

  try {
    const fs = await import('node:fs')
    const os = await import('node:os')

    // Step 1: CDP로 다운로드 경로 설정 (save dialog 스킵)
    const tempDir = path.join(os.tmpdir(), `flow-dl-${Date.now()}`)
    fs.mkdirSync(tempDir, { recursive: true })
    console.log('[Flow DOMDownload] Download dir:', tempDir)

    try {
      await flowView.webContents.debugger.sendCommand('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: tempDir
      })
      console.log('[Flow DOMDownload] CDP Page.setDownloadBehavior set')
    } catch (cdpErr) {
      console.warn('[Flow DOMDownload] CDP setDownloadBehavior failed:', cdpErr.message, '— trying Browser domain')
      try {
        await flowView.webContents.debugger.sendCommand('Browser.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: tempDir,
          eventsEnabled: true
        })
        console.log('[Flow DOMDownload] CDP Browser.setDownloadBehavior set')
      } catch (cdpErr2) {
        console.warn('[Flow DOMDownload] Browser.setDownloadBehavior also failed:', cdpErr2.message)
      }
    }

    // Step 2: DOM 자동화 — AutoFlow downloadVideoAtResolution 패턴
    const domResult = await flowView.webContents.executeJavaScript(`
      (async function() {
        const LOG = (msg) => console.log('[DOMDownload] ' + msg)
        const mediaId = ${JSON.stringify(mediaId)}
        const resolution = ${JSON.stringify(resolution)}

        // --- Helper: pointerClick (Radix UI 호환) ---
        function pointerClick(el) {
          if (!el) return
          const rect = el.getBoundingClientRect()
          const x = rect.left + rect.width / 2
          const y = rect.top + rect.height / 2
          const pOpts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true }
          el.dispatchEvent(new PointerEvent('pointerdown', pOpts))
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
          el.dispatchEvent(new PointerEvent('pointerup', pOpts))
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
        }

        // --- Helper: waitForMenu ---
        async function waitForMenu(ms = 2000) {
          const t0 = Date.now()
          while (Date.now() - t0 < ms) {
            const m = document.querySelector("[data-radix-menu-content][data-state='open'], [role='menu'][data-state='open']")
            if (m) return m
            await new Promise(r => setTimeout(r, 80))
          }
          return null
        }

        // --- Helper: closeMenus ---
        async function closeMenus() {
          for (let i = 0; i < 3; i++) {
            if (!document.querySelector("[data-radix-menu-content][data-state='open'], [role='menu'][data-state='open']")) break
            document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true }))
            await new Promise(r => setTimeout(r, 150))
          }
        }

        // --- Helper: ICON_SEL ---
        const ICON_SEL = "i, .material-symbols, .material-symbols-outlined, .google-symbols, [class*='material-symbols']"

        // --- Helper: findVideoElement ---
        function findVideoElement(uuid) {
          if (!uuid) return null
          for (const el of document.querySelectorAll('video[src], video source[src]')) {
            const src = el.getAttribute('src') || ''
            const resolved = el.src || ''
            if (uuid && (src.includes(uuid) || resolved.includes(uuid))) {
              return el.tagName === 'SOURCE' ? el.closest('video') : el
            }
          }
          // fallback: 가장 최근 비디오 (마지막 <video>)
          const allVideos = document.querySelectorAll('video[src]')
          if (allVideos.length > 0) {
            LOG('UUID match failed, using last video element as fallback')
            return allVideos[allVideos.length - 1]
          }
          return null
        }

        // --- Helper: findTileWithOverlay ---
        function findTileWithOverlay(mediaEl) {
          if (!mediaEl) return null
          let node = mediaEl.parentElement
          for (let i = 0; i < 10 && node; i++) {
            if (Array.from(node.querySelectorAll(ICON_SEL)).some(icon => {
              const t = (icon.textContent || '').trim().toLowerCase()
              return t === 'more_vert' || t === 'more_horiz'
            })) return node
            node = node.parentElement
          }
          return null
        }

        // --- Helper: findThreeDots ---
        function findThreeDots(scope) {
          if (!scope) return null
          for (const icon of scope.querySelectorAll(ICON_SEL)) {
            const t = (icon.textContent || '').trim().toLowerCase()
            if (t === 'more_vert' || t === 'more_horiz')
              return icon.closest('button') || icon.parentElement
          }
          return null
        }

        // --- Helper: findMenuItem ---
        function findMenuItem(menu, iconText) {
          if (!menu) return null
          const needle = iconText.toLowerCase()
          for (const item of menu.querySelectorAll("[role='menuitem']")) {
            for (const icon of item.querySelectorAll(ICON_SEL))
              if ((icon.textContent || '').trim().toLowerCase() === needle) return item
            if ((item.textContent || '').trim().toLowerCase().startsWith(needle)) return item
          }
          return null
        }

        // --- Helper: unhover ---
        function unhover(el) {
          if (!el) return
          el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
          el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
          let node = el.parentElement
          for (let i = 0; i < 4 && node; i++) {
            node.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
            node.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
            node = node.parentElement
          }
        }

        try {
          // 1. 비디오 요소 찾기
          LOG('Finding video element for: ' + mediaId.substring(0, 30))
          let targetVideo = findVideoElement(mediaId)
          if (!targetVideo) {
            return { success: false, error: 'Video element not found on page' }
          }
          LOG('Found target video element, src: ' + (targetVideo.getAttribute('src') || '').substring(0, 60))

          // 2. Hover — 오버레이 표시
          targetVideo.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
          targetVideo.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
          let hoverNode = targetVideo.parentElement
          for (let i = 0; i < 4 && hoverNode; i++) {
            hoverNode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
            hoverNode.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
            hoverNode = hoverNode.parentElement
          }
          await new Promise(r => setTimeout(r, 500))

          // 3. Tile 찾기 (more_vert 포함)
          const tile = findTileWithOverlay(targetVideo)
          if (!tile) {
            unhover(targetVideo)
            return { success: false, error: 'Overlay tile not found after hover' }
          }

          // 4. Three-dots 버튼 클릭
          const threeDotsBtn = findThreeDots(tile)
          if (!threeDotsBtn) {
            unhover(targetVideo)
            return { success: false, error: 'Three-dots button not found in tile' }
          }
          LOG('Clicking three-dots button')
          pointerClick(threeDotsBtn)
          await new Promise(r => setTimeout(r, 300))

          // 5. 메뉴 대기 (재시도 1회)
          let menu = await waitForMenu(2000)
          if (!menu) {
            pointerClick(threeDotsBtn)
            menu = await waitForMenu(2000)
          }
          if (!menu) {
            unhover(targetVideo)
            return { success: false, error: 'Context menu did not open' }
          }
          LOG('Context menu opened')

          // 6. "download" 메뉴 아이템 찾기 (아이콘 텍스트로 — 언어 독립)
          const downloadItem = findMenuItem(menu, 'download')
          if (!downloadItem) {
            const items = Array.from(menu.querySelectorAll("[role='menuitem']")).map(i => i.textContent?.trim())
            LOG('Download item not found. Items: ' + JSON.stringify(items))
            await closeMenus()
            unhover(targetVideo)
            return { success: false, error: 'Download menu item not found. Items: ' + items.join(', ') }
          }
          LOG('Hovering Download menu item to open submenu')

          // 7. Download 호버 → 서브메뉴 열기
          const dlRect = downloadItem.getBoundingClientRect()
          const dlX = dlRect.left + dlRect.width / 2
          const dlY = dlRect.top + dlRect.height / 2
          const hoverOpts = { bubbles: true, cancelable: true, clientX: dlX, clientY: dlY, pointerId: 1, pointerType: 'mouse', isPrimary: true }

          downloadItem.focus?.()
          downloadItem.setAttribute?.('data-highlighted', '')
          downloadItem.dispatchEvent(new PointerEvent('pointerenter', { ...hoverOpts, composed: true }))
          downloadItem.dispatchEvent(new PointerEvent('pointermove', { ...hoverOpts, composed: true }))
          downloadItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: dlX, clientY: dlY }))
          downloadItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: dlX, clientY: dlY }))
          downloadItem.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: dlX, clientY: dlY }))
          await new Promise(r => setTimeout(r, 400))

          // 8. 서브메뉴 대기 (jitter 포함)
          let submenu = null
          for (let attempt = 0; attempt < 20; attempt++) {
            const openMenus = document.querySelectorAll("[data-radix-menu-content][data-state='open'], [role='menu'][data-state='open']")
            if (openMenus.length >= 2) {
              submenu = openMenus[openMenus.length - 1]
              break
            }
            if (attempt % 3 === 2) {
              const jX = dlX + (attempt % 2 === 0 ? 2 : -2)
              const jY = dlY + (attempt % 2 === 0 ? 1 : -1)
              const jOpts = { ...hoverOpts, clientX: jX, clientY: jY }
              downloadItem.dispatchEvent(new PointerEvent('pointermove', { ...jOpts, composed: true }))
              downloadItem.dispatchEvent(new PointerEvent('pointerenter', { ...jOpts, composed: true }))
              downloadItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: jX, clientY: jY }))
              downloadItem.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: jX, clientY: jY }))
            }
            await new Promise(r => setTimeout(r, 200))
          }

          // 9. 해상도 선택
          const resMap = { '270p': '270p', '720p': '720p', '1080p': '1080p', '4k': '4K' }
          const targetRes = resMap[String(resolution).toLowerCase()] || '720p'

          if (submenu) {
            LOG('Submenu opened! Looking for resolution: ' + targetRes)
            const submenuItems = Array.from(submenu.querySelectorAll("[role='menuitem']"))
            LOG('Submenu items: ' + submenuItems.map(i => i.textContent?.trim()).join(', '))
            let resOption = null
            for (const item of submenuItems) {
              if ((item.textContent || '').trim().includes(targetRes)) {
                resOption = item
                break
              }
            }
            if (resOption) {
              pointerClick(resOption)
              LOG('✅ Clicked resolution: ' + targetRes)
              await closeMenus()
              unhover(targetVideo)
              return { success: true, resolution: targetRes }
            }
          }

          // 10. 서브메뉴 안 열리면 click + keyboard fallback
          if (!submenu) {
            LOG('Submenu did not open, trying click + keyboard fallback')
            pointerClick(downloadItem)
            await new Promise(r => setTimeout(r, 400))
            downloadItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
            await new Promise(r => setTimeout(r, 400))

            for (const item of document.querySelectorAll("[role='menuitem']")) {
              if ((item.textContent || '').trim().includes(targetRes)) {
                pointerClick(item)
                LOG('✅ Clicked resolution (keyboard fallback): ' + targetRes)
                await closeMenus()
                unhover(targetVideo)
                return { success: true, resolution: targetRes }
              }
            }
          }

          // 11. 해상도 옵션 없으면 직접 다운로드 클릭 (서브메뉴 없는 경우)
          LOG('No resolution submenu, clicking download directly')
          pointerClick(downloadItem)
          await closeMenus()
          unhover(targetVideo)
          return { success: true, resolution: 'default' }

        } catch (e) {
          try { await closeMenus() } catch {}
          return { success: false, error: e.message }
        }
      })()
    `)

    console.log('[Flow DOMDownload] DOM automation result:', JSON.stringify(domResult))

    if (!domResult.success) {
      // 다운로드 디렉토리 정리
      try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
      return { success: false, error: `DOM: ${domResult.error}` }
    }

    // Step 3: temp 디렉토리에서 다운로드 파일 대기 (폴링)
    console.log('[Flow DOMDownload] Waiting for download file in:', tempDir)
    let downloadedFile = null
    const maxWait = 120000 // 2분 (업스케일에 시간 걸릴 수 있음)
    const pollInterval = 1000
    const startTime = Date.now()

    while (Date.now() - startTime < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval))

      try {
        const files = fs.readdirSync(tempDir)
          .filter(f => !f.endsWith('.crdownload') && !f.endsWith('.tmp') && !f.startsWith('.'))

        if (files.length > 0) {
          const filePath = path.join(tempDir, files[0])
          const stats = fs.statSync(filePath)

          // 파일 크기가 변하지 않으면 완료 (1초 대기 후 재확인)
          await new Promise(r => setTimeout(r, 1000))
          const stats2 = fs.statSync(filePath)

          if (stats.size === stats2.size && stats.size > 0) {
            downloadedFile = filePath
            console.log('[Flow DOMDownload] File ready:', files[0], 'size:', stats.size)
            break
          }
        }
      } catch (pollErr) {
        // 디렉토리 아직 비어있음 — 계속 대기
      }
    }

    // CDP 다운로드 설정 해제
    try {
      await flowView.webContents.debugger.sendCommand('Page.setDownloadBehavior', {
        behavior: 'default'
      })
    } catch {}

    // "닫기" 버튼 클릭 — 업스케일링 완료 토스트 닫기
    try {
      await flowView.webContents.executeJavaScript(`
        (function() {
          // 토스트/스낵바에서 "닫기" 또는 "Close" 버튼 찾기
          const buttons = Array.from(document.querySelectorAll('button'))
          for (const btn of buttons) {
            const text = (btn.textContent || '').trim()
            if (text === '닫기' || text === 'Close' || text === '닫 기') {
              console.log('[DOMDownload] Clicking close button: ' + text)
              btn.click()
              break
            }
          }
        })()
      `)
      console.log('[Flow DOMDownload] Dismissed upscale toast')
    } catch (dismissErr) {
      console.warn('[Flow DOMDownload] Toast dismiss failed (non-critical):', dismissErr.message)
    }

    if (!downloadedFile) {
      // 디렉토리 정리
      try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
      return { success: false, error: 'Download timeout — no file appeared in temp dir' }
    }

    // Step 4: 파일 읽기 → base64
    try {
      const data = fs.readFileSync(downloadedFile)
      const ext = path.extname(downloadedFile).toLowerCase()
      const mimeType = ext === '.webm' ? 'video/webm' : 'video/mp4'
      const base64 = `data:${mimeType};base64,${data.toString('base64')}`
      console.log('[Flow DOMDownload] ✅ Success! size:', data.length, 'type:', mimeType)

      // 정리
      try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}

      return { success: true, base64 }
    } catch (readErr) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
      return { success: false, error: `File read error: ${readErr.message}` }
    }

  } catch (e) {
    console.error('[Flow DOMDownload] Error:', e.message)
    return { success: false, error: e.message }
  }
})

// Upload image to Flow
ipcMain.handle('flow:upload-reference', async (event, { token, base64, projectId }) => {
  if (!token) return { success: false, error: 'No token' }

  // projectId가 없으면 flowView URL에서 추출 시도
  let resolvedProjectId = projectId || ''
  if (!resolvedProjectId && flowView) {
    try {
      const flowUrl = flowView.webContents.getURL()
      const match = flowUrl.match(/\/project\/([a-f0-9-]+)/)
      if (match) resolvedProjectId = match[1]
    } catch (e) { /* ignore */ }
  }

  try {
    // AutoFlow 10.7.58 형식 (sidepanel.js:44951)
    const body = {
      clientContext: {
        projectId: resolvedProjectId,
        tool: 'PINHOLE'
      },
      imageBytes: base64,
      isUserUploaded: true,
      isHidden: false,
      mimeType: 'image/png',
      fileName: 'ref_image.png'
    }

    console.log('[Flow API] upload-reference: sending to', UPLOAD_URL, 'projectId:', resolvedProjectId?.substring(0, 12), 'base64Len:', base64?.length)

    const response = await sessionFetch(UPLOAD_URL, {
      method: 'POST',
      headers: { ...API_HEADERS, 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.error('[Flow API] upload-reference HTTP', response.status, errText.substring(0, 500))
      return { success: false, error: `Upload HTTP ${response.status}` }
    }

    const text = await response.text()
    const data = parseFlowResponse(text)

    // 응답 구조: { media: { name: "uuid" }, workflow: { ... } }
    const mediaId = data?.media?.name || data?.mediaGenerationId || data?.name || null
    const caption = data?.media?.caption || data?.caption || data?.description || null

    console.log('[Flow API] upload-reference result:', { mediaId: mediaId?.substring(0, 36), caption: caption?.substring(0, 30), dataKeys: data ? Object.keys(data) : [] })

    if (mediaId) {
      return { success: true, mediaId, caption }
    }

    console.warn('[Flow API] upload-reference: No mediaId in response, data:', JSON.stringify(data)?.substring(0, 500))
    return { success: false, error: 'No media ID returned' }
  } catch (e) {
    console.error('[Flow API] upload-reference error:', e.message)
    return { success: false, error: e.message }
  }
})

// Validate token and get expiry
ipcMain.handle('flow:validate-token', async (event, { token }) => {
  try {
    const response = await sessionFetch(`${TOKEN_INFO_URL}?access_token=${token}`)
    if (response.ok) {
      const data = await response.json()
      return { valid: true, expiry: parseInt(data.exp) * 1000 }
    }
    return { valid: false, expiry: null }
  } catch (e) {
    return { valid: false, expiry: null }
  }
})

// === Video Generation IPC Handlers (DOM 자동화 — 이미지와 동일한 접근법) ===
// Flow 페이지가 자체적으로 reCAPTCHA를 처리하므로 DOM 자동화가 가장 안정적

/**
 * 비디오 응답에서 generation ID (UUID) 추출 헬퍼
 */
function extractVideoGenerationId(data) {
  const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '').trim())
  // media[].name (video entries)
  if (Array.isArray(data?.media)) {
    for (const m of data.media) {
      if ((m?.video || /video/i.test(String(m?.mediaMetadata?.mediaType || ''))) && isUuid(m?.name)) {
        return m.name
      }
    }
  }
  // workflows[].metadata.primaryMediaId
  if (Array.isArray(data?.workflows)) {
    for (const w of data.workflows) {
      if (isUuid(w?.metadata?.primaryMediaId)) return w.metadata.primaryMediaId
    }
  }
  // Legacy fallbacks
  return data?.asyncVideoGenerationOperations?.[0]?.operationId
    || data?.responses?.[0]?.generationId
    || null
}

/**
 * Flow 페이지를 비디오 모드로 전환
 * AutoFlow와 동일한 CSS selector 사용 (로케일 무관):
 *   - SETTINGS_BUTTON:  button[aria-haspopup='menu']:has(div[data-type='button-overlay'])
 *   - MODE_VIDEO:       button[role='tab'][id*='-trigger-VIDEO']
 *   - SETTINGS_MENU:    [role='menu'][data-state='open']
 */
async function configureFlowMode(targetMode = 'VIDEO', batchCount = 1) {
  if (!flowView) return { success: false, error: 'No flowView' }

  // AutoFlow 동일 CSS selectors (텍스트 비교 없음 — 모든 로케일에서 동작)
  const modeKey = targetMode === 'IMAGE' ? 'IMAGE' : 'VIDEO'
  const SEL = {
    SETTINGS_BTN: "button[aria-haspopup='menu']:has(div[data-type='button-overlay'])",
    MODE_TAB: `button[role='tab'][id*='-trigger-${modeKey}']:not([id*='FRAMES']):not([id*='REFERENCES'])`,
    SETTINGS_MENU: "[role='menu'][data-state='open'], [data-radix-menu-content][data-state='open'], [role='menu']",
  }
  const batchLabel = `x${Math.max(1, Math.min(4, batchCount))}`

  const maxAttempts = 5
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await flowView.webContents.executeJavaScript(`
        (async function() {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          const isVisible = (el) => {
            if (!el || !el.isConnected) return false;
            const r = el.getBoundingClientRect?.();
            return !!r && r.width > 2 && r.height > 2;
          };
          const escapeMenu = () => {
            try { document.body.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true
            })); } catch {}
          };
          // AutoFlow afHumanClick 동일: 전체 이벤트 시퀀스 (Radix UI는 pointerdown+mousedown 필요)
          const humanClick = (el) => {
            if (!el) return false;
            try {
              const rect = el.getBoundingClientRect();
              const x = rect.left + Math.max(6, Math.min(rect.width - 6, rect.width * 0.5));
              const y = rect.top + Math.max(6, Math.min(rect.height - 6, rect.height * 0.5));
              const common = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
              try {
                el.dispatchEvent(new PointerEvent('pointerover', common));
                el.dispatchEvent(new PointerEvent('pointermove', common));
                const pDown = new PointerEvent('pointerdown', common);
                el.dispatchEvent(pDown);
              } catch {}
              el.dispatchEvent(new MouseEvent('mouseover', common));
              el.dispatchEvent(new MouseEvent('mousemove', common));
              el.dispatchEvent(new MouseEvent('mousedown', common));
              el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
              try { el.dispatchEvent(new PointerEvent('pointerup', common)); } catch {}
              el.dispatchEvent(new MouseEvent('mouseup', common));
              el.dispatchEvent(new MouseEvent('click', common));
              return true;
            } catch { try { el.click(); return true; } catch { return false; } }
          };

          // Step 0: 열려있는 메뉴 닫기
          if (document.querySelector("[role='menu']")) { escapeMenu(); await sleep(200); }

          // Step 1: 세팅 드롭다운 버튼 찾기 (AutoFlow SETTINGS_BUTTON_SELECTOR 동일)
          const settingsBtns = Array.from(document.querySelectorAll("${SEL.SETTINGS_BTN}")).filter(isVisible);
          if (!settingsBtns.length) {
            return { ok: false, error: 'settings_btn_not_found' };
          }

          // 여러 개면 프롬프트 에디터에 가장 가까운 것 선택
          const compose = document.querySelector("[data-slate-editor='true']");
          let settingsBtn = settingsBtns[0];
          if (settingsBtns.length > 1 && compose) {
            const cr = compose.getBoundingClientRect();
            settingsBtn = settingsBtns.reduce((best, btn) => {
              const r = btn.getBoundingClientRect();
              const d = Math.hypot(r.left - cr.left, r.top - cr.bottom);
              const bd = Math.hypot(best.getBoundingClientRect().left - cr.left, best.getBoundingClientRect().top - cr.bottom);
              return d < bd ? btn : best;
            });
          }

          // Step 2: 드롭다운 클릭 → 메뉴 대기
          humanClick(settingsBtn);
          let menu = null;
          for (let i = 0; i < 20; i++) {
            await sleep(80);
            const allMenus = Array.from(document.querySelectorAll("[role='menu']"))
              .filter(m => { const r = m.getBoundingClientRect?.(); return r && r.width > 12 && r.height > 12; });
            menu = allMenus.find(m => m.querySelectorAll("[role='tab']").length >= 2) || null;
            if (menu) break;
            if (i >= 15 && allMenus.length > 0) { menu = allMenus[0]; break; }
          }
          if (!menu) {
            escapeMenu();
            return { ok: false, error: 'menu_not_opened' };
          }

          // Step 3: 모드 탭 찾기 + 필요하면 클릭
          let modeTab = menu.querySelector("${SEL.MODE_TAB}") || document.querySelector("${SEL.MODE_TAB}");
          let modeMethod = 'already_active';
          if (modeTab && isVisible(modeTab)) {
            const isActive = modeTab.getAttribute('aria-selected') === 'true'
              || modeTab.getAttribute('data-state') === 'active';
            if (!isActive) {
              humanClick(modeTab);
              await sleep(300);
              modeMethod = 'switched';
            }
          } else {
            escapeMenu(); await sleep(150);
            return { ok: false, error: 'mode_tab_not_found', target: '${modeKey}' };
          }

          // Step 4: 배치 개수 선택 (x1, x2, x3, x4 — 로케일 무관)
          const targetBatch = '${batchLabel}';
          let batchMethod = 'not_found';
          // 메뉴 안의 모든 버튼에서 textContent로 xN 매칭
          const allBtns = Array.from(menu.querySelectorAll('button')).filter(isVisible);
          const batchBtn = allBtns.find(btn => {
            const txt = btn.textContent.trim();
            return txt === targetBatch;
          });
          if (batchBtn) {
            const isActive = batchBtn.getAttribute('data-state') === 'active'
              || batchBtn.getAttribute('data-state') === 'on'
              || batchBtn.getAttribute('aria-selected') === 'true'
              || batchBtn.getAttribute('aria-pressed') === 'true'
              || batchBtn.classList.contains('active');
            if (isActive) {
              batchMethod = 'already_set';
            } else {
              humanClick(batchBtn);
              await sleep(200);
              batchMethod = 'clicked';
            }
          }

          // Step 5: 메뉴 닫기
          if (document.querySelector("[role='menu']")) { escapeMenu(); await sleep(200); }

          return { ok: true, method: modeMethod, batch: batchMethod, tabId: modeTab?.id };
        })()
      `)

      if (result?.ok) {
        console.log(`[Flow Mode] Configured: mode=${targetMode}, batch=${batchLabel}`, result.method, result.batch, result.tabId || '')
        await new Promise(r => setTimeout(r, 500)) // UI 전환 안정화 대기
        return { success: true, method: result.method, batch: result.batch }
      }

      console.warn(`[Flow Mode] Attempt ${attempt + 1}/${maxAttempts} failed:`, result?.error)

      // 마지막 시도에서 실패하면 진단 저장
      if (attempt === maxAttempts - 1) {
        try {
          const fs = await import('node:fs')
          fs.writeFileSync('/tmp/flow-video-dom-diag.json', JSON.stringify(result, null, 2))
          console.log('[Flow Video] Last failure saved to /tmp/flow-video-dom-diag.json')
        } catch {}
      }

      await new Promise(r => setTimeout(r, 400 + attempt * 200))
    } catch (e) {
      console.warn(`[Flow Video] Attempt ${attempt + 1} error:`, e.message)
      await new Promise(r => setTimeout(r, 400))
    }
  }

  return { success: false, error: `Mode ${targetMode} not set after ${maxAttempts} attempts` }
}

// 하위 호환 래퍼
async function switchFlowToVideoMode() {
  return configureFlowMode('VIDEO', 1)
}

// Text-to-Video generation (DOM 자동화 — 페이지가 reCAPTCHA 자체 처리)
ipcMain.handle('flow:generate-video-t2v', async (event, {
  token, prompt, projectId, model, aspectRatio, duration
}) => {
  if (!prompt) return { success: false, error: 'No prompt' }
  if (!flowView) return { success: false, error: 'Flow view not ready' }

  console.log('[Flow Video T2V] Starting DOM-triggered video generation:', prompt?.substring(0, 50))

  try {
    // 0. Flow 프로젝트 페이지 확인
    const currentUrl = flowView.webContents.getURL()
    if (!currentUrl.includes('/project/') && !currentUrl.includes('/tools/flow/')) {
      return { success: false, error: 'Not on Flow project page. Please open a Flow project first.' }
    }

    // 1. 비디오 모드로 전환
    const modeResult = await switchFlowToVideoMode()
    if (!modeResult.success) {
      return { success: false, error: modeResult.error || 'Failed to switch to video mode' }
    }
    console.log('[Flow Video T2V] Video mode active:', modeResult.method)

    // 2. 프롬프트 입력 (이미지와 동일한 Slate 에디터 사용)
    const promptBounds = flowView.getBounds()
    const promptWasHidden = (promptBounds.width === 0 || promptBounds.height === 0)
    if (promptWasHidden) {
      const { width, height } = mainWindow.getContentBounds()
      flowView.setBounds({ x: width + 5000, y: 0, width, height })
      await new Promise(r => setTimeout(r, 300))
    }

    const promptResult = await flowView.webContents.executeJavaScript(`
      (async function() {
        const promptText = ${JSON.stringify(prompt)};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        // Slate editor 찾기
        let editor = document.querySelector("[data-slate-editor='true']");
        if (!editor) editor = document.querySelector("div[role='textbox'][contenteditable='true']:not(#af-bot-panel *)");
        if (!editor) editor = document.querySelector('[contenteditable="true"]:not([aria-hidden])');

        if (!editor) return { success: false, error: 'Editor not found' };

        const isSlate = !!(editor.matches?.("[data-slate-editor='true']") || editor.querySelector?.("[data-slate-node]"));

        // Slate React API로 프롬프트 주입
        let injected = false;
        if (isSlate) {
          try {
            const reactKeys = Object.keys(editor).filter(k => k.startsWith('__react'));
            let slateEditor = null;
            for (const key of reactKeys) {
              const stack = [editor[key]];
              const visited = new Set();
              let guard = 0;
              while (stack.length > 0 && guard < 5000) {
                const node = stack.pop(); guard++;
                if (!node || typeof node !== 'object' || visited.has(node)) continue;
                visited.add(node);
                const candidate = node?.memoizedProps?.node || node?.memoizedProps?.editor
                  || node?.pendingProps?.node || node?.pendingProps?.editor
                  || node?.stateNode?.editor || node?.editor;
                if (candidate && typeof candidate.apply === 'function') { slateEditor = candidate; break; }
                if (node.child) stack.push(node.child);
                if (node.sibling) stack.push(node.sibling);
                if (node.return) stack.push(node.return);
                if (node.alternate) stack.push(node.alternate);
              }
              if (slateEditor) break;
            }
            if (slateEditor) {
              try {
                const existingText = slateEditor.children?.[0]?.children?.[0]?.text || '';
                if (existingText) slateEditor.apply({ type: 'remove_text', path: [0, 0], offset: 0, text: existingText });
              } catch {}
              slateEditor.apply({ type: 'insert_text', path: [0, 0], offset: 0, text: promptText });
              if (typeof slateEditor.onChange === 'function') slateEditor.onChange();
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(200);
              const modelText = (slateEditor.children?.[0]?.children?.[0]?.text || '').trim();
              if (modelText && modelText.includes(promptText.slice(0, 40))) injected = true;
            }
          } catch {}
        }

        // Fallback: execCommand
        if (!injected) {
          try {
            editor.focus(); editor.click(); await sleep(100);
            if (isSlate) {
              const sel = window.getSelection(); const range = document.createRange();
              const stringNodes = Array.from(editor.querySelectorAll('[data-slate-string]'))
                .map(n => n.firstChild).filter(n => n && n.nodeType === Node.TEXT_NODE);
              if (stringNodes.length > 0) {
                range.setStart(stringNodes[0], 0);
                const last = stringNodes[stringNodes.length - 1];
                range.setEnd(last, (last.textContent || '').length);
              } else {
                const zeroNode = Array.from(editor.querySelectorAll('[data-slate-zero-width]'))
                  .map(n => n.firstChild).find(n => n && n.nodeType === Node.TEXT_NODE);
                if (zeroNode) { range.setStart(zeroNode, 0); range.setEnd(zeroNode, (zeroNode.textContent || '').length); }
                else range.selectNodeContents(editor);
              }
              sel.removeAllRanges(); sel.addRange(range);
            } else {
              document.execCommand('selectAll', false, null);
            }
            document.execCommand('delete', false, null); await sleep(50);
            try { editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: promptText })); } catch {}
            const inserted = document.execCommand('insertText', false, promptText);
            if (inserted) { injected = true; }
          } catch {}
        }

        if (!injected) return { success: false, error: 'Prompt injection failed' };
        await sleep(500);
        return { success: true };
      })()
    `)

    if (promptWasHidden) {
      flowView.setBounds(promptBounds)
      await new Promise(r => setTimeout(r, 200))
    }

    if (!promptResult?.success) {
      return { success: false, error: promptResult?.error || 'Prompt injection failed' }
    }
    console.log('[Flow Video T2V] Prompt injected successfully')

    // 3. CDP 비디오 응답 캡처 Promise 설정
    let resolveVideo = null
    let videoTimeout = null
    const videoResponsePromise = new Promise((resolve) => {
      videoTimeout = setTimeout(() => {
        if (pendingVideoGeneration) {
          pendingVideoGeneration = null
          resolve({ error: true, message: 'Video response timeout (30s)' })
        }
      }, 30000) // 비디오 제출은 이미지보다 빠름 (초기 응답만 캡처)
      resolveVideo = resolve
    })

    // 4. Generate 버튼 Trusted Click
    const generateBtnSelector = `(function() {
      try {
        const xr = document.evaluate("//button[.//i[text()='arrow_forward']]",
          document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (xr.singleNodeValue && !xr.singleNodeValue.disabled) return xr.singleNodeValue;
      } catch {}
      for (const b of document.querySelectorAll('button')) {
        for (const icon of b.querySelectorAll('i')) {
          if (icon.textContent.trim() === 'arrow_forward' && !b.disabled) return b;
        }
      }
      return null;
    })()`

    const clickResult = await trustedClickOnFlowView(generateBtnSelector)
    console.log('[Flow Video T2V] Trusted click result:', clickResult)

    if (!clickResult?.success) {
      clearTimeout(videoTimeout)
      return { success: false, error: clickResult?.error || 'Failed to click Generate button' }
    }

    // ★ 클릭 직후 pendingVideoGeneration 설정
    const videoSetAt = Date.now() / 1000 - 2
    pendingVideoGeneration = {
      setAt: videoSetAt,
      resolve: (result) => {
        clearTimeout(videoTimeout)
        resolveVideo(result)
      }
    }
    console.log('[Flow Video T2V] pendingVideoGeneration set, waiting for CDP capture...')

    // 5. 비디오 API 응답 대기
    const netResult = await videoResponsePromise

    if (netResult.error) {
      console.warn('[Flow Video T2V] Video API failed:', netResult.message || `HTTP ${netResult.status}`)
      return { success: false, error: netResult.message || `HTTP ${netResult.status}: Video generation failed` }
    }

    // 6. 응답에서 generation ID 추출
    const data = parseFlowResponse(netResult.body)
    const generationId = extractVideoGenerationId(data)

    if (generationId) {
      console.log('[Flow Video T2V] Generation ID:', generationId)
      return { success: true, generationId }
    }

    return { success: false, error: `No generation ID. Response keys: ${Object.keys(data || {}).join(',')}` }
  } catch (e) {
    console.error('[Flow Video T2V] Error:', e.message)
    return { success: false, error: e.message }
  }
})

// Image-to-Video generation (DOM 자동화)
// I2V는 비디오 모드에서 시작 이미지가 필요하므로, 직접 API 호출을 페이지 컨텍스트에서 실행
// (Flow 페이지 UI에서 이미지 업로드 + I2V 모드 전환이 복잡하므로 인젝션 방식 사용)
ipcMain.handle('flow:generate-video-i2v', async (event, {
  token, prompt, startImageMediaId, projectId, model, aspectRatio, duration
}) => {
  if (!token) return { success: false, error: 'No token' }
  if (!startImageMediaId) return { success: false, error: 'No start image mediaId' }
  if (!flowView) return { success: false, error: 'Flow view not ready' }

  console.log('[Flow Video I2V] Starting page-context video generation, mediaId:', startImageMediaId?.substring(0, 8))

  // I2V model
  const apiModelKey = String(model || '').toLowerCase().includes('quality')
    ? 'veo_3_1_i2v_quality_ultra_relaxed'
    : 'veo_3_1_i2v_s_fast_ultra_relaxed'

  const batchId = randomUUID()
  const pid = projectId || capturedProjectId || ''
  const apiAspect = aspectRatio || 'VIDEO_ASPECT_RATIO_LANDSCAPE'

  // I2V는 AutoFlow와 동일하게 페이지 컨텍스트에서 직접 fetch 실행
  // credentials: "include"와 mode: "cors" 포함 (AutoFlow I2V 패턴)
  // 페이지가 reCAPTCHA를 자체적으로 로드하므로 grecaptcha.enterprise.execute가 유효
  try {
    const result = await flowView.webContents.executeJavaScript(`
      (async function() {
        try {
          // 1. reCAPTCHA 토큰 획득 (페이지 컨텍스트 — origin 일치)
          let recaptchaToken = '';
          try {
            const g = window.grecaptcha;
            if (g?.enterprise?.execute) {
              recaptchaToken = String(await g.enterprise.execute(
                '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV',
                { action: 'generate' }
              ) || '').trim();
            }
          } catch {}

          // 2. 액세스 토큰 획득 (세션 API에서)
          let accessToken = ${JSON.stringify(token)};
          if (!accessToken) {
            try {
              const sessResp = await fetch('${SESSION_URL}');
              if (sessResp.ok) {
                const sessText = await sessResp.text();
                const sessData = JSON.parse(sessText.replace(/^\\)\\]\\}',?\\s*/, '').trim());
                accessToken = sessData?.access_token || sessData?.accessToken || '';
              }
            } catch {}
          }
          if (!accessToken) return { ok: false, error: 'no_access_token' };

          // 3. API 요청 본문
          const body = {
            mediaGenerationContext: { batchId: ${JSON.stringify(batchId)} },
            clientContext: {
              projectId: ${JSON.stringify(pid)},
              tool: 'PINHOLE',
              userPaygateTier: 'PAYGATE_TIER_TWO',
              sessionId: ';' + Date.now(),
              ...(recaptchaToken ? {
                recaptchaContext: {
                  token: recaptchaToken,
                  applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB'
                }
              } : {})
            },
            requests: [{
              aspectRatio: ${JSON.stringify(apiAspect)},
              seed: Math.floor(Math.random() * 2147483647),
              textInput: { structuredPrompt: { parts: [{ text: ${JSON.stringify(prompt || '')} }] } },
              videoModelKey: ${JSON.stringify(apiModelKey)},
              metadata: {},
              startImage: { mediaId: ${JSON.stringify(startImageMediaId)} }
            }],
            useV2ModelConfig: true
          };

          // 4. fetch 실행 (페이지 컨텍스트 — credentials: include로 쿠키 포함)
          const resp = await fetch('${VIDEO_I2V_URL}', {
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
            headers: { authorization: 'Bearer ' + accessToken },
            body: JSON.stringify(body)
          });
          const text = await resp.text().catch(() => '');
          return { ok: resp.ok, status: resp.status, text };
        } catch (e) {
          return { ok: false, status: 0, error: e.message };
        }
      })()
    `)

    if (!result.ok) {
      console.error('[Flow Video I2V] HTTP', result.status, (result.text || result.error || '').substring(0, 200))
      return { success: false, error: `HTTP ${result.status}: ${(result.text || result.error || '').substring(0, 200)}` }
    }

    const data = parseFlowResponse(result.text)
    const generationId = extractVideoGenerationId(data)

    if (generationId) {
      console.log('[Flow Video I2V] Generation ID:', generationId)
      return { success: true, generationId }
    }

    return { success: false, error: `No generation ID. Response keys: ${Object.keys(data || {}).join(',')}` }
  } catch (e) {
    console.error('[Flow Video I2V] Error:', e.message)
    return { success: false, error: e.message }
  }
})

// Check video generation status (페이지 컨텍스트에서 실행 — origin 일치)
ipcMain.handle('flow:check-video-status', async (event, { token, generationIds, projectId }) => {
  if (!token) return { success: false, error: 'No token' }
  if (!flowView) return { success: false, error: 'Flow view not ready' }

  const pid = projectId || capturedProjectId || ''

  try {
    // 페이지 컨텍스트에서 fetch 실행 (AutoFlow 동일 바디 구조)
    // AutoFlow: { media: [{ name: "<genId>", projectId: "<pid>" }] }
    const result = await flowView.webContents.executeJavaScript(`
      (async function() {
        try {
          const ids = ${JSON.stringify(generationIds)};
          const pid = ${JSON.stringify(pid)};
          const media = ids.map(name => pid ? { name, projectId: pid } : { name });
          const body = { media };
          const resp = await fetch('${VIDEO_STATUS_URL}', {
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
            headers: { authorization: 'Bearer ' + ${JSON.stringify(token)} },
            body: JSON.stringify(body)
          });
          const text = await resp.text().catch(() => '');
          return { ok: resp.ok, status: resp.status, text };
        } catch (e) {
          return { ok: false, status: 0, text: e.message };
        }
      })()
    `)

    console.log('[Flow VideoStatus] HTTP', result.status, 'body length:', result.text?.length || 0)

    if (!result.ok) {
      console.warn('[Flow VideoStatus] Error:', result.text?.substring(0, 300))
      return { success: false, error: `HTTP ${result.status}: ${(result.text || '').substring(0, 200)}` }
    }

    const data = parseFlowResponse(result.text)
    console.log('[Flow VideoStatus] Parsed keys:', data ? Object.keys(data).join(',') : 'null')

    // AutoFlow 형식: media[].mediaMetadata.mediaStatus.mediaGenerationStatus
    const statuses = []

    // 방법 1: media[] 배열 (최신 API 응답 형식)
    if (Array.isArray(data?.media)) {
      for (const m of data.media) {
        const genStatus = m?.mediaMetadata?.mediaStatus?.mediaGenerationStatus || ''
        const mediaId = m?.name
        console.log('[Flow VideoStatus] media status:', genStatus, 'mediaId:', mediaId?.substring(0, 30))
        if (genStatus === 'MEDIA_GENERATION_STATUS_SUCCESSFUL') {
          // 전체 media 객체 구조 디버깅
          const findUrls = (obj, path = '') => {
            if (!obj || typeof obj !== 'object') return []
            const urls = []
            for (const [k, v] of Object.entries(obj)) {
              if (typeof v === 'string' && (v.startsWith('http') || v.includes('googleapis') || v.includes('google'))) {
                urls.push({ path: path + '.' + k, url: v.substring(0, 150) })
              } else if (typeof v === 'object' && v !== null) {
                urls.push(...findUrls(v, path + '.' + k))
              }
            }
            return urls
          }
          const allUrls = findUrls(m, 'media')
          console.log('[Flow VideoStatus] ✅ URLs in response:', JSON.stringify(allUrls))
          console.log('[Flow VideoStatus] ✅ mediaMetadata keys:', JSON.stringify(Object.keys(m?.mediaMetadata || {})))

          // AutoFlow: 비디오 URL은 status 응답에서 직접 추출
          const meta = m?.mediaMetadata
          const videoUrl = meta?.videoData?.generatedVideo?.fifeUri
            || meta?.videoData?.generatedVideo?.url
            || meta?.videoData?.fifeUri
            || meta?.videoData?.url
            || meta?.imageData?.fifeUri
            || meta?.imageData?.url
            || m?.mediaData?.url
            || m?.generatedMedia?.url
            || m?.thumbnailUrl
            || m?.url
            || null
          console.log('[Flow VideoStatus] ✅ Complete! videoUrl:', videoUrl?.substring(0, 80))
          statuses.push({ status: 'complete', mediaId, videoUrl })
        } else if (genStatus.includes('FAILED') || genStatus.includes('ERROR')) {
          statuses.push({ status: 'failed', error: genStatus })
        } else {
          statuses.push({ status: 'pending', progress: null })
        }
      }
    }

    // 방법 2: responses[] / asyncVideoGenerationOperations[] (레거시)
    if (statuses.length === 0) {
      const results = data?.responses || data?.asyncVideoGenerationOperations || []
      console.log('[Flow VideoStatus] Legacy path, results count:', results.length)
      for (const r of results) {
        console.log('[Flow VideoStatus] Response item keys:', Object.keys(r).join(','),
          'done:', r.done, 'status:', r.status, 'state:', r.state)
        const done = r.done || r.status === 'COMPLETE' || r.state === 'COMPLETE'
        const failed = r.error || r.status === 'FAILED' || r.state === 'FAILED'
        const mediaId = r.result?.mediaGenerationId || r.mediaGenerationId || r.name
        const progress = r.progress || r.metadata?.progress

        if (failed) statuses.push({ status: 'failed', error: r.error?.message || 'Generation failed' })
        else if (done && mediaId) statuses.push({ status: 'complete', mediaId })
        else statuses.push({ status: 'pending', progress })
      }
    }

    // 아무 statuses도 못 뽑았으면 raw data 로깅
    if (statuses.length === 0) {
      console.warn('[Flow VideoStatus] No statuses parsed! Raw data (first 500):', JSON.stringify(data)?.substring(0, 500))
    }

    console.log('[Flow VideoStatus] Final statuses:', JSON.stringify(statuses))
    return { success: true, statuses }
  } catch (e) {
    console.error('[Flow VideoStatus] Exception:', e.message)
    return { success: false, error: e.message }
  }
})

// === DOM Mode IPC Handlers ===

// Navigate to Flow base URL and wait for load
ipcMain.handle('flow:dom-navigate', async (event, { url }) => {
  if (!flowView) return { success: false, error: 'Flow view not ready' }
  try {
    await flowView.webContents.loadURL(url || FLOW_URL)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// Get current URL of Flow view
ipcMain.handle('flow:dom-get-url', async () => {
  if (!flowView) return { success: false, error: 'Flow view not ready' }
  return { success: true, url: flowView.webContents.getURL() }
})

// Execute JavaScript in Flow view (generic DOM injection)
ipcMain.handle('flow:dom-execute', async (event, { script }) => {
  if (!flowView) return { success: false, error: 'Flow view not ready' }
  try {
    const result = await flowView.webContents.executeJavaScript(script)
    return { success: true, result }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// Click "Enter tool" button to create new project
ipcMain.handle('flow:dom-click-enter-tool', async (event, { selectors }) => {
  if (!flowView) return { success: false, error: 'Flow view not ready' }

  // 이미 프로젝트가 있으면 스킵
  if (capturedProjectId) {
    console.log('[DOM IPC] Enter tool: already have project, skipping')
    return { success: true, skipped: true }
  }

  try {
    // XPath: add_2 아이콘 (AutoFlow 검증)
    const xpathStr = selectors?.create_project_btn ||
      "//button[.//i[normalize-space(text())='add_2']] | (//button[.//i[normalize-space(.)='add_2']])"

    const btnSelector = `(function() {
      try {
        const xr = document.evaluate(
          ${JSON.stringify(xpathStr)},
          document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        if (xr.singleNodeValue) return xr.singleNodeValue;
      } catch {}
      // fallback: add_2 아이콘으로 직접 찾기
      for (const b of document.querySelectorAll('button')) {
        const icon = b.querySelector('i');
        if (icon && (icon.textContent.trim() === 'add_2' || icon.textContent.trim() === 'add')) return b;
      }
      return null;
    })()`

    const clickResult = await trustedClickOnFlowView(btnSelector)
    if (clickResult.success) {
      enterToolClicked = true
      return { success: true }
    }
    return { success: false, error: 'Enter tool button not found' }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// Set aspect ratio: AutoFlow 역공학 — combobox 드롭다운 방식
// 1) aspect ratio 드롭다운 버튼 클릭 (crop_portrait/crop_landscape 아이콘)
// 2) option 선택 (div[@role='option'])
// 3) Escape로 닫기
ipcMain.handle('flow:dom-set-aspect-ratio', async (event, { aspectRatio }) => {
  if (!flowView) return { success: false, error: 'Flow view not ready' }
  try {
    const isPortrait = aspectRatio === '9:16'
    console.log('[DOM IPC] Setting aspect ratio:', aspectRatio, 'isPortrait:', isPortrait)

    // Step 1: 드롭다운 버튼 찾기 & 클릭
    // AutoFlow: "//button[@role='combobox' and .//i[normalize-space(text())='crop_portrait' or normalize-space(text())='crop_landscape']]"
    const dropdownSelector = `(function() {
      try {
        const xr = document.evaluate(
          "//button[@role='combobox' and .//i[normalize-space(text())='crop_portrait' or normalize-space(text())='crop_landscape']]",
          document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        if (xr.singleNodeValue) return xr.singleNodeValue;
      } catch {}
      return null;
    })()`

    const dropdownClick = await trustedClickOnFlowView(dropdownSelector)
    if (!dropdownClick.success) {
      console.log('[DOM IPC] Aspect ratio dropdown not found, trying tab fallback...')

      // Fallback: CSS tab selector 방식 (새 UI 버전에서 사용)
      const tabSelector = isPortrait
        ? "button[role='tab'][id$='-trigger-PORTRAIT'], button[role='tab'][id*='-trigger-PORTRAIT']"
        : "button[role='tab'][id$='-trigger-LANDSCAPE'], button[role='tab'][id*='-trigger-LANDSCAPE']"

      const tabResult = await flowView.webContents.executeJavaScript(`
        (function() {
          const btn = document.querySelector(${JSON.stringify(tabSelector)});
          if (btn) { btn.click(); return { success: true, method: 'tab_click' }; }
          return { success: false, error: 'Neither dropdown nor tab found' };
        })()
      `)
      return tabResult
    }

    // 드롭다운이 열릴 때까지 대기
    await new Promise(r => setTimeout(r, 500))

    // Step 2: Option 선택
    // AutoFlow: "//div[@role='option' and .//i[normalize-space(text())='crop_landscape']]"
    const optionIcon = isPortrait ? 'crop_portrait' : 'crop_landscape'
    const optionSelector = `(function() {
      try {
        const xr = document.evaluate(
          "//div[@role='option' and .//i[normalize-space(text())='${optionIcon}']]",
          document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        if (xr.singleNodeValue) return xr.singleNodeValue;
      } catch {}
      return null;
    })()`

    const optionClick = await trustedClickOnFlowView(optionSelector)
    if (!optionClick.success) {
      console.log('[DOM IPC] Aspect ratio option not found:', optionIcon)
      // Escape로 드롭다운 닫기
      try {
        await flowView.webContents.executeJavaScript(`
          document.body.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true
          }))
        `)
      } catch {}
      return { success: false, error: 'Aspect ratio option not found' }
    }

    // Step 3: Escape로 드롭다운 닫기
    await new Promise(r => setTimeout(r, 500))
    try {
      await flowView.webContents.executeJavaScript(`
        document.body.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true
        }))
      `)
    } catch {}

    await new Promise(r => setTimeout(r, 500))
    console.log('[DOM IPC] Aspect ratio set:', aspectRatio)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// Send prompt and click generate button
// AutoFlow 분석: Flow는 Slate.js 에디터를 사용 → textContent 설정은 무시됨
// 1순위: React fiber에서 Slate editor 인스턴스 → editor.apply({ type: 'insert_text' })
// 2순위: document.execCommand('insertText') — Slate가 감지하는 표준 DOM API
ipcMain.handle('flow:dom-send-prompt', async (event, { prompt, selectors }) => {
  console.log('[DOM IPC] dom-send-prompt called:', prompt?.substring(0, 40))
  if (!flowView) return { success: false, error: 'Flow view not ready' }

  // document.execCommand 방식이 작동하려면 flowView가 보여야 함 (focus 필요)
  // Slate API (editor.apply)는 숨겨져 있어도 작동하지만 fallback을 위해 일시적으로 보이게
  const currentBounds = flowView.getBounds()
  const wasHidden = (currentBounds.width === 0 || currentBounds.height === 0)
  if (wasHidden) {
    const { width, height } = mainWindow.getContentBounds()
    flowView.setBounds({ x: width + 5000, y: 0, width, height })
    await new Promise(r => setTimeout(r, 300))
    console.log('[DOM IPC] Temporarily showed flowView for prompt injection')
  }

  try {
    // Step 1: 프롬프트 입력 (Slate.js 에디터 — AutoFlow 역공학)
    const promptResult = await flowView.webContents.executeJavaScript(`
      (async function() {
        const promptText = ${JSON.stringify(prompt)};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        // Slate editor 찾기: data-slate-editor='true' 또는 contenteditable div
        let editor = document.querySelector("[data-slate-editor='true']");
        if (!editor) editor = document.querySelector("div[role='textbox'][contenteditable='true']:not(#af-bot-panel *)");
        if (!editor) editor = document.querySelector('[contenteditable="true"]:not([aria-hidden])');

        if (!editor) {
          return { success: false, error: 'Editor not found', retry: false };
        }

        const isSlate = !!(editor.matches?.("[data-slate-editor='true']") || editor.querySelector?.("[data-slate-node]"));
        console.log('[Prompt] Editor found, isSlate:', isSlate, 'tag:', editor.tagName);

        // ==== 방법 1: Slate React API — editor.apply() ====
        let slateSuccess = false;
        if (isSlate) {
          try {
            // React fiber 트리에서 Slate editor 인스턴스 탐색
            const reactKeys = Object.keys(editor).filter(k => k.startsWith('__react'));
            let slateEditor = null;

            for (const key of reactKeys) {
              const stack = [editor[key]];
              const visited = new Set();
              let guard = 0;
              while (stack.length > 0 && guard < 5000) {
                const node = stack.pop();
                guard++;
                if (!node || typeof node !== 'object' || visited.has(node)) continue;
                visited.add(node);

                const candidate =
                  node?.memoizedProps?.node ||
                  node?.memoizedProps?.editor ||
                  node?.pendingProps?.node ||
                  node?.pendingProps?.editor ||
                  node?.stateNode?.editor ||
                  node?.editor;

                if (candidate && typeof candidate.apply === 'function') {
                  slateEditor = candidate;
                  break;
                }
                if (node.child) stack.push(node.child);
                if (node.sibling) stack.push(node.sibling);
                if (node.return) stack.push(node.return);
                if (node.alternate) stack.push(node.alternate);
              }
              if (slateEditor) break;
            }

            if (slateEditor) {
              console.log('[Prompt] Found Slate editor instance via React fiber');

              // 기존 텍스트 삭제
              try {
                const existingText = slateEditor.children?.[0]?.children?.[0]?.text || '';
                if (existingText) {
                  slateEditor.apply({ type: 'remove_text', path: [0, 0], offset: 0, text: existingText });
                }
              } catch (e) {
                console.log('[Prompt] remove_text failed (ok):', e.message);
                // Slate API로 전체 삭제 시도
                try {
                  if (window.Slate?.Editor && window.Slate?.Transforms) {
                    const start = window.Slate.Editor.start(slateEditor, []);
                    const end = window.Slate.Editor.end(slateEditor, []);
                    window.Slate.Transforms.select(slateEditor, { anchor: start, focus: end });
                    window.Slate.Transforms.delete(slateEditor, { at: { anchor: start, focus: end } });
                  }
                } catch {}
              }

              // 새 텍스트 삽입
              slateEditor.apply({ type: 'insert_text', path: [0, 0], offset: 0, text: promptText });
              if (typeof slateEditor.onChange === 'function') slateEditor.onChange();

              // input/change 이벤트 dispatch (프레임워크 통지)
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              editor.dispatchEvent(new Event('change', { bubbles: true }));

              await sleep(200);

              // 검증: Slate 모델에 텍스트가 있는지
              const modelText = (slateEditor.children?.[0]?.children?.[0]?.text || '').trim();
              if (modelText && modelText.includes(promptText.slice(0, 40))) {
                console.log('[Prompt] Slate API insert verified OK');
                slateSuccess = true;
              } else {
                console.log('[Prompt] Slate API insert: model text mismatch:', modelText?.substring(0, 40));
              }
            } else {
              console.log('[Prompt] Could not find Slate editor in React fiber');
            }
          } catch (e) {
            console.log('[Prompt] Slate API method failed:', e.message);
          }
        }

        // ==== 방법 2: document.execCommand('insertText') ====
        if (!slateSuccess) {
          console.log('[Prompt] Trying execCommand insertText...');
          try {
            editor.focus();
            editor.click();
            await sleep(100);

            // 기존 텍스트 선택 & 삭제
            if (isSlate) {
              // Slate selection 설정
              const sel = window.getSelection();
              const range = document.createRange();
              const stringNodes = Array.from(editor.querySelectorAll('[data-slate-string]'))
                .map(n => n.firstChild)
                .filter(n => n && n.nodeType === Node.TEXT_NODE);

              if (stringNodes.length > 0) {
                range.setStart(stringNodes[0], 0);
                const last = stringNodes[stringNodes.length - 1];
                range.setEnd(last, (last.textContent || '').length);
              } else {
                const zeroNode = Array.from(editor.querySelectorAll('[data-slate-zero-width]'))
                  .map(n => n.firstChild)
                  .find(n => n && n.nodeType === Node.TEXT_NODE);
                if (zeroNode) {
                  range.setStart(zeroNode, 0);
                  range.setEnd(zeroNode, (zeroNode.textContent || '').length);
                } else {
                  range.selectNodeContents(editor);
                }
              }
              sel.removeAllRanges();
              sel.addRange(range);
            } else {
              document.execCommand('selectAll', false, null);
            }

            // 삭제
            document.execCommand('delete', false, null);
            await sleep(50);

            // beforeinput 이벤트
            try {
              editor.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true, cancelable: true,
                inputType: 'insertText', data: promptText
              }));
            } catch {}

            // insertText
            const inserted = document.execCommand('insertText', false, promptText);
            console.log('[Prompt] execCommand insertText result:', inserted);

            if (inserted) {
              // input 이벤트
              try {
                editor.dispatchEvent(new InputEvent('input', {
                  bubbles: true, inputType: 'insertText', data: promptText
                }));
              } catch {}
              await sleep(200);

              // 검증
              const hasText = !!editor.querySelector?.('[data-slate-string]');
              const visibleText = (editor.innerText || editor.textContent || '').trim();
              if (hasText || visibleText.includes(promptText.slice(0, 20))) {
                console.log('[Prompt] execCommand insertText verified OK');
                slateSuccess = true;
              }
            }
          } catch (e) {
            console.log('[Prompt] execCommand method failed:', e.message);
          }
        }

        // ==== 방법 3: textarea fallback (Slate가 아닌 경우) ====
        if (!slateSuccess && !isSlate) {
          console.log('[Prompt] Trying textarea value setter...');
          try {
            const tag = editor.tagName.toLowerCase();
            if (tag === 'textarea' || tag === 'input') {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
              if (setter) {
                setter.call(editor, '');
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                setter.call(editor, promptText);
                editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: promptText }));
                slateSuccess = true;
              }
            }
          } catch (e) {
            console.log('[Prompt] textarea setter failed:', e.message);
          }
        }

        if (!slateSuccess) {
          return { success: false, error: 'All prompt injection methods failed', retry: true };
        }

        await sleep(500);

        // Generate 버튼 disabled 체크
        try {
          const xr = document.evaluate(
            "//button[.//i[text()='arrow_forward']]",
            document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
          );
          if (xr.singleNodeValue?.disabled) {
            return { success: false, error: 'Generate button disabled', retry: true };
          }
        } catch {}

        return { success: true, method: isSlate ? 'slate' : 'legacy' };
      })()
    `)

    console.log('[DOM IPC] Prompt injection result:', promptResult)
    if (!promptResult?.success) return promptResult

    // Step 2: Generate 버튼 trusted click (sendInputEvent)
    const generateBtnSelector = `(function() {
      try {
        const xr = document.evaluate(
          "//button[.//i[text()='arrow_forward']]",
          document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        if (xr.singleNodeValue && !xr.singleNodeValue.disabled) return xr.singleNodeValue;
      } catch {}
      for (const b of document.querySelectorAll('button')) {
        for (const icon of b.querySelectorAll('i')) {
          if (icon.textContent.trim() === 'arrow_forward' && !b.disabled) return b;
        }
      }
      return null;
    })()`

    const clickResult = await trustedClickOnFlowView(generateBtnSelector)
    console.log('[DOM IPC] Generate button click result:', clickResult)
    if (!clickResult.success) {
      return { success: false, error: clickResult.error || 'Generate button click failed', retry: false }
    }

    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  } finally {
    // flowView 복원 (숨겨져 있었으면 원래대로)
    if (wasHidden) {
      await new Promise(r => setTimeout(r, 500))
      flowView.setBounds(currentBounds)
      console.log('[DOM IPC] Restored flowView hidden bounds after prompt')
    }
  }
})

// Snapshot current blob image URLs
ipcMain.handle('flow:dom-snapshot-blobs', async () => {
  if (!flowView) return { success: true, urls: [] }
  try {
    const urls = await flowView.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll('img[src^="blob:"]')).map(img => img.src)
    `)
    return { success: true, urls: urls || [] }
  } catch (e) {
    return { success: true, urls: [] }
  }
})

// Scan for new blob images and check error popup
// Note: errorSelector는 XPath 형식이므로 document.evaluate() 사용
ipcMain.handle('flow:dom-scan-images', async (event, { knownUrls, errorSelector }) => {
  if (!flowView) return { error: false, urls: [] }
  try {
    const result = await flowView.webContents.executeJavaScript(`
      (function() {
        const knownUrls = ${JSON.stringify(knownUrls)};
        const errorSelector = ${JSON.stringify(errorSelector)};

        // Error popup 체크 (XPath)
        if (errorSelector) {
          try {
            const isXPath = errorSelector.startsWith('//') || errorSelector.startsWith('(');
            if (isXPath) {
              const xr = document.evaluate(errorSelector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              if (xr.singleNodeValue) return { error: true, urls: [] };
            } else {
              if (document.querySelector(errorSelector)) return { error: true, urls: [] };
            }
          } catch {}
        }

        const newUrls = [];
        for (const img of document.querySelectorAll('img[src^="blob:"]')) {
          if (!knownUrls.includes(img.src)) newUrls.push(img.src);
        }
        return { error: false, urls: newUrls };
      })()
    `)
    return result
  } catch (e) {
    return { error: false, urls: [] }
  }
})

// Convert blob URL to base64
ipcMain.handle('flow:dom-blob-to-base64', async (event, { blobUrl }) => {
  if (!flowView) return { success: false, error: 'Flow view not ready' }
  try {
    const base64 = await flowView.webContents.executeJavaScript(`
      (async function() {
        try {
          const res = await fetch(${JSON.stringify(blobUrl)});
          const blob = await res.blob();
          return new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        } catch (e) { return null; }
      })()
    `)
    return { success: !!base64, base64 }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// Switch to Flow tab to show DOM results
ipcMain.handle('flow:dom-show-flow', async () => {
  // Split 모드에서는 항상 Flow가 보임 — no-op
  return { success: true }
})

// === App Lifecycle ===
app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
