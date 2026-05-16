/**
 * Electron IPC Handler - DOM Mode Operations
 *
 * Direct Flow page DOM automation: navigation, script execution,
 * prompt injection, aspect ratio setting, image scanning.
 */

export function registerDomIPC(ipcMain, deps) {
  const { getFlowView, getMainWindow, trustedClickOnFlowView, FLOW_URL } = deps

  // Navigate to Flow base URL and wait for load
  ipcMain.handle('flow:dom-navigate', async (event, { url }) => {
    const flowView = getFlowView()
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
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    return { success: true, url: flowView.webContents.getURL() }
  })

  // Execute JavaScript in Flow view (generic DOM injection)
  ipcMain.handle('flow:dom-execute', async (event, { script }) => {
    const flowView = getFlowView()
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
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    // 이미 프로젝트가 있으면 스킵
    if (deps.getCapturedProjectId()) {
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
        deps.setEnterToolClicked(true)
        return { success: true }
      }
      return { success: false, error: 'Enter tool button not found' }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // Set aspect ratio.
  //
  // Current Flow UI: the aspect ratio is an always-visible Radix Tabs row.
  // Tab triggers have an UNSTABLE generated id prefix (radix-:rNN:) but a
  // STABLE value suffix:
  //   -trigger-LANDSCAPE     → 16:9      -trigger-PORTRAIT     → 9:16
  //   -trigger-LANDSCAPE_4_3 → 4:3       -trigger-PORTRAIT_3_4 → 3:4
  //   -trigger-SQUARE        → 1:1
  // The exact-suffix matcher [id$=...] is REQUIRED: a *contains* matcher
  // (*=) would also catch -trigger-PORTRAIT_3_4 / -trigger-LANDSCAPE_4_3,
  // and querySelector returns the first in DOM order — selecting 9:16 would
  // actually click the 3:4 tab.
  //
  // Legacy fallback: older Flow UI used a combobox dropdown.
  ipcMain.handle('flow:dom-set-aspect-ratio', async (event, { aspectRatio }) => {
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    try {
      const isPortrait = aspectRatio === '9:16'
      console.log('[DOM IPC] Setting aspect ratio:', aspectRatio, 'isPortrait:', isPortrait)

      // ─── Primary: Radix Tabs row (current Flow UI) ───
      const tabIdSuffix = isPortrait ? '-trigger-PORTRAIT' : '-trigger-LANDSCAPE'
      const tabExpr = `document.querySelector("button[role='tab'][id$='${tabIdSuffix}']")`
      const readTab = () => flowView.webContents.executeJavaScript(`
        (function() {
          const btn = ${tabExpr};
          if (!btn) return { found: false };
          return { found: true, active: btn.getAttribute('aria-selected') === 'true' };
        })()
      `)

      // 탭이 렌더될 때까지 잠깐 폴링한다 — 프로젝트가 막 생성된 직후 등 패널이
      // 아직 안 떠 있을 수 있다.
      let tabState = await readTab()
      for (let i = 0; i < 5 && !(tabState && tabState.found); i++) {
        await new Promise(r => setTimeout(r, 200))
        tabState = await readTab()
      }

      if (tabState && tabState.found) {
        if (tabState.active) {
          console.log('[DOM IPC] Aspect ratio already set:', aspectRatio)
          return { success: true, method: 'tab', alreadySet: true, controlFound: true }
        }
        // 클릭 후 aria-selected 가 실제로 바뀌었는지 검증하고, 안 바뀌었으면
        // 재시도한다. 클릭만 보내고 검증하지 않으면 — 배치 첫 클릭이 조용히
        // 실패해도 success 로 보고돼, 그 씬이 Flow 기본값(16:9)으로 생성된다.
        // (Flow 는 untrusted 클릭을 무시 → sendInputEvent 기반 trusted click 사용.)
        for (let attempt = 1; attempt <= 3; attempt++) {
          await trustedClickOnFlowView(tabExpr)
          await new Promise(r => setTimeout(r, 300))
          const after = await readTab()
          if (after && after.active) {
            console.log('[DOM IPC] Aspect ratio set via tab:', aspectRatio, `(attempt ${attempt})`)
            return { success: true, method: 'tab', attempts: attempt, controlFound: true }
          }
          console.warn(`[DOM IPC] Aspect ratio tab not switched yet (attempt ${attempt})`)
        }
        // 컨트롤은 찾았으나 전환 실패 — controlFound:true 로 호출부가 abort 하게 한다.
        return { success: false, controlFound: true, error: 'Aspect ratio tab did not switch after 3 attempts' }
      }

      // ─── Legacy fallback: combobox dropdown (old Flow UI) ───
      console.log('[DOM IPC] Aspect ratio tab not found, trying legacy combobox...')
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
        // 탭도 콤보박스도 못 찾음 — Flow UI 가 바뀌었거나 패널이 안 떠 있음.
        // 진단용 DOM 덤프를 남기고 controlFound:false 로 반환한다 (호출부는
        // abort 하지 않고 생성을 계속 — 모든 씬이 막히는 것보다 낫다).
        let diagnostics = null
        try {
          diagnostics = await flowView.webContents.executeJavaScript(`
            (function() {
              const pick = (el) => ({
                tag: el.tagName, role: el.getAttribute('role'), id: el.id || null,
                ariaLabel: el.getAttribute('aria-label'),
                ariaSelected: el.getAttribute('aria-selected'),
                dataState: el.getAttribute('data-state'),
                text: (el.textContent || '').trim().slice(0, 40),
              });
              const tabs = [...document.querySelectorAll("button[role='tab']")].map(pick);
              const ratioish = [...document.querySelectorAll('button,[role="radio"],[role="option"],[role="tab"]')]
                .filter(el => /\\b(16:9|9:16|4:3|3:4|1:1)\\b/.test(el.textContent || '')
                           || /portrait|landscape|aspect|crop_/i.test(el.outerHTML))
                .slice(0, 25).map(pick);
              return { tabCount: tabs.length, tabs, ratioish };
            })()
          `)
        } catch {}
        console.warn('[DOM IPC] Aspect ratio control not found — DOM diagnostics:',
          JSON.stringify(diagnostics))
        return {
          success: false,
          controlFound: false,
          error: 'Aspect ratio control not found (no tab, no combobox)',
          diagnostics,
        }
      }
      await new Promise(r => setTimeout(r, 500))

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
      // Escape로 드롭다운 닫기 (성공/실패 무관)
      try {
        await flowView.webContents.executeJavaScript(`
        document.body.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true
        }))
      `)
      } catch {}
      if (!optionClick.success) {
        return { success: false, controlFound: true, error: 'Aspect ratio option not found: ' + optionIcon }
      }
      await new Promise(r => setTimeout(r, 500))
      console.log('[DOM IPC] Aspect ratio set via legacy combobox:', aspectRatio)
      return { success: true, method: 'combobox', controlFound: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // Send prompt and click generate button
  // AutoFlow 분석: Flow는 Slate.js 에디터를 사용 → textContent 설정은 무시됨
  // 1순위: React fiber에서 Slate editor 인스턴스 → editor.apply({ type: 'insert_text' })
  // 2순위: document.execCommand('insertText') — Slate가 감지하는 표준 DOM API
  ipcMain.handle('flow:dom-send-prompt', async (event, { prompt, selectors }) => {
    const flowView = getFlowView()
    const mainWindow = getMainWindow()
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
        const flowView = getFlowView()
        if (flowView) flowView.setBounds(currentBounds)
        console.log('[DOM IPC] Restored flowView hidden bounds after prompt')
      }
    }
  })

  // Snapshot current blob image URLs
  ipcMain.handle('flow:dom-snapshot-blobs', async () => {
    const flowView = getFlowView()
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
    const flowView = getFlowView()
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
    const flowView = getFlowView()
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
}
