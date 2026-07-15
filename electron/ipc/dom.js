/**
 * Electron IPC Handler - DOM Mode Operations
 *
 * Direct Flow page DOM automation: navigation, script execution,
 * prompt injection, aspect ratio setting, image scanning.
 */

import { screen } from 'electron'
import { updateBounds } from './layout.js'
import { AGENT_TOGGLE_SELECTOR } from '../flow-agent-toggle.js'
import { decideFlowOpenAction, isFlowErrorPage, isDeadMappingFailure, FLOW_PAGE_PROBE_JS } from '../flowOpenRetry.js'
import { computeOffscreenBounds } from '../offscreen-bounds.js'

export function registerDomIPC(ipcMain, deps) {
  const { getFlowView, getMainWindow, trustedClickOnFlowView, FLOW_URL, getCurrentMode } = deps

  // #R28-2: API 모드 전환 후에도 flowView 가 보존되므로, mode 게이트 없이 open/new-project 를
  //   처리하면 stale 호출이 보존된 Flow view 를 엉뚱한 프로젝트로 navigate/생성해 Flow 상태를
  //   오염시킨다. 프로젝트를 navigate/생성하는 핸들러는 mode 가 'flow' 일 때만 진행한다.
  const flowActive = () => !getCurrentMode || getCurrentMode() === 'flow'

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

  // 컴포즈("모든 미디어")로 네비 + React 하이드레이션 대기.
  // 캐릭터/장면 페이지에서 컴포즈로 돌아온 직후 generate-image 가 동작하려면, 단순 loadURL
  // (flow:dom-navigate)만으론 부족하다 — did-finish-load 후에도 SPA 가 settling 중이라
  // (1) ensureAgentOff 가 토글을 못 찾아 fail-closed, (2) 제출 버튼 핸들러가 아직 안 붙어
  // 트러스트 클릭이 batchGenerateImages 를 트리거하지 못한다(진행중 멈춤).
  // → 컴포즈 에디터 + 에이전트 토글이 모두 뜰 때까지 폴링한 뒤 settle 한다.
  // (character.js ensureOnCharactersPage 와 동일 패턴.)
  ipcMain.handle('flow:compose-navigate-wait', async (event, { url }) => {
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    try {
      await flowView.webContents.loadURL(url || FLOW_URL)
      const READY = `!!(
        (document.querySelector("[data-slate-editor='true']")
          || document.querySelector("div[role='textbox'][contenteditable='true']")
          || document.querySelector('textarea'))
        && (${AGENT_TOGGLE_SELECTOR})
      )`
      let ready = false
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 500))
        ready = await flowView.webContents.executeJavaScript(READY).catch(() => false)
        if (ready) break
      }
      // 핸들러 와이어링 settle — readiness 직후 클릭이 안 먹는 케이스 방지.
      await new Promise((r) => setTimeout(r, 1200))
      console.log('[Flow Compose] compose-navigate-wait ready:', ready)
      return { success: true, navigated: true, ready }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // 저장된 Flow 프로젝트로 진입(A0 영속화). 새 프로젝트를 만들지 않고 기존 것을 연다.
  ipcMain.handle('flow:open-project', async (event, { flowProjectId }) => {
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R28-2
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    if (!flowProjectId) return { success: false, error: 'No flowProjectId' }
    // ⚠️ projectId 는 한 경로 세그먼트여야 한다. "abc/characters" 같은 저장값이면 /project/abc/characters
    //    를 열고 그 캐릭터 페이지를 "정상 로드"로 승인한다(ensureOnProjectComposer 와 같은 함정).
    if (!/^[A-Za-z0-9._~-]+$/.test(String(flowProjectId))) {
      return { success: false, error: 'Invalid flowProjectId' }
    }
    try {
      const cur = flowView.webContents.getURL() || ''
      // 현재 URL 에서 /tools/flow 까지의 base(로케일 포함) 추출, 없으면 기본.
      const m = cur.match(/^(.*\/tools\/flow)(\/|$)/)
      const base = m ? m[1] : 'https://labs.google/fx/tools/flow'
      const target = `${base}/project/${flowProjectId}`
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      // 페이지가 진짜 대상 프로젝트로 로드됐는지 확인 — URL 일치 + 에러 텍스트 없음.
      //   (URL 만 보면 "문제가 발생했습니다" 에러 페이지도 success 로 오판 → false positive.)
      const probe = async () => {
        let page = { hasComposer: false, interactiveCount: 0 }
        let probeOk = true
        try { page = await flowView.webContents.executeJavaScript(FLOW_PAGE_PROBE_JS) } catch { probeOk = false }
        // ⚠️ URL 을 probe 전에 따로 읽으면 A→B 로 넘어간 사이 B 의 DOM 을 A 의 URL 과 짝지어 성공이라
        //    보고한다. probe 가 **같은 페이지 컨텍스트에서** 돌려준 url 을 쓴다(원자적).
        const urlNow = (probeOk && page && page.url) || flowView.webContents.getURL() || ''
        // ⚠️ 경로 끝이면서 **컴포저** 여야 한다. (/[^/]*)?$ 로만 두면 /characters·/settings 도 통과해,
        //    캐릭터 작업 후 그 페이지에 머문 상태를 "프로젝트 열림"으로 승인한다(컴포저는 없는데).
        //    ensureOnProjectComposer 와 같은 허용 목록을 쓴다.
        let onTargetUrl = false
        try {
          const pn = new URL(urlNow).pathname
          const m = pn.match(new RegExp(`/tools/flow/project/${flowProjectId}(/[^/]*)?$`))
          onTargetUrl = !!m && ['', '/', '/all-media'].includes(m[1] || '')
        } catch { onTargetUrl = false }
        return { urlNow, onTargetUrl, isErrorPage: isFlowErrorPage(page), probeOk, page }
      }

      // 이미 그 프로젝트 URL 이면 페이지만 확인(로딩이면 1.5s 대기 후 재확인).
      if (cur.includes(`/project/${flowProjectId}`)) {
        let p = await probe()
        if (!p.onTargetUrl || p.isErrorPage) { await sleep(1500); p = await probe() }
        if (p.onTargetUrl && !p.isErrorPage) return { success: true, already: true, url: p.urlNow }
        // 에러면 아래 재네비 경로로 떨어진다.
      }

      console.log('[Flow Project] opening saved flow project:', target)
      const MAX_ATTEMPTS = 2 // 최초 1 + 재시도 1
      await flowView.webContents.loadURL(target).catch((e) => console.warn('[Flow Project] loadURL failed:', e.message))
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await sleep(2000) // 로드/에러 표시 안정화 대기
        const p = await probe()
        const action = decideFlowOpenAction({ onTargetUrl: p.onTargetUrl, isErrorPage: p.isErrorPage, attempt, maxAttempts: MAX_ATTEMPTS })
        if (action === 'success') return { success: true, url: p.urlNow }
        if (action === 'fail') {
          // 대상 URL 에 머문 에러페이지만 죽은 매핑(제거). URL 이탈(로그인 리다이렉트/느린 네비)은
          //   transient — errorPage=false 로 반환해 caller 가 멀쩡한 매핑을 지우지 않게 한다.
          const errorPage = isDeadMappingFailure({ onTargetUrl: p.onTargetUrl, isErrorPage: p.isErrorPage, probeOk: p.probeOk })
          console.warn('[Flow Project] open failed after retry:', flowProjectId, 'dead=', errorPage, p.urlNow)
          return { success: false, errorPage, url: p.urlNow }
        }
        // retry: 직접 deep-link 가 에러나면 home(base) 경유 후 재네비(갤러리 클릭과 동일 경로).
        console.warn('[Flow Project] open error — retry via home:', flowProjectId)
        await flowView.webContents.loadURL(base).catch(() => {})
        await sleep(1500)
        await flowView.webContents.loadURL(target).catch(() => {})
      }
      // 루프 소진(이론상 도달 안 함) — 보수적으로 매핑 보존(errorPage=false).
      return { success: false, errorPage: false, url: flowView.webContents.getURL() }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // 새 Flow 프로젝트를 강제 생성(A0 격리). 미매핑 로컬 프로젝트로 전환 시, 이전 프로젝트의
  // Flow 프로젝트에 캐릭터가 섞이지 않도록 fresh 프로젝트를 만든다. home(base)으로 가서 add_2
  // 클릭 → 새 /project/{id} URL 대기. (startup 자동생성은 enterToolClicked=true 라 skip 되어
  // 중복 생성 없음.) 반환: { success, projectId }.
  ipcMain.handle('flow:new-project', async () => {
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R28-2
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    // #R20-4: 실패/타임아웃 경로에서 enterToolClicked 가 true 로 고착되면 이후 부트스트랩 자동
    //   생성이 영구 skip 된다 — 생성 성공(새 id 포착) 전까지는 finally 에서 이전 값으로 복원한다.
    const prevEnterToolClicked = deps.getEnterToolClicked?.()
    let createdNew = false
    try {
      deps.setCapturedProjectId?.(null)
      // #R17-3: 명시적 생성 소유권 표시 — loadURL 전에 enterToolClicked 를 세워, did-finish-load
      //   부트스트랩의 자동 Enter-tool 생성이 경쟁적으로 다른 프로젝트를 만들지 않게 한다.
      deps.setEnterToolClicked?.(true)
      await flowView.webContents.loadURL(FLOW_URL)
      await new Promise((r) => setTimeout(r, 2000)) // home 렌더 대기
      const addBtnSelector = `(function(){
        try {
          const xr = document.evaluate("//button[.//i[normalize-space(text())='add_2']] | (//button[.//i[normalize-space(.)='add_2']])", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          if (xr.singleNodeValue) return xr.singleNodeValue;
        } catch {}
        for (const b of document.querySelectorAll('button')) { const i = b.querySelector('i'); if (i && (i.textContent.trim()==='add_2'||i.textContent.trim()==='add')) return b; }
        return null;
      })()`
      // #R15-6/#R16-2: 클릭 "전"에 project id 를 기록한다(클릭 후 빠른 네비로 이미 새 id 가 떠
      //   preId 가 새 id 가 되면 루프가 영원히 다른 id 를 기다린다). 클릭 성공도 요구한다.
      //   (home 이 직전 프로젝트로 리다이렉트돼 있으면 stale id 를 잘못 바인딩할 수 있다.)
      const preUrl = flowView.webContents.getURL() || ''
      const preMatch = preUrl.match(/\/project\/([0-9a-f-]{36})/)
      const preId = preMatch ? preMatch[1] : null
      const clickRes = await trustedClickOnFlowView(addBtnSelector, { required: true, step: 'new-project' })
      if (!clickRes?.success) {
        return { success: false, error: 'failed to click new-project button' }
      }
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500))
        const url = flowView.webContents.getURL() || ''
        const m = url.match(/\/project\/([0-9a-f-]{36})/)
        if (m && m[1] !== preId) {
          deps.setCapturedProjectId?.(m[1])
          createdNew = true
          console.log('[Flow Project] new flow project created:', m[1])
          await new Promise((r) => setTimeout(r, 1500)) // 프로젝트 UI 렌더 settle
          return { success: true, projectId: m[1] }
        }
      }
      return { success: false, error: 'timeout waiting for a NEW project URL' }
    } catch (e) {
      return { success: false, error: e.message }
    } finally {
      // #R20-4: 새 프로젝트 생성에 실패했으면 enterToolClicked 를 이전 값으로 복원(부트스트랩 자동생성 재허용).
      if (!createdNew) deps.setEnterToolClicked?.(prevEnterToolClicked ?? false)
    }
  })

  // Get current URL of Flow view
  ipcMain.handle('flow:dom-get-url', async () => {
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    return { success: true, url: flowView.webContents.getURL() }
  })

  // 진단: Flow "에이전트 설정" 패널 DOM 덤프(모델 드롭다운 옵션 포함) — 동적 모델 목록 셀렉터 캡처용.
  // 메인 창 콘솔에서 `await window.electronAPI.dumpFlowSettings()` 로 호출. (flow-settings-dumper 주입본 실행)
  ipcMain.handle('flow:dump-settings', async () => {
    const flowView = getFlowView()
    // locale-error-ok: Developer-only flow:dump-settings output is read in DevTools and never rendered in the product UI.
    if (!flowView) return { error: 'Flow view not ready (flow 모드로 전환했는지 확인)' }
    try {
      return await flowView.webContents.executeJavaScript(
        // locale-error-ok: Developer-only flow:dump-settings output is read in DevTools and never rendered in the product UI.
        'typeof __autoflowcut_dump_settings__ === "function" ? __autoflowcut_dump_settings__() : { error: "dumper 미주입 — Flow 페이지 로드 후 다시" }'
      )
    } catch (e) {
      return { error: e?.message || String(e) }
    }
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

      const clickResult = await trustedClickOnFlowView(btnSelector, { required: true, step: 'enter-tool' })
      if (clickResult.success) {
        deps.setEnterToolClicked(true)
        return { success: true }
      }
      return { success: false, error: 'Enter tool button not found' }
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
    // 프롬프트 본문은 안 찍는다 — Sentry consoleIntegration 이 main 콘솔을 breadcrumb 으로 걷어가
    //   사용자 콘텐츠가 그대로 전송된다. 길이만으로 "주입됐는지"는 충분히 진단된다.
    console.log('[DOM IPC] dom-send-prompt called: promptLen=', prompt?.length ?? 0)
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    // document.execCommand 방식이 작동하려면 flowView가 보여야 함 (focus 필요)
    // Slate API (editor.apply)는 숨겨져 있어도 작동하지만 fallback을 위해 일시적으로 보이게
    const currentBounds = flowView.getBounds()
    const wasHidden = (currentBounds.width === 0 || currentBounds.height === 0)
    if (wasHidden) {
      const { width, height } = mainWindow.getContentBounds()
      // 모든 디스플레이 너머로 — 멀티모니터에서 보조 모니터에 안 깜빡이게.
      flowView.setBounds(computeOffscreenBounds(screen.getAllDisplays(), mainWindow.getBounds().x, width, height))
      await new Promise(r => setTimeout(r, 300))
      console.log('[DOM IPC] Temporarily showed flowView (offscreen) for prompt injection')
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

      const clickResult = await trustedClickOnFlowView(generateBtnSelector, { required: true, step: 'compose-submit' })
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
        if (flowView) updateBounds(getMainWindow(), flowView)
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
