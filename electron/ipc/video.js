/**
 * Electron IPC Handler - Video Generation
 *
 * Text-to-Video (T2V), Image-to-Video (I2V) DOM automation,
 * and video status polling.
 */

/**
 * Register video-generation-related IPC handlers.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object} deps - Shared dependencies from main process
 */
export function registerVideoIPC(ipcMain, deps) {
  const {
    getFlowView, getMainWindow, trustedClickOnFlowView, sessionFetch, flowPageFetch,
    parseFlowResponse, getRecaptchaToken, configureFlowMode, switchFlowToVideoMode,
    getCapturedProjectId, setCapturedProjectId,
    getPendingVideoGeneration, setPendingVideoGeneration,
    getPendingI2VInjection, setPendingI2VInjection,
    setPendingSeedValue,
    SESSION_URL, VIDEO_T2V_URL, VIDEO_I2V_URL, VIDEO_I2V_START_END_URL, VIDEO_STATUS_URL, VIDEO_UPSCALE_URL,
    API_HEADERS, FLOW_URL,
  } = deps

  // LOCAL helper — 비디오 응답에서 generation ID (UUID) 추출
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

  // Text-to-Video generation (DOM 자동화 — 페이지가 reCAPTCHA 자체 처리)
  ipcMain.handle('flow:generate-video-t2v', async (event, {
    token, prompt, projectId, model, aspectRatio, duration, videoBatchCount, seed
  }) => {
    const flowView = getFlowView()
    const mainWindow = getMainWindow()
    if (!prompt) return { success: false, error: 'No prompt' }
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    // Seed: 숫자면 CDP Fetch 인터셉션이 batchAsyncGenerateVideoText 요청에 주입,
    //       null/undefined면 Flow 자체 랜덤 seed 유지
    const hasUserSeed = typeof seed === 'number' && Number.isFinite(seed)
    setPendingSeedValue?.(hasUserSeed ? seed : null)

    // CDP Fetch 도메인이 image용 패턴만 등록돼 있을 수 있으므로,
    // 사용자 seed 지정 시 video text 패턴으로 등록 (없으면 inject 안 됨)
    if (hasUserSeed) {
      try {
        await flowView.webContents.debugger.sendCommand('Fetch.enable', {
          patterns: [
            { urlPattern: '*batchGenerateImages*', requestStage: 'Request' },
            { urlPattern: '*batchAsyncGenerateVideoText*', requestStage: 'Request' }
          ]
        })
        console.log('[Flow Video T2V] [Fetch] Enabled with video text pattern for seed inject')
      } catch (e) {
        console.warn('[Flow Video T2V] [Fetch] Fetch.enable failed:', e.message)
      }
    }

    console.log('[Flow Video T2V] Starting DOM-triggered video generation:', prompt?.substring(0, 50), hasUserSeed ? `(seed: ${seed})` : '(seed: random)')

    try {
      // 0. Flow 프로젝트 페이지 확인
      const currentUrl = flowView.webContents.getURL()
      if (!currentUrl.includes('/project/') && !currentUrl.includes('/tools/flow/')) {
        return { success: false, error: 'Not on Flow project page. Please open a Flow project first.' }
      }

      // 1. 비디오 모드로 전환 (배치 카운트 적용)
      const effectiveBatchCount = Math.max(1, Math.min(4, videoBatchCount || 1))
      const modeResult = await configureFlowMode('VIDEO', effectiveBatchCount)
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
          if (getPendingVideoGeneration()) {
            setPendingVideoGeneration(null)
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
      setPendingVideoGeneration({
        setAt: videoSetAt,
        resolve: (result) => {
          clearTimeout(videoTimeout)
          resolveVideo(result)
        }
      })
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

  // Image-to-Video generation (DOM 자동화 + CDP Fetch 인터셉션)
  // T2V와 동일한 DOM 흐름: 프롬프트 주입 → Generate 클릭 → CDP 응답 캡처
  // 차이점: CDP Fetch로 나가는 T2V 요청을 가로채서 startImage 주입 + URL을 I2V 엔드포인트로 변경
  ipcMain.handle('flow:generate-video-i2v', async (event, {
    token, prompt, startImageMediaId, endImageMediaId, projectId, model, aspectRatio, duration, videoBatchCount, seed
  }) => {
    const flowView = getFlowView()
    const mainWindow = getMainWindow()
    if (!startImageMediaId) return { success: false, error: 'No start image mediaId' }
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    // Seed: 숫자면 CDP Fetch 인터셉션이 batchAsyncGenerateVideoStartImage 등에 주입,
    //       null/undefined면 Flow 자체 랜덤 seed 유지
    const hasUserSeed = typeof seed === 'number' && Number.isFinite(seed)
    setPendingSeedValue?.(hasUserSeed ? seed : null)

    const hasEndImage = !!endImageMediaId
    console.log('[Flow Video I2V] Starting DOM-triggered I2V generation, start:', startImageMediaId?.substring(0, 8),
      hasEndImage ? ', end: ' + endImageMediaId?.substring(0, 8) : '(start only)',
      hasUserSeed ? `(seed: ${seed})` : '(seed: random)')

    let cdpFetchEnabled = false

    try {
      // 0. Flow 프로젝트 페이지 확인
      const currentUrl = flowView.webContents.getURL()
      if (!currentUrl.includes('/project/') && !currentUrl.includes('/tools/flow/')) {
        return { success: false, error: 'Not on Flow project page. Please open a Flow project first.' }
      }

      // 1. 비디오 모드로 전환 (배치 카운트 적용)
      const effectiveBatchCount = Math.max(1, Math.min(4, videoBatchCount || 1))
      const modeResult = await configureFlowMode('VIDEO', effectiveBatchCount)
      if (!modeResult.success) {
        return { success: false, error: modeResult.error || 'Failed to switch to video mode' }
      }
      console.log('[Flow Video I2V] Video mode active:', modeResult.method)

      // 2. 프롬프트 입력 (T2V와 동일한 Slate 에디터 사용)
      const promptBounds = flowView.getBounds()
      const promptWasHidden = (promptBounds.width === 0 || promptBounds.height === 0)
      if (promptWasHidden) {
        const { width, height } = mainWindow.getContentBounds()
        flowView.setBounds({ x: width + 5000, y: 0, width, height })
        await new Promise(r => setTimeout(r, 300))
      }

      const promptResult = await flowView.webContents.executeJavaScript(`
        (async function() {
          const promptText = ${JSON.stringify(prompt || '')};
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
      console.log('[Flow Video I2V] Prompt injected successfully')

      // 3. CDP Fetch 인터셉션 활성화 — 나가는 T2V 요청을 I2V로 변환
      setPendingI2VInjection({
        startImageMediaId,
        endImageMediaId: hasEndImage ? endImageMediaId : null,
        i2vUrl: VIDEO_I2V_URL,
        i2vStartEndUrl: VIDEO_I2V_START_END_URL,
      })
      try {
        await flowView.webContents.debugger.sendCommand('Fetch.enable', {
          patterns: [{ urlPattern: '*batchAsyncGenerateVideo*', requestStage: 'Request' }]
        })
        cdpFetchEnabled = true
        console.log('[Flow Video I2V] CDP Fetch interception enabled for',
          hasEndImage ? 'start+end image injection' : 'start image injection')
      } catch (e) {
        console.warn('[Flow Video I2V] Fetch.enable failed:', e.message)
        setPendingI2VInjection(null)
        return { success: false, error: 'Failed to enable CDP Fetch interception: ' + e.message }
      }

      // 4. CDP 비디오 응답 캡처 Promise 설정
      let resolveVideo = null
      let videoTimeout = null
      const videoResponsePromise = new Promise((resolve) => {
        videoTimeout = setTimeout(() => {
          if (getPendingVideoGeneration()) {
            setPendingVideoGeneration(null)
            resolve({ error: true, message: 'Video response timeout (30s)' })
          }
        }, 30000)
        resolveVideo = resolve
      })

      // 5. Generate 버튼 Trusted Click
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
      console.log('[Flow Video I2V] Trusted click result:', clickResult)

      if (!clickResult?.success) {
        clearTimeout(videoTimeout)
        return { success: false, error: clickResult?.error || 'Failed to click Generate button' }
      }

      // ★ 클릭 직후 pendingVideoGeneration 설정
      const videoSetAt = Date.now() / 1000 - 2
      setPendingVideoGeneration({
        setAt: videoSetAt,
        resolve: (result) => {
          clearTimeout(videoTimeout)
          resolveVideo(result)
        }
      })
      console.log('[Flow Video I2V] pendingVideoGeneration set, waiting for CDP capture...')

      // 6. 비디오 API 응답 대기
      const netResult = await videoResponsePromise

      if (netResult.error) {
        console.warn('[Flow Video I2V] Video API failed:', netResult.message || `HTTP ${netResult.status}`)
        return { success: false, error: netResult.message || `HTTP ${netResult.status}: Video generation failed` }
      }

      // 7. 응답에서 generation ID 추출
      const data = parseFlowResponse(netResult.body)
      const generationId = extractVideoGenerationId(data)

      if (generationId) {
        console.log('[Flow Video I2V] Generation ID:', generationId)
        return { success: true, generationId }
      }

      return { success: false, error: `No generation ID. Response keys: ${Object.keys(data || {}).join(',')}` }
    } catch (e) {
      console.error('[Flow Video I2V] Error:', e.message)
      return { success: false, error: e.message }
    } finally {
      // CDP Fetch 인터셉션 비활성화 (항상 정리)
      if (cdpFetchEnabled) {
        setPendingI2VInjection(null)
        try {
          await flowView.webContents.debugger.sendCommand('Fetch.disable')
          console.log('[Flow Video I2V] CDP Fetch interception disabled')
        } catch {}
      }
    }
  })

  // Check video generation status (페이지 컨텍스트에서 실행 — origin 일치)
  ipcMain.handle('flow:check-video-status', async (event, { token, generationIds, projectId }) => {
    const flowView = getFlowView()
    if (!token) return { success: false, error: 'No token' }
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    const pid = projectId || getCapturedProjectId() || ''

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
            console.warn('[Flow VideoStatus] ❌ FAILED media detail:', JSON.stringify(m).substring(0, 1000))
            const failReason = m?.mediaMetadata?.mediaStatus?.failureReason
              || m?.mediaMetadata?.mediaStatus?.errorMessage
              || m?.error?.message
              || genStatus
            statuses.push({ status: 'failed', error: failReason })
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

  // ─── Video Upscale (API 기반, DOM 불필요) ───
  // AutoFlow 10.7.58 역공학: upscaleVideoDirect (sidepanel.js:20223)
  // mediaId → workflowId 조회 → reCAPTCHA → upscale 제출 → resultMediaName 반환
  ipcMain.handle('flow:upscale-video', async (event, { token, mediaId, projectId, resolution, aspectRatio }) => {
    const flowView = getFlowView()
    if (!token) return { success: false, error: 'No token' }
    if (!mediaId) return { success: false, error: 'No mediaId' }
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    const normalizedRes = String(resolution || '1080p').toLowerCase()
    const resolutionEnum = normalizedRes === '4k' ? 'VIDEO_RESOLUTION_4K' : 'VIDEO_RESOLUTION_1080P'
    const modelKey = normalizedRes === '4k' ? 'veo_3_1_upsampler_4k' : 'veo_3_1_upsampler_1080p'
    const pid = projectId || getCapturedProjectId() || ''

    console.log('[Flow Upscale] Starting upscale — mediaId:', mediaId?.substring(0, 20),
      'resolution:', normalizedRes, 'projectId:', pid?.substring(0, 8))

    try {
      // 페이지 컨텍스트에서 전체 실행 (reCAPTCHA origin 일치 + projectInitialData 상대 URL)
      const result = await flowView.webContents.executeJavaScript(`
        (async function() {
          try {
            const mediaId = ${JSON.stringify(mediaId)};
            const pid = ${JSON.stringify(pid)};
            const token = ${JSON.stringify(token)};
            const endpoint = ${JSON.stringify(VIDEO_UPSCALE_URL)};
            const resolutionEnum = ${JSON.stringify(resolutionEnum)};
            const modelKey = ${JSON.stringify(modelKey)};
            const videoAspectRatio = ${JSON.stringify(aspectRatio || 'VIDEO_ASPECT_RATIO_LANDSCAPE')};

            // 1. projectInitialData에서 workflowId 조회
            let workflowId = '';
            if (pid) {
              const pdUrl = '/fx/api/trpc/flow.projectInitialData?input='
                + encodeURIComponent(JSON.stringify({ json: { projectId: pid } }))
                + '&af_upscale_ts=' + Date.now();
              const pdResp = await fetch(pdUrl, {
                method: 'GET', cache: 'no-store', credentials: 'same-origin',
                headers: { accept: 'application/json, text/plain, */*' }
              });
              if (pdResp.ok) {
                const pdData = await pdResp.json().catch(() => null);
                // TRPC 응답 언래핑 (AutoFlow unwrapProjectData 패턴)
                const unwrap = (raw) => {
                  if (!raw) return null;
                  const queue = [raw]; const seen = new Set();
                  while (queue.length > 0) {
                    const node = queue.shift();
                    if (!node || typeof node !== 'object' || seen.has(node)) continue;
                    seen.add(node);
                    const candidate = node.projectContents ? node : node.data;
                    const pc = candidate?.projectContents || null;
                    if (pc && (pc.workflows !== undefined || pc.media !== undefined)) return candidate;
                    if (node.json) queue.push(node.json);
                    if (node.result) queue.push(node.result);
                    if (node.data) queue.push(node.data);
                    if (Array.isArray(node)) node.forEach(i => queue.push(i));
                  }
                  return null;
                };
                const pc = unwrap(pdData)?.projectContents || {};
                const asArr = (v) => v ? (Array.isArray(v) ? v : Object.keys(v).sort((a,b)=>a-b).map(k=>v[k]).filter(Boolean)) : [];
                const mediaItems = asArr(pc.media);
                const workflows = asArr(pc.workflows);
                const bareId = mediaId.split('/').pop();

                // media[].workflowId 직접 매칭
                for (const m of mediaItems) {
                  const mName = (m?.name || m?.mediaId || m?.id || '').split('/').pop();
                  if (mName !== bareId) continue;
                  const wid = String(m?.workflowId || '').trim();
                  if (wid) { workflowId = wid.split('/').pop() || wid; break; }
                }
                // fallback: workflows[].metadata.primaryMediaId 매칭
                if (!workflowId) {
                  for (const w of workflows) {
                    const pmId = (w?.metadata?.primaryMediaId || '').split('/').pop();
                    if (pmId !== bareId) continue;
                    const wid = (w?.workflowId || w?.name || '').split('/').pop();
                    if (wid) { workflowId = wid; break; }
                  }
                }
              }
            }
            if (!workflowId) return { ok: false, error: 'Could not resolve workflowId for mediaId: ' + mediaId.substring(0, 20) };

            // 2. reCAPTCHA 토큰 획득 (AutoFlow 패턴: ready() 대기 후 execute())
            let recaptchaToken = '';
            try {
              const g = window.grecaptcha;
              if (g?.enterprise?.execute) {
                // ready() 대기 — reCAPTCHA가 완전히 초기화될 때까지 기다림
                if (g.enterprise.ready) {
                  await new Promise(resolve => g.enterprise.ready(resolve));
                }
                recaptchaToken = await g.enterprise.execute('6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', { action: 'generate' });
                recaptchaToken = String(recaptchaToken || '').trim();
                console.log('[Flow Upscale] reCAPTCHA token obtained, length:', recaptchaToken.length);
              } else {
                console.warn('[Flow Upscale] grecaptcha.enterprise.execute not available');
              }
            } catch (e) {
              console.warn('[Flow Upscale] reCAPTCHA error:', e.message);
            }

            // 3. Upscale 요청 body 구성 (AutoFlow buildClientContext 패턴)
            const body = {
              mediaGenerationContext: { batchId: crypto.randomUUID() },
              clientContext: {
                projectId: pid,
                tool: 'PINHOLE',
                userPaygateTier: 'PAYGATE_TIER_ONE',
                sessionId: ';' + Date.now(),
                recaptchaContext: {
                  token: recaptchaToken,
                  applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB'
                }
              },
              requests: [{
                resolution: resolutionEnum,
                aspectRatio: videoAspectRatio,
                seed: Math.floor(Math.random() * 2147483647),
                videoModelKey: modelKey,
                metadata: { workflowId },
                videoInput: { mediaId }
              }],
              useV2ModelConfig: true
            };

            // 4. Upscale API 호출 (페이지 컨텍스트 fetch — origin 일치)
            const resp = await fetch(endpoint, {
              method: 'POST',
              headers: { authorization: 'Bearer ' + token },
              body: JSON.stringify(body)
            });
            const text = await resp.text().catch(() => '');
            if (!resp.ok) return { ok: false, error: 'HTTP ' + resp.status + ': ' + (text || '').substring(0, 200) };

            // 5. 응답에서 resultMediaName 추출 (_upsampled suffix)
            let data = null;
            try { data = text ? JSON.parse(text) : null; } catch {}

            let resultMediaName = '';
            if (data) {
              const candidates = [];
              if (Array.isArray(data.operations))
                for (const item of data.operations) candidates.push(item?.operation?.name);
              if (Array.isArray(data.media))
                for (const item of data.media) candidates.push(item?.name);
              for (const c of candidates) {
                const name = String(c || '').trim();
                if (/_upsampled$/i.test(name)) { resultMediaName = name; break; }
              }
            }

            return { ok: true, resultMediaName, workflowId, recaptchaLen: recaptchaToken.length, responseKeys: data ? Object.keys(data).slice(0, 12) : [] };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        })()
      `)

      if (!result.ok) {
        console.warn('[Flow Upscale] ❌ Failed:', result.error)
        return { success: false, error: result.error }
      }

      if (result.resultMediaName) {
        console.log('[Flow Upscale] ✅ Upscale submitted — resultMediaName:', result.resultMediaName,
          'workflowId:', result.workflowId)
        return { success: true, resultMediaName: result.resultMediaName, workflowId: result.workflowId }
      }

      console.warn('[Flow Upscale] ⚠️ No _upsampled media name. Response keys:', result.responseKeys)
      return { success: false, error: 'No upsampled media name in response. Keys: ' + (result.responseKeys || []).join(',') }
    } catch (e) {
      console.error('[Flow Upscale] Error:', e.message)
      return { success: false, error: e.message }
    }
  })
}
