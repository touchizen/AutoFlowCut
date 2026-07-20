/**
 * electron/ipc/character.js
 *
 * Flow 캐릭터 생성·등록 IPC — 하이브리드.
 *
 * 순수 API 직접 호출로는 캐릭터 "생성"이 불가능(주입 fetch 는 reCAPTCHA Enterprise
 * 위험점수가 낮아 batchGenerateImages 가 영원히 400). 그래서:
 *   1) /characters 컴포저로 네비 → 프롬프트 주입 → arrow_forward 트러스트 클릭으로 생성 트리거.
 *      (서버가 진짜 UI 컨텍스트로 entity 를 만든다.)
 *   2) batchGenerateImages 응답을 pendingGeneration 으로 가로채 entityId/workflowId 추출
 *      (../flow-character-api.js parseCharacterGenerateResponse — entityId 는 workflows[].parentEntityId).
 *   3) PATCH /v1/flow/entities 로 이름(멘션 토큰) 등록 (buildEntityRegisterBody, recaptcha 불필요).
 *
 * 트러스트 클릭/프롬프트 주입 패턴은 flow-api.js 의 flow:generate-image 와 동일(검증된 경로).
 */

import { updateBounds } from './layout.js'
import {
  buildEntityRegisterBody,
  buildEntityRenameBody,
  buildEntityImageBody,
  parseCharacterGenerateResponse,
  buildCharacterResult,
  downloadFifeAsBase64,
  isStaleEntityErrorBody,
  isStaleRegistrationResponse,
  parseUploadImageResponse,
  buildCharactersUrl,
} from '../flow-character-api.js'
import { COMPOSE_EDITOR_READY } from '../flow-compose-editor.js'
import { EDITOR_SELECTOR, appendSceneText, insertSceneMention, injectComposeSegments } from '../flow-compose-mention.js'
import { FLOW_APPLY_NAME_PROBE, FLOW_BACK_BTN_EXPR } from '../flow-character-name.js'
import { screen } from 'electron'
import { computeOffscreenBounds } from '../offscreen-bounds.js'
import { GENERATED_IMG_PROBE } from '../flow-media-collect.js'
import { collectAgentDomImages } from '../flow-agent-collect.js'
import { AGENT_CHAT_CLOSE_SELECTOR } from '../flow-agent-toggle.js'
import { SUBMIT_PROBE, shouldProceed } from '../flow-submit-gate.js'

// 캡처(flow-net-capture.json)로 확인한 호스트. ⚠️ 후속: 가로챈 batchGenerateImages URL 의
// origin 으로 동적화 고려(region/계정별 다를 가능성). 지금은 관찰된 글로벌 엔드포인트로 고정.
const API_BASE = 'https://aisandbox-pa.googleapis.com/v1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// #R35: 비동기 멘션 씬의 응답↔gen 상관키를 고른다(순수). 멘션 부분은 batchGenerateImages 요청 body 에서
//   entity 참조로 치환돼 verbatim 이 아니므로, 요청 body 에 그대로 실리는 "가장 긴 텍스트 세그먼트"를
//   키로 쓴다 — 씬마다 설명이 달라 고유하다. 텍스트 세그먼트가 없으면 원본 prompt 로 폴백.
export function pickSceneCorrelationKey(segs, prompt) {
  // #R35-fix(Codex[1]): 길이는 trim 기준으로 비교하되 키는 "원문"을 그대로 보존한다.
  //   generationMatch.promptInBody 는 `"<key>"` 를 요청 body 에서 exact 검색하므로, trim 하면
  //   실제 삽입된 세그먼트(예: leading space " walks")와 안 맞아 다중 pending 에서 drop→timeout 된다.
  let key = ''
  let keyLen = -1
  for (const s of segs || []) {
    if (s && s.type === 'text' && typeof s.text === 'string') {
      const tl = s.text.trim().length
      if (tl > keyLen) { key = s.text; keyLen = tl }
    }
  }
  return key || (typeof prompt === 'string' ? prompt : '')
}

// #R33: 캐릭터 entity 업로드(=on-demand @멘션 등록)의 uploadImage 응답 대기 한도.
//   60s 는 큰 레퍼런스/혼잡 시 짧아 타임아웃→registered=false→flowNameSyncStatus='failed' 로
//   고착돼 멘션 후보에서 빠졌다("Unresolved @mention"). 등록 완료 시간을 확보(+1분).
export const CHARACTER_UPLOAD_TIMEOUT_MS = 120000

// EDITOR_SELECTOR / appendSceneText / insertSceneMention / injectComposeSegments 는 flow-compose-mention.js 로
//   추출(이미지 씬·T2V 비디오 공용). #R36.

// arrow_forward(생성) 버튼 — /characters 컴포저도 동일 아이콘. disabled 면 선택 안 함.
const GENERATE_BTN_SELECTOR = `(function(){
  try {
    const xr = document.evaluate("//button[.//i[text()='arrow_forward']]",
      document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    if (xr.singleNodeValue && !xr.singleNodeValue.disabled) return xr.singleNodeValue;
  } catch {}
  for (const b of document.querySelectorAll('button'))
    for (const icon of b.querySelectorAll('i'))
      if (icon.textContent.trim() === 'arrow_forward' && !b.disabled) return b;
  return null;
})()`

export function registerCharacterIPC(ipcMain, deps) {
  const {
    getFlowView, getMainWindow, trustedClickOnFlowView, flowPageFetch,
    parseFlowResponse, getCapturedProjectId, ensureOnProjectComposer,
    // R10-P1: getPendingGeneration 은 clickAndCaptureGeneration 의 timeout identity 가드에서 쓴다 —
    //   destructure 안 하면 free variable 이 되어 timeout 발생 시 ReferenceError 로 handler 가 hang.
    getPendingGeneration, setPendingGeneration, SESSION_URL,
    sessionFetch, getCurrentMode, getFlowAgentOn,
    // #R33: 씬(@멘션) 생성도 generate-image 와 동일하게 이미지 모드 강제 + 화면비 주입에 필요.
    //   안 쓰면 컴포저의 직전 상태(영상/9:16)를 그대로 따라가 영상·잘못된 비율로 생성된다.
    configureFlowMode, setFlowPageInject, clearFlowPageInject, applyAgentDefaults,
    ensureAgentOff, ensureAgentOn,
    // #R33: entities PATCH 호스트를 region 에 맞춰 동적 해석(없으면 API_BASE fallback).
    getApiBase,
    // #R35: 멘션 씬 비동기 제출용 — flow-api.js async 이미지와 동일한 다중 pending 추적 Map.
    pendingGenerations,
  } = deps
  // entities 직접 호출 base — region 캡처값(getApiBase) 우선, 없으면 하드코딩 fallback.
  const apiBase = async () => (getApiBase ? await getApiBase() : API_BASE)
  // flow-api(비동기) 와 공유하는 DOM 수집 de-dup — 혼합 배치에서 서로의 이미지를 안 가로채게.
  const collectedMediaIds = deps.collectedMediaIds || new Set()

  // #R26-1: R25 의 flowActive() 게이트가 flow-api.js/video.js 만 덮고 character/scene 경로를 놓쳤다.
  //   API 모드 전환 후에도 flowView 가 보존되므로 stale 호출이 Flow quota 를 쓰거나 상태를 바꿀 수
  //   있다. quota/상태변경 핸들러는 현재 모드가 'flow' 일 때만 진행한다.
  const flowActive = () => !getCurrentMode || getCurrentMode() === 'flow'

  // Flow API 는 OAuth2 Bearer access token 을 요구(쿠키만으론 401). 세션 엔드포인트에서 추출.
  async function getAccessToken() {
    try {
      const r = await flowPageFetch(SESSION_URL, { method: 'GET' })
      let parsed = null
      try { parsed = parseFlowResponse(r.text) } catch {}
      if (!parsed) { try { parsed = JSON.parse(r.text) } catch {} }
      return (parsed && (parsed.access_token || parsed.accessToken)) || null
    } catch { return null }
  }

  function projectIdFromUrl() {
    try {
      const url = (getFlowView() && getFlowView().webContents.getURL()) || ''
      const m = url.match(/\/project\/([0-9a-f-]{36})/)
      return m ? m[1] : null
    } catch { return null }
  }

  // 생성 버튼 트러스트 클릭 + batchGenerateImages 응답 캡처 (character/reroll/scene 공통).
  //   P2-1: pendingGeneration 을 클릭 "직전"에 arm 한다 — 클릭 후 arm 하면 매우 빠른 400/실패
  //   응답이 arm 전에 도착해 main 의 report-response 가 버릴 수 있다(미스). setAt -2s fudge 와
  //   함께 클릭 직후 시작되는 요청을 안정적으로 잡는다.
  //   반환: { clickError?, clickErrorKind?, timeout?, resp0, body, status } (resp0 = responses[0]).
  async function clickAndCaptureGeneration(flowView, { timeoutMs = 120000 } = {}) {
    let timeout = null
    let ownPending = null
    // R11-P2: 자기 pending(identity)만 정리하는 헬퍼 — 클릭 실패/throw 공통.
    const cleanupOwn = () => {
      clearTimeout(timeout)
      if (getPendingGeneration() === ownPending) setPendingGeneration(null)
    }
    const genPromise = new Promise((resolve) => {
      // R5-P2: arm-before-click 구조라 backdate(-2s) 불필요 — 클릭으로 시작될 요청은 이 setAt
      //   이후 reqStartedAt 을 가진다. 2초 창을 두면 그 안의 이전 응답이 새 요청을 만족시킬 수 있어 제거.
      ownPending = { setAt: Date.now() / 1000, expectedCount: 1, responses: [], collectionTimer: null, resolve: (r) => { clearTimeout(timeout); resolve(r) } }
      setPendingGeneration(ownPending)
      // R9-P2: identity 가드 — 만료 시 "자기 pending(ownPending)" 이 여전히 현재일 때만 null/resolve.
      //   옛 코드는 무조건 setPendingGeneration(null) 이라, 그 사이 새 생성이 arm 한 pending 을 지웠다.
      //   (createGenerationTimeout 은 payload 가 달라 여기선 timeout:true 형태를 직접 유지.)
      timeout = setTimeout(() => {
        if (getPendingGeneration() === ownPending) {
          setPendingGeneration(null)
          resolve({ error: true, timeout: true })
        }
      }, timeoutMs)
    })
    // R11-P2: 클릭이 throw 하면(예외) cleanup 없이 빠져 stale pending 이 120초까지 남고 main 의 sync
    //   캡처가 다음 batchGenerateImages 응답을 삼킨다. try/catch 로 자기 pending 을 정리한다.
    let click
    try {
      click = await trustedClickOnFlowView(GENERATE_BTN_SELECTOR, { required: true, step: 'character-submit' })
    } catch (e) {
      cleanupOwn()
      return {
        clickErrorKind: 'generate-button-click-failed',
        clickError: 'Could not click Generate',
      }
    }
    // R7-P2: 클릭 실패 시 timeout 도 반드시 clear — 안 하면 120초 뒤 콜백이 그때 살아있는 다른
    //   pendingGeneration 을 지운다(arm 한 pending 삭제 + 타이머 정리).
    if (!click || !click.success) {
      cleanupOwn()
      return {
        clickErrorKind: 'generate-button-click-failed',
        clickError: 'Could not click Generate',
      }
    }
    const genResult = await genPromise
    const resp0 = genResult && !genResult.error && genResult.responses && genResult.responses[0]
    return { timeout: !!(genResult && genResult.timeout), resp0, body: resp0 && resp0.body, status: resp0 && resp0.status }
  }

  // #R20-5: projectIdOverride 우선 — 없으면 현재 URL 의 프로젝트 base. 드리프트한 페이지에서
  //   현재 URL 로 detail URL 을 만들면 엉뚱한 프로젝트의 /character/{entityId} 로 간다.
  function characterDetailUrl(entityId, projectIdOverride) {
    const cur = (getFlowView() && getFlowView().webContents.getURL()) || ''
    if (projectIdOverride) {
      const fm = cur.match(/^(.*\/tools\/flow)(\/|$)/)
      const base = fm ? fm[1] : 'https://labs.google/fx/tools/flow'
      return `${base}/project/${projectIdOverride}/character/${entityId}`
    }
    const m = cur.match(/^(.*\/project\/[0-9a-f-]{36})/)
    return m ? `${m[1]}/character/${entityId}` : null
  }

  // 상세페이지 진입 보장 — 아니면 loadURL 후 컴포저 에디터 대기(COMPOSE_EDITOR_READY).
  async function ensureOnCharacterDetailPage(flowView, entityId, projectIdOverride) {
    const url = flowView.webContents.getURL()
    // #R20-5: projectId 지정 시 그 프로젝트의 detail 인지까지 확인.
    const onPage = projectIdOverride
      ? url.includes('/project/' + projectIdOverride + '/character/' + entityId)
      : url.includes('/character/' + entityId)
    if (!onPage) {
      const target = characterDetailUrl(entityId, projectIdOverride)
      if (!target) return false
      console.log('[Flow Character] navigating to character detail:', target)
      await flowView.webContents.loadURL(target)
    }
    for (let i = 0; i < 30; i++) {
      await sleep(500)
      const ready = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
      if (ready) { await sleep(600); return true }
    }
    return false
  }

  // 서버 진실은 PATCH /v1/flow/entities 가 쓴다. 하지만 SPA 는 페이지 로드 시점의 이름
  //   ('제목 없는 캐릭터' 또는 옛 이름)을 캐시한 채라, 프로젝트를 나갔다 재진입(refreshFlowComposer)
  //   해야 반영됐다. 상세 페이지 이름칸에 타이핑하면 SPA 스토어가 갱신돼 그 왕복이 사라진다.
  //   (라이브 캡처 2026-07-10: 타이핑은 네트워크 요청을 내지 않는 순수 로컬 갱신이고, 상세 페이지의
  //    '완료' 는 저장이 아니라 뒤로가기다.)
  //   생성/동기화/이름변경 세 경로가 공유한다. false 를 돌려주면 호출측이 refresh 로 폴백한다.
  async function applyEntityNameToSpa(flowView, { entityId, projectId, displayName }) {
    if (!displayName || !entityId) return false
    try {
      const onDetail = await ensureOnCharacterDetailPage(flowView, entityId, projectId)
      if (!onDetail) {
        console.warn('[Flow Character] character detail page not ready — name left to refresh fallback')
        return false
      }
      const r = await flowView.webContents.executeJavaScript(FLOW_APPLY_NAME_PROBE(displayName))
      if (!(r && r.ok)) {
        console.warn('[Flow Character] name not applied to SPA:', r && r.error)   // r.value 는 캐릭터 이름 — 안 찍는다
        return false
      }
      // 타이핑만 하고 상세 페이지에 남으면, 다음 동작의 ensureOnCharactersPage 가 loadURL(전체 로드)로
      //   SPA 스토어를 다시 받아 갱신한 이름이 날아간다. back 은 SPA 클라이언트 라우팅이라 스토어를
      //   유지한 채 목록으로 돌아간다 — 이름이 살아서 멘션 피커까지 간다. 덤으로 다음 캐릭터 생성이
      //   시작할 /characters 에 이미 도착해 있다. 못 나가면 성공이라 말하지 않는다(refresh 폴백).
      const back = await trustedClickOnFlowView(FLOW_BACK_BTN_EXPR)
      if (back && back.success === false) {
        console.warn('[Flow Character] back button click failed:', back.error)
        return false
      }
      for (let i = 0; i < 20; i++) {
        await sleep(200)
        if (!(flowView.webContents.getURL() || '').includes('/character/' + entityId)) return true
      }
      console.warn('[Flow Character] still on character detail after back — refresh fallback')
      return false
    } catch (e) {
      console.warn('[Flow Character] applyName error:', e.message)
      return false
    }
  }

  // 현재 URL 에서 로케일 보존하여 같은 프로젝트의 /characters 컴포저 URL 도출.
  function charactersUrl(projectIdOverride) {
    const url = (getFlowView() && getFlowView().webContents.getURL()) || ''
    return buildCharactersUrl(url, projectIdOverride || null)
  }

  // /characters 컴포저 보장 — 아니면 loadURL(전체 로드 → monkey-patch 재주입) 후 에디터 대기.
  //   projectIdOverride: A2 는 bound projectId 를 전달 — Flow 탭이 다른 프로젝트에 있으면 그 프로젝트의
  //   /characters 로 강제 이동(엉뚱한 프로젝트에 entity 가 생기는 것 방지).
  async function ensureOnCharactersPage(flowView, projectIdOverride) {
    const url = flowView.webContents.getURL()
    const onPage = projectIdOverride
      ? new RegExp('/project/' + projectIdOverride + '/characters').test(url)
      : /\/project\/[0-9a-f-]{36}\/characters/.test(url)
    if (!onPage) {
      const target = charactersUrl(projectIdOverride)
      if (!target) return false
      console.log('[Flow Character] navigating to characters compose:', target)
      await flowView.webContents.loadURL(target)
    }
    // 진짜 Slate 컴포저 에디터가 마운트될 때까지 대기. EDITOR_SELECTOR(숨은 textarea 폴백
    // 포함)로 판정하면 항상-존재하는 g-recaptcha-response textarea 때문에 너무 일찍 통과해
    // 주입이 실패한다 → COMPOSE_EDITOR_READY(Slate/보이는 contenteditable 만) 로 폴링.
    for (let i = 0; i < 30; i++) {
      await sleep(500)
      const ready = await flowView.webContents
        .executeJavaScript(COMPOSE_EDITOR_READY)
        .catch(() => false)
      if (ready) { await sleep(600); return true }  // Slate React fiber attach settle
    }
    return false
  }

  // A2 헬퍼들 — Flow 는 synthetic 클릭(isTrusted:false)을 무시하므로 버튼은 trustedClickOnFlowView
  //   (sendInputEvent)로 눌러야 한다. 파일 input 의 change 는 onChange 가 e.target.files 만 읽어 synthetic
  //   으로도 동작. 네이티브 "업로드" 트러스트 클릭은 파일 대화상자를 여니 input.click 을 noop 으로 막는다.
  const A2_FILE_SEL = 'input[type="file"][accept="image/*"]'
  // 업로드/만들기 버튼을 텍스트로 찾는 JS 식 (trustedClickOnFlowView 에 그대로 전달).
  const A2_UPLOAD_BTN_EXPR = `Array.prototype.find.call(document.querySelectorAll('button'),function(b){return /업로드|upload/i.test(b.textContent||'')})`
  const A2_RUN_BTN_EXPR = `(Array.prototype.find.call(document.querySelectorAll('button'),function(b){var t=b.textContent||'';return /arrow_forward/.test(t)&&/만들기|만들$|실행/.test(t)})||Array.prototype.find.call(document.querySelectorAll('button'),function(b){return /arrow_forward/.test(b.textContent||'')&&!b.disabled}))`

  // 파일 대화상자 방지: file input 의 click 을 noop 으로 막아둔다(업로드 버튼 트러스트 클릭 전).
  async function neutralizeFileInputClick(flowView) {
    return flowView.webContents.executeJavaScript(`(function(){
      var i=document.querySelector(${JSON.stringify(A2_FILE_SEL)});
      if(!i) return false;
      if(!i.__afOrigClick){ i.__afOrigClick = i.click.bind(i); i.click = function(){}; }
      return true;
    })()`).catch(() => false)
  }

  // file input 에 base64 파일을 넣고 change 를 발생(+ click 복구). DataTransfer 로 input.files 세팅.
  async function injectFileToInput(flowView, base64, fileName, mimeType) {
    return flowView.webContents.executeJavaScript(`(function(){
      try{
        var i=document.querySelector(${JSON.stringify(A2_FILE_SEL)});
        if(!i) return {success:false, error:'File input not found'};
        if(i.__afOrigClick){ try{ i.click=i.__afOrigClick }catch(_){}; try{ delete i.__afOrigClick }catch(_){} }
        var bin=atob(${JSON.stringify(base64)}); var by=new Uint8Array(bin.length);
        for(var k=0;k<bin.length;k++) by[k]=bin.charCodeAt(k);
        var f=new File([by], ${JSON.stringify(fileName || 'upload.png')}, {type:${JSON.stringify(mimeType || 'image/png')}});
        var dt=new DataTransfer(); dt.items.add(f); i.files=dt.files;
        i.dispatchEvent(new Event('input',{bubbles:true}));
        i.dispatchEvent(new Event('change',{bubbles:true}));
        return {success:i.files.length===1};
      }catch(e){ return {success:false, error:String(e&&e.message||e)}; }
    })()`).catch(e => ({ success: false, error: e.message }))
  }

  // A2: SPA 가 보낸 uploadImage 응답을 네트워크 캡처 버퍼(window.__autoflowcut_net__)에서 회수.
  //   - parentEntityId 있는 200 → { status:200, respBody } (성공: character entity 생성됨)
  //   - 4xx/5xx → { status, respBody } 즉시 반환(auth/quota/server 에러를 timeout 으로 뭉개지 않게, P2)
  //   - parentEntityId 없는 200(일반 media staging) → 무시하고 계속 대기.
  async function waitForUploadImageResponse(flowView, timeoutMs = CHARACTER_UPLOAD_TIMEOUT_MS) {
    const wc = flowView.webContents
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const r = await wc.executeJavaScript(`(function(){
        var n = window.__autoflowcut_net__ || [];
        for (var i = n.length - 1; i >= 0; i--) {
          var x = n[i];
          if (!x || !x.url || x.url.indexOf('/flow/uploadImage') === -1) continue;
          if (x.status === 200 && x.respBody && x.respBody.indexOf('parentEntityId') !== -1)
            return { status: 200, respBody: x.respBody };
          if (x.status >= 400) return { status: x.status, respBody: x.respBody || '' };
        }
        return null;
      })()`).catch(() => null)
      if (r) return r
      await sleep(500)
    }
    return null
  }

  // 프롬프트를 Slate 에디터에 주입 (React fiber apply → execCommand 폴백). generate-image 와 동일 전략.
  async function injectPrompt(flowView, prompt) {
    return flowView.webContents.executeJavaScript(`
      (async function() {
        const promptText = ${JSON.stringify(prompt)};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        let editor = ${EDITOR_SELECTOR};
        if (!editor) return { success: false, error: 'Editor not found' };
        const isSlate = !!(editor.matches?.("[data-slate-editor='true']") || editor.querySelector?.("[data-slate-node]"));

        // 방법 1: Slate React API (editor.apply)
        let ok = false;
        if (isSlate) {
          try {
            const reactKeys = Object.keys(editor).filter(k => k.startsWith('__react'));
            let se = null;
            for (const key of reactKeys) {
              const stack = [editor[key]]; const seen = new Set(); let guard = 0;
              while (stack.length && guard < 5000) {
                const n = stack.pop(); guard++;
                if (!n || typeof n !== 'object' || seen.has(n)) continue;
                seen.add(n);
                const c = n?.memoizedProps?.node || n?.memoizedProps?.editor
                  || n?.pendingProps?.node || n?.pendingProps?.editor
                  || n?.stateNode?.editor || n?.editor;
                if (c && typeof c.apply === 'function') { se = c; break; }
                if (n.child) stack.push(n.child);
                if (n.sibling) stack.push(n.sibling);
                if (n.return) stack.push(n.return);
                if (n.alternate) stack.push(n.alternate);
              }
              if (se) break;
            }
            if (se) {
              try {
                const ex = se.children?.[0]?.children?.[0]?.text || '';
                if (ex) se.apply({ type: 'remove_text', path: [0, 0], offset: 0, text: ex });
              } catch {}
              se.apply({ type: 'insert_text', path: [0, 0], offset: 0, text: promptText });
              if (typeof se.onChange === 'function') se.onChange();
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(200);
              const t = (se.children?.[0]?.children?.[0]?.text || '').trim();
              if (t && t.includes(promptText.slice(0, 40))) ok = true;
            }
          } catch (e) { /* fallthrough */ }
        }

        // 방법 2: execCommand insertText
        if (!ok) {
          try {
            editor.focus(); editor.click(); await sleep(100);
            if (isSlate) {
              const sel = window.getSelection(); const range = document.createRange();
              const nodes = Array.from(editor.querySelectorAll('[data-slate-string]'))
                .map(n => n.firstChild).filter(n => n && n.nodeType === Node.TEXT_NODE);
              if (nodes.length) {
                range.setStart(nodes[0], 0);
                const last = nodes[nodes.length - 1];
                range.setEnd(last, (last.textContent || '').length);
              } else { range.selectNodeContents(editor); }
              sel.removeAllRanges(); sel.addRange(range);
            } else { document.execCommand('selectAll', false, null); }
            document.execCommand('delete', false, null); await sleep(50);
            try { editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: promptText })); } catch {}
            if (document.execCommand('insertText', false, promptText)) {
              try { editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: promptText })); } catch {}
              await sleep(200);
              const vis = (editor.innerText || editor.textContent || '').trim();
              if (editor.querySelector?.('[data-slate-string]') || vis.includes(promptText.slice(0, 20))) ok = true;
            }
          } catch (e) { /* fallthrough */ }
        }

        if (!ok) return { success: false, error: 'prompt injection failed' };
        return { success: true };
      })()
    `).catch((e) => ({ success: false, error: e.message }))
  }

  ipcMain.handle('flow:generate-character', async (_e, opts = {}) => {
    const { prompt, displayName } = opts
    // generate-image/generate-scene 과 동일 계약 — 화면비/seed 를 batchGenerateImages body 에 주입한다.
    //   미주입 시 /characters 컴포저의 직전 상태(관측상 9:16)를 그대로 따라가 프로젝트 화면비와 어긋난다.
    //   스타일은 호출측 styledPrompt(텍스트)에 이미 반영돼 있어 references 는 주입하지 않는다.
    const _seedValue = typeof opts.seed === 'number' && Number.isFinite(opts.seed) ? opts.seed : null
    const _aspectRatioEnum = (
      opts.aspectRatio === '16:9' ? 'IMAGE_ASPECT_RATIO_LANDSCAPE'
        : opts.aspectRatio === '9:16' ? 'IMAGE_ASPECT_RATIO_PORTRAIT'
          : null
    )
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R26-1
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    if (!prompt) return { success: false, error: 'No prompt' }
    const projectId = opts.projectId || projectIdFromUrl() || (getCapturedProjectId && getCapturedProjectId())
    if (!projectId) return { success: false, error: 'No projectId' }
    console.log('[Flow Character] generate-character projectId:', projectId, 'nameLen:', displayName?.length ?? 0)

    // 1) /characters 컴포저 진입 — #R7-14(R4-4 sibling): TARGET projectId 를 넘겨 드리프트한
    //    탭에서 엉뚱한 프로젝트의 characters 페이지에 엔티티를 만드는 것을 막는다(URL 검증+이동).
    const onPage = await ensureOnCharactersPage(flowView, projectId)
    if (!onPage) return {
      success: false,
      errorKind: 'character-composer-unavailable',
      error: 'Character composer unavailable',
    }

    // 2) 프롬프트 주입 — execCommand 동작 위해 flowView 를 일시적으로 보이게 + 포커스 + 에디터 trusted click.
    const mainWindow = getMainWindow && getMainWindow()
    const bounds = flowView.getBounds()
    const wasHidden = (bounds.width === 0 || bounds.height === 0)
    if (wasHidden && mainWindow) {
      const { width, height } = mainWindow.getContentBounds()
      flowView.setBounds(computeOffscreenBounds(screen.getAllDisplays(), mainWindow.getBounds().x, width, height))
      await sleep(300)
    }
    try {
      try { flowView.webContents.focus() } catch {}
      await sleep(120)
      await trustedClickOnFlowView(EDITOR_SELECTOR)
      await sleep(120)
      const inj = await injectPrompt(flowView, prompt)
      console.log('[Flow Character] prompt injection:', JSON.stringify(inj))
      if (!inj.success) return { success: false, error: inj.error || 'prompt injection failed' }
    } finally {
      if (wasHidden) { updateBounds(getMainWindow(), flowView); await sleep(200) }
    }

    // 3) 생성 버튼 enable 대기 (프롬프트 인식됨 확인)
    let enabled = false
    for (let i = 0; i < 20 && !enabled; i++) {
      enabled = await flowView.webContents
        .executeJavaScript(`!!(${GENERATE_BTN_SELECTOR})`)
        .catch(() => false)
      if (!enabled) await sleep(1000)
    }
    if (!enabled) return {
      success: false,
      errorKind: 'generate-button-unavailable',
      error: 'Generate button unavailable',
      retry: true,
    }

    // 3.5) 선택된 이미지 모델 적용 — 에이전트 설정 패널 경유(generate-image 와 동일 best-effort).
    //   패널 미발견/미적용은 생성을 막지 않는다(경고만). arm 전에 호출해야 패널 개폐가 주입을 가리지 않는다.
    if (opts.model && applyAgentDefaults) {
      try {
        const _md = await applyAgentDefaults({ image: { model: opts.model } })
        if (!_md?.success) console.warn('[Flow Character] applyAgentDefaults(image model) not applied:', _md?.error)
        else if (_md.applied === false) console.warn('[Flow Character] applyAgentDefaults(image model): panel found but model not applied')
      } catch (e) { console.warn('[Flow Character] applyAgentDefaults(image model) error:', e.message) }
    }

    // 4) 화면비/seed arm — 캡처 후 finally 에서 반드시 clear(다음 요청 오염 방지).
    if (setFlowPageInject) {
      const _inj = await setFlowPageInject({ seed: _seedValue, aspectRatio: _aspectRatioEnum, references: null, i2v: null })
      if (_inj && _inj.success === false) {
        // arm 실패여도 페이지엔 payload 가 이미 써졌을 수 있다 → stale seed/aspect 가 다음 요청을
        //   오염시키지 않게 best-effort clear (generate-scene 과 동일).
        try { await clearFlowPageInject?.() } catch {}
        return { success: false, error: `Flow inject arming failed: ${_inj.error || 'unknown'}`, retry: true }
      }
    }
    try {
      return await _generateCharacterAfterArm(flowView, { projectId, displayName })
    } finally {
      try { await clearFlowPageInject?.() } catch {}
    }
  })

  // 5~7) arrow_forward 트러스트 클릭 → 응답 캡처 → 파싱 → 이미지 다운로드 → 이름 등록.
  //   arm/clear 는 호출부(finally)가 책임진다.
  async function _generateCharacterAfterArm(flowView, { projectId, displayName }) {
    const cap = await clickAndCaptureGeneration(flowView)
    if (cap.clickError) {
      return { success: false, errorKind: cap.clickErrorKind, error: cap.clickError }
    }
    const body = cap.resp0 && cap.resp0.body
    // HTTP 오류 status 보존 — 안 그러면 401/429/500 이 "entityId/workflowId 없음" 으로 뭉개져
    //   렌더러 quota/auth/server 처리가 안 먹는다(reroll/scene 과 동일 가드).
    if (cap.resp0 && cap.resp0.status >= 400) {
      // 응답 본문은 프롬프트·이름을 되돌려줄 수 있다 — 상태와 길이만.
      console.warn('[Flow Character] generate HTTP', cap.resp0.status, 'bodyLen=', (body || '').length)
      return {
        success: false,
        status: cap.resp0.status,
        errorKind: 'character-generation-failed',
        error: 'Character generation failed',
      }
    }
    if (!body) return {
      success: false,
      errorKind: 'generation-response-timeout',
      error: 'Generation response timed out',
    }

    // 5) 응답 파싱 — entityId(workflows[].parentEntityId) + workflowId/mediaId/fifeUrl
    const parsed = parseCharacterGenerateResponse(body)
    if (!parsed || !parsed.entityId || !parsed.workflowId) {
      return {
        success: false,
        errorKind: 'generation-response-invalid',
        error: 'Generation response was invalid',
      }
    }
    console.log('[Flow Character] generated entityId:', parsed.entityId, 'workflowId:', parsed.workflowId)

    // 6) fifeUrl → base64 (generateImageDOM 과 동일 images 형태로 반환해 ref 저장 흐름 재사용)
    const base64Image = await downloadFifeAsBase64(sessionFetch, parsed.fifeUrl)
    if (parsed.fifeUrl && !base64Image) console.warn('[Flow Character] fifeUrl download failed')

    // 7) 이름 등록 (best-effort) — PATCH /flow/entities, Bearer, recaptcha 불필요.
    let registered = false
    if (displayName) {
      try {
        const token = await getAccessToken()
        if (token) {
          const regRes = await flowPageFetch(`${await apiBase()}/flow/entities`, {
            method: 'PATCH',
            headers: { authorization: 'Bearer ' + token },
            body: JSON.stringify(buildEntityRegisterBody({ projectId, entityId: parsed.entityId, displayName, workflowId: parsed.workflowId })),
          })
          registered = !!regRes.ok
          console.log('[Flow Character] register entities:', regRes.status, registered ? '✓' : '✗')
          if (!regRes.ok) console.warn('[Flow Character] register failed: bodyLen=', (regRes.text || '').length)
        } else {
          console.warn('[Flow Character] access token 추출 실패 — 이름 등록 skip')
        }
      } catch (e) { console.warn('[Flow Character] register error:', e.message) }
    }

    // 8) SPA 캐시에 이름 반영 — 서버는 위 PATCH 가 이미 썼지만, SPA 는 페이지 로드 시점의
    //    '제목 없는 캐릭터' 를 들고 있어 나갔다 재진입해야 새 이름이 보인다. 상세 페이지 이름칸에
    //    타이핑하면 스토어가 갱신돼 refresh 가 필요 없어진다(라이브 캡처: 요청을 내지 않는 순수 로컬 갱신).
    //    실패하면 nameApplied:false — 호출측이 refreshFlowComposer 로 폴백한다.
    const nameApplied = await applyEntityNameToSpa(flowView, { entityId: parsed.entityId, projectId, displayName })

    return buildCharacterResult(parsed, base64Image, { displayName: displayName || null, registered, nameApplied })
  }

  // A1b: 기존 entity 이미지 재생성(reroll). 상세페이지(/character/{entityId})에서 프롬프트 주입
  //   + arrow_forward → batchGenerateImages → 응답 parentEntityId 가 기존 entityId 로 유지된다
  //   (flow-net-capture #34 확인). 새 workflowId 를 캐릭터 대표 이미지로 PATCH 한다.
  //   ⚠️ inject/submit/capture 는 generate-character 와 동일 패턴(추후 공통 함수로 dedup TODO).
  ipcMain.handle('flow:reroll-character', async (_e, opts = {}) => {
    const { entityId, prompt, displayName } = opts
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R26-1
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    if (!entityId) return { success: false, error: 'No entityId' }
    if (!prompt) return { success: false, error: 'No prompt' }
    const projectId = opts.projectId || projectIdFromUrl() || (getCapturedProjectId && getCapturedProjectId())
    if (!projectId) return { success: false, error: 'No projectId' }
    console.log('[Flow Character] reroll entityId:', entityId)

    const onPage = await ensureOnCharacterDetailPage(flowView, entityId, projectId) // #R20-5: projectId 전달
    if (!onPage) return {
      success: false,
      errorKind: 'character-detail-composer-unavailable',
      error: 'Character editor unavailable',
    }

    // 프롬프트 주입 — execCommand 동작 위해 flowView 를 일시적으로 보이게 + 포커스 + 에디터 trusted click.
    const mainWindow = getMainWindow && getMainWindow()
    const bounds = flowView.getBounds()
    const wasHidden = (bounds.width === 0 || bounds.height === 0)
    if (wasHidden && mainWindow) {
      const { width, height } = mainWindow.getContentBounds()
      flowView.setBounds(computeOffscreenBounds(screen.getAllDisplays(), mainWindow.getBounds().x, width, height))
      await sleep(300)
    }
    let inj
    try {
      try { flowView.webContents.focus() } catch {}
      await sleep(120)
      await trustedClickOnFlowView(EDITOR_SELECTOR)
      await sleep(120)
      inj = await injectPrompt(flowView, prompt)
      console.log('[Flow Character] reroll prompt injection:', JSON.stringify(inj))
      if (!inj.success) return { success: false, error: inj.error || 'prompt injection failed' }
    } finally {
      if (wasHidden) { updateBounds(getMainWindow(), flowView); await sleep(200) }
    }

    let enabled = false
    for (let i = 0; i < 20 && !enabled; i++) {
      enabled = await flowView.webContents.executeJavaScript(`!!(${GENERATE_BTN_SELECTOR})`).catch(() => false)
      if (!enabled) await sleep(1000)
    }
    if (!enabled) return {
      success: false,
      errorKind: 'generate-button-unavailable',
      error: 'Generate button unavailable',
      retry: true,
    }

    const cap = await clickAndCaptureGeneration(flowView)
    if (cap.clickError) {
      return { success: false, errorKind: cap.clickErrorKind, error: cap.clickError }
    }
    const resp0 = cap.resp0
    const body = cap.body
    // §2 staleEntity: entity 가 현재 Flow 프로젝트에 없으면(legacy/A0 격리) batchGenerateImages 가
    // 400 INVALID_ARGUMENT. 이때만 렌더러가 generateCharacter 폴백으로 self-heal 하도록 신호한다.
    // ⚠️ 400 한정 — 429(quota)/401(auth)/500(server) 까지 staleEntity 로 보면 폴백이 중복 entity 를
    //    만들고 quota/auth/server 처리를 우회한다. 그 외 4xx/5xx 는 일반 실패로 반환해 렌더러
    //    공통 핸들러(quota-stop/auth/server)가 error/status 로 처리하게 한다.
    if (resp0 && resp0.status >= 400) {
      console.warn('[Flow Character] reroll HTTP', resp0.status, 'bodyLen=', (body || '').length)
      // 400 중에서도 stale entity(INVALID_ARGUMENT)만 self-heal 폴백. content-policy/validation
      //   류 400 은 stale 아님 → generic 실패로(엉뚱한 새 character 생성 방지).
      if (resp0.status === 400 && isStaleEntityErrorBody(body)) return { success: false, staleEntity: true, status: 400 }
      return {
        success: false,
        status: resp0.status,
        errorKind: 'character-generation-failed',
        error: 'Character generation failed',
      }
    }
    if (!body) return {
      success: false,
      errorKind: 'generation-response-timeout',
      error: 'Generation response timed out',
    }

    const parsed = parseCharacterGenerateResponse(body)
    if (!parsed || !parsed.workflowId) return {
      success: false,
      errorKind: 'generation-response-invalid',
      error: 'Generation response was invalid',
    }
    console.log('[Flow Character] reroll new workflowId:', parsed.workflowId, 'parentEntityId:', parsed.entityId)

    const base64Image = await downloadFifeAsBase64(sessionFetch, parsed.fifeUrl)
    if (parsed.fifeUrl && !base64Image) console.warn('[Flow Character] reroll fifeUrl download failed')

    // 새 workflowId 를 캐릭터 대표 이미지로 등록(기존 entity 유지). 이름은 그대로.
    let registered = false
    try {
      const token = await getAccessToken()
      if (token) {
        const regRes = await flowPageFetch(`${await apiBase()}/flow/entities`, {
          method: 'PATCH',
          headers: { authorization: 'Bearer ' + token },
          body: JSON.stringify(buildEntityImageBody({ projectId, entityId, workflowId: parsed.workflowId })),
        })
        registered = !!regRes.ok
        console.log('[Flow Character] reroll re-register:', regRes.status, registered ? '✓' : '✗')
      }
    } catch (e) { console.warn('[Flow Character] reroll re-register error:', e.message) }

    // P1-8: reroll 은 기존 entity 의 이미지 교체이므로 항상 요청한 entityId 를 유지한다.
    //   Flow 가 다른 parentEntityId 를 주더라도(이론상) local ref 가 엉뚱한 entity 로 rebind 되지
    //   않게 — 차이가 나면 경고만 남기고 요청 entityId 를 쓴다.
    if (parsed.entityId && parsed.entityId !== entityId) {
      console.warn('[Flow Character] reroll parentEntityId differs from requested — keeping requested:', { requested: entityId, parsed: parsed.entityId })
    }
    return buildCharacterResult({ ...parsed, entityId }, base64Image, { displayName: displayName || null, registered })
  })

  // B1: 장면 생성 — 메인 컴포저에서 `@캐릭터` 멘션 + 텍스트로 생성.
  //   장면은 entity 가 아니라 이미지만 만든다(컴포저 = 이미지 생성과 동일 페이지). 차이는
  //   structuredPrompt 에 캐릭터 entity 참조가 들어가 인물 일관성을 얻는 것(캡처 확인:
  //   parts:[{reference:{entity:{handle,entityId}}},{text}], imageInputs:[]).
  //   요청 자체는 recaptcha 때문에 주입 fetch 불가 → UI 구동: @주입→피커(div[role=dialog])
  //   에서 이름매칭 div[role=option] 트러스트 클릭→칩 삽입→텍스트 주입→arrow_forward→응답 캡처.
  //   ⚠️ inject/submit/capture 는 generate-character 와 동일 패턴(추후 공통 엔진으로 dedup TODO).

  ipcMain.handle('flow:generate-scene', async (_e, opts = {}) => {
    const { prompt, segments } = opts
    const gapReferences = Array.isArray(opts.gapReferences) ? opts.gapReferences : []
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R26-1
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    const segs = (segments && segments.length) ? segments : (prompt ? [{ type: 'text', text: prompt }] : null)
    if (!segs) return { success: false, error: 'No prompt' }
    // #R33: 씬(@멘션) 생성도 generate-image 와 동일 계약 — 이미지 모드 강제 + 화면비/seed 주입.
    //   opts.aspectRatio/seed/batchCount 는 engineFlow.flowGenerateScene 이 이미 넘긴다(미사용이던 값).
    const _seedValue = typeof opts.seed === 'number' && Number.isFinite(opts.seed) ? opts.seed : null
    const _aspectRatioEnum = (
      opts.aspectRatio === '16:9' ? 'IMAGE_ASPECT_RATIO_LANDSCAPE'
        : opts.aspectRatio === '9:16' ? 'IMAGE_ASPECT_RATIO_PORTRAIT'
          : null
    )
    const _batchCount = opts.batchCount
    const _agentOn = !!(getFlowAgentOn && getFlowAgentOn())
    if (_agentOn && gapReferences.length > 0) {
      console.warn('[Flow Scene] (Agent ON) gap reference injection is unavailable for streamChat:', gapReferences.length)
    }
    // #R35: 비동기 제출 여부 — Agent OFF 에서만 async(컴포저 intercept). Agent ON 은 DOM 수집이라 동기 유지.
    const _asyncMode = opts.asyncMode === true && !_agentOn && !!pendingGenerations
    const projectId = opts.projectId || projectIdFromUrl() || (getCapturedProjectId && getCapturedProjectId())
    if (!projectId) return { success: false, error: 'No projectId' }
    console.log('[Flow Scene] generate-scene projectId:', projectId, 'segments:', segs.length)

    // Codex #R4-4: enforce Flow page is on the TARGET project before DOM mutation.
    const projectCheck = await ensureOnProjectComposer(flowView, projectId)
    if (!projectCheck.ok) {
      return { success: false, errorKind: projectCheck.errorKind, error: projectCheck.error }
    }

    // 앱 설정과 실제 Flow composer 토글을 먼저 일치시킨다. Agent OFF 인데 페이지가 ON 이면
    // streamChat 으로 제출돼 batchGenerateImages intercept 가 절대 오지 않고, 반대 방향이면
    // DOM 수집 경로가 비게 된다. 이미 원하는 상태(already_off/on)는 shared helper 가 성공으로
    // 반환하므로, 토글을 못 찾거나 전환 후 상태 검증에 실패한 경우만 fail-closed 한다.
    let _agentReady = false
    try {
      const _agentResult = _agentOn ? await ensureAgentOn() : await ensureAgentOff()
      _agentReady = !!(_agentResult && _agentResult.success)
    } catch (e) {
      console.warn(`[Flow Scene] ensureAgent${_agentOn ? 'On' : 'Off'} failed:`, e.message)
    }
    if (!_agentReady) {
      return {
        success: false,
        errorKind: _agentOn ? 'flow-agent-on-failed' : 'flow-agent-off-failed',
        error: _agentOn ? 'Could not turn Flow Agent on' : 'Could not turn Flow Agent off',
      }
    }

    // Agent ON: 직전 씬 생성이 진행 중이면 제출 버튼이 stop(busy)이고 컴포저 에디터가 잠시
    //   사라진다 → 에디터 없는 상태로 주입하다 '컴포저 에디터 진입 실패'. flow:generate-image
    //   와 동일하게 (1) 에이전트가 idle(arrow_forward enable) 될 때까지 폴링한 뒤, (2) 그래도
    //   챗 패널이 가리면 닫는다.
    if (_agentOn) {
      const SUBMIT_POLL = 1500
      const SUBMIT_MAX_WAIT = 180000 // 에이전트 생성이 길 수 있어 최대 3분
      let submitState = 'absent'
      let gwaited = 0
      while (gwaited <= SUBMIT_MAX_WAIT) {
        submitState = await flowView.webContents.executeJavaScript(SUBMIT_PROBE).catch(() => 'error')
        if (shouldProceed(submitState)) break
        if (gwaited === 0) console.log('[Flow Scene] (Agent ON) agent not idle (' + submitState + ') — waiting for ready...')
        await sleep(SUBMIT_POLL)
        gwaited += SUBMIT_POLL
      }
      if (submitState !== 'idle') {
        console.warn('[Flow Scene] (Agent ON) agent never idle (last=' + submitState + ', ' + Math.round(gwaited / 1000) + 's)')
        return { success: false, error: 'Agent not ready (' + submitState + ') after 180s', retry: true }
      }
      if (gwaited > 0) console.log('[Flow Scene] (Agent ON) agent idle after', Math.round(gwaited / 1000), 's')
      // idle 인데도 챗 패널이 컴포저를 가리면 닫는다(no-op if 없음).
      for (let i = 0; i < 3; i++) {
        const r = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
        if (r) break
        await trustedClickOnFlowView(AGENT_CHAT_CLOSE_SELECTOR).catch(() => {})
        await sleep(350)
      }
    }

    // 1) 컴포저 에디터 준비 대기(hook 이 ensureComposePage 로 컴포즈 복귀시킨 뒤 호출 — 여기선 ready 재확인).
    let ready = false
    for (let i = 0; i < 30 && !ready; i++) {
      await sleep(500)
      ready = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
    }
    if (!ready) return {
      success: false,
      errorKind: 'text-injection-failed',
      error: 'Text injection failed',
    }
    await sleep(400)

    // 1.5) 이미지 모드 강제 — generate-image(flow-api.js #R30-1)와 동일. 컴포저가 직전에 영상
    //   모드였으면 @멘션 씬 제출이 영상 요청으로 나가(영상 생성 + batchGenerateImages intercept
    //   미동작 → capture timeout). Agent ON 은 컴포즈 모드 탭이 없어 생략(프롬프트 타입 강제는 아래).
    if (!_agentOn && configureFlowMode) {
      // #R35-fix(Codex R7[2]): @멘션 씬은 항상 1장(async pending expectedCount:1)이다. batch 칩을 N>1 로
      //   켜면 Flow 가 여러 이미지/응답을 만들어 첫 응답에 completed → 나머지 중복/유실(R31-1 멀티결과
      //   미구현과 동일). 컴포저 batch 를 1 로 고정해 UI 설정(imageBatchCount)과 무관하게 씬=1장 계약 유지.
      let _modeRes = null
      try { _modeRes = await configureFlowMode('IMAGE', 1) }
      catch (e) { console.warn('[Flow Scene] configureFlowMode skipped:', e.message) }
      if (_modeRes && _modeRes.success === false) {
        return { success: false, error: `Flow IMAGE mode switch failed: ${_modeRes.error || 'unknown'}`, retry: true }
      }
    }

    // #R33: Agent ON(streamChat)은 컴포즈 모드 탭/monkey-patch inject 가 안 먹는다 →
    //   (1) 화면비(설정>씬)는 에이전트 설정 패널(aspectSuffix)로 적용 + autoApprove,
    //   (2) 타입(이미지)은 프롬프트 프리펜드로 강제(영상으로 빠지지 않게). Agent OFF 는 위 IMAGE 모드+inject.
    if (_agentOn) {
      if (applyAgentDefaults) {
        // #R34-fix(2): best-effort(warn) — 패널 미발견/필드 미적용으로 씬 생성을 막지 않는다.
        try {
          const _md = await applyAgentDefaults({ image: { aspectRatio: opts.aspectRatio }, autoApprove: true })
          if (!_md?.success) console.warn('[Flow Scene] (Agent ON) applyAgentDefaults not applied:', _md?.error)
          else if (_md.applied === false) console.warn('[Flow Scene] (Agent ON) applyAgentDefaults: panel found but aspect not applied')
        } catch (e) { console.warn('[Flow Scene] (Agent ON) applyAgentDefaults error:', e.message) }
      }
      segs.unshift({ type: 'text', text: 'Generate a still image: ' })
    }

    // 2) flowView 보이게 + 포커스 + 에디터 트러스트 클릭 + 기존 텍스트 클리어 후 segment 순서대로 주입.
    const mainWindow = getMainWindow && getMainWindow()
    const bounds = flowView.getBounds()
    const wasHidden = (bounds.width === 0 || bounds.height === 0)
    if (wasHidden && mainWindow) {
      const { width, height } = mainWindow.getContentBounds()
      flowView.setBounds(computeOffscreenBounds(screen.getAllDisplays(), mainWindow.getBounds().x, width, height))
      await sleep(300)
    }
    try {
      try { flowView.webContents.focus() } catch {}
      await sleep(120)
      await trustedClickOnFlowView(EDITOR_SELECTOR)
      await sleep(150)
      // #R36: 컴포저 클리어 + segments(칩/텍스트) 주입 — 공용 헬퍼(injectComposeSegments)로 T2V 와 공유.
      //   Characters 탭에서 option 이 없을 때만 staleMention 이 온다. 다른 멘션 실패는 재등록 없이 재시도.
      const _inj = await injectComposeSegments(flowView, segs, trustedClickOnFlowView)
      if (!_inj.ok) {
        return {
          success: false,
          errorKind: _inj.errorKind,
          error: _inj.error,
          retry: true,
          ...(_inj.mentionFailure ? { mentionFailure: _inj.mentionFailure } : {}),
          ...(_inj.staleMention ? { staleMention: _inj.staleMention } : {}),
        }
      }
    } finally {
      if (wasHidden) { updateBounds(getMainWindow(), flowView); await sleep(200) }
    }

    // 3) 생성 버튼 enable 대기 → 트러스트 클릭 → batchGenerateImages 응답 캡처.
    let enabled = false
    for (let i = 0; i < 20 && !enabled; i++) {
      enabled = await flowView.webContents.executeJavaScript(`!!(${GENERATE_BTN_SELECTOR})`).catch(() => false)
      if (!enabled) await sleep(1000)
    }
    if (!enabled) return {
      success: false,
      errorKind: 'generate-button-unavailable',
      error: 'Generate button unavailable',
      retry: true,
    }

    // Agent ON(streamChat): batchGenerateImages 가 안 나가 intercept 로 못 받는다 → 제출 전
    //   스냅샷 후 클릭하고 DOM 의 "새" 결과 이미지(media.getMediaUrlRedirect?name=)를 수집한다.
    //   스냅샷이 직전 업로드된 @멘션 캐릭터 이미지를 제외 → 결과만 받는다(공용 헬퍼).
    if (_agentOn) {
      let existingGenMediaIds = []
      try {
        const _pre = await flowView.webContents.executeJavaScript(GENERATED_IMG_PROBE)
        if (Array.isArray(_pre)) existingGenMediaIds = _pre.map(i => i && i.mediaId).filter(Boolean)
      } catch {}
      const aClick = await trustedClickOnFlowView(GENERATE_BTN_SELECTOR, { required: true, step: 'character-submit' })
      if (!aClick || !aClick.success) return {
        success: false,
        errorKind: 'generate-button-click-failed',
        error: 'Could not click Generate',
        retry: true,
      }
      const col = await collectAgentDomImages({
        scan: () => flowView.webContents.executeJavaScript(GENERATED_IMG_PROBE),
        sessionFetch, sleep,
        // 제출 전 스냅샷 + 다른 경로(비동기 generate-image)가 이미 수집한 것도 제외 → 결과만.
        existingMediaIds: [...existingGenMediaIds, ...collectedMediaIds], want: 1,
        // 수집한 mediaId 를 공유 set 에 등록 → 비동기 경로가 이 이미지를 다시 매칭하지 않게.
        markCollected: (mid) => collectedMediaIds.add(mid),
        logPrefix: '[Flow Scene] (Agent ON)', warn: (m) => console.warn(m),
      })
      if (!col.success) {
        return { success: false, errorKind: col.errorKind, error: col.error, retry: true }
      }
      console.log('[Flow Scene] (Agent ON) collected', col.images.length, 'image(s) from DOM')
      return { success: true, images: col.images, mediaId: col.images[0] && col.images[0].mediaId }
    }

    // #R35: Agent OFF 비동기 제출 — 화면비/seed/genTag 주입 후 pendingGenerations 에 등록하고 생성버튼을
    //   클릭한 뒤 "즉시" generationId 를 반환한다(응답 대기 안 함). batchGenerateImages 응답은
    //   monkey-patch report-response(genTag 실림) → reportResponseRouter 가 genTag 로 이 gen 에 100%
    //   매칭 → flow:collect-generation 이 fifeUrl→base64 로 회수한다(async 이미지와 동일 경로).
    //   → 씬 제출이 블록되지 않아 배치가 병렬로 진행된다(컴포저 칩삽입 시간이 자연 페이싱).
    if (_asyncMode) {
      // @멘션 프롬프트는 컴포저 entity 로 치환돼 promptKey(텍스트)가 요청 body 에 verbatim 으로 안 실릴 수
      //   있다(씬2 correlation 실패의 원인). seed 는 절대 건드리지 않고(UI 사용자 seed 그대로), 요청 arm
      //   시 "고유 genTag"를 함께 inject 해 응답 보고에 실어 보내 정확히 correlate 한다(promptKey 는 보조).
      const generationSetAt = Date.now() / 1000
      const generationId = `scene-async-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      if (setFlowPageInject) {
        // seed: _seedValue (사용자 seed 그대로), genTag: generationId (correlation 전용, seed 무관).
        const _inj = await setFlowPageInject({ seed: _seedValue, aspectRatio: _aspectRatioEnum, references: gapReferences.length > 0 ? gapReferences : null, i2v: null, genTag: generationId })
        if (_inj && _inj.success === false) {
          // #R35-fix(Codex R7[3]): arm 실패여도 페이지엔 payload 가 이미 써졌을 수 있다 → stale
          //   seed/aspect/genTag 가 다음 요청을 오염시키지 않게 best-effort clear.
          try { await clearFlowPageInject?.() } catch {}
          return { success: false, error: `Flow inject arming failed: ${_inj.error || 'unknown'}`, retry: true }
        }
      }
      // 보조 상관키: 씬의 가장 긴 텍스트 세그먼트(genTag 가 없을 때 promptInBody 매칭 대비).
      const promptKey = pickSceneCorrelationKey(segs, prompt)
      pendingGenerations.set(generationId, {
        setAt: generationSetAt,
        expectedCount: 1,          // 멘션 씬은 1 이미지(동기 경로와 동일)
        responses: [],
        collectionTimer: null,
        completed: false,
        token: null,               // collect 시 렌더러가 token 을 넘김(fifeUrl 은 sessionFetch 라 불필요)
        allowDomFallback: false,   // intercept(fifeUrl)로 받으므로 DOM 잔상 재배정 방지
        promptKey,                 // 보조 상관키(텍스트 세그먼트) — 주 매칭은 genTag(=generationId)
        refMediaIds: gapReferences.map(ref => ref?.mediaId).filter(Boolean).sort(), // sorted → parseSignature(정렬 추출)와 signature 일치
        reqSeed: _seedValue,       // 실제 사용자 seed 기록(override 안 함)
        reqAspectRatio: _aspectRatioEnum,
      })
      const _g = pendingGenerations.get(generationId)
      if (_g) {
        _g.orphanTimer = setTimeout(() => {
          if (pendingGenerations.get(generationId) === _g) {
            pendingGenerations.delete(generationId)
            console.warn('[Flow Scene] [Async] pendingGeneration orphan TTL expired — removed:', generationId)
          }
        }, 10 * 60 * 1000)
      }
      // #R35-fix(Codex[3]): 클릭이 반환 실패든 throw 든 stale pending 을 반드시 정리(10분 TTL 누수 방지).
      const cleanupPending = () => {
        const g = pendingGenerations.get(generationId)
        if (g?.orphanTimer) clearTimeout(g.orphanTimer)
        if (g?.collectionTimer) clearTimeout(g.collectionTimer)
        pendingGenerations.delete(generationId)
      }
      let aClick
      try {
        aClick = await trustedClickOnFlowView(GENERATE_BTN_SELECTOR, { required: true, step: 'character-submit' })
      } catch (e) {
        cleanupPending()
        try { await clearFlowPageInject?.() } catch {}
        return {
          success: false,
          errorKind: 'generate-button-click-failed',
          error: 'Could not click Generate',
          retry: true,
        }
      }
      if (!aClick || !aClick.success) {
        cleanupPending()
        try { await clearFlowPageInject?.() } catch {}
        return {
          success: false,
          errorKind: 'generate-button-click-failed',
          error: 'Could not click Generate',
          retry: true,
        }
      }
      console.log('[Flow Scene] [Async] submitted:', generationId, '(promptKeyLen:', (promptKey || '').length, ')')
      // #R35-fix(Codex R1[4]/R2[2]): inject(seed/aspect) 를 clear 하기 전에 요청이 실제로 나갈 시간을
      //   확보한다. trustedClickOnFlowView 는 mouseUp 후 ~200ms 만 대기하므로 즉시 clear 하면 Flow 가
      //   fetch 를 늦게 시작할 때 window.__autoflowcut_inject__ 가 비어 원본 화면비/seed 로 나간다.
      //   flow-api.js async 경로와 동일하게 2초 대기 후 clear.
      await sleep(2000)
      try { await clearFlowPageInject?.() } catch {}
      return { success: true, generationId, submitted: true }
    }

    // 화면비/seed 주입 — generate-image(monkey-patch fetch)와 동일. 패치된 window.fetch 가
    //   batchGenerateImages 요청 body 의 imageAspectRatio 를 이 값으로 덮어써 16:9/9:16 이 반영된다.
    //   미주입 시 Flow 기본값(관측상 9:16)으로 나간다. 캡처 후 finally 에서 반드시 clear.
    if (setFlowPageInject) {
      const _inj = await setFlowPageInject({ seed: _seedValue, aspectRatio: _aspectRatioEnum, references: gapReferences.length > 0 ? gapReferences : null, i2v: null })
      if (_inj && _inj.success === false) {
        return { success: false, error: `Flow inject arming failed: ${_inj.error || 'unknown'}`, retry: true }
      }
    }
    try {
      // #R33: 5xx(예: 500 INTERNAL)는 Google 서버측 일시 오류 → 같은 컴포저 상태로 1회 재시도.
      //   (프롬프트/멘션 칩이 그대로 남아 있어 재클릭=재제출. 4xx 는 재시도 안 함.)
      const SCENE_5XX_RETRIES = 1
      let cap, resp0, body
      for (let attempt = 0; ; attempt++) {
        cap = await clickAndCaptureGeneration(flowView)
        if (cap.clickError) {
          return { success: false, errorKind: cap.clickErrorKind, error: cap.clickError }
        }
        resp0 = cap.resp0
        body = cap.body
        if (resp0 && resp0.status >= 500 && attempt < SCENE_5XX_RETRIES) {
          console.warn('[Flow Scene] HTTP', resp0.status, '(transient) — retrying', attempt + 1, '/', SCENE_5XX_RETRIES)
          await sleep(1500 * (attempt + 1))
          continue
        }
        break
      }
      if (resp0 && resp0.status >= 400) {
        console.warn('[Flow Scene] generate failed (HTTP', resp0.status, ') bodyLen=', (body || '').length)
        // 5xx 는 재시도 소진 후에도 실패면 retry 신호(상위 배치/사용자 재시도 대상).
        return {
          success: false,
          errorKind: 'scene-generation-failed',
          error: 'Scene generation failed',
          status: resp0.status,
          retry: resp0.status >= 500,
        }
      }
      if (!body) return {
        success: false,
        errorKind: 'generation-response-timeout',
        error: 'Generation response timed out',
      }

      const parsed = parseCharacterGenerateResponse(body)
      if (!parsed || !parsed.workflowId) return {
        success: false,
        errorKind: 'generation-response-invalid',
        error: 'Generation response was invalid',
      }
      console.log('[Flow Scene] generated workflowId:', parsed.workflowId, 'mediaId:', parsed.mediaId)

      // fifeUrl → base64 (generateImageDOM 과 동일 images 형태로 반환해 ref 저장 흐름 재사용)
      const base64Image = await downloadFifeAsBase64(sessionFetch, parsed.fifeUrl)
      if (parsed.fifeUrl && !base64Image) console.warn('[Flow Scene] fifeUrl download failed')

      return {
        success: true,
        images: base64Image ? [{ base64: base64Image, mediaId: parsed.mediaId }] : [],
        workflowId: parsed.workflowId,
        mediaId: parsed.mediaId,
        fifeUrl: parsed.fifeUrl,
      }
    } finally {
      try { await clearFlowPageInject?.() } catch {}
    }
  })

  // #R34: Flow 컴포저 새로고침 — 등록/동기화 직후 SPA 가 새 entity 이름을 다시 읽게 한다.
  //   캐릭터 등록(PATCH displayName) 후 SPA 가 캐시된 'Untitled Character' 를 그대로 보여, 멘션
  //   피커도 옛 이름으로 떠 매칭이 깨질 수 있다. 단순 reload() 는 SPA in-memory 상태가 남아 이름이
  //   갱신 안 될 수 있어, 사용자가 수동으로 하는 것처럼 "프로젝트를 나갔다(프로젝트 리스트) → 다시
  //   들어오기"로 강제 재요청한다(projectInitialData 재fetch → 새 이름 반영).
  // #R34-fix: 동시 refresh 정리. card/modal/panel 이 fire-and-forget 으로 호출해 여러 refresh 가
  //   겹치면 공유 flowView 에서 loadURL 들이 서로 ERR_ABORTED 로 충돌한다.
  //   - 같은 타깃 projectId 를 향한 refresh 가 이미 진행/대기 중이면 같은 promise 로 coalesce
  //     (refresh 는 "그 프로젝트 나갔다 재진입"이라 idempotent).
  //   - 다른 타깃이면 직렬화한다 — 같은 flowView 라 두 navigation 을 동시에 돌리면 안 된다.
  let refreshChain = Promise.resolve()
  let refreshActivePid = null
  let refreshActivePromise = null
  const resolveRefreshPid = (opts) => opts.projectId || projectIdFromUrl() || (getCapturedProjectId && getCapturedProjectId()) || null
  ipcMain.handle('flow:refresh-composer', async (_e, opts = {}) => {
    const pid = resolveRefreshPid(opts)
    if (refreshActivePromise && refreshActivePid === pid) return refreshActivePromise
    const prev = refreshChain
    // #R34-fix: 핸들러에서 확정한 pid 를 실행 target 으로 고정한다. 안 그러면 앞선 refresh 의 navigation
    //   으로 URL 이 바뀐 뒤 doRefreshComposer 가 projectIdFromUrl 로 다른(엉뚱한) 프로젝트를 refresh 할 수 있다.
    const p = (async () => { await prev.catch(() => {}); return doRefreshComposer({ ...opts, projectId: pid }) })()
    refreshChain = p.catch(() => {})
    refreshActivePid = pid
    refreshActivePromise = p
    p.finally(() => { if (refreshActivePromise === p) { refreshActivePromise = null; refreshActivePid = null } })
    return p
  })
  async function doRefreshComposer(opts = {}) {
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }
    const flowView = getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    const pid = opts.projectId || projectIdFromUrl() || (getCapturedProjectId && getCapturedProjectId())
    try {
      // 1) 프로젝트에서 나간다 — 현재 URL 의 /project/<id> 앞부분(= 프로젝트 리스트 base)로 이동.
      const cur = (flowView.webContents.getURL && flowView.webContents.getURL()) || ''
      const base = cur.split('/project/')[0]
      if (base && base !== cur) {
        await flowView.webContents.loadURL(base).catch((e) => console.warn('[Flow Refresh] leave loadURL:', e.message))
        await sleep(1000)
      }
      // 2) 다시 들어온다 — ensureOnProjectComposer 가 타깃 프로젝트로 loadURL(전체 로드 → 재fetch).
      if (pid && ensureOnProjectComposer) {
        try { await ensureOnProjectComposer(flowView, pid) } catch (e) { console.warn('[Flow Refresh] ensureOnProjectComposer:', e.message) }
      } else {
        // pid 모르면 최소한 reload 로 fallback. (webContents.reload() 는 void → .catch 불가, try 로 감쌈)
        try { flowView.webContents.reload() } catch (e) { console.warn('[Flow Refresh] reload fallback:', e.message) }
      }
      // 3) 컴포저 에디터 ready 대기.
      let ready = false
      for (let i = 0; i < 40 && !ready; i++) {
        await sleep(500)
        ready = await flowView.webContents.executeJavaScript(COMPOSE_EDITOR_READY).catch(() => false)
      }
      console.log('[Flow Refresh] composer refreshed (leave+reenter), ready:', ready)
      return { success: !!ready }
    } catch (e) {
      console.warn('[Flow Refresh] failed:', e.message)
      return { success: false, error: e.message }
    }
  }

  /**
   * #R37: 등록 복구 — 이미 만들어진 entity 에 register PATCH 만 다시 친다(재업로드 없음).
   *
   * uploadImage 는 부를 때마다 새 entity 를 만든다. 업로드는 성공했는데 등록 PATCH 만 실패한 ref 를
   * 재업로드로 재시도하면 같은 캐릭터가 Flow 에 계속 쌓인다(실측: 사용자 Flow 에 Zed 4개).
   * entityId/workflowId 는 이미 손에 있으니 PATCH 만 다시 치면 된다.
   *
   * rename 이 아니라 register 를 쓴다: rename 은 displayName 만 쓰지만 register 는
   * imageReferences[{workflowId}] 까지 함께 쓴다(buildEntityRegisterBody). rename 으로 복구하면
   * 이미지 레퍼런스가 빈 채로 이름만 붙어 @멘션이 엉뚱하게 생성된다.
   *
   * 실패는 삼키지 않는다 — 호출측이 사용자에게 이유를 보여줄 수 있게 status/error 를 돌려준다.
   */
  ipcMain.handle('flow:register-character-entity', async (_e, opts = {}) => {
    const { entityId, workflowId, displayName } = opts
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }
    if (!entityId || !workflowId || !displayName) {
      return { success: false, error: 'entityId/workflowId/displayName required' }
    }
    const projectId = opts.projectId || projectIdFromUrl() || (getCapturedProjectId && getCapturedProjectId())
    if (!projectId) return { success: false, error: 'No projectId' }
    try {
      const token = await getAccessToken()
      if (!token) return {
        success: false,
        errorKind: 'flow-access-token-unavailable',
        error: 'Flow access token unavailable',
      }
      const res = await flowPageFetch(`${await apiBase()}/flow/entities`, {
        method: 'PATCH',
        headers: { authorization: 'Bearer ' + token },
        body: JSON.stringify(buildEntityRegisterBody({ projectId, entityId, displayName, workflowId })),
      })
      console.log('[Flow Character] re-register entities:', res.status, res.ok ? '✓' : '✗')
      if (!res.ok) {
        console.warn('[Flow Character] re-register failed: bodyLen=', (res.text || '').length)
        // entity 가 Flow 에서 지워졌으면(사용자가 라이브러리에서 삭제) 복구가 영원히 404 다.
        //   stale 을 알려줘야 호출측이 업로드로 self-heal 한다 — 안 그러면 ref 가 벽돌이 된다.
        const stale = isStaleRegistrationResponse(res)
        // PATCH 가 실패했으면 SPA 를 건드리지 않는다 — 서버와 화면이 어긋나는 게 더 나쁘다.
        return {
          success: false, registered: false, stale, status: res.status, nameApplied: false,
          error: stale ? 'entity not found (stale)' : `registration PATCH failed (${res.status})`,
        }
      }
      const nameApplied = await applyEntityNameToSpa(getFlowView(), { entityId, projectId, displayName })
      // entityId 를 반드시 돌려준다 — 호출측 needsComposerRefresh 가 result.entityId 로 판정한다.
      //   빠뜨리면 nameApplied:false 인데도 SPA 새로고침을 건너뛰고 'synced' 로 굳어, 멘션 피커가
      //   이름을 모르는 채 생성으로 넘어간다(원래 버그의 재현).
      return { success: true, registered: true, entityId, workflowId, status: res.status, nameApplied }
    } catch (e) {
      console.warn('[Flow Character] re-register error:', e.message)
      return { success: false, registered: false, error: e.message }
    }
  })

  ipcMain.handle('flow:rename-character', async (_e, opts = {}) => {
    const { entityId, displayName } = opts
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R26-1
    if (!entityId || !displayName) return { success: false, error: 'entityId/displayName required' }
    const projectId = opts.projectId || projectIdFromUrl() || (getCapturedProjectId && getCapturedProjectId())
    if (!projectId) return { success: false, error: 'No projectId' }
    try {
      const token = await getAccessToken()
      if (!token) return {
        success: false,
        errorKind: 'flow-access-token-unavailable',
        error: 'Flow access token unavailable',
      }
      const res = await flowPageFetch(`${await apiBase()}/flow/entities`, {
        method: 'PATCH',
        headers: { authorization: 'Bearer ' + token },
        body: JSON.stringify(buildEntityRenameBody({ projectId, entityId, displayName })),
      })
      console.log('[Flow Character] rename entities:', res.status, res.ok ? '✓' : '✗')
      if (!res.ok) console.warn('[Flow Character] rename failed: bodyLen=', (res.text || '').length)
      // PATCH 가 실패했으면 SPA 를 건드리지 않는다 — 서버와 화면이 어긋나는 게 더 나쁘다.
      if (!res.ok) return { success: false, status: res.status, nameApplied: false }
      const nameApplied = await applyEntityNameToSpa(getFlowView(), { entityId, projectId, displayName })
      return { success: true, status: res.status, nameApplied }
    } catch (e) {
      console.warn('[Flow Character] rename error:', e.message)
      return { success: false, error: e.message }
    }
  })

  // A2: 이미 있는 이미지를 Flow /characters 의 실제 "업로드" UI 로 올려 character entity 로 등록.
  //   직접 uploadImage API 는 SPA 내부 entity 컨텍스트가 없어 404 → A1 처럼 DOM 을 구동한다:
  //   0) /characters 진입. 1) file input(input[type=file][accept=image/*])에 임시파일을 debugger 로
  //   주입 → SPA 의 onChange 가 entityContext 와 함께 uploadImage 실행(= 캐릭터 생성). 2) 가로챈
  //   네트워크 버퍼에서 그 응답(parentEntityId/workflowId) 회수. 3) PATCH /flow/entities 로 이름 등록.
  ipcMain.handle('flow:upload-character-entity', async (_e, opts = {}) => {
    const { base64, displayName, mimeType, fileName } = opts
    if (!flowActive()) return { success: false, error: 'Flow inactive (API mode)' }  // #R26-1
    if (!base64) return { success: false, error: 'base64 required' }
    const projectId = opts.projectId || projectIdFromUrl() || (getCapturedProjectId && getCapturedProjectId())
    if (!projectId) return { success: false, error: 'No projectId' }
    const flowView = getFlowView && getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    const b64 = base64.includes(',') ? base64.split(',')[1] : base64
    try {
      // P1: bound projectId 의 /characters 로 강제 — Flow 탭이 다른 프로젝트에 있어도 거기에 entity 가
      //   생기지 않게(local ref 에 잘못된 entityId 저장 방지).
      const onPage = await ensureOnCharactersPage(flowView, projectId)
      if (!onPage) return {
        success: false,
        errorKind: 'character-composer-unavailable',
        error: 'Character composer unavailable',
      }

      // 이전 캡처 노이즈 제거 — 이 업로드로 생긴 응답만 보게.
      await flowView.webContents.executeJavaScript('window.__autoflowcut_net__ = []').catch(() => {})

      // 1) 대화상자 방지(input.click noop) → "업로드" 버튼 트러스트 클릭(= character upload 모드 진입).
      const hasInput = await neutralizeFileInputClick(flowView)
      if (!hasInput) return {
        success: false,
        errorKind: 'character-file-input-unavailable',
        error: 'Character file input unavailable',
      }
      const upClick = await trustedClickOnFlowView(A2_UPLOAD_BTN_EXPR, { required: true, step: 'reference-upload' })
      console.log('[Flow Character] A2 업로드 버튼 trusted click:', JSON.stringify(upClick))
      await sleep(500)

      // 2) file input 에 파일 주입(synthetic change — onChange 가 읽음).
      const inj = await injectFileToInput(flowView, b64, fileName, mimeType)
      if (!inj || !inj.success) return {
        success: false,
        errorKind: 'character-file-injection-failed',
        error: 'Character file injection failed',
      }
      console.log('[Flow Character] A2 file injected')
      await sleep(800)

      // 3) "만들기"(실행) 버튼 best-effort 클릭. 단, Flow 는 파일 주입(onChange) 만으로 uploadImage 가
      //    자동 트리거되는 경우가 많아 이 버튼이 아예 없을 수 있다 → "Button not found" 는 정상이며
      //    실패가 아니다(아래 waitForUploadImageResponse 가 실제 성공/실패를 판정). 오해 방지용 로그.
      const runClick = await trustedClickOnFlowView(A2_RUN_BTN_EXPR)
      if (runClick && runClick.success) console.log('[Flow Character] A2 만들기(실행) 버튼 클릭됨')
      else console.log('[Flow Character] A2 만들기 버튼 없음 — 파일 선택으로 자동 업로드 진행(정상, 응답 대기)')

      // SPA 가 보낸 uploadImage 응답을 네트워크 버퍼에서 회수(성공 200 또는 4xx/5xx 실패 즉시).
      // #R33: 타임아웃을 CHARACTER_UPLOAD_TIMEOUT_MS(120s)로 — 60s 는 짧아 등록 실패 고착을 유발했다.
      const resp = await waitForUploadImageResponse(flowView, CHARACTER_UPLOAD_TIMEOUT_MS)
      if (!resp) return {
        success: false,
        errorKind: 'character-upload-timeout',
        error: 'Character upload timed out',
      }
      if (resp.status >= 400) {
        console.warn('[Flow Character] A2 uploadImage HTTP', resp.status, 'bodyLen=', (resp.respBody || '').length)
        return {
          success: false,
          status: resp.status,
          errorKind: 'character-upload-failed',
          error: 'Character upload failed',
        }
      }
      const parsed = parseUploadImageResponse(resp.respBody)
      if (!parsed || !parsed.entityId || !parsed.workflowId) {
        return {
          success: false,
          errorKind: 'character-upload-response-invalid',
          error: 'Character upload response was invalid',
        }
      }
      console.log('[Flow Character] A2 uploaded mediaId:', parsed.mediaId, 'workflowId:', parsed.workflowId, 'entityId:', parsed.entityId)

      // 이름 등록 — SPA 가 만든 entity 에 displayName + 이미지 레퍼런스 PATCH (검증된 경로).
      let registered = false
      try {
        const token = await getAccessToken()
        if (token) {
          const reg = await flowPageFetch(`${await apiBase()}/flow/entities`, {
            method: 'PATCH',
            headers: { authorization: 'Bearer ' + token },
            body: JSON.stringify(buildEntityRegisterBody({ projectId, entityId: parsed.entityId, displayName: displayName || '', workflowId: parsed.workflowId })),
          })
          registered = !!reg.ok
          console.log('[Flow Character] A2 register entities:', reg.status, registered ? '✓' : '✗')
          if (!reg.ok) console.warn('[Flow Character] A2 register failed: bodyLen=', (reg.text || '').length)
        }
      } catch (e2) {
        console.warn('[Flow Character] A2 register error:', e2.message)
      }
      const nameApplied = registered
        ? await applyEntityNameToSpa(flowView, { entityId: parsed.entityId, projectId, displayName })
        : false
      return { success: true, entityId: parsed.entityId, workflowId: parsed.workflowId, mediaId: parsed.mediaId, registered, nameApplied }
    } catch (e) {
      console.warn('[Flow Character] A2 upload-character-entity error:', e.message)
      return { success: false, error: e.message }
    }
  })
}
