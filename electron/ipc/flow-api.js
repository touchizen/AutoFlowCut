/**
 * Electron IPC Handler - Flow API Operations
 *
 * Image generation, media fetch, reference upload, token management.
 * All operations use Flow page context (cookies, reCAPTCHA) via deps.
 */

import path from 'node:path'
import { net } from 'electron'

/**
 * Register all Flow API IPC handlers.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object} deps - Shared dependencies injected from main process
 */
export function registerFlowAPIIPC(ipcMain, deps) {
  const {
    getFlowView, getMainWindow, trustedClickOnFlowView, sessionFetch, flowPageFetch,
    parseFlowResponse, getRecaptchaToken, extractMediaIds, extractFifeUrls,
    extractBase64Images, fetchMediaAsBase64, configureFlowMode,
    getCapturedProjectId, setCapturedProjectId,
    getPendingGeneration, setPendingGeneration,
    pendingGenerations,
    getPendingReferenceImages, setPendingReferenceImages,
    getPendingSeedValue, setPendingSeedValue,
    getEnterToolClicked, setEnterToolClicked,
    SESSION_URL, TOKEN_INFO_URL, FLOW_URL, MEDIA_REDIRECT_URL, UPLOAD_URL,
    API_HEADERS, GENERATE_URL, BASE_API_URL,
  } = deps

  // Extract Flow access token from session
  ipcMain.handle('flow:extract-token', async () => {
    console.log('[Flow API] extract-token called')
    const flowView = getFlowView()
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
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    // 이미 캡처된 projectId가 있으면 반환
    if (getCapturedProjectId()) {
      return { success: true, projectId: getCapturedProjectId() }
    }

    try {
      // 방법 1: URL에서 추출 (project/UUID 패턴)
      const url = flowView.webContents.getURL()
      const match = url.match(/project\/([a-f0-9-]{36})/)
      if (match) {
        setCapturedProjectId(match[1])
        return { success: true, projectId: getCapturedProjectId() }
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
        setCapturedProjectId(pid)
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
    token, prompt, aspectRatio, seed, model, projectId, referenceImages, batchCount,
    asyncMode  // true: 제출만 하고 즉시 반환 (비동기 배치용)
  }) => {
    console.log('[Flow API] generate-image:', { prompt: prompt?.substring(0, 50), model, aspectRatio, seed: (seed ?? 'random') })
    if (!prompt) return { success: false, error: 'No prompt' }
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    // Seed: 숫자면 CDP Fetch 인터셉션에서 사용, null이면 Flow 자체 랜덤 seed 유지
    setPendingSeedValue(typeof seed === 'number' && Number.isFinite(seed) ? seed : null)

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
              setEnterToolClicked(true) // 무한루프 방지

              // 프로젝트 생성 대기 (최대 15초)
              for (let w = 0; w < 30; w++) {
                await new Promise(r => setTimeout(r, 500))
                const projUrl = flowView.webContents.getURL()
                if (projUrl.includes('/project/')) {
                  const m = projUrl.match(/\/project\/([a-f0-9-]{36})/)
                  if (m) setCapturedProjectId(m[1])
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

      // 0.8. 이미지 모드 + 배치 설정 (Settings에서 전달받은 값 사용, 기본 x2)
      const effectiveBatchCount = Math.max(1, Math.min(4, batchCount || 2))
      const modeResult = await configureFlowMode('IMAGE', effectiveBatchCount)
      if (modeResult.success) {
        console.log('[Flow API] Image mode configured:', modeResult.method, 'batch:', modeResult.batch)
      } else {
        console.warn('[Flow API] Image mode config failed (continuing anyway):', modeResult.error)
      }

      // 0.9. CDP Fetch 인터셉션 설정 (레퍼런스 이미지 주입 + seed 테스트)
      //   batchGenerateImages 요청을 가로채서 imageInputs / seed 수정
      //   [SEED TEST] 항상 활성화 — main.js에서 body 로깅 + seed:12345 주입
      if (referenceImages && referenceImages.length > 0) {
        setPendingReferenceImages(referenceImages)
      }
      try {
        await flowView.webContents.debugger.sendCommand('Fetch.enable', {
          patterns: [{ urlPattern: '*batchGenerateImages*', requestStage: 'Request' }]
        })
        cdpFetchEnabled = true
        console.log('[Flow API] [Fetch] Interception enabled (refs:',
          (referenceImages?.length || 0), ', seedTestMode: true)')
      } catch (e) {
        console.warn('[Flow API] [Fetch] Fetch.enable failed:', e.message)
        setPendingReferenceImages(null)
      }

      // 1. 네트워크 응답 캡처 Promise 설정 (동기 모드만)
      // ★ pendingGeneration은 Generate 버튼 클릭 직후에 설정한다!
      //   프롬프트 주입 시 Slate의 input/change 이벤트가 Flow 자동생성을 트리거할 수 있음.
      //   pendingGeneration을 미리 설정하면 자동생성 응답이 캡처되고,
      //   실제 버튼 클릭의 응답은 무시되는 문제가 발생한다.
      let resolveGeneration = null
      let generationTimeout = null
      let responsePromise = null
      if (!asyncMode) {
        responsePromise = new Promise((resolve) => {
          generationTimeout = setTimeout(() => {
            if (getPendingGeneration()) {
              setPendingGeneration(null)
              resolve({ error: true, message: 'Response timeout (120s)' })
            }
          }, 120000)
          resolveGeneration = resolve
        })
      }

      // 2. 기존 blob URL 스냅샷 (fallback용)
      let existingBlobs = []
      try {
        existingBlobs = await flowView.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('img[src^="blob:"]')).map(img => img.src)`
        ) || []
      } catch {}

      // 3. 프롬프트 입력 (Slate.js 에디터 — AutoFlow 역공학)
      // execCommand 방식이 작동하려면 flowView가 보여야 함 (focus 필요)
      const mainWindow = getMainWindow()
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

      // ★ Generate 버튼 클릭 성공 직후 즉시 pending 설정!
      //   버튼 클릭이 batchGenerateImages 요청을 트리거하므로,
      //   expectedImageCount 감지 전에 먼저 설정해야 CDP 핸들러가 응답을 캡처할 수 있다.
      //   2초 버퍼: 클릭과 네트워크 요청 사이의 wallTime 차이를 보정
      const generationSetAt = Date.now() / 1000 - 2  // 2초 전부터 유효 (stale 필터 보정)
      let generationId = null  // 비동기 모드에서만 사용

      if (asyncMode) {
        // === 비동기 모드: pendingGenerations Map에 등록 ===
        generationId = `gen-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
        pendingGenerations.set(generationId, {
          setAt: generationSetAt,
          expectedCount: 1,
          responses: [],
          collectionTimer: null,
          completed: false,
          token  // 나중에 이미지 fetch용
        })
        console.log('[Flow API] [Async] pendingGenerations set:', generationId,
          '(setAt:', generationSetAt.toFixed(3), ')')
      } else {
        // === 동기 모드: 기존 pendingGeneration 설정 ===
        setPendingGeneration({
          setAt: generationSetAt,
          expectedCount: 1,
          responses: [],
          collectionTimer: null,
          resolve: (result) => {
            clearTimeout(generationTimeout)
            const pg = getPendingGeneration()
            if (pg?.collectionTimer) clearTimeout(pg.collectionTimer)
            resolveGeneration(result)
          }
        })
        console.log('[Flow API] [DOM+Net] pendingGeneration set IMMEDIATELY after click (setAt:',
          generationSetAt.toFixed(3), ')')
      }

      // 예상 이미지 개수 감지 (x1/x2/x3/x4 선택 버튼에서)
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

      // expectedCount 업데이트
      if (asyncMode) {
        const ag = pendingGenerations.get(generationId)
        if (ag) ag.expectedCount = expectedImageCount
        console.log('[Flow API] [Async] expectedCount updated to', expectedImageCount,
          'for gen:', generationId)

        // 비동기 모드: Fetch 인터셉션 정리 후 즉시 반환
        await new Promise(r => setTimeout(r, 2000))  // 요청이 나갈 시간 확보
        if (cdpFetchEnabled) {
          setPendingReferenceImages(null)
          try { await flowView.webContents.debugger.sendCommand('Fetch.disable') } catch {}
          cdpFetchEnabled = false
        }
        return { success: true, generationId, submitted: true }
      }

      // === 동기 모드: 기존 대기 로직 ===
      const pg = getPendingGeneration()
      if (pg) {
        pg.expectedCount = expectedImageCount
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
      setPendingGeneration(null)
      return { success: false, error: e.message }
    } finally {
      // CDP Fetch 인터셉션 정리
      if (cdpFetchEnabled) {
        setPendingReferenceImages(null)
        try {
          const flowView = getFlowView()
          await flowView.webContents.debugger.sendCommand('Fetch.disable')
          console.log('[Flow API] [Fetch] Interception disabled')
        } catch (e) {
          // Fetch.disable 실패해도 무시 (디버거 분리 등)
        }
      }
    }
  })

  // ─── 비동기 생성 결과 조회 (폴링용) ───
  ipcMain.handle('flow:check-generation', async (event, { generationId }) => {
    if (!generationId) return { success: false, error: 'No generationId' }
    const gen = pendingGenerations.get(generationId)
    if (!gen) return { success: false, error: 'Generation not found', notFound: true }
    return {
      success: true,
      completed: gen.completed,
      responseCount: gen.responses.length,
      expectedCount: gen.expectedCount
    }
  })

  // ─── 비동기 생성 결과 수집 + 파싱 (완료 후 호출) ───
  ipcMain.handle('flow:collect-generation', async (event, { generationId, token }) => {
    if (!generationId) return { success: false, error: 'No generationId' }
    const gen = pendingGenerations.get(generationId)
    if (!gen) return { success: false, error: 'Generation not found', notFound: true }
    if (!gen.completed) return { success: false, error: 'Generation not completed yet' }

    // 타이머 정리 + Map에서 제거
    if (gen.collectionTimer) clearTimeout(gen.collectionTimer)
    pendingGenerations.delete(generationId)

    console.log('[Flow API] [AsyncCollect] Parsing results for gen:', generationId,
      'responses:', gen.responses.length)

    // 응답 파싱 (flow:generate-image 동기 모드와 동일한 로직)
    const successResponses = gen.responses.filter(r => !r.error)
    const failedCount = gen.responses.filter(r => r.error).length
    const allImages = []
    const allErrors = []

    const useToken = token || gen.token || null

    for (const resp of successResponses) {
      const data = parseFlowResponse(resp.body)
      if (!data) { allErrors.push('Failed to parse response'); continue }
      if (data.error) { allErrors.push(data.error.message || JSON.stringify(data.error)); continue }

      // base64 이미지 직접 추출
      const base64Images = extractBase64Images(data)
      if (base64Images.length > 0) { allImages.push(...base64Images); continue }

      // fifeUrl 직접 다운로드
      const fifeResults = extractFifeUrls(data)
      if (fifeResults.length > 0) {
        for (const { fifeUrl, mediaId } of fifeResults) {
          try {
            const res = await sessionFetch(fifeUrl)
            if (!res.ok) throw new Error(`fifeUrl fetch HTTP ${res.status}`)
            const buffer = await res.arrayBuffer()
            const base64Raw = Buffer.from(buffer).toString('base64')
            const contentType = res.headers.get('content-type') || 'image/png'
            allImages.push({ base64: `data:${contentType};base64,${base64Raw}`, mediaId })
          } catch (fifeErr) {
            allErrors.push(fifeErr.message)
          }
        }
        if (allImages.length > 0) continue
      }

      // mediaId fallback
      const mediaIds = extractMediaIds(data)
      if (mediaIds.length > 0 && useToken) {
        for (const id of mediaIds) {
          try {
            const base64 = await fetchMediaAsBase64(useToken, id)
            allImages.push({ base64, mediaId: id })
          } catch (fetchErr) {
            allErrors.push(fetchErr.message)
          }
        }
        continue
      }
      allErrors.push('No images in response')
    }

    console.log('[Flow API] [AsyncCollect] Total images:', allImages.length,
      '(errors:', allErrors.length, ', failed:', failedCount, ')')

    if (allImages.length > 0) {
      return { success: true, images: allImages }
    }
    return { success: false, error: allErrors.join('; ') || 'No images generated' }
  })

  // ─── 비동기 생성 일괄 정리 (배치 종료 시) ───
  ipcMain.handle('flow:clear-generations', async () => {
    for (const [id, gen] of pendingGenerations) {
      if (gen.collectionTimer) clearTimeout(gen.collectionTimer)
    }
    const count = pendingGenerations.size
    pendingGenerations.clear()
    console.log('[Flow API] [AsyncClear] Cleared', count, 'pending generations')
    return { success: true, cleared: count }
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
      console.log('[Flow VideoDownload] Downloaded, size:', buffer.byteLength, 'type:', contentType)
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
    const flowView = getFlowView()
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
          // strict 매칭(1~3순위)은 mediaId 가 DOM 어딘가에 박혀 있어야 함.
          // allowFallback=true 면 4순위로 "마지막 video" 를 반환하는데,
          // 배치 처리 중엔 이전 생성물이 갤러리에 남아있을 수 있어 위험하다.
          // 폴링 헬퍼(waitForVideoElement)에서는 반드시 false 로 호출해 잘못된
          // 영상이 선택되지 않도록 한다.
          function findVideoElement(uuid, opts) {
            const allowFallback = opts && opts.allowFallback !== undefined ? opts.allowFallback : true
            if (!uuid) return null

            // 1순위: <video src> 또는 <source src> 에 UUID 포함
            for (const el of document.querySelectorAll('video[src], video source[src]')) {
              const src = el.getAttribute('src') || ''
              const resolved = el.src || ''
              if (src.includes(uuid) || resolved.includes(uuid)) {
                return el.tagName === 'SOURCE' ? el.closest('video') : el
              }
            }

            // 2순위: <video poster> 에 UUID 포함 (T2V 갤러리는 보통 poster만 먼저 로드됨)
            for (const el of document.querySelectorAll('video[poster]')) {
              const poster = el.getAttribute('poster') || ''
              if (poster.includes(uuid)) {
                return el
              }
            }

            // 3순위: data-* 속성에 UUID 가 박힌 컨테이너 → 그 안의 video
            // (Flow UI 가 data-id, data-media-id 등으로 타일을 표시하는 케이스)
            for (const el of document.querySelectorAll(
              '[data-id*="' + uuid + '"], [data-media-id*="' + uuid + '"], [data-name*="' + uuid + '"]'
            )) {
              const v = el.tagName === 'VIDEO' ? el : (el.querySelector('video') || el.closest('video'))
              if (v) return v
            }

            // 4순위(fallback): 마지막 <video> — 명시적으로 허용한 호출자만 사용.
            // 배치 컨텍스트에선 절대 쓰면 안 됨(이전 생성물이 잡힐 수 있음).
            if (allowFallback) {
              const allVideos = document.querySelectorAll('video[src], video[poster]')
              if (allVideos.length > 0) {
                LOG('UUID match failed across all selectors, using last video element as fallback')
                return allVideos[allVideos.length - 1]
              }
            }
            return null
          }

          // --- Helper: waitForVideoElement (폴링, strict-only) ---
          // T2V 결과는 generation-status complete 직후 DOM에 즉시 추가되지 않는 경우가
          // 있어, 최대 15초까지 폴링하며 대기한다. 발견되면 즉시 반환.
          // ⚠️ fallback 비활성화: 배치 처리 중 갤러리에 이전 생성물이 남아있을 때
          //    fallback이 활성화되면 첫 폴링에 잘못된 영상이 즉시 잡혀 폴링 의미가
          //    사라지고 silent data corruption 이 발생한다(원래 영상 자리에 다른 영상
          //    저장됨). 폴링 후에도 못 찾으면 null 반환 → 상위 폴백(direct URL,
          //    fetchMedia)이 처리하도록 한다.
          async function waitForVideoElement(uuid, maxMs = 15000, intervalMs = 500) {
            const t0 = Date.now()
            let attempt = 0
            while (Date.now() - t0 < maxMs) {
              const v = findVideoElement(uuid, { allowFallback: false })
              if (v) {
                if (attempt > 0) LOG('Video element appeared after ' + (Date.now() - t0) + 'ms')
                return v
              }
              attempt++
              await new Promise(r => setTimeout(r, intervalMs))
            }
            LOG('waitForVideoElement timeout after ' + maxMs + 'ms (strict match only, no fallback)')
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
            // 1. 비디오 요소 찾기 — 폴링 (T2V 결과는 status complete 직후 DOM에 즉시
            //    추가되지 않는 경우가 있어, 최대 15초 대기)
            LOG('Finding video element for: ' + mediaId.substring(0, 30))
            let targetVideo = await waitForVideoElement(mediaId, 15000, 500)
            if (!targetVideo) {
              return { success: false, error: 'Video element not found on page (15s timeout)' }
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
                LOG('Clicked resolution: ' + targetRes)
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
                  LOG('Clicked resolution (keyboard fallback): ' + targetRes)
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
        console.log('[Flow DOMDownload] Success! size:', data.length, 'type:', mimeType, 'resolution:', domResult?.resolution)

        // 정리
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}

        // domResult.resolution은 Step 2의 DOM 자동화가 실제 클릭한 해상도
        // ("720p"/"1080p"/"4K" — submenu에서 선택 성공) 또는 "default" (submenu 못 열림).
        // 상위 호출자가 요청 해상도와 비교해서 upscale 필요 여부 판단하게 그대로 전달.
        return { success: true, base64, resolution: domResult?.resolution || 'default' }
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
    const flowView = getFlowView()
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

  // ─── List User Projects (Flow archive — date list) ─────────────
  // 사용자의 Flow 프로젝트(=날짜별 세션) 목록을 가져온다.
  // 응답: result.data.json.result.projects[] → {projectId, projectInfo, creationTime}
  ipcMain.handle('flow:list-projects', async (event, { token, pageSize = 20 } = {}) => {
    try {
      const input = JSON.stringify({ json: { pageSize, toolName: 'PINHOLE' } })
      const url = `https://labs.google/fx/api/trpc/project.searchUserProjects?input=${encodeURIComponent(input)}`

      console.log('[Projects] Fetching project list, pageSize:', pageSize)
      const resp = await sessionFetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      })

      if (!resp.ok) {
        return { success: false, error: `List projects HTTP ${resp.status}`, items: [] }
      }

      const text = await resp.text()
      const data = parseFlowResponse(text)
      const projects =
        data?.result?.data?.json?.result?.projects ||
        data?.result?.data?.result?.projects ||
        []

      const items = projects.map(p => ({
        projectId: p.projectId || '',
        title: p.projectInfo?.projectTitle || p.projectId || '',
        thumbnailMediaKey: p.projectInfo?.thumbnailMediaKey || null,
        creationTime: p.creationTime || '',
      })).filter(p => p.projectId)

      console.log(`[Projects] ${items.length} projects extracted`)
      return { success: true, items }
    } catch (e) {
      console.error('[Projects] Error:', e.message)
      return { success: false, error: e.message, items: [] }
    }
  })

  // ─── Fetch Gallery (Project Images — uploads + generated) ─────────
  // Flow archive 뷰가 호출하는 project.getProjectContents 사용.
  // flow.projectInitialData 와 달리 사용자가 Flow UI로 직접 업로드한
  // 이미지(image.userUploadedImage)와 생성 이미지(image.generatedImage)
  // 모두 반환한다. 비디오는 제외.
  ipcMain.handle('flow:fetch-gallery', async (event, { token, projectId }) => {
    try {
      if (!projectId) {
        projectId = getCapturedProjectId?.()
      }
      if (!projectId) {
        return { success: false, error: 'No projectId available', items: [] }
      }

      const input = JSON.stringify({ json: { projectId } })
      const url = `https://labs.google/fx/api/trpc/project.getProjectContents?input=${encodeURIComponent(input)}`

      console.log('[Gallery] Fetching project contents for:', projectId.substring(0, 12) + '...')
      const resp = await sessionFetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      })

      if (!resp.ok) {
        return { success: false, error: `Gallery fetch failed: ${resp.status}`, items: [] }
      }

      const text = await resp.text()
      const data = parseFlowResponse(text)

      // 응답: result.data.json.result.{media[], workflows[], externalReferenceMedia[]}
      const root =
        data?.result?.data?.json?.result ||
        data?.result?.data?.result ||
        {}
      const media = Array.isArray(root.media) ? root.media : []
      const workflows = Array.isArray(root.workflows) ? root.workflows : []

      // workflowId → workflow.metadata.displayName 매핑 (원본 파일명 표시용)
      const workflowMap = new Map()
      for (const wf of workflows) {
        const wfId = String(wf?.name || wf?.workflowId || '')
        if (wfId) workflowMap.set(wfId, wf)
      }

      console.log(`[Gallery] Found ${media.length} media items, ${workflows.length} workflows`)

      // 모든 이미지 (업로드 + 생성). 비디오는 제외.
      const images = media.filter(m => m?.image && !m?.video)

      // media.getMediaUrlRedirect 는 ?name=<uuid> 만 받고 307로 CDN URL을 돌려준다.
      // 메모리 폭증 방지: 이미지 바이트를 가져오지 않고 redirect Location 만 추출해
      // 서명 CDN URL을 그대로 renderer 에 반환한다. (signed Expires 토큰이 있어
      // 인증 없이 <img src> 로 바로 렌더 가능.)
      //
      // ses.fetch / 브라우저 fetch 는 redirect:'manual'을 못 잡거나 opaque로 가려서
      // Location 을 못 읽는다. Electron 의 net.request 는 Flow 세션 쿠키를 그대로 쓰면서
      // 'redirect' 이벤트로 Location URL 을 직접 넘겨주므로 거기서 잡는다.
      const flowView = getFlowView()
      const flowSession = flowView?.webContents?.session
      const resolveMediaUrl = (mediaId) => new Promise((resolve, reject) => {
        const url = `${MEDIA_REDIRECT_URL}?name=${encodeURIComponent(mediaId)}`
        const req = net.request({
          method: 'GET',
          url,
          session: flowSession,
          useSessionCookies: true,
          redirect: 'manual',
        })
        req.setHeader('Authorization', `Bearer ${token}`)
        let settled = false
        const settle = (fn, val) => { if (!settled) { settled = true; fn(val) } }
        req.on('redirect', (_status, _method, redirectUrl) => {
          req.abort()
          settle(resolve, redirectUrl)
        })
        req.on('response', (response) => {
          // redirect:'manual'인데 200이 떨어졌다면 (인증 만료 → HTML 등) 실패 처리.
          settle(reject, new Error(`unexpected status ${response.statusCode}`))
          response.on('data', () => {})
        })
        req.on('error', (err) => settle(reject, err))
        req.end()
      })

      // 작은 동시성 풀 — 한 번에 N개만 redirect+CDN을 받아 base64 변환한다.
      // 무제한 Promise.all 은 이미지 많은 프로젝트에서 동시 fetch 폭주 + 메모리 스파이크 야기.
      const MEDIA_RESOLVE_CONCURRENCY = 6
      const resolveItem = async (m) => {
        const mediaId = m.name || m.mediaId || m.id || ''
        if (!mediaId) return null
        const wf = workflowMap.get(String(m.workflowId || ''))
        const displayName = wf?.metadata?.displayName || ''
        try {
          const cdnUrl = await resolveMediaUrl(mediaId)
          if (!cdnUrl) {
            console.warn('[Gallery] no URL resolved for', mediaId.substring(0, 8))
            return null
          }
          return { mediaId, url: cdnUrl, displayName }
        } catch (e) {
          console.warn('[Gallery] resolve url failed for', mediaId.substring(0, 8), e.message)
          return null
        }
      }
      const results = []
      for (let i = 0; i < images.length; i += MEDIA_RESOLVE_CONCURRENCY) {
        const slice = images.slice(i, i + MEDIA_RESOLVE_CONCURRENCY)
        const batch = await Promise.all(slice.map(resolveItem))
        results.push(...batch)
      }

      const filtered = results.filter(Boolean)
      console.log(`[Gallery] ${filtered.length} image items extracted`)
      return { success: true, items: filtered }
    } catch (e) {
      console.error('[Gallery] Error:', e.message)
      return { success: false, error: e.message, items: [] }
    }
  })

  // ─── Image Upscale (DOM 방식: three-dots → download → 해상도 선택 → 파일 캡처) ───
  // 비디오 DOM 다운로드와 동일한 패턴. Flow UI가 reCAPTCHA를 내부적으로 처리.
  ipcMain.handle('flow:upscale-image', async (event, { token, mediaId, projectId, resolution }) => {
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    if (!mediaId) return { success: false, error: 'No mediaId' }

    const normalizedRes = String(resolution || '2k').toLowerCase()
    const resText = normalizedRes === '4k' ? '4K' : '2K'

    console.log('[Flow Image Upscale] Starting DOM upscale — mediaId:', mediaId?.substring(0, 30), 'resolution:', resText)

    try {
      const fs = await import('node:fs')
      const os = await import('node:os')

      // Step 1: CDP로 다운로드 경로 설정 (save dialog 스킵)
      const tempDir = path.join(os.tmpdir(), `flow-img-up-${Date.now()}`)
      fs.mkdirSync(tempDir, { recursive: true })
      console.log('[Flow Image Upscale] Download dir:', tempDir)

      try {
        await flowView.webContents.debugger.sendCommand('Page.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: tempDir
        })
      } catch (cdpErr) {
        try {
          await flowView.webContents.debugger.sendCommand('Browser.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: tempDir,
            eventsEnabled: true
          })
        } catch {}
      }

      // Step 2: DOM 자동화 — 이미지 hover → three-dots → download → 해상도 선택
      const domResult = await flowView.webContents.executeJavaScript(`
        (async function() {
          const LOG = (msg) => console.log('[ImageUpscale] ' + msg)
          const mediaId = ${JSON.stringify(mediaId)}
          const resText = ${JSON.stringify(resText)}

          // --- Helpers (flow:dom-download-video와 동일) ---
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

          async function waitForMenu(ms = 2000) {
            const t0 = Date.now()
            while (Date.now() - t0 < ms) {
              const m = document.querySelector("[data-radix-menu-content][data-state='open'], [role='menu'][data-state='open']")
              if (m) return m
              await new Promise(r => setTimeout(r, 80))
            }
            return null
          }

          async function closeMenus() {
            for (let i = 0; i < 3; i++) {
              if (!document.querySelector("[data-radix-menu-content][data-state='open'], [role='menu'][data-state='open']")) break
              document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true }))
              await new Promise(r => setTimeout(r, 150))
            }
          }

          const ICON_SEL = "i, .material-symbols, .material-symbols-outlined, .google-symbols, [class*='material-symbols']"

          function findImageElement(uuid) {
            if (!uuid) return null
            for (const el of document.querySelectorAll('img[src]')) {
              const src = el.getAttribute('src') || ''
              const resolved = el.src || ''
              if (src.includes(uuid) || resolved.includes(uuid)) return el
            }
            return null
          }

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

          function findThreeDots(scope) {
            if (!scope) return null
            for (const icon of scope.querySelectorAll(ICON_SEL)) {
              const t = (icon.textContent || '').trim().toLowerCase()
              if (t === 'more_vert' || t === 'more_horiz')
                return icon.closest('button') || icon.parentElement
            }
            return null
          }

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
            // 1. 이미지 요소 찾기
            LOG('Finding image for: ' + mediaId.substring(0, 30))
            const targetImg = findImageElement(mediaId)
            if (!targetImg) {
              return { success: false, error: 'Image element not found on page' }
            }
            LOG('Found image, src: ' + (targetImg.getAttribute('src') || '').substring(0, 60))

            // 2. Hover — 오버레이 표시
            targetImg.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
            targetImg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
            let hoverNode = targetImg.parentElement
            for (let i = 0; i < 4 && hoverNode; i++) {
              hoverNode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
              hoverNode.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
              hoverNode = hoverNode.parentElement
            }
            await new Promise(r => setTimeout(r, 500))

            // 3. Tile 찾기 (more_vert/more_horiz 포함)
            const tile = findTileWithOverlay(targetImg)
            if (!tile) {
              unhover(targetImg)
              return { success: false, error: 'Overlay tile not found after hover' }
            }

            // 4. Three-dots 버튼 클릭
            const threeDotsBtn = findThreeDots(tile)
            if (!threeDotsBtn) {
              unhover(targetImg)
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
              unhover(targetImg)
              return { success: false, error: 'Context menu did not open' }
            }
            LOG('Context menu opened')

            // 6. "download" 메뉴 아이템 찾기
            const downloadItem = findMenuItem(menu, 'download')
            if (!downloadItem) {
              const items = Array.from(menu.querySelectorAll("[role='menuitem']")).map(i => i.textContent?.trim())
              LOG('Download item not found. Items: ' + JSON.stringify(items))
              await closeMenus()
              unhover(targetImg)
              return { success: false, error: 'Download menu item not found. Items: ' + items.join(', ') }
            }
            LOG('Hovering Download menu item to open submenu')

            // 7. Download 호버 → 서브메뉴 열기 (Radix UI 호환)
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

            // 9. 해상도 선택 (이미지: 1K/2K/4K)
            if (submenu) {
              LOG('Submenu opened! Looking for resolution: ' + resText)
              const submenuItems = Array.from(submenu.querySelectorAll("[role='menuitem']"))
              LOG('Submenu items: ' + submenuItems.map(i => i.textContent?.trim()).join(', '))
              let resOption = null
              for (const item of submenuItems) {
                if ((item.textContent || '').includes(resText)) {
                  resOption = item
                  break
                }
              }
              if (resOption) {
                pointerClick(resOption)
                LOG('Clicked resolution: ' + resText)
                await closeMenus()
                unhover(targetImg)
                return { success: true, resolution: resText }
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
                if ((item.textContent || '').includes(resText)) {
                  pointerClick(item)
                  LOG('Clicked resolution (keyboard fallback): ' + resText)
                  await closeMenus()
                  unhover(targetImg)
                  return { success: true, resolution: resText }
                }
              }
            }

            // 11. 해상도 옵션 없으면 직접 다운로드 (원본)
            LOG('No resolution submenu, clicking download directly')
            pointerClick(downloadItem)
            await closeMenus()
            unhover(targetImg)
            return { success: true, resolution: 'default' }

          } catch (e) {
            try { await closeMenus() } catch {}
            return { success: false, error: e.message }
          }
        })()
      `)

      console.log('[Flow Image Upscale] DOM automation result:', JSON.stringify(domResult))

      if (!domResult.success) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
        return { success: false, error: `DOM: ${domResult.error}` }
      }

      // Step 3: temp 디렉토리에서 다운로드 파일 대기 (폴링)
      console.log('[Flow Image Upscale] Waiting for download file in:', tempDir)
      let downloadedFile = null
      const maxWait = 120000 // 2분 (업스케일 처리 시간 포함)
      const startTime = Date.now()

      while (Date.now() - startTime < maxWait) {
        await new Promise(r => setTimeout(r, 1000))

        try {
          const files = fs.readdirSync(tempDir)
            .filter(f => !f.endsWith('.crdownload') && !f.endsWith('.tmp') && !f.startsWith('.'))

          if (files.length > 0) {
            const filePath = path.join(tempDir, files[0])
            const stats = fs.statSync(filePath)

            // 파일 크기 안정화 확인
            await new Promise(r => setTimeout(r, 1000))
            const stats2 = fs.statSync(filePath)

            if (stats.size === stats2.size && stats.size > 0) {
              downloadedFile = filePath
              console.log('[Flow Image Upscale] File ready:', files[0], 'size:', stats.size)
              break
            }
          }
        } catch {}
      }

      // CDP 다운로드 설정 해제
      try {
        await flowView.webContents.debugger.sendCommand('Page.setDownloadBehavior', { behavior: 'default' })
      } catch {}

      // 업스케일 완료 토스트 닫기
      try {
        await flowView.webContents.executeJavaScript(`
          (function() {
            const buttons = Array.from(document.querySelectorAll('button'))
            for (const btn of buttons) {
              const text = (btn.textContent || '').trim()
              if (text === '닫기' || text === 'Close') { btn.click(); break }
            }
          })()
        `)
      } catch {}

      if (!downloadedFile) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
        return { success: false, error: 'Download timeout — no file appeared in temp dir' }
      }

      // Step 4: 파일 읽기 → base64 (data URL)
      try {
        const data = fs.readFileSync(downloadedFile)
        const ext = path.extname(downloadedFile).toLowerCase()
        const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.webp' ? 'image/webp' : 'image/png'
        const base64DataUrl = `data:${mimeType};base64,${data.toString('base64')}`
        console.log('[Flow Image Upscale] ✅ Success — size:', data.length, 'bytes, type:', mimeType)

        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
        return { success: true, data: base64DataUrl }
      } catch (readErr) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
        return { success: false, error: `File read error: ${readErr.message}` }
      }

    } catch (e) {
      console.error('[Flow Image Upscale] Error:', e.message)
      return { success: false, error: e.message }
    }
  })
}
