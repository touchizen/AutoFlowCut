/**
 * Shared helper functions for Flow API IPC modules.
 *
 * trustedClickOnFlowView, parseFlowResponse, sessionFetch, flowPageFetch,
 * getRecaptchaToken, extract*, fetchMediaAsBase64, configureFlowMode.
 *
 * These are used by flow-api.js, video.js, dom.js via deps injection from main.js.
 */

import { aspectRatioTabSuffix } from '../flow-aspect-ratio-ui.js'
import { buildAgentDefaultsScript, buildListModelsScript } from '../flow-agent-defaults.js'
import { AGENT_TOGGLE_PROBE, AGENT_TOGGLE_SELECTOR, AGENT_CHAT_CLOSE_SELECTOR, AGENT_SETTINGS_CLOSE_SELECTOR, AGENT_TOGGLE_DIAGNOSTIC } from '../flow-agent-toggle.js'
import { buildSelectModeScript } from '../flow-mode-tab.js'
import { FLOW_PAGE_PROBE_JS, isFlowErrorPage } from '../flowOpenRetry.js'
import { screen } from 'electron'
import { computeOffscreenBounds } from '../offscreen-bounds.js'
import { updateBounds } from './layout.js'
import { createMutex } from '../asyncMutex.js'
import { sanitizeForSentry } from '../flow-diag.js'

export const FLOW_PAGE_FETCH_TIMEOUT_MS = 120000

/**
 * #R34-fix: applyAgentDefaults 결과가 "요청한 image/video aspect·model 을 실제로 적용했는지" 판정(순수).
 *   buildAgentDefaultsScript 의 result.ok 는 패널을 찾기만 하면 true 라, 탭/옵션 미발견 같은 필드 적용
 *   실패를 잡지 못한다. 그대로 success 처리하면 잘못된 화면비/모델로 생성돼 quota 를 낭비한다.
 *   - 'skipped'(요청 비율이 매핑 안 됨)·'already'·'clicked'·null 은 적용된 것으로 본다.
 *   - 그 외(tab_not_found, trigger_not_found, menu_not_opened, option_not_found, section error)는 미적용.
 *   - count(배치 수) 실패는 비치명적이라 무시한다(화면비/모델만 본다).
 *
 * @param {object} opts - applyAgentDefaults 에 넘긴 요청({image?,video?})
 * @param {object} result - page-script 반환값({ok,image,video,...})
 * @returns {boolean}
 */
export function agentDefaultsApplied(opts = {}, result = {}) {
  const okStatus = (s) => s == null || s === 'skipped' || s === 'already' || s === 'clicked'
  const sectionOk = (req, sec) => {
    if (!req) return true                       // 요청 안 함 → 무관
    if (!sec || sec.error) return false         // section_not_found 등
    if (req.aspectRatio != null && !okStatus(sec.aspect)) return false
    if (req.model != null && !okStatus(sec.model)) return false
    return true
  }
  return sectionOk(opts.image, result.image) && sectionOk(opts.video, result.video)
}

/**
 * Create all shared helpers bound to the given getters.
 *
 * @param {object} ctx
 * @param {Function} ctx.getFlowView - Returns the Flow WebContentsView
 * @param {Function} ctx.getMainWindow - Returns the main BrowserWindow
 * @param {object} ctx.constants - URL constants and API headers
 * @returns {object} All helper functions
 */
export function createSharedHelpers(ctx) {
  const { getFlowView, getMainWindow, constants, onDomFailure } = ctx
  const flowPageFetchTimeoutMs = ctx.flowPageFetchTimeoutMs ?? FLOW_PAGE_FETCH_TIMEOUT_MS

  // 클릭 직렬화 — 두 클릭이 겹치면 서로의 임시(확대) bounds 를 자기 '원래 값'으로 스냅샷해
  //   복원이 어긋나고, 마우스 이벤트도 뒤섞인다. 모든 DOM 클릭이 이 병목을 지난다.
  const clickMutex = createMutex()

  // DOM 스텝 실패 보고 — 셀렉터가 깨졌을 때 그 순간의 페이지 컨텍스트를 함께 남긴다.
  //   'Flow view not ready'(Flow 모드 아님) 같은 정상 상태 체크는 부르지 않는다 — 노이즈가 된다.
  async function reportDomFailure(step, reason, extra = {}) {
    if (!onDomFailure) return
    try {
      const flowView = getFlowView()
      const scan = flowView
        ? await flowView.webContents.executeJavaScript(AGENT_TOGGLE_DIAGNOSTIC).catch(() => null)
        : null
      await onDomFailure(step, {
        reason,
        ...extra,
        viewBounds: flowView ? flowView.getBounds() : null,
        context: (scan && scan.context) || {},
      })
    } catch (e) {
      console.warn(`[Flow Diag] report failed (${step}):`, e.message)
    }
  }
  const {
    SESSION_URL, MEDIA_REDIRECT_URL, RECAPTCHA_SITE_KEY, RECAPTCHA_ACTION,
  } = constants

  // ─── trustedClickOnFlowView ───────────────────────────────────
  /**
   * flowView를 일시적으로 보이게 한 후 sendInputEvent로 trusted click을 보내는 헬퍼
   * b.click()은 isTrusted: false라 Flow 페이지가 무시함 → sendInputEvent 필수
   * sendInputEvent는 viewport가 0x0이면 좌표가 의미없으므로 일시적으로 보이게 해야 함
   */
  /**
   * @param {string} jsSelector  page expression returning the element
   * @param {object} [opts]
   * @param {boolean} [opts.required]  true ⇒ this button MUST exist; a miss is a broken selector
   *   and gets reported. Default false: many call sites click "if it's there" (closeAgentPanels
   *   closes panels that are usually absent), and reporting those would fire on every healthy
   *   generation and drown the real breakages.
   */
  // 클릭 하나가 붙잡을 수 있는 최대 시간. Flow 렌더러가 먹통이면 executeJavaScript 가 영영
  //   settle 되지 않고, 그러면 락이 안 풀려 **이후 모든 클릭이 영구 정지**한다(병목이라 앱 전체가 멈춘다).
  //   측정(≤ 수 초) + 확대 대기 + 클릭 시퀀스 + 복원을 다 합쳐도 넉넉한 값.
  const CLICK_TIMEOUT_MS = 30_000

  async function trustedClickOnFlowView(jsSelector, opts = {}) {
    const release = await clickMutex.acquire()
    try {
      let timer
      // ⚠️ Promise.race 로 버린 쪽은 계속 살아 있다. 먹통 렌더러가 뒤늦게 응답하면 그 좀비가
      //    마우스 이벤트를 쏘고 updateBounds 를 불러 **다음 클릭과 겹친다**. abort 플래그를 넘겨
      //    부작용 직전마다 확인하게 한다.
      const token = { aborted: false }
      const timeout = new Promise((_, rej) => {
        timer = setTimeout(() => { token.aborted = true; rej(new Error('trusted-click timed out')) }, CLICK_TIMEOUT_MS)
      })
      try {
        return await Promise.race([trustedClickLocked(jsSelector, opts, token), timeout])
      } catch (e) {
        console.warn('[TrustedClick] aborted:', e.message)
        // ⚠️ 진단은 페이지를 프로브하지 않는다 — 먹통 렌더러를 다시 await 하면 이 catch 도 안 끝나고
        //    락이 영영 안 풀린다(병목이라 앱 전체 정지). 컨텍스트 없이 사실만 보고한다.
        // 좀비가 영영 안 깨어날 수 있으므로 여기서도 복원한다(멱등).
        try { updateBounds(getMainWindow(), getFlowView()) } catch { /* 뷰가 이미 없을 수 있다 */ }
        if (opts.required && onDomFailure) {
          await onDomFailure(`trusted-click:${opts.step || 'unknown'}`, { reason: 'timeout', error: e.message }).catch(() => {})
        }
        return { success: false, error: e.message }
      } finally {
        clearTimeout(timer)
      }
    } finally {
      release()
    }
  }

  async function trustedClickLocked(jsSelector, opts = {}, token = { aborted: false }) {
    const mainWindow = getMainWindow()
    const flowView = getFlowView()
    if (!mainWindow || !flowView) return { success: false, error: 'No flowView' }

    const startBounds = flowView.getBounds()
    const wasHidden = (startBounds.width === 0 || startBounds.height === 0)
    let enlarged = false

    console.log('[TrustedClick] Current bounds:', startBounds, 'wasHidden:', wasHidden)

    // 뷰를 창 크기만큼 키워 화면 밖에 배치 — 사용자에겐 안 보이고, 페이지는 정상 폭으로 레이아웃된다.
    //   (모든 디스플레이 너머로 — 멀티모니터에서 보조 모니터에 안 깜빡이게.)
    const enlargeOffscreen = async () => {
      if (token.aborted) return
      const { width, height } = mainWindow.getContentBounds()
      flowView.setBounds(computeOffscreenBounds(screen.getAllDisplays(), mainWindow.getBounds().x, width, height))
      enlarged = true
      await new Promise(r => setTimeout(r, 300)) // 레이아웃 업데이트 대기
    }

    const measure = () => flowView.webContents.executeJavaScript(`
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
          visible: rect.width > 0 && rect.height > 0,
          url: location.href
        };
      })()
    `)

    // ⚠️ bounds 만 확인하면 부족하다. 측정 후 100ms 사이에 오버레이가 덮이거나 버튼이 이동하면
    //    좌표는 여전히 뷰 안이지만 **다른 요소**가 이벤트를 받는다 — 그래도 success 를 반환했다.
    //    누르기 직전에 그 점의 hit target 이 우리 요소(또는 그 자손)인지 확인한다.
    // ⚠️ measuredUrl 을 넘겨 "측정한 그 페이지" 인지 확인한다. reject 만 막으면 부족하다 — 100ms 사이에
    //    B 로 **정상 navigate** 되면 executeJavaScript 는 성공하고, B 에도 같은 자리에 같은 버튼이 있으면
    //    hit-test 를 통과해 **B 의 버튼을 누른다**(B 에 남은 draft 를 잘못 제출할 수도 있다).
    const hitTest = (x, y, measuredUrl) => flowView.webContents.executeJavaScript(`
      (function() {
        if (location.href !== ${JSON.stringify(measuredUrl)}) return { ok: false, why: 'page-changed' };
        const target = ${jsSelector};
        if (!target) return { ok: false, why: 'gone' };
        const hit = document.elementFromPoint(${x}, ${y});
        if (!hit) return { ok: false, why: 'nothing-at-point' };
        // hit.contains(target) 은 넣지 않는다 — 큰 부모가 hit 이면 우리 버튼이 이벤트를 못 받는다는 뜻이다.
        return { ok: target === hit || target.contains(hit), why: 'covered' };
      })()
    `).then((r) => (r && typeof r.ok === 'boolean' ? r : { ok: false, why: 'unreadable' }))
     .catch(() => ({ ok: false, why: 'context-gone' }))
    // ⚠️ 여기서 fail-open 하면 안 된다. hit-test 가 reject 된다는 건 그 사이 페이지가 navigate 되어
    //    실행 컨텍스트가 사라졌다는 뜻이고, 그러면 우리가 들고 있는 좌표는 **다른 페이지의 좌표** 다.
    //    그걸 누르고 success 를 반환하면 오늘 종일 쫓던 "엉뚱한 걸 누르고 성공이라 말하기" 다.

    // 유효 좌표는 0..width-1 / 0..height-1 이다. `>` 로 검사하면 x === width 가 "안"으로 통과해
    //   뷰 밖을 클릭하고 성공을 반환한다(옛 clamp 도 width-1 로 잘랐다).
    const outside = (c, b) => c.x < 0 || c.y < 0 || c.x >= b.width || c.y >= b.height

    // 0×0(모달/드래그 중)이면 재보기 전에 키운다 — 그 상태의 좌표는 의미가 없다.
    if (wasHidden) await enlargeOffscreen()

    try {
      let coords = await measure()

      // width 만 보면 안 된다 — 높이 0 도 클릭이 안 먹는 요소다. 그런데도 "성공"을 반환하면
      //   호출부는 제출된 줄 알고 오지 않을 응답을 기다린다(2분 timeout).
      if (!coords || coords.width === 0 || coords.height === 0) {
        console.log('[TrustedClick] Button not found or zero-size:', coords)
        // required 인 클릭만 보고한다 — best-effort 클릭(패널 닫기 등)은 대상이 없는 게 정상이라
        //   보고하면 정상 생성마다 노이즈가 쌓여 진짜 breakage 를 덮는다.
        if (opts.required) {
          await reportDomFailure(`trusted-click:${opts.step || 'unknown'}`, coords ? 'zero-size' : 'not-found', { coords: coords || null })
        }
        return { success: false, error: 'Button not found or zero-size' }
      }

      // disabled 를 재놓고 무시하고 있었다. 비활성 버튼을 누르면 아무 일도 안 일어나는데 success 를
      //   반환하니, 호출부는 제출된 줄 알고 기다리다 timeout 난다. 정직하게 실패한다.
      if (coords.disabled) {
        console.warn('[TrustedClick] Button is disabled — refusing to click:', coords)
        if (opts.required) {
          await reportDomFailure(`trusted-click:${opts.step || 'unknown'}`, 'disabled', { coords })
        }
        return { success: false, error: 'Button is disabled' }
      }

      console.log('[TrustedClick] Button coords:', coords)

      // 좌표가 뷰 밖이면 — 사용자가 스플리터로 Flow 패널을 좁혀 컴포즈 바가 가로로 넘친 경우다.
      //   옛 코드는 좌표를 뷰 가장자리로 "클램핑"해서 눌렀다. 그러면 엉뚱한 요소를 클릭하고도
      //   success 를 반환한다 → 호출부는 제출된 줄 알고 오지 않을 응답을 2분간 기다린다(timeout).
      //   잘못된 요소를 누르고 성공이라 말하는 것은 실패보다 나쁘다. 클램핑 대신 뷰를 키워
      //   진짜 좌표로 누른다(위 wasHidden 경로와 같은 수단).
      if (outside(coords, flowView.getBounds()) && !enlarged) {
        console.warn('[TrustedClick] Coords outside view bounds — enlarging view instead of clamping')
        await enlargeOffscreen()
        coords = await measure()   // 넓어진 폭에서 재레이아웃 → 좌표가 바뀐다
        // ⚠️ 재측정 결과도 처음과 똑같이 검사해야 한다. 첫 측정만 zero-size/disabled 를 보고
        //    두 번째는 안 봐서, 넓힌 뒤 disabled 로 바뀐 버튼을 누르고 success 를 반환했다.
        if (coords && (coords.height === 0 || coords.disabled)) {
          console.warn('[TrustedClick] Button unusable after enlarging:', coords)
          if (opts.required) {
            await reportDomFailure(`trusted-click:${opts.step || 'unknown'}`, coords.disabled ? 'disabled' : 'zero-size', { coords })
          }
          return { success: false, error: coords.disabled ? 'Button is disabled' : 'Button not found or zero-size' }
        }
      }

      if (!coords || coords.width === 0 || coords.height === 0 || outside(coords, flowView.getBounds())) {
        console.warn('[TrustedClick] Button unreachable even after enlarging:', coords)
        if (opts.required) {
          await reportDomFailure(`trusted-click:${opts.step || 'unknown'}`, 'outside-view-bounds', { coords: coords || null })
        }
        return { success: false, error: 'Button outside view bounds' }
      }

      // sendInputEvent로 trusted click (mouseMove → mouseDown → mouseUp)
      // mouseMove 먼저 보내서 hover 상태 생성
      if (token.aborted) return { success: false, error: 'aborted' }
      flowView.webContents.sendInputEvent({ type: 'mouseMove', x: coords.x, y: coords.y })
      await new Promise(r => setTimeout(r, 100))

      const hit = await hitTest(coords.x, coords.y, coords.url)
      if (!hit.ok) {
        console.warn('[TrustedClick] Another element occupies the point — refusing to click it:', hit.why)
        if (opts.required) {
          await reportDomFailure(`trusted-click:${opts.step || 'unknown'}`, `hit-test:${hit.why}`, { coords })
        }
        return { success: false, error: `Target not at point (${hit.why})` }
      }

      // ⚠️ 좌표는 measure 시점의 bounds 기준이다. 위 100ms 사이에 모달이 열리면 layout 이 뷰를
      //   0×0 으로 접고(네이티브 뷰라 CSS 로 못 가리니 접는다), mouseDown/Up 은 아무 데도 안 닿는다.
      //   그런데도 success 를 반환하면 또 "아무것도 안 누르고 성공" 이다. 누르기 직전에 다시 본다.
      if (outside(coords, flowView.getBounds())) {
        console.warn('[TrustedClick] View bounds changed mid-click — aborting instead of clicking nowhere')
        if (opts.required) {
          await reportDomFailure(`trusted-click:${opts.step || 'unknown'}`, 'bounds-changed-mid-click', { coords })
        }
        return { success: false, error: 'View bounds changed mid-click' }
      }

      if (token.aborted) return { success: false, error: 'aborted' }
      flowView.webContents.sendInputEvent({ type: 'mouseDown', x: coords.x, y: coords.y, button: 'left', clickCount: 1 })
      await new Promise(r => setTimeout(r, 80))

      // ⚠️ down 을 보냈으면 up 은 **무조건** 보낸다. 중간에 그냥 return 하면 렌더러에 press 상태가
      //    남아 drag/selection 이 걸린 채로 다음 동작이 돈다.
      flowView.webContents.sendInputEvent({ type: 'mouseUp', x: coords.x, y: coords.y, button: 'left', clickCount: 1 })
      await new Promise(r => setTimeout(r, 200))

      // down 과 up 사이에 모달이 뷰를 접었다면 클릭은 완성되지 않았다 — 성공이라 말하지 않는다.
      if (outside(coords, flowView.getBounds())) {
        console.warn('[TrustedClick] View collapsed mid-click — click did not complete')
        if (opts.required) {
          await reportDomFailure(`trusted-click:${opts.step || 'unknown'}`, 'bounds-changed-mid-click', { coords })
        }
        return { success: false, error: 'View bounds changed mid-click' }
      }

      console.log('[TrustedClick] Click events sent at (' + coords.x + ', ' + coords.y + ')')
      return { success: true, coords }
    } catch (e) {
      // executeJavaScript 가 reject 되거나(페이지가 중간에 navigate) sendInputEvent 가 throw 하면
      //   여기로 온다. 예전엔 호출부로 그대로 던져 아무 기록도 안 남았다 — 오늘 종일 우리 눈을 가린
      //   것과 정확히 같은 클래스다. 모든 실패 출구가 보고한다.
      console.warn('[TrustedClick] threw:', e.message)
      if (opts.required) {
        await reportDomFailure(`trusted-click:${opts.step || 'unknown'}`, 'threw', { error: e.message })
      }
      return { success: false, error: e.message }
    } finally {
      // bounds 복원 — 스냅샷을 되돌리는 게 아니라 레이아웃 상태에서 "다시 계산"한다.
      //   클릭이 도는 ~1초 사이에 사용자가 모달을 열거나(→ Flow 를 0×0 으로 숨겨야 함) 스플리터를
      //   드래그했을 수 있다. 스냅샷을 복원하면 그 변경을 덮어써서, 최악의 경우 Flow 네이티브 뷰가
      //   모달 위에 되살아난다(네이티브라 CSS z-index 로 못 가린다). updateBounds 가 유일한 진실이다.
      // ⚠️ abort 라고 건너뛰면 안 된다 — 확대해둔 뷰가 **화면 밖에 영구히 남는다**(사용자는 Flow 가
      //    사라진 걸 본다). abort 야말로 복원이 필요한 순간이다. 좀비의 중복 복원은 아래 outer catch
      //    에서 한 번 더 부르는 것으로 수렴한다(updateBounds 는 멱등).
      if (enlarged) {
        if (!token.aborted) await new Promise(r => setTimeout(r, 500)) // 클릭 이벤트 처리 대기
        updateBounds(mainWindow, flowView)
        console.log('[TrustedClick] Restored bounds from layout:', flowView.getBounds())
      }
    }
  }

  // ─── parseFlowResponse ────────────────────────────────────────
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

  // ─── sessionFetch ─────────────────────────────────────────────
  /**
   * Electron Session.fetch()를 사용하여 Chromium 네트워킹 스택으로 요청
   * - flowView 세션의 쿠키가 자동으로 포함됨 (credentials: 'include'와 동일)
   * - CORS 제약 없음 (main process에서 실행)
   * - Electron 28+ 필요 (현재 34.1.1)
   */
  async function sessionFetch(url, options = {}) {
    const flowView = getFlowView()
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

  // ─── flowPageFetch ────────────────────────────────────────────
  /**
   * Flow 페이지 컨텍스트 안에서 fetch 실행
   * reCAPTCHA 토큰의 origin과 API 요청 origin을 일치시키기 위해 필수
   * (main process의 sessionFetch는 origin이 달라 reCAPTCHA 검증 실패)
   */
  async function flowPageFetch(url, { method = 'POST', headers = {}, body, redirect } = {}) {
    const flowView = getFlowView()
    if (!flowView) throw new Error('Flow view not ready')

    // AutoFlow과 동일: fetch.call(window, ...) 패턴
    const pagePromise = flowView.webContents.executeJavaScript(`
      (async function() {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ${JSON.stringify(flowPageFetchTimeoutMs)});
        try {
          const _fetch = window.__afNativeFetch || window.__autoFlowNativeFetch || window.fetch;
          const init = {
            method: ${JSON.stringify(method)},
            headers: ${JSON.stringify(headers)},
            body: ${JSON.stringify(body)},
            signal: controller.signal
          };
          ${redirect ? `init.redirect = ${JSON.stringify(redirect)};` : ''}
          const resp = await _fetch.call(window, ${JSON.stringify(url)}, init);
          // redirect:'manual' 모드면 본문 읽기 의미 없음
          let text = '';
          try { text = await resp.text(); } catch (_) {}
          return {
            ok: resp.ok,
            status: resp.status,
            type: resp.type,
            url: resp.url,
            redirected: resp.redirected,
            location: (resp.headers && resp.headers.get) ? (resp.headers.get('location') || '') : '',
            text
          };
        } catch (e) {
          return { ok: false, status: 0, text: e.message };
        } finally {
          clearTimeout(timeoutId);
        }
      })()
    `)

    // renderer/WebContents invoke 자체가 응답하지 않는 경우 페이지 안 AbortController 도 실행할 수 없다.
    // main 쪽 제한도 함께 둬 IPC caller/coordinator key 가 reload 전까지 영구 고착되지 않게 한다.
    let timeoutId
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Flow page fetch timed out after ${flowPageFetchTimeoutMs}ms`)),
        flowPageFetchTimeoutMs,
      )
    })
    const result = await Promise.race([pagePromise, timeoutPromise]).finally(() => clearTimeout(timeoutId))

    return result
  }

  // ─── getRecaptchaToken ────────────────────────────────────────
  /**
   * Flow 페이지의 grecaptcha.enterprise를 사용하여 reCAPTCHA 토큰 획득
   * AutoFlow와 동일한 방식 (sidepanel.js:20097-20108)
   */
  async function getRecaptchaToken(action = RECAPTCHA_ACTION) {
    const flowView = getFlowView()
    if (!flowView) return ''
    try {
      const token = await flowView.webContents.executeJavaScript(`
        (async function() {
          try {
            const g = window.grecaptcha;
            if (!g || !g.enterprise || !g.enterprise.execute) return '';
            // AutoFlow 패턴: ready() 대기 후 execute()
            if (g.enterprise.ready) {
              await new Promise(resolve => g.enterprise.ready(resolve));
            }
            const token = await g.enterprise.execute(
              '${RECAPTCHA_SITE_KEY}',
              { action: '${action}' }
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

  // ─── extractMediaIds ──────────────────────────────────────────
  /** 응답에서 mediaId 추출 */
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

  // ─── extractFifeUrls ─────────────────────────────────────────
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

  // ─── extractBase64Images ──────────────────────────────────────
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

  // ─── fetchMediaAsBase64 ───────────────────────────────────────
  /** mediaId로 실제 미디어 URL 가져와서 base64로 변환 */
  async function fetchMediaAsBase64(token, mediaId) {
    const redirectUrl = `${MEDIA_REDIRECT_URL}?input=${encodeURIComponent(JSON.stringify({ json: { name: mediaId } }))}`

    // Step 1: media redirect URL 가져오기
    // flowPageFetch 우선 (페이지 쿠키 포함 → TRPC 인증 성공률 높음)
    // 실패 시 sessionFetch 폴백 (이미지 등 쿠키 불필요한 경우)
    let redirectText = ''
    let redirectOk = false

    try {
      const pageResult = await flowPageFetch(redirectUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      redirectOk = pageResult.ok
      redirectText = pageResult.text || ''
      if (!redirectOk) {
        console.warn(`[fetchMedia] flowPageFetch HTTP ${pageResult.status}, trying sessionFetch...`)
      }
    } catch (e) {
      console.warn('[fetchMedia] flowPageFetch failed:', e.message, ', trying sessionFetch...')
    }

    // flowPageFetch 실패 시 sessionFetch 폴백
    if (!redirectOk) {
      const redirectRes = await sessionFetch(redirectUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!redirectRes.ok) {
        throw new Error(`Media redirect HTTP ${redirectRes.status}`)
      }
      redirectText = await redirectRes.text()
    }

    const redirectData = parseFlowResponse(redirectText)
    const mediaUrl = redirectData?.result?.data?.json?.url || redirectData?.result?.data?.json?.redirectUrl

    if (!mediaUrl) {
      throw new Error('No media URL in redirect response')
    }

    // Step 2: 실제 미디어 다운로드 → base64 (CDN은 쿠키 불필요)
    const mediaRes = await sessionFetch(mediaUrl)
    if (!mediaRes.ok) {
      throw new Error(`Media fetch HTTP ${mediaRes.status}`)
    }
    const buffer = await mediaRes.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const contentType = mediaRes.headers?.get?.('content-type') || 'image/png'
    return `data:${contentType};base64,${base64}`
  }

  // ─── configureFlowMode ────────────────────────────────────────
  /**
   * Flow 페이지를 비디오 모드로 전환
   * AutoFlow와 동일한 CSS selector 사용 (로케일 무관):
   *   - SETTINGS_BUTTON:  button[aria-haspopup='menu']:has(div[data-type='button-overlay'])
   *   - MODE_VIDEO:       button[role='tab'][id*='-trigger-VIDEO']
   *   - SETTINGS_MENU:    [role='menu'][data-state='open']
   */
  async function configureFlowMode(targetMode = 'VIDEO', batchCount = 1, aspectRatio = null) {
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'No flowView' }

    // AutoFlow 동일 CSS selectors (텍스트 비교 없음 — 모든 로케일에서 동작)
    const modeKey = targetMode === 'IMAGE' ? 'IMAGE' : 'VIDEO'

    // 화면비 탭 — 모드/배치 탭과 같은 설정 메뉴 안의 Radix Tab.
    // 반드시 메뉴가 열려 있는 동안(Step 4.5) 클릭해야 한다: 메뉴를 닫으면
    // Radix 가 content 를 unmount 하므로, 메뉴 밖에서의 별도 동기화는 동작하지 않는다.
    // '-trigger-LANDSCAPE'(16:9) | '-trigger-PORTRAIT'(9:16) | null(미지정)
    const aspectTabSuffix = aspectRatioTabSuffix(aspectRatio)
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

            // Step 4: 배치 개수 선택
            // Flow UI는 첫 버튼만 '1x', 나머지는 'x2/x3/x4' 로 비대칭 — textContent 매칭 깨짐.
            // class 'flow_tab_slider_trigger' + id 끝의 '-trigger-N' 으로 잡는다 (radix prefix 동적).
            const targetN = ${Math.max(1, Math.min(4, batchCount))};
            let batchMethod = 'not_found';
            const tabBtns = Array.from(menu.querySelectorAll('button.flow_tab_slider_trigger')).filter(isVisible);
            let batchBtn = tabBtns.find(b => b.id.endsWith('-trigger-' + targetN));
            // Fallback: Flow가 클래스를 바꾸면 textContent로 한 번 더 시도 ('x1' / '1x' / '1' 모두 허용)
            if (!batchBtn) {
              const allBtns = Array.from(menu.querySelectorAll('button')).filter(isVisible);
              batchBtn = allBtns.find(b => {
                const txt = b.textContent.trim().toLowerCase();
                return txt === 'x' + targetN || txt === targetN + 'x' || txt === String(targetN);
              });
            }
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

            // Step 4.5: 화면비(aspect ratio) 탭 — 메뉴가 아직 열려 있는 동안 클릭한다.
            // 모드/배치와 같은 메뉴 안의 Radix Tabs. id 접미사로 구분하며,
            // endsWith 는 정확 접미사 매칭이라 '-trigger-PORTRAIT'(9:16) 가
            // '-trigger-PORTRAIT_3_4'(3:4) 를 잘못 잡지 않는다.
            // best-effort — 못 찾거나 전환 실패해도 ok 에는 영향 없음 (실제 생성 화면비는
            // CDP request injection 이 보장; 이 단계는 Flow 프리뷰 표시 교정용일 뿐).
            let aspectMethod = 'skipped';
            const aspectSuffix = ${aspectTabSuffix ? `'${aspectTabSuffix}'` : 'null'};
            if (aspectSuffix) {
              const findAr = () => Array.from(menu.querySelectorAll("button[role='tab']"))
                .filter(isVisible).find(b => b.id.endsWith(aspectSuffix)) || null;
              const arActive = (b) => !!b && (b.getAttribute('aria-selected') === 'true'
                || b.getAttribute('data-state') === 'active');
              let arBtn = findAr();
              if (!arBtn) {
                aspectMethod = 'tab_not_found';
              } else if (arActive(arBtn)) {
                aspectMethod = 'already_set';
              } else {
                aspectMethod = 'click_unconfirmed';
                for (let a = 1; a <= 3; a++) {
                  humanClick(arBtn);
                  await sleep(200);
                  arBtn = findAr() || arBtn;
                  if (arActive(arBtn)) { aspectMethod = 'clicked'; break; }
                }
              }
            }

            // Step 5: 메뉴 닫기
            if (document.querySelector("[role='menu']")) { escapeMenu(); await sleep(200); }

            return { ok: true, method: modeMethod, batch: batchMethod, aspect: aspectMethod, tabId: modeTab?.id };
          })()
        `)

        if (result?.ok) {
          console.log(`[Flow Mode] Configured: mode=${targetMode}, batch=${batchLabel}`, result.method, result.batch, `aspect=${result.aspect || 'n/a'}`, result.tabId || '')
          await new Promise(r => setTimeout(r, 500)) // UI 전환 안정화 대기
          return { success: true, method: result.method, batch: result.batch, aspect: result.aspect }
        }

        console.warn(`[Flow Mode] Attempt ${attempt + 1}/${maxAttempts} failed:`, result?.error)

        // 마지막 시도에서 실패하면 진단 저장
        if (attempt === maxAttempts - 1) {
          try {
            const fs = await import('node:fs')
            const os = await import('node:os')
            const diagPath = `${os.tmpdir()}/flow-video-dom-diag.json`
            fs.writeFileSync(diagPath, JSON.stringify(result, null, 2))
            console.log(`[Flow Video] Last failure saved to ${diagPath}`)
          } catch {}
        }

        await new Promise(r => setTimeout(r, 400 + attempt * 200))
      } catch (e) {
        console.warn(`[Flow Video] Attempt ${attempt + 1} error:`, e.message)
        await new Promise(r => setTimeout(r, 400))
      }
    }

    await reportDomFailure('configure-mode', `mode_not_set_after_${maxAttempts}_attempts`, { targetMode })
    return { success: false, error: `Mode ${targetMode} not set after ${maxAttempts} attempts` }
  }

  // ─── switchFlowToVideoMode ────────────────────────────────────
  /** 하위 호환 래퍼 */
  async function switchFlowToVideoMode() {
    return configureFlowMode('VIDEO', 1)
  }

  // ─── ensureAgentOff ───────────────────────────────────────────
  /**
   * Force Flow's compose "Agent" toggle OFF so generation uses the direct APIs
   * (batchGenerateImages / batchAsyncGenerateVideoText) that the app's
   * response-interception collection handles — instead of the agent (streamChat)
   * which only renders DOM media. Best-effort + logs all candidates.
   */
  // Agent 토글을 가릴 수 있는 두 패널(우측 대화"챗" 패널 + "에이전트 설정"(기본값) 패널)을
  //   모두 닫는다(각각 no-op if 없음). 사용자 지정: OFF/ON 전환 시 둘 다 동시에 떠 있을 수 있어
  //   토글 가림 여부와 무관하게 선제적으로 강제 close 한다. (Escape 는 설정 패널을 못 닫아 X 클릭 병행.)
  async function closeAgentPanels(flowView) {
    await trustedClickOnFlowView(AGENT_CHAT_CLOSE_SELECTOR).catch(() => {})
    await trustedClickOnFlowView(AGENT_SETTINGS_CLOSE_SELECTOR).catch(() => {})
    await flowView.webContents.executeJavaScript(
      `try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true })); } catch (e) {}`
    ).catch(() => {})
    await new Promise(r => setTimeout(r, 350))
  }

  // 토글을 못 찾아 fail-closed 할 때, 그 순간의 페이지를 박제한다. 이게 없으면 사용자 제보가
  //   반증 불가능해진다 — 로그에 'toggle not found' 한 줄뿐이라 마크업 변경/로케일/접힌 뷰포트가
  //   전부 똑같아 보인다. viewBounds 는 프로브가 실제로 어떤 크기의 뷰에서 돌았는지(0×0 여부)를
  //   말해주므로 executeJavaScript 로는 얻을 수 없는 유일한 단서다.
  /**
   * Agent 토글 처리의 **모든 실패 출구**에서 부른다 — not_found / still_on / 예외 전부.
   *
   * 처음엔 not_found 에만 붙였다. 정작 배포에서 터진 건 예외(주입 스크립트가 minify 때문에
   * ReferenceError)였고 그 경로엔 계측이 없어, 모든 씬이 실패하는 동안 Sentry 에도 진단 파일에도
   * 아무것도 안 남았다. 의심되는 분기만 계측하는 것은 계측이 아니다.
   */
  async function reportAgentToggleFailure(flowView, caller, reason, extra = {}) {
    try {
      const scan = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_DIAGNOSTIC).catch(() => null)
      const diag = {
        caller,
        reason,
        ...extra,
        viewBounds: flowView.getBounds(),
        candidates: (scan && scan.candidates) || [],
        context: (scan && scan.context) || {},
      }
      // ⚠️ diag 를 그대로 찍으면 candidates[].text / ariaLabel(= Flow 페이지 텍스트, 멘션 칩엔
      //   사용자 캐릭터 이름)이 breadcrumb 으로 나간다. Sentry extra 만 sanitize 하고 콘솔로
      //   흘리면 옆문을 열어둔 것과 같다. 콘솔에도 sanitize 한 것만 찍는다(전체는 로컬 파일에).
      // safe-log: sanitizeForSentry 가 text/ariaLabel/url 을 재귀적으로 벗긴 뒤라 콘텐츠가 없다.
      console.warn(`[Flow API] ${caller}: ${reason} — diagnostic:`, JSON.stringify(sanitizeForSentry(diag)))
      await onDomFailure?.('agent-toggle', diag)
    } catch (e) {
      console.warn(`[Flow API] ${caller}: diagnostic capture failed:`, e.message)
    }
  }

  async function ensureAgentOff() {
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'No flowView' }
    try {
      // 선제적으로 대화창 + "에이전트 설정" 패널을 모두 닫는다(둘 다 떠 있을 수 있음).
      await closeAgentPanels(flowView)
      let probe = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_PROBE)
      // 그래도 토글이 안 보이면(여전히 가림) 재시도하며 닫는다.
      for (let i = 0; i < 4 && (!probe || !probe.found); i++) {
        console.log('[Flow API] ensureAgentOff: toggle hidden — closing covering panel attempt', i + 1)
        await closeAgentPanels(flowView)
        probe = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_PROBE)
      }
      if (!probe || !probe.found) {
        console.log('[Flow API] ensureAgentOff: toggle not found (panel close retries exhausted)')
        await reportAgentToggleFailure(flowView, 'ensureAgentOff', 'not_found')
        return { success: false, state: 'not_found' }
      }
      if (!probe.on) {
        console.log('[Flow API] ensureAgentOff: already OFF')
        return { success: true, state: 'already_off' }
      }
      // ON → Flow 의 토글은 synthetic 클릭(isTrusted:false)을 무시하므로 trusted click 으로 끈다.
      const click = await trustedClickOnFlowView(AGENT_TOGGLE_SELECTOR, { required: true, step: 'agent-toggle-click' })
      await new Promise(r => setTimeout(r, 400))
      probe = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_PROBE)
      const off = !!probe && !probe.on
      console.log('[Flow API] ensureAgentOff: trusted-click', click?.success, '→ nowOn:', probe?.on, off ? '(OFF ✓)' : '(still ON ✗)')
      if (!off) await reportAgentToggleFailure(flowView, 'ensureAgentOff', 'still_on', { clicked: !!click?.success })
      return { success: off, state: off ? 'turned_off' : 'still_on' }
    } catch (e) {
      // 배포에서 실제로 터진 자리 — 주입 스크립트의 ReferenceError 가 "Script failed to execute"
      //   로 올라온다. 여기에 계측이 없어 우리는 눈을 감고 있었다.
      console.warn('[Flow API] ensureAgentOff failed:', e.message)
      await reportAgentToggleFailure(flowView, 'ensureAgentOff', 'probe_threw', { error: e.message })
      return { success: false, error: e.message }
    }
  }

  // ─── ensureAgentOn ────────────────────────────────────────────
  /**
   * Force Flow's compose "Agent" toggle ON (Maps-grounded, address-based generation).
   * ensureAgentOff 의 미러 — already_on 도 success=true. Agent ON 경로(flowAgentOn)에서만 호출.
   */
  async function ensureAgentOn() {
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'No flowView' }
    try {
      // 선제적으로 대화창 + "에이전트 설정"(기본값) 패널을 모두 닫는다(ensureAgentOff 와 동일 헬퍼).
      //   둘 중 어느 쪽이 토글을 가리는지 불확실해도 둘 다 닫으면 된다.
      await closeAgentPanels(flowView)
      let probe = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_PROBE)
      // 그래도 토글이 안 보이면(여전히 가림) 재시도하며 닫는다.
      for (let i = 0; i < 4 && (!probe || !probe.found); i++) {
        console.log('[Flow API] ensureAgentOn: toggle hidden — closing covering panel attempt', i + 1)
        await closeAgentPanels(flowView)
        probe = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_PROBE)
      }
      if (!probe || !probe.found) {
        console.log('[Flow API] ensureAgentOn: toggle not found (panel close retries exhausted)')
        await reportAgentToggleFailure(flowView, 'ensureAgentOn', 'not_found')
        return { success: false, state: 'not_found' }
      }
      if (probe.on) {
        console.log('[Flow API] ensureAgentOn: already ON')
        return { success: true, state: 'already_on' }
      }
      const click = await trustedClickOnFlowView(AGENT_TOGGLE_SELECTOR, { required: true, step: 'agent-toggle-click' })
      await new Promise(r => setTimeout(r, 400))
      probe = await flowView.webContents.executeJavaScript(AGENT_TOGGLE_PROBE)
      const on = !!probe && !!probe.on
      console.log('[Flow API] ensureAgentOn: trusted-click', click?.success, '→ nowOn:', probe?.on, on ? '(ON ✓)' : '(still OFF ✗)')
      if (!on) await reportAgentToggleFailure(flowView, 'ensureAgentOn', 'still_off', { clicked: !!click?.success })
      return { success: on, state: on ? 'turned_on' : 'still_off' }
    } catch (e) {
      console.warn('[Flow API] ensureAgentOn failed:', e.message)
      await reportAgentToggleFailure(flowView, 'ensureAgentOn', 'probe_threw', { error: e.message })
      return { success: false, error: e.message }
    }
  }

  // ─── selectFlowModeTab ────────────────────────────────────────
  /**
   * Select the compose IMAGE/VIDEO mode tab (visible when Agent is OFF).
   * 'already' | 'clicked' | 'not_found'. not_found ⇒ Agent 가 아직 ON (탭 없음).
   */
  async function selectFlowModeTab(mode) {
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'No flowView' }
    try {
      const r = await flowView.webContents.executeJavaScript(buildSelectModeScript(mode))
      console.log(`[Flow API] selectFlowModeTab(${mode}):`, r)
      return { success: r !== 'not_found', state: r }
    } catch (e) {
      console.warn('[Flow API] selectFlowModeTab failed:', e.message)
      return { success: false, error: e.message }
    }
  }

  // ─── applyAgentDefaults ───────────────────────────────────────
  /**
   * Set Flow's "에이전트 설정" panel image/video generation defaults
   * (aspect ratio, batch count, model) and click 저장. Replaces the legacy
   * popup-menu path (configureFlowMode) which no longer matches Flow's UI.
   *
   * @param {object} opts
   * @param {{aspectRatio?:string,count?:number,model?:string}} [opts.image]
   * @param {{aspectRatio?:string,count?:number,model?:string}} [opts.video]
   * @param {boolean} [opts.save=true]
   * @returns {Promise<{success:boolean,result?:object,error?:string}>}
   */
  async function applyAgentDefaults(opts = {}) {
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'No flowView' }

    const script = buildAgentDefaultsScript(opts)
    const maxAttempts = 3
    // #R34-fix(2): 패널을 찾았지만 요청 필드(aspect/model)가 미적용이면 재시도한다. 단 끝까지 미적용이어도
    //   "패널을 찾은 경우"는 success:true 로 두되 applied:false 신호를 준다 — 호출측이 생성을 막지 않도록.
    //   (패널이 상황에 따라 없을 수 있어(Agent OFF/첫 씬 등) 하드 블록하면 정상 생성까지 막힌다.
    //    잘못된 화면비/모델은 복구 가능하지만 생성 불가는 아님.) 패널 자체를 못 찾은 경우만 success:false.
    let lastPanelResult = null
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await flowView.webContents.executeJavaScript(script)
        if (result && result.ok) {
          lastPanelResult = result
          if (agentDefaultsApplied(opts, result)) {
            console.log('[Flow AgentDefaults] applied:',
              'approval=', result.approval,
              'image=', JSON.stringify(result.image), 'video=', JSON.stringify(result.video),
              'saved=', result.saved, 'panelClosed=', result.panelClosed)
            return { success: true, applied: true, result }
          }
          console.warn(`[Flow AgentDefaults] attempt ${attempt + 1}/${maxAttempts} panel found but requested field(s) not applied — retrying:`,
            `image=${JSON.stringify(result.image)} video=${JSON.stringify(result.video)}`)
        } else {
          console.warn(`[Flow AgentDefaults] attempt ${attempt + 1}/${maxAttempts} failed:`, result && result.error)
        }
      } catch (e) {
        console.warn(`[Flow AgentDefaults] attempt ${attempt + 1} error:`, e.message)
      }
      await new Promise(r => setTimeout(r, 500 + attempt * 300))
    }
    // 패널은 찾았지만 필드가 끝내 미적용 → 생성은 막지 않는다(applied:false 로 신호만).
    if (lastPanelResult) {
      console.warn('[Flow AgentDefaults] panel found but requested defaults not fully applied after retries — proceeding')
      return { success: true, applied: false, result: lastPanelResult }
    }
    // 패널 자체를 못 찾음(정상 상황일 수 있음) → success:false 지만 호출측은 경고 후 진행한다.
    return { success: false, error: 'panel not configured after retries' }
  }

  // ─── listAgentModels (동적 모델 목록 스크랩) ───────────────────
  async function listAgentModels() {
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'No flowView' }
    try {
      const r = await flowView.webContents.executeJavaScript(buildListModelsScript())
      if (r && r.ok) return { success: true, image: r.image, video: r.video }
      return { success: false, error: (r && r.error) || 'list failed' }
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  }

  // ─── ensureOnProjectComposer ──────────────────────────────────
  /**
   * Guard: verify Flow page is on the composer of the TARGET project before DOM mutation.
   *
   * Codex #R4-4: generation handlers previously only checked "some project page"
   * (or no page at all), allowing generation to run in the wrong Flow project after
   * navigation/startup-drift/switch races.
   *
   * Behaviour:
   *   - If projectId is FALSY: fall back to the lenient "some /project/ page" check
   *     (preserves unbound/startup-flow behavior — don't break callers that haven't
   *     bound a Flow project yet).
   *   - If projectId is PROVIDED and the URL is NOT on /project/${projectId}: attempt
   *     to navigate to the target project (reuses the same loadURL path as flow:open-project
   *     in dom.js), wait up to 3 s for the URL to confirm, then re-check.
   *   - Returns { ok: true }  when confirmed on target project.
   *   - Returns { ok: false, error: '…' } (FAIL CLOSED) when the URL can't be confirmed —
   *     the caller must abort and NOT mutate.
   *
   * @param {Electron.WebContentsView} flowView
   * @param {string|null|undefined} projectId  Bound Flow project UUID, or falsy if unbound.
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  /**
   * 대상 프로젝트 URL 위에 있을 때, 페이지가 진짜 로드됐는지(에러 페이지가 아닌지) 확인한다.
   * 에러면 flow:open-project 와 동일하게 home(base) 경유로 한 번 복구를 시도한다 — 갤러리 클릭
   * (앱 셸 로드 후 client-side 네비)과 같은 경로라 대체로 살아난다.
   *
   * 프로브를 못 읽으면(null/throw) 통과시킨다 — 판정 불가를 실패로 처리하면 멀쩡한 생성을 막는다.
   */
  async function ensureProjectLoaded(flowView, projectId) {
    // ⚠️ throw 와 "판정 불가" 를 구분한다. 예전엔 둘 다 null 로 뭉개고 null 을 "정상"으로 취급해,
    //    렌더러가 죽어 페이지를 읽지도 못하는 상태에서 {ok:true} 를 내주고 DOM 조작을 허가했다.
    //    네비 중엔 일시적으로 throw 할 수 있으니 한 번은 재시도하고, 그래도 못 읽으면 멈춘다.
    const probeOnce = async () => {
      try { return { read: true, page: await flowView.webContents.executeJavaScript(FLOW_PAGE_PROBE_JS) } }
      catch (e) { return { read: false, error: e.message } }
    }
    const probe = async () => {
      let r = await probeOnce()
      if (r.read) return r
      await new Promise((res) => setTimeout(res, 800))
      return probeOnce()
    }

    let r = await probe()
    if (!r.read) {
      await reportDomFailure('project-probe-unreadable', 'probe_threw', { projectId, error: r.error })
      return {
        ok: false,
        errorKind: 'flow-page-unreadable',
        error: 'Could not read the Flow page',
      }
    }
    // ⚠️ probe 결과는 **그것이 읽힌 페이지** 에 대해서만 유효하다. 밖에서 getURL() 을 다시 부르면
    //    A→B→A 로 오간 경우 B 의 결과를 A 의 것으로 오인한다(ABA). probe 가 같은 컨텍스트에서 돌려준
    //    url 로 짝을 맞춘다.
    if (!onProjectComposerUrl(r.page?.url || '', projectId)) {
      return {
        ok: false,
        errorKind: 'flow-project-changed',
        error: 'Flow project changed during generation',
      }
    }
    let page = r.page
    if (!page || !isFlowErrorPage(page)) return { ok: true }

    console.warn('[Flow Guard] project URL but page is not loaded (error/landing) — recovering via home')
    const m = safeUrl(flowView).match(/^(.*\/tools\/flow)(\/|$)/)
    const base = m ? m[1] : 'https://labs.google/fx/tools/flow'
    // loadURL 은 파괴된 webContents 에서 **동기로** throw 한다 — .catch() 는 promise rejection 만 잡는다.
    const safeLoad = async (u) => { try { await flowView.webContents.loadURL(u) } catch { /* 파괴/중단 */ } }
    await safeLoad(base)
    await new Promise((r) => setTimeout(r, 1500))
    await safeLoad(`${base}/project/${projectId}`)
    await new Promise((r) => setTimeout(r, 2000))

    // ⚠️ 페이지가 "리치"하다는 것만으로 복구를 선언하면 안 된다 — home 화면도 인터랙티브 요소가
    //   많아 isFlowErrorPage 를 통과한다. target 재진입이 실패해 home 에 머물러 있어도 ok:true 가
    //   나고, 그다음 DOM 조작이 엉뚱한 페이지에서 돈다. URL 이 대상 프로젝트인지 반드시 다시 본다.
    r = await probe()
    page = r.read ? r.page : null
    const backOnTarget = onProjectComposerUrl(page?.url || '', projectId)   // probe 가 읽은 그 페이지의 url
    if (backOnTarget && r.read && (!page || !isFlowErrorPage(page))) {
      console.log('[Flow Guard] project recovered after home re-nav')
      return { ok: true }
    }

    await reportDomFailure('project-not-loaded', 'flow_error_page', { projectId, interactiveCount: page?.interactiveCount ?? null })
    // 사용자가 읽는 문구 — 진짜 원인을 말한다. "모든 미디어 화면인지 확인하세요"가 제보자를
    //   (그리고 우리를) 엉뚱한 곳으로 몇 시간 보냈다.
    return {
      ok: false,
      errorKind: 'flow-project-open-failed',
      error: 'Could not open the Flow project',
    }
  }

  /**
   * URL 이 대상 프로젝트의 **컴포저**인가. #R20-6: /project/{id}/characters · /character/{...} 같은
   * 하위 라우트는 컴포저가 아니다(거기에 프롬프트를 주입하면 엉뚱한 곳에 들어간다).
   * ⚠️ 초기 체크에만 이 제외가 있었고 복구·폴링 경로는 단순 includes 라, 대기 중 사용자가
   *    /characters 로 넘어가면 그 페이지를 "대상 프로젝트"로 승인했다. 한 곳에서 판정한다.
   */
  // Flow 컴포저로 인정하는 하위 경로. 그 외(/characters, /settings, 알 수 없는 라우트)는 컴포저가
  //   아니므로 거기에 프롬프트를 주입하면 안 된다 — 모르면 막고 진단을 남긴다.
  const COMPOSER_SUBPATHS = new Set(['', '/', '/all-media'])

  function onProjectComposerUrl(url, projectId) {
    // ⚠️ substring 으로 보면 "…/tools/flow/?next=/project/<id>"(쿼리), "/archive/project/<id>"(다른 라우트),
    //    "/project/<id>-suffix"(다른 id), 심지어 다른 origin 도 통과한다 — 전부 실측으로 확인됐다.
    //    origin 과 pathname 을 정확히 본다.
    // ⚠️ projectId 는 **한 경로 세그먼트** 여야 한다. 저장값에 '/' 가 섞이면("abc/characters")
    //    /project/abc/characters 가 통째로 id 로 매칭돼 캐릭터 페이지를 컴포저로 승인한다.
    if (!/^[A-Za-z0-9._~-]+$/.test(String(projectId))) return false
    let u
    try { u = new URL(url) } catch { return false }
    if (u.hostname.toLowerCase() !== 'labs.google') return false
    // ⚠️ projectId 를 정규식에 그대로 넣으면 저장값이 "[" 같을 때 SyntaxError 로 **던진다** —
    //    가드가 {ok:false} 를 반환하는 대신 reject 된다. 이스케이프한다.
    const esc = String(projectId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = u.pathname.match(new RegExp(`/tools/flow/project/${esc}(/[^/]*)?$`))
    if (!m) return false
    return COMPOSER_SUBPATHS.has(m[1] || '')
  }

  /** getURL 은 뷰/렌더러가 파괴되면 throw 한다 — 가드가 {ok:false} 대신 reject 되면 안 된다. */
  function safeUrl(flowView) {
    try { return flowView.webContents.getURL() || '' } catch { return '' }
  }

  async function ensureOnProjectComposer(flowView, projectId) {
    if (!flowView) return { ok: false, error: 'Flow view not ready' }

    const currentUrl = safeUrl(flowView)

    // Falsy projectId → lenient fallback: any /project/ or /tools/flow/ page is acceptable.
    if (!projectId) {
      const onSomePage = currentUrl.includes('/project/') || currentUrl.includes('/tools/flow/')
      return onSomePage
        ? { ok: true }
        : { ok: false, error: 'Not on a Flow project page' }
    }

    // Specific projectId → enforce exact project URL.
    // #R20-6: /project/{id}/characters · /character/{...} 등 하위 라우트는 컴포저가 아니므로 제외
    //   (안 그러면 scene 프롬프트가 엉뚱한 컴포저에 주입된다). base 컴포저 경로만 ok.
    {
      if (onProjectComposerUrl(currentUrl, projectId)) {
        // ⚠️ URL 만으로는 부족하다. Flow 가 프로젝트를 못 띄우면 "문제가 발생했습니다" 에러 페이지를
        //   보여주는데, 이때 URL 은 /project/{id} 그대로다. 그대로 통과시키면 컴포저가 없는 페이지에서
        //   생성이 진행되고, ensureAgentOff 가 토글을 못 찾아 "Agent 를 OFF 로 못 바꿨다"는 엉뚱한
        //   에러가 사용자에게 뜬다(실제 원인은 프로젝트 미로드). 실제 제보가 이 경로였다.
        return await ensureProjectLoaded(flowView, projectId)
      }
    }

    // Not on the target project — attempt navigation (same logic as flow:open-project in dom.js).
    const m = currentUrl.match(/^(.*\/tools\/flow)(\/|$)/)
    const base = m ? m[1] : 'https://labs.google/fx/tools/flow'
    const target = `${base}/project/${projectId}`
    console.log('[Flow Guard] Not on target project, navigating:', target)
    try {
      await flowView.webContents.loadURL(target).catch((e) =>
        console.warn('[Flow Guard] loadURL failed:', e.message))
    } catch (e) {
      console.warn('[Flow Guard] loadURL threw:', e.message)
    }

    // Poll up to 3 s for URL to confirm (6 × 500 ms).
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 500))
      if (onProjectComposerUrl(safeUrl(flowView), projectId)) {
        console.log('[Flow Guard] Confirmed on target project after navigation')
        // URL 만 맞은 것일 수 있다 — 우리가 방금 한 loadURL 도 에러 페이지로 떨어질 수 있다.
        return await ensureProjectLoaded(flowView, projectId)
      }
    }

    const finalUrl = safeUrl(flowView)
    console.warn('[Flow Guard] Failed to reach target project. Current URL:', finalUrl)
    return { ok: false, error: `Flow not on target project ${projectId}` }
  }

  // ─── Return all helpers ───────────────────────────────────────
  return {
    trustedClickOnFlowView,
    parseFlowResponse,
    sessionFetch,
    flowPageFetch,
    getRecaptchaToken,
    extractMediaIds,
    extractFifeUrls,
    extractBase64Images,
    fetchMediaAsBase64,
    configureFlowMode,
    switchFlowToVideoMode,
    applyAgentDefaults,
    listAgentModels,
    ensureAgentOff,
    ensureAgentOn,
    selectFlowModeTab,
    ensureOnProjectComposer,
  }
}
