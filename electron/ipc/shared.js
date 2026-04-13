/**
 * Shared helper functions for Flow API IPC modules.
 *
 * trustedClickOnFlowView, parseFlowResponse, sessionFetch, flowPageFetch,
 * getRecaptchaToken, extract*, fetchMediaAsBase64, configureFlowMode.
 *
 * These are used by flow-api.js, video.js, dom.js via deps injection from main.js.
 */

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
  const { getFlowView, getMainWindow, constants } = ctx
  const {
    SESSION_URL, MEDIA_REDIRECT_URL, RECAPTCHA_SITE_KEY, RECAPTCHA_ACTION,
  } = constants

  // ─── trustedClickOnFlowView ───────────────────────────────────
  /**
   * flowView를 일시적으로 보이게 한 후 sendInputEvent로 trusted click을 보내는 헬퍼
   * b.click()은 isTrusted: false라 Flow 페이지가 무시함 → sendInputEvent 필수
   * sendInputEvent는 viewport가 0x0이면 좌표가 의미없으므로 일시적으로 보이게 해야 함
   */
  async function trustedClickOnFlowView(jsSelector) {
    const mainWindow = getMainWindow()
    const flowView = getFlowView()
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
  async function flowPageFetch(url, { method = 'POST', headers = {}, body } = {}) {
    const flowView = getFlowView()
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

  // ─── getRecaptchaToken ────────────────────────────────────────
  /**
   * Flow 페이지의 grecaptcha.enterprise를 사용하여 reCAPTCHA 토큰 획득
   * AutoFlow와 동일한 방식 (sidepanel.js:20097-20108)
   */
  async function getRecaptchaToken() {
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
  async function configureFlowMode(targetMode = 'VIDEO', batchCount = 1) {
    const flowView = getFlowView()
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

    return { success: false, error: `Mode ${targetMode} not set after ${maxAttempts} attempts` }
  }

  // ─── switchFlowToVideoMode ────────────────────────────────────
  /** 하위 호환 래퍼 */
  async function switchFlowToVideoMode() {
    return configureFlowMode('VIDEO', 1)
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
  }
}
