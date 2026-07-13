/**
 * Electron IPC Handler - Video Generation
 *
 * Text-to-Video (T2V), Image-to-Video (I2V) DOM automation,
 * and video status polling.
 */

import { screen } from 'electron'
import { updateBounds } from './layout.js'
import { extractServerErrorMessage } from './videoErrorExtractor.js'
import { computeOffscreenBounds } from '../offscreen-bounds.js'
import { GENERATED_VIDEO_PROBE } from '../flow-media-collect.js'
import { collectAgentDomVideos } from '../flow-agent-collect.js'
import { SUBMIT_PROBE, shouldProceed } from '../flow-submit-gate.js'
import { COMPOSE_EDITOR_READY } from '../flow-compose-editor.js'
import { AGENT_CHAT_CLOSE_SELECTOR } from '../flow-agent-toggle.js'
import { isOmniFlashModel } from '../video-model-rules.js'
import { injectComposeSegments } from '../flow-compose-mention.js'

// #R36: 비디오 제출 응답(batchAsyncGenerateVideo* → operation id) 캡처 타임아웃. 원래 30s 였으나
//   @멘션(entity 참조) 비디오 등에서 초기 응답이 30s 를 넘겨 조기 실패(멈춤)하는 사례가 있어, 이미지
//   캡처(120s)와 동일하게 여유를 둔다. (초기 ack 만 기다림 — 실제 생성/upscale 은 status 폴링이 처리.)
const VIDEO_RESPONSE_TIMEOUT_MS = 120000

/**
 * Register video-generation-related IPC handlers.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object} deps - Shared dependencies from main process
 */
export function registerVideoIPC(ipcMain, deps) {
  const {
    getFlowView, getMainWindow, trustedClickOnFlowView, sessionFetch, flowPageFetch,
    parseFlowResponse, getRecaptchaToken, configureFlowMode, switchFlowToVideoMode, ensureAgentOff, ensureAgentOn, ensureOnProjectComposer, applyAgentDefaults,
    getFlowAgentOn,
    getCapturedProjectId, setCapturedProjectId,
    getPendingVideoGeneration, setPendingVideoGeneration,
    setFlowPageInject, clearFlowPageInject,
    getCurrentMode,
    getApiBase, // #R33: region 대응 동적 API base (video i2v/status/upscale 호스트)
    SESSION_URL, VIDEO_T2V_URL, VIDEO_I2V_URL, VIDEO_I2V_START_END_URL, VIDEO_STATUS_URL, VIDEO_UPSCALE_URL,
    API_HEADERS, FLOW_URL,
  } = deps
  // #R33: video 직접 호출 엔드포인트 — 캡처된 region origin 우선, 없으면 하드코딩 fallback.
  const videoUrls = async () => {
    const base = getApiBase ? await getApiBase() : null
    return base ? {
      i2v: `${base}/video:batchAsyncGenerateVideoStartImage`,
      i2vStartEnd: `${base}/video:batchAsyncGenerateVideoStartAndEndImage`,
      status: `${base}/video:batchCheckAsyncVideoGenerationStatus`,
      upscale: `${base}/video:batchAsyncGenerateVideoUpsampleVideo`,
    } : {
      i2v: VIDEO_I2V_URL, i2vStartEnd: VIDEO_I2V_START_END_URL,
      status: VIDEO_STATUS_URL, upscale: VIDEO_UPSCALE_URL,
    }
  }

  // #R25-4: API 모드 전환 후에도 flowView 는 보존되므로 stale 호출이 Flow quota 를 쓸 수 있다.
  //   quota 를 쓰는 비디오 submit/upscale 핸들러는 현재 모드가 'flow' 일 때만 진행한다.
  const flowActive = () => !getCurrentMode || getCurrentMode() === 'flow'

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

  // 공유 DOM 수집 de-dup(이미지 비동기/동기 경로와 같은 set — cross-grab 방지).
  const collectedMediaIds = deps.collectedMediaIds || new Set()

  // Agent ON idle-gate — 직전 에이전트 생성이 끝날 때까지(arrow_forward enable) 대기 후 챗 패널
  //   가림을 해제한다. streamChat 은 순차라 직전 작업이 끝나야 컴포저가 보인다.
  //   (character.js generate-scene 의 idle-gate 와 동일 패턴.)
  async function waitAgentIdle(flowView, logTag) {
    const SUBMIT_POLL = 1500
    const SUBMIT_MAX_WAIT = 180000 // 에이전트 생성이 길 수 있어 최대 3분
    let submitState = 'absent'
    let gwaited = 0
    while (gwaited <= SUBMIT_MAX_WAIT) {
      submitState = await flowView.webContents.executeJavaScript(SUBMIT_PROBE).catch(() => 'error')
      if (shouldProceed(submitState)) break
      if (gwaited === 0) console.log(logTag + ' (Agent ON) agent not idle (' + submitState + ') — waiting for ready...')
      await new Promise(r => setTimeout(r, SUBMIT_POLL))
      gwaited += SUBMIT_POLL
    }
    if (submitState !== 'idle') {
      console.warn(logTag + ' (Agent ON) agent never idle (last=' + submitState + ', ' + Math.round(gwaited / 1000) + 's)')
      return { ok: false, error: 'Agent not ready (' + submitState + ') after 180s' }
    }
    if (gwaited > 0) console.log(logTag + ' (Agent ON) agent idle after', Math.round(gwaited / 1000), 's')
    // idle 인데도 챗 패널이 컴포저를 가리면 닫는다(no-op if 없음).
    for (let i = 0; i < 3; i++) {
      const r = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
      if (r) break
      await trustedClickOnFlowView(AGENT_CHAT_CLOSE_SELECTOR).catch(() => {})
      await new Promise(r => setTimeout(r, 350))
    }
    return { ok: true }
  }

  // Text-to-Video generation (DOM 자동화 — 페이지가 reCAPTCHA 자체 처리)
  ipcMain.handle('flow:generate-video-t2v', async (event, {
    token, prompt, projectId, model, aspectRatio, duration, videoBatchCount, seed, segments
  }) => {
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R25-4
    // #R36: @멘션 T2V — segments 가 있으면 컴포저 @칩(injectComposeSegments)으로 캐릭터 entity 를 넣는다.
    const _segments = Array.isArray(segments) && segments.length > 0 ? segments : null
    const flowView = getFlowView()
    const mainWindow = getMainWindow()
    if (!prompt) return { success: false, error: 'No prompt' }
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    // Seed: 숫자면 monkey-patch inject가 batchAsyncGenerateVideoText 요청에 주입,
    //       null/undefined면 Flow 자체 랜덤 seed 유지
    const hasUserSeed = typeof seed === 'number' && Number.isFinite(seed)
    const _seedValue  = hasUserSeed ? seed : null

    // #R8-8: seed inject 는 ensureOnProjectComposer(아래)의 네비게이션이 페이지를 reload 해
    //   __autoflowcut_inject__ 를 지운 뒤에 설정해야 한다 → 네비/모드전환 후로 이동.

    // R10-P2: arm-before-click 으로 둔 pending/timeout 을 try 밖에 선언 — 클릭/주입이 throw 하면
    //   finally 에서 자기 pending(identity)만 정리한다. 안 그러면 stale pending 이 남아 다음 영상
    //   응답을 잘못 받는다.
    let videoTimeout = null
    let videoOwnPending = null
    // #R7-10(R6-13 sibling): hoist so the finally always restores temp-shown bounds, even on throw.
    let promptWasHidden = false
    let promptBounds = null

    // 프롬프트 본문은 안 찍는다 — Sentry consoleIntegration 이 main 콘솔을 breadcrumb 으로 걷어간다.
    console.log('[Flow Video T2V] Starting DOM-triggered video generation: promptLen=', prompt?.length ?? 0, hasUserSeed ? `(seed: ${seed})` : '(seed: random)')

    try {
      // 0. Codex #R4-4: enforce Flow page is on the TARGET project before DOM mutation.
      const projectCheck = await ensureOnProjectComposer(flowView, projectId)
      if (!projectCheck.ok) return { success: false, error: projectCheck.error }

      // 1.5. Agent 토글 — flowAgentOn(설정) 이면 ON(autoApprove), 아니면 OFF(직접 API).
      const agentOn = !!(getFlowAgentOn && getFlowAgentOn())
      if (!agentOn) {
      let agentOff = false
      try { const r = await ensureAgentOff(); agentOff = !!(r && r.success) } catch (e) { console.warn('[Flow Video T2V] ensureAgentOff skipped:', e.message) }
      // [P1] Agent OFF 보장 실패 시 중단(fail-closed) — Agent ON 이면 batchAsyncGenerateVideo*
      //   캡처 전제가 깨져 timeout/오동작한다. (already_off 도 success=true 라 정상은 안 막음)
      if (!agentOff) return { success: false, error: 'Flow Agent 를 OFF 로 전환하지 못했습니다. Flow 가 "모든 미디어" 화면인지 확인한 뒤 다시 시도해주세요. (캐릭터/장면 탭에는 Agent 토글이 없어 실패할 수 있음)' }

      // 1.6. 동영상 모드로 전환 — 이미지/동영상 모드 탭은 컴포즈 하단 칩 팝오버
      //      (button[aria-haspopup='menu'])  안에 있다. configureFlowMode 가 칩을 눌러
      //      팝오버를 연 뒤 동영상 탭을 클릭한다(Step1~3). [P2] 배치 카운트(videoBatchCount) 전달.
      // #R30-1: 모드 전환이 (내부 재시도 소진 후) 명시적 {success:false} 면 컴포저가 IMAGE 모드일 수
      //   있어 비디오 제출이 이미지 요청으로 나가 잘못된 quota 소비 + capture timeout 을 유발한다 →
      //   제출 전에 중단한다(아직 inject/pending 미설정이라 plain return 안전). throw 는 기존대로 관용.
      // #R31-1: Flow 비디오 배치는 1 로 고정한다. configureFlowMode 가 N>1 칩을 켜면 Flow 가 N 개
      //   영상을 생성하지만 extractVideoGenerationId 는 1 개 id 만 회수해 나머지 유료 결과가 추적/복구
      //   불가로 유실된다(quota 낭비). 멀티-비디오 캡처가 구현되기 전까진 1 로 클램프.
      let _vmodeRes = null
      try { _vmodeRes = await configureFlowMode("VIDEO", 1) } catch (e) { console.warn("[Flow Video] configureFlowMode skipped:", e.message) }
      if (_vmodeRes && _vmodeRes.success === false) {
        return { success: false, error: `Flow VIDEO mode switch failed: ${_vmodeRes.error || 'unknown'}`, retry: true }
      }

      // (v2) Flow 비디오 모델 + 화면비 적용 — 에이전트 설정 패널(동적 모델 목록 반영). 컴포즈 주입 전.
      // #R33: 화면비(설정>씬)는 이미지·비디오 공용. 이미지는 monkey-patch inject 로, 비디오는 이
      //   패널(aspectSuffix)로 적용한다 — aspectRatio 를 안 넘기면 컴포저 기본값(잘못된 비율)으로 나간다.
      if (applyAgentDefaults) {
        // #R34-fix(2): best-effort(warn) — 패널 미발견/필드 미적용으로 생성을 막지 않는다.
        try {
          const _md = await applyAgentDefaults({ video: { model, aspectRatio } })
          if (!_md?.success) console.warn('[Flow Video] applyAgentDefaults(video) not applied:', _md?.error)
          else if (_md.applied === false) console.warn('[Flow Video] applyAgentDefaults(video): panel found but not fully applied')
        } catch (e) { console.warn('[Flow Video] applyAgentDefaults(video) error:', e.message) }
      }
      } else {
        // [Agent ON — Maps 그라운딩/주소 기반] 토글 ON 유지 + autoApprove. 모드 탭 없어 configureFlowMode 생략.
        // ⚠️ 라이브 검증 필요(셀렉터/타이밍/DOM 수집).
        let onOk = false
        try { const r = await ensureAgentOn(); onOk = !!(r && r.success) } catch (e) { console.warn('[Flow Video T2V] ensureAgentOn skipped:', e.message) }
        if (!onOk) return { success: false, error: 'Flow Agent 를 ON 으로 전환하지 못했습니다. Flow 컴포즈에 Agent 토글이 있는지 확인해주세요.' }
        if (applyAgentDefaults) {
          // #R33: Agent ON 도 화면비(설정>씬) 적용 — video.aspectRatio 전달. #R34-fix(2): best-effort(warn).
          try {
            const _md = await applyAgentDefaults({ video: { model, aspectRatio }, autoApprove: true })
            if (!_md?.success) console.warn('[Flow Video T2V] applyAgentDefaults not applied:', _md?.error)
            else if (_md.applied === false) console.warn('[Flow Video T2V] applyAgentDefaults: panel found but not fully applied')
          } catch (e) { console.warn('[Flow Video T2V] applyAgentDefaults error:', e.message) }
        }
        // 타입 강제(이미지로 빠지지 않게) — 명시 지시로 감싼다.
        prompt = `Generate a video: ${prompt}`
        // 직전 에이전트 생성이 진행 중이면 컴포저가 가려진다 → idle 까지 대기 후 주입.
        const idle = await waitAgentIdle(flowView, '[Flow Video T2V]')
        if (!idle.ok) return { success: false, error: idle.error, retry: true }
      }

      // #R8-8: seed monkey-patch inject 는 네비게이션/모드전환 이후(reload 가 끝난 뒤)에 설정 —
      //   클릭으로 발사될 batchAsyncGenerateVideoText 요청이 이 seed 를 확실히 싣는다.
      // #R15-5: arming 실패 시 중단(미주입 seed 로 생성 방지).
      { const _ir = await setFlowPageInject?.({ seed: _seedValue, aspectRatio: null, references: null, i2v: null, duration, videoModel: model })
        if (_ir && _ir.success === false) return { success: false, error: `Flow inject arming failed: ${_ir.error || 'unknown'}`, retry: true } }

      // 2. 프롬프트 입력 (이미지와 동일한 Slate 에디터 사용)
      promptBounds = flowView.getBounds()
      promptWasHidden = (promptBounds.width === 0 || promptBounds.height === 0)
      if (promptWasHidden) {
        const { width, height } = mainWindow.getContentBounds()
        flowView.setBounds(computeOffscreenBounds(screen.getAllDisplays(), mainWindow.getBounds().x, width, height))
        await new Promise(r => setTimeout(r, 300))
      }

      // 2-pre. 에디터 포커스 확보 (이미지와 동일) — webContents.focus() + 에디터 trusted-click.
      // 이게 없으면 editor.focus()/execCommand 가 무시되어(activeEl=body) 프롬프트가 안 박힌다.
      try { flowView.webContents.focus() } catch (e) { console.warn('[Flow Video T2V] webContents.focus failed:', e.message) }
      await new Promise(r => setTimeout(r, 120))
      const vEditorFocusSelector = `(function(){
        return document.querySelector("[data-slate-editor='true']")
          || document.querySelector("div[role='textbox'][contenteditable='true']:not(#af-bot-panel *)")
          || document.querySelector('[contenteditable="true"]:not([aria-hidden])')
          || document.querySelector('textarea');
      })()`
      try {
        const ef = await trustedClickOnFlowView(vEditorFocusSelector)
        console.log('[Flow Video T2V] Editor focus click:', ef?.success)
      } catch (e) { console.warn('[Flow Video T2V] editor focus click failed:', e.message) }
      await new Promise(r => setTimeout(r, 120))

      // #R36: @멘션 T2V — segments 가 있으면 컴포저 칩 삽입(이미지 씬과 동일 헬퍼). 없으면 기존 텍스트 주입.
      //   #R36-fix(Codex R1[4]): Agent ON 은 모드 탭이 없어 "Generate a video:" 프리픽스로 타입을 강제한다.
      //   plain 프롬프트 경로는 위에서 prompt 에 붙였지만, segments(칩) 경로엔 텍스트 세그먼트로 앞에 붙인다.
      const _injSegments = _segments && agentOn
        ? [{ type: 'text', text: 'Generate a video: ' }, ..._segments]
        : _segments
      const promptResult = _injSegments
        ? await (async () => {
            const _si = await injectComposeSegments(flowView, _injSegments)
            console.log('[Flow Video T2V] segments injected (chips):', _segments.filter(s => s.type === 'mention').length, '→', _si.ok)
            return _si.ok
              ? { success: true }
              : { success: false, error: _si.error, ...(_si.staleMention ? { staleMention: _si.staleMention } : {}) }
          })()
        : await flowView.webContents.executeJavaScript(`
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
          // #R32-1: 프롬프트가 비어도(F2V 'none' 소스 → I2V) 유효하다 — 이미지가 생성을 주도.
          //   빈 프롬프트는 주입할 게 없으니 injected=true 로 시작해, 비-빈 modelText 요구(아래 verifier)
          //   때문에 'Prompt injection failed' 로 막히지 않게 한다(API 모드는 빈 프롬프트 허용 — 모드 일치).
          let injected = !promptText;
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
        updateBounds(getMainWindow(), flowView)
        await new Promise(r => setTimeout(r, 200))
      }

      if (!promptResult?.success) {
        // #R36: @멘션 칩 삽입 실패면 staleMention 전파(렌더러 self-heal — ref 를 failed 로 마킹).
        return { success: false, error: promptResult?.error || 'Prompt injection failed', ...(promptResult?.staleMention ? { staleMention: promptResult.staleMention, retry: true } : {}) }
      }
      console.log('[Flow Video T2V] Prompt injected successfully')

      // 4. Generate 버튼 셀렉터 (Agent ON/OFF 공통)
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

      // [Agent ON] streamChat 은 batchAsyncGenerateVideoText 를 안 보내 intercept 로 못 받는다 →
      //   제출 전 스냅샷 후 클릭하고 DOM 의 "새" 결과 <video>(media.getMediaUrlRedirect?name=) 를 수집한다.
      //   base64 가 아닌 mediaId 를 generationId 로 반환 → 렌더러의 기존 check-video-status→download 파이프가 이어받는다.
      if (agentOn) {
        let existingGenMediaIds = []
        try {
          const _pre = await flowView.webContents.executeJavaScript(GENERATED_VIDEO_PROBE)
          if (Array.isArray(_pre)) existingGenMediaIds = _pre.map(v => v && v.mediaId).filter(Boolean)
        } catch {}
        const aClick = await trustedClickOnFlowView(generateBtnSelector, { required: true, step: 'video-submit' })
        if (!aClick?.success) return { success: false, error: aClick?.error || 'Failed to click Generate button' }
        console.log('[Flow Video T2V] (Agent ON) clicked, collecting DOM <video>...')
        const col = await collectAgentDomVideos({
          scan: () => flowView.webContents.executeJavaScript(GENERATED_VIDEO_PROBE),
          sleep: (ms) => new Promise(r => setTimeout(r, ms)),
          // 제출 전 스냅샷 + 다른 경로가 이미 수집한 것 제외 → 결과만.
          existingMediaIds: [...existingGenMediaIds, ...collectedMediaIds], want: 1,
          markCollected: (mid) => collectedMediaIds.add(mid),
        })
        if (!col.success) return { success: false, error: col.error, retry: true }
        const mediaId = col.videos[0] && col.videos[0].mediaId
        console.log('[Flow Video T2V] (Agent ON) collected video mediaId:', mediaId)
        return { success: true, generationId: mediaId }
      }

      // 3. (Agent OFF) CDP 비디오 응답 캡처 Promise 설정 (resolve 만 캡처 — 타이머/arm 은 클릭 직전에)
      let resolveVideo = null
      const videoResponsePromise = new Promise((resolve) => { resolveVideo = resolve })

      // R9-P1: arm-before-click — main 의 캡처는 pendingVideoGeneration 이 non-null 일 때만 동작한다.
      //   클릭 후 arm 하면 매우 빠른 응답/에러가 arm 전에 도착해 캡처를 놓치고 false 30s timeout 으로 빠진다.
      //   setAt=now(백데이트 제거): 클릭으로 시작될 요청은 이 setAt 이후 reqSentAt 을 가진다.
      //   timeout/click 실패 정리는 자기 pending(videoOwnPending)만 identity 로 건드린다.
      const videoSetAt = Date.now() / 1000
      videoOwnPending = {
        setAt: videoSetAt,
        resolve: (result) => { clearTimeout(videoTimeout); resolveVideo(result) }
      }
      setPendingVideoGeneration(videoOwnPending)
      videoTimeout = setTimeout(() => {
        if (getPendingVideoGeneration() === videoOwnPending) {
          setPendingVideoGeneration(null)
          resolveVideo({ error: true, message: `Video response timeout (${Math.round(VIDEO_RESPONSE_TIMEOUT_MS / 1000)}s)` })
        }
      }, VIDEO_RESPONSE_TIMEOUT_MS) // #R36: 초기 ack 캡처(생성/upscale 은 status 폴링)

      const clickResult = await trustedClickOnFlowView(generateBtnSelector, { required: true, step: 'video-submit' })
      console.log('[Flow Video T2V] Trusted click result:', clickResult)

      if (!clickResult?.success) {
        clearTimeout(videoTimeout)
        if (getPendingVideoGeneration() === videoOwnPending) setPendingVideoGeneration(null)
        return { success: false, error: clickResult?.error || 'Failed to click Generate button' }
      }
      console.log('[Flow Video T2V] pendingVideoGeneration armed BEFORE click, waiting for CDP capture...')

      // 5. 비디오 API 응답 대기
      const netResult = await videoResponsePromise

      if (netResult.error) {
        const errMsg = extractServerErrorMessage(netResult, parseFlowResponse)
        console.warn('[Flow Video T2V] Video API failed:', errMsg)
        return { success: false, error: errMsg }
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
    } finally {
      // R10-P2: throw 등 어떤 종료 경로든 arm 한 pending/timeout 을 정리 — 자기 pending(identity)만.
      //   (성공 경로는 응답이 이미 pending 을 비웠으므로 no-op.)
      if (videoTimeout) clearTimeout(videoTimeout)
      if (videoOwnPending && getPendingVideoGeneration() === videoOwnPending) setPendingVideoGeneration(null)
      // #R7-10: 주입 중 throw 해도 임시로 보인 flowView 를 원복(성공 경로는 이미 hidden → no-op).
      if (promptWasHidden) { try { updateBounds(getMainWindow(), flowView) } catch {} }
      // Monkey-patch inject 정리 (항상 실행)
      await clearFlowPageInject?.()
    }
  })

  // Image-to-Video generation (DOM 자동화 + CDP Fetch 인터셉션)
  // T2V와 동일한 DOM 흐름: 프롬프트 주입 → Generate 클릭 → CDP 응답 캡처
  // 차이점: CDP Fetch로 나가는 T2V 요청을 가로채서 startImage 주입 + URL을 I2V 엔드포인트로 변경
  ipcMain.handle('flow:generate-video-i2v', async (event, {
    token, prompt, startImageMediaId, endImageMediaId, projectId, model, aspectRatio, duration, videoBatchCount, seed
  }) => {
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R25-4
    const flowView = getFlowView()
    const mainWindow = getMainWindow()
    if (!startImageMediaId) return { success: false, error: 'No start image mediaId' }
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    // Seed: 숫자면 monkey-patch inject가 video 요청에 주입,
    //       null/undefined면 Flow 자체 랜덤 seed 유지
    const hasUserSeed = typeof seed === 'number' && Number.isFinite(seed)
    const _seedValue  = hasUserSeed ? seed : null

    // OmniFlash i2v 는 종료프레임 미지원 — 종료이미지가 있어도 무시한다(start-only). 안 그러면
    //   URL 은 StartAndEndImage 로 가는데 body 엔 endImage 가 없어 HTTP 400 INVALID_ARGUMENT.
    if (endImageMediaId && isOmniFlashModel(model)) {
      console.log('[Flow Video I2V] OmniFlash 는 종료프레임 미지원 → endImage 무시(start-only)')
    }
    const hasEndImage = !!endImageMediaId && !isOmniFlashModel(model)
    console.log('[Flow Video I2V] Starting DOM-triggered I2V generation, start:', startImageMediaId?.substring(0, 8),
      hasEndImage ? ', end: ' + endImageMediaId?.substring(0, 8) : '(start only)',
      hasUserSeed ? `(seed: ${seed})` : '(seed: random)')

    // R10-P2: arm-before-click pending/timeout 을 try 밖에 선언 — throw 시 finally 에서 identity 정리.
    let videoTimeout = null
    let videoOwnPending = null
    // #R7-10(R6-13 sibling): hoist so the finally always restores temp-shown bounds, even on throw.
    let promptWasHidden = false
    let promptBounds = null

    try {
      // 0. Codex #R4-4: enforce Flow page is on the TARGET project before DOM mutation.
      const projectCheck = await ensureOnProjectComposer(flowView, projectId)
      if (!projectCheck.ok) return { success: false, error: projectCheck.error }

      // 1.5. Agent 토글 — i2v 는 시작 이미지(startImageMediaId)를 monkey-patch 로 비디오 요청에
      //   주입하는데, Agent ON(streamChat)은 그 요청 자체를 안 보내 주입 통로가 없다(Agent ON 컴포저에
      //   이미지 첨부 자동화도 없음). 그래서 사용자가 Agent ON 으로 설정했어도 i2v 는 항상 Agent OFF
      //   경로(intercept)로 fallback 한다. t2v 와 달리 DOM 수집으로 살릴 수 없는 입력단 한계.
      if (getFlowAgentOn && getFlowAgentOn()) {
        console.log('[Flow Video I2V] Agent ON 설정이나 i2v 는 시작 이미지 주입(intercept) 필요 → Agent OFF 경로로 fallback')
      }
      let agentOff = false
      try { const r = await ensureAgentOff(); agentOff = !!(r && r.success) } catch (e) { console.warn('[Flow Video I2V] ensureAgentOff skipped:', e.message) }
      // [P1] Agent OFF 보장 실패 시 중단(fail-closed) — t2v 와 동일 이유.
      if (!agentOff) return { success: false, error: 'Flow Agent 를 OFF 로 전환하지 못했습니다. Flow 가 "모든 미디어" 화면인지 확인한 뒤 다시 시도해주세요. (캐릭터/장면 탭에는 Agent 토글이 없어 실패할 수 있음)' }

      // 1.6. 동영상 모드로 전환 — t2v 와 동일하게 configureFlowMode 가 컴포즈 칩 팝오버를
      //      열고 동영상 탭을 클릭한다. [P2] 배치 카운트(videoBatchCount) 전달.
      // #R30-1: 모드 전환 명시적 {success:false} 면 제출 중단(t2v 와 동일 — 잘못된 quota/timeout 방지).
      // #R31-1: 배치 1 로 고정(멀티-비디오 결과 미추적 → 유료 유실 방지, t2v 와 동일).
      let _vmodeRes = null
      try { _vmodeRes = await configureFlowMode("VIDEO", 1) } catch (e) { console.warn("[Flow Video] configureFlowMode skipped:", e.message) }
      if (_vmodeRes && _vmodeRes.success === false) {
        return { success: false, error: `Flow VIDEO mode switch failed: ${_vmodeRes.error || 'unknown'}`, retry: true }
      }

      // (v2) Flow 비디오 모델 + 화면비 적용 (I2V — t2v 와 동일). #R33: aspectRatio(설정>씬) 전달.
      if (applyAgentDefaults) {
        // #R34-fix(2): best-effort(warn) — 패널 미발견/필드 미적용으로 생성을 막지 않는다.
        try {
          const _md = await applyAgentDefaults({ video: { model, aspectRatio } })
          if (!_md?.success) console.warn('[Flow Video I2V] applyAgentDefaults(video) not applied:', _md?.error)
          else if (_md.applied === false) console.warn('[Flow Video I2V] applyAgentDefaults(video): panel found but not fully applied')
        } catch (e) { console.warn('[Flow Video I2V] applyAgentDefaults error:', e.message) }
      }

      // 2. 프롬프트 입력 (T2V와 동일한 Slate 에디터 사용)
      promptBounds = flowView.getBounds()
      promptWasHidden = (promptBounds.width === 0 || promptBounds.height === 0)
      if (promptWasHidden) {
        const { width, height } = mainWindow.getContentBounds()
        flowView.setBounds(computeOffscreenBounds(screen.getAllDisplays(), mainWindow.getBounds().x, width, height))
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
          // #R32-1: 프롬프트가 비어도(F2V 'none' 소스 → I2V) 유효하다 — 이미지가 생성을 주도.
          //   빈 프롬프트는 주입할 게 없으니 injected=true 로 시작해, 비-빈 modelText 요구(아래 verifier)
          //   때문에 'Prompt injection failed' 로 막히지 않게 한다(API 모드는 빈 프롬프트 허용 — 모드 일치).
          let injected = !promptText;
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
        updateBounds(getMainWindow(), flowView)
        await new Promise(r => setTimeout(r, 200))
      }

      if (!promptResult?.success) {
        return { success: false, error: promptResult?.error || 'Prompt injection failed' }
      }
      console.log('[Flow Video I2V] Prompt injected successfully')

      // 3. Set inject state for monkey-patch path
      // #R33: i2v 엔드포인트를 region 캡처 origin 으로 해석(없으면 하드코딩 fallback).
      const _vu = await videoUrls()
      const i2vConfig = {
        startImageMediaId,
        endImageMediaId: hasEndImage ? endImageMediaId : null,
        i2vUrl: _vu.i2v,
        i2vStartEndUrl: _vu.i2vStartEnd,
        duration,    // OmniFlash i2v 길이 접미사 최적화용
        videoModel: model,  // 앱이 OmniFlash 면 injectI2VBody 가 abra i2v 키로 강제(패널 우회)
      }
      // Monkey-patch path: write into Flow page — #R15-5: arming 실패 시 중단(미주입 i2v 방지).
      const _i2vInjRes = await setFlowPageInject?.({
        seed:        _seedValue,
        aspectRatio: null,
        references:  null,
        i2v:         i2vConfig,
      })
      if (_i2vInjRes && _i2vInjRes.success === false) {
        return { success: false, error: `Flow inject arming failed: ${_i2vInjRes.error || 'unknown'}`, retry: true }
      }

      // 4. 비디오 응답 캡처 Promise 설정 (resolve 만 캡처 — 타이머/arm 은 클릭 직전에)
      let resolveVideo = null
      const videoResponsePromise = new Promise((resolve) => { resolveVideo = resolve })

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

      // R9-P1: arm-before-click(이미지/ T2V 와 동일) — 클릭 후 arm 하면 빠른 응답/에러를 놓쳐
      //   false 30s timeout 으로 빠진다. setAt=now, 정리는 자기 pending 만 identity 로.
      const videoSetAt = Date.now() / 1000
      videoOwnPending = {
        setAt: videoSetAt,
        resolve: (result) => { clearTimeout(videoTimeout); resolveVideo(result) }
      }
      setPendingVideoGeneration(videoOwnPending)
      videoTimeout = setTimeout(() => {
        if (getPendingVideoGeneration() === videoOwnPending) {
          setPendingVideoGeneration(null)
          resolveVideo({ error: true, message: `Video response timeout (${Math.round(VIDEO_RESPONSE_TIMEOUT_MS / 1000)}s)` })
        }
      }, VIDEO_RESPONSE_TIMEOUT_MS)

      const clickResult = await trustedClickOnFlowView(generateBtnSelector, { required: true, step: 'video-submit' })
      console.log('[Flow Video I2V] Trusted click result:', clickResult)

      if (!clickResult?.success) {
        clearTimeout(videoTimeout)
        if (getPendingVideoGeneration() === videoOwnPending) setPendingVideoGeneration(null)
        return { success: false, error: clickResult?.error || 'Failed to click Generate button' }
      }
      console.log('[Flow Video I2V] pendingVideoGeneration armed BEFORE click, waiting for CDP capture...')

      // 6. 비디오 API 응답 대기
      const netResult = await videoResponsePromise

      if (netResult.error) {
        const errMsg = extractServerErrorMessage(netResult, parseFlowResponse)
        console.warn('[Flow Video I2V] Video API failed:', errMsg)
        return { success: false, error: errMsg }
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
      // R10-P2: throw 등 어떤 종료 경로든 arm 한 pending/timeout 정리 — 자기 pending(identity)만.
      if (videoTimeout) clearTimeout(videoTimeout)
      if (videoOwnPending && getPendingVideoGeneration() === videoOwnPending) setPendingVideoGeneration(null)
      // #R7-10: 주입 중 throw 해도 임시로 보인 flowView 를 원복(성공 경로는 이미 hidden → no-op).
      if (promptWasHidden) { try { updateBounds(getMainWindow(), flowView) } catch {} }
      // Monkey-patch inject 정리 (항상 실행)
      await clearFlowPageInject?.()
    }
  })

  // Check video generation status (페이지 컨텍스트에서 실행 — origin 일치)
  ipcMain.handle('flow:check-video-status', async (event, { token, generationIds, projectId }) => {
    const flowView = getFlowView()
    if (!token) return { success: false, error: 'No token' }
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    const pid = projectId || getCapturedProjectId() || ''
    const _statusUrl = (await videoUrls()).status  // #R33: region 대응 status 엔드포인트

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
            const resp = await fetch('${_statusUrl}', {
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
            // 실제 실패 사유를 우선 추출 ("Media not found." 등). 구조:
            //   mediaMetadata.mediaStatus.error.message / .failureReasons[0]
            // 이게 stale("Media not found") 자동복구 판정(isStaleVideoStatus)의 입력이므로
            // enum(MEDIA_GENERATION_STATUS_FAILED)으로 폴백하면 복구가 안 된다.
            const ms = m?.mediaMetadata?.mediaStatus
            const failReason = ms?.error?.message
              || (Array.isArray(ms?.failureReasons) ? ms.failureReasons[0] : null)
              || ms?.failureReason
              || ms?.errorMessage
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
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R25-4
    const flowView = getFlowView()
    if (!token) return { success: false, error: 'No token' }
    if (!mediaId) return { success: false, error: 'No mediaId' }
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    const normalizedRes = String(resolution || '1080p').toLowerCase()
    const resolutionEnum = normalizedRes === '4k' ? 'VIDEO_RESOLUTION_4K' : 'VIDEO_RESOLUTION_1080P'
    const modelKey = normalizedRes === '4k' ? 'veo_3_1_upsampler_4k' : 'veo_3_1_upsampler_1080p'
    const pid = projectId || getCapturedProjectId() || ''

    const _upscaleUrl = (await videoUrls()).upscale  // #R33: region 대응 upscale 엔드포인트

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
            const endpoint = ${JSON.stringify(_upscaleUrl)};
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
