/**
 * electron/ipc/flow-angular.js
 *
 * flow.google.com(Angular, 2026-09) 전용 핸들러 — M1: 이미지 생성(ogiZ0b) · M2: 텍스트→영상 제출(YhhmEf, M2-4).
 * 옛 labs.google 핸들러(flow-api.js·video.js)는 301 로 도달 불가라 남겨 두되 Flow 모드에서는 **무조건** 여기로 온다.
 *
 * 원칙(플랜 D2–D8):
 *   - 제출은 페이지의 신뢰 클릭으로만 — 앱은 제출 RPC 를 만들지도, 본문을 바꾸지도, reCAPTCHA 를 부르지도 않는다.
 *   - 페이지가 보낸 XHR 은 캡처 주입(flow-rpc-capture.js)이 send/loadend 로 보고하고 라우터가 {doc, seq} 로
 *     pendingGenerations 의 gen 에 바인딩한다. 핸들러는 클릭 전에 gen 을 arm 하고(send 마감 15s) 응답을 기다린다.
 *   - 순서: 세션(URL·WIZ) → 에이전트 모드/레퍼런스 거부 → 프로젝트 컴포저 → ensureAgentOff → 캡처 플래그(없으면 주입→재프로브)
 *     → 설정 패널(모드·비율·개수·모델 검증) → 편집기 클릭·텍스트 주입·재판독 → 제출 가능 → arm → 신뢰 클릭.
 *   - 실패는 kind 로 닫는다(문구 중립, 코드는 필드). 로그엔 내용 없음(길이·id 앞 8자·숫자·상태어만).
 *   - 상태 폴(M2-5): 앱이 페이지 컨텍스트 XHR 로 jwpduf 를 **id 당 1회** 부르고(§5-4) 상태 3 이면 as29s 로 mp4 서명 URL 을 받는다.
 *     읽기 RPC 실패는 그 항목만 pending+pollError(항목별 폴 예산 소모), auth 는 401/16 만 최상위. as29s 는 유계 pending(3회) 뒤
 *     flow-video-fetch-failed(+mediaId — download-only 허용). 완료 폴의 모델키 재검사는 없다(D8-6).
 *   - 영상(M2-4): 캡처 확인 뒤 **클릭 전에 nzlxg 로 크레딧을 읽어 둔다**(send 가 안 왔는데 줄었으면 not-sent → lost 격상, 감소분은
 *     로그 숫자로만). 설정은 video·count 1·duration·resolution(패널 밖이면 클릭 전 거부). 200 뒤엔 응답 모델키를 표(modelKeyMatches)로
 *     검증하고 불일치면 flow-video-settings-mismatch {expected, actual} + rejectedMediaId. 클릭 **뒤** 실패는 전부 postClick:true.
 *     거부한 미디어 id 는 rejectedMediaId(s) 로만 나간다(mediaId/generationId 로는 절대 — download-only 분류가 물지 않게).
 *
 * tests/electron/ipc/flowGenerateImageAngular.test.js · tests/electron/ipc/flowVideoT2VAngular.test.js · tests/electron/flowRpcPipeline.test.js
 */
import { isFlowPageUrl, isLegacyFlowUrl } from '../flowUrl.js'
import { updateBounds, getLayoutDragging } from './layout.js'
import { computeInPlaceBounds, needsAutomationViewport } from '../offscreen-bounds.js'
import { FLOW_RPC_CAPTURE_INJECTION } from '../flow-rpc-capture.js'
import { armDeadline, settleGen } from '../flow-rpc-router.js'
import {
  FlowRpcShapeError, normalizePrompt, describeMediaUrl, modelKeyMatches, rpcErrorToRendererResult,
  parseVideoStatusResponse, parseMediaRecord, mediaStateToStatus,
} from '../flow-rpc-protocol.js'
import { callFlowRpc } from '../flow-rpc-client.js'
import { applyComposerSettings } from '../flow-composer-settings.js'
import { FIND_GENERATE_BUTTON_JS, READ_EDITOR_TEXT_JS, findPromptEditor } from '../flow-composer-dom.js'
import { SUBMIT_ENABLED_PROBE } from '../flow-submit-gate.js'

/** 캡처 주입 설치 플래그 프로브(클릭 전). */
export const CAPTURE_FLAG_PROBE = '!!window.__autoflowcut_rpc_capture__'
/** batchexecute 의 at 토큰이 있는 문서인가 — 값은 가져오지 않는다. */
export const WIZ_PROBE = '!!(window.WIZ_global_data && window.WIZ_global_data.SNlM0e)'
/** 편집기 element(신뢰 클릭으로 캐럿을 넣는다). */
export const FIND_PROMPT_EDITOR_JS = `(${findPromptEditor.toString()})(document)`

/**
 * 편집기에 텍스트 주입 — ProseMirror 는 contenteditable 네이티브 입력(execCommand insertText → DOM 변경 → PM 의
 * DOMObserver)을 그대로 받는다. 검증은 별도 재판독(READ_EDITOR_TEXT_JS)으로 한다. 자기완결.
 */
export function SET_EDITOR_TEXT_JS(text) {
  return `/* __af_set_editor_text__ */(async function () {
  const text = ${JSON.stringify(String(text))};
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) };
  const editor = document.querySelector('div.ProseMirror[contenteditable="true"]')
    || document.querySelector("[data-slate-editor='true']")
    || document.querySelector("div[role='textbox'][contenteditable='true']:not([aria-hidden='true'])");
  if (!editor) return { ok: false, reason: 'editor-not-found' };
  try { editor.focus() } catch (_) {}
  await sleep(50);
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) {}
  try { document.execCommand('delete', false, null) } catch (_) {}
  let inserted = false;
  try { inserted = document.execCommand('insertText', false, text) } catch (_) { inserted = false }
  await sleep(150);
  return { ok: !!inserted };
})()`
}

/** 옛 핸들러 단락(M1-12): 새 Flow 에서 미지원 기능. */
export function unsupportedOnAngular(name) {
  return { success: false, errorKind: 'flow-feature-unsupported', error: 'flow-feature-unsupported:' + String(name) }
}

const kindResult = (kind, extra) => ({ success: false, errorKind: kind, error: kind, ...(extra || {}) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// M2-LIVE N1: 드래그 끝 대기 상한 · DOM 단계 워치독(제출 클릭 전까지) · 워치독 sentinel
const DRAG_WAIT_MS = 5000
const DOM_STAGE_TIMEOUT_MS = 120000
const DOM_STAGE_TIMEOUT = Symbol('dom-stage-timeout')
const short = (v) => String(v ?? '').slice(0, 8)
/** nzlxg payload → 크레딧 잔량(숫자) 또는 null. */
const creditsOf = (payload) => (Array.isArray(payload) && typeof payload[0] === 'number' ? payload[0] : null)
/** 요청 설정 한 줄(errorParams.expected 용 — 값만: 모델 라벨·길이·비율·해상도). */
const describeWant = (w) => `${w.model} ${w.duration}s ${w.ratio || '?'} ${w.resolution}`
/** 제출 단계의 실패 kind — D8-9 의 reportDomFailure('submit:<kind>') 대상(내용 없음). */
const SUBMIT_FAILURE_KINDS = new Set(['flow-submit-not-sent', 'flow-submit-lost', 'flow-rpc-multi-batch'])
/** M2-R7 L1: 클릭 전 값보다 줄었나 — 줄었으면 로그(감소분은 숫자로만, params 없음) + true. 판정 불가(null)는 false. */
function creditsDropped(before, after) {
  if (before == null || after == null || after >= before) return false
  console.warn(`[Flow Video T2V] [Angular] credits dropped without a captured send before=${before} after=${after} → flow-submit-lost`)
  return true
}

/**
 * @param {object} deps flow-api.js 의 deps(main.js flowAPIDeps 와 동일 모양). 필요한 것: getFlowView, getFlowAgentOn, getMainWindow,
 *   trustedClickOnFlowView, ensureAgentOff, ensureOnProjectComposer, sessionFetch, pendingGenerations, reportDomFailure?, createInputShield?(M2-LIVE N1)
 */
export function createFlowAngular(deps) {
  const report = async (step, reason, extra) => {
    try { await deps.reportDomFailure?.(step, reason, extra) } catch (_e) { /* 진단은 실패해도 흐름을 막지 않는다 */ }
  }
  const exec = (flowView, js) => flowView.webContents.executeJavaScript(js, true)

  /** Flow 페이지 + WIZ 전역이 있는 문서인가. 아니면 flow-session-missing(+authFailed) — DOM 을 건드리기 전에. */
  async function sessionGate(flowView) {
    const url = flowView.webContents.getURL()
    if (!isFlowPageUrl(url)) return { success: false, errorKind: 'flow-session-missing', error: 'not-on-flow', authFailed: true }
    // 옛 도메인은 301 로 flow.google.com 에 착지한다 — 여기 있다는 건 리다이렉트 전/실패다(WIZ 프로브가 판정).
    if (isLegacyFlowUrl(url)) console.warn('[Flow API] [Angular] legacy labs.google URL — expecting redirect to flow.google.com')
    let wiz = false
    try { wiz = !!(await exec(flowView, WIZ_PROBE)) } catch (_e) { wiz = false }
    if (!wiz) return { success: false, errorKind: 'flow-session-missing', error: 'wiz-missing', authFailed: true }
    return null
  }

  /**
   * 자동화 뷰포트 + 포커스 반환 — DOM 단계 전체(에이전트 OFF → 캡처 → 설정 → 편집기 → 제출 클릭)를 감싼다. 이미지·영상 공용.
   *   숨었거나(0×0: 모달·드래그) 좁은(< AUTOMATION_MIN_WIDTH) 뷰는 창 안 제자리에서 창 콘텐츠 크기로 키운다. flow.google.com 은 좁은 폭에서
   *   에이전트 칩 등 컴포저 컨트롤을 아예 렌더하지 않는다(2026-09-25 실기: 597px 에서 chip 0개 → not_found, 957px 정상).
   *   execCommand 주입도 보이는 뷰를 요구한다. fn 이 어떻게 끝나든(정상·조기 반환·throw) finally 에서 레이아웃(updateBounds —
   *   유일한 진실)으로 원복한다. 넓은 보이는 뷰는 손대지 않는다(실기 게이트 957×1022 통과). 신뢰 클릭 헬퍼는 자기가 키운(0×0)
   *   경우에만 되돌리므로 여기서 키운 뷰를 중간에 접지 않는다.
   *   R2-2#1(§12 #45): DOM 단계 전에 뷰가 OS 포커스를 갖고 있었는지(hadFocus) 적어 두고, 뷰포트에 들어갔거나 애초에 포커스가
   *   없었으면 끝난 뒤 메인 창에 포커스를 돌려준다 — 편집기 주입의 webContents.focus() 가 Flow 뷰로 옮긴 포커스가 모달·입력창에
   *   남지 않게. 조기 반환도 같은 finally 를 지난다.
   *   M2-LIVE N1(A1/B6): 제자리 뷰포트 동안 Flow 뷰(네이티브)가 앱 UI 위에 있어 사용자의 클릭이 그대로 컴포저에 닿는다 — 제출 화살표를 누르면
   *   과금 + 앱의 신뢰 클릭은 disabled 버튼 → 고아 미디어, 설정 라디오를 누르면 잘못된 길이·개수로 과금. 뷰포트를 키운 직후 **최상위 투명 방패 뷰**
   *   (deps.createInputShield — main 이 WebContentsView 로 만든다)를 창 콘텐츠 크기로 올려 포인터 입력을 삼킨다. 신뢰 클릭은 webContents.sendInputEvent 라
   *   OS 히트테스트를 거치지 않아 방패 아래로 그대로 통한다. 방패는 같은 finally 에서 레이아웃 복원 **전에** 제거된다(정상·조기 반환·throw·워치독 전부).
   *   드래그 중(레이아웃이 뷰를 0×0 으로 접어 둔 상태) 진입하면 제자리 확장이 스플리터 드래그 위로 네이티브 뷰를 올려 mouseup 을 삼키고 dragging 이
   *   영영 안 풀린다 — 드래그 끝을 ≤5s 기다리고, 그래도 드래그 중이면 클릭 전 fail-closed(layout-dragging, 다음 항목이 다시 시도).
   *   M2-LIVE N1(A8) 워치독: DOM 단계엔 개별 타임아웃이 없어(exec 는 무한) 먹통 렌더러가 제자리 뷰를 앱 위에 영영 남겼다 — 120s 에 같은 finally 를
   *   지나 클릭 전 dom-stage-timeout 으로 닫는다. 제출 클릭이 이미 나갔으면(ctl.clickStarted) 결과를 덮지 않고 기존 post-click 경로가 판정한다
   *   (신뢰 클릭 헬퍼는 자체 30s 상한이 있다). 버려진 fn 은 ctl.aborted 를 보고 arm·클릭 전에 멈춘다(좀비가 뒤늦게 제출하지 않게).
   * @param {string} tag 로그 접두('[Flow API] [Angular]' | '[Flow Video T2V] [Angular]')
   * @param {(ctl:{aborted:boolean, clickStarted:boolean}) => Promise<any>} fn
   */
  async function withAutomationViewport(flowView, tag, fn) {
    // M2-LIVE N1: 드래그 중이면 먼저 드래그 끝을 기다린다(≤ DRAG_WAIT_MS) — 그 뒤에 bounds 를 읽어야 접힌 0×0 이 아니라 복원된 레이아웃을 본다.
    if (getLayoutDragging()) {
      const until = Date.now() + DRAG_WAIT_MS
      while (getLayoutDragging() && Date.now() < until) await sleep(100)
      if (getLayoutDragging()) {
        console.warn(`${tag} layout still dragging after ${DRAG_WAIT_MS}ms → refusing before click`)
        return kindResult('flow-settings-not-applied', { reason: 'layout-dragging' })
      }
    }
    const startBounds = flowView.getBounds ? flowView.getBounds() : null
    const viewport = needsAutomationViewport(startBounds)
    let hadFocus = false
    try { hadFocus = !!(flowView.webContents.isFocused && flowView.webContents.isFocused()) } catch (_e) { hadFocus = false }
    let shield = null
    if (viewport) {
      // M2 실기(2026-09-25, 597×872 스플릿): 화면 밖(x=1760) 1200×872 로 옮겨도 페이지 innerWidth 가 597 그대로 — 완전히
      //   화면 밖인 뷰는 Chromium 이 다시 레이아웃하지 않는다(단위 테스트는 우리가 준 bounds 만 단언했다). 창 **안** 제자리
      //   (x=0,y=0)에서 창 콘텐츠 크기로 키운다 — DOM 단계 몇 초 동안 Flow 뷰가 앱 UI 를 덮고 finally 가 레이아웃으로 되돌린다.
      const mainWindow = deps.getMainWindow()
      const size = computeInPlaceBounds(mainWindow.getContentBounds())
      flowView.setBounds(size)
      // M2-LIVE N1: 제자리 확장 직후 입력 방패 — 뷰가 사용자 위에 있는 동안은 언제나 방패가 있다.
      try { shield = (typeof deps.createInputShield === 'function' && deps.createInputShield()) || null } catch (_e) { shield = null; console.warn(`${tag} input shield failed — continuing without it`) }
      await sleep(300)
      const why = (!startBounds || !(startBounds.width > 0) || !(startBounds.height > 0)) ? 'hidden' : 'narrow'
      console.log(`${tag} view ${why} ${(startBounds && startBounds.width) || 0}x${(startBounds && startBounds.height) || 0} → automation viewport ${size.width}x${size.height} in-place${shield ? ' shielded' : ''}`)
    }
    const ctl = { aborted: false, clickStarted: false }
    let timer = null
    try {
      const run = fn(ctl)
      run.catch(() => {})   // 워치독이 이긴 뒤의 zombie reject 는 unhandled 가 되면 안 된다(race 는 따로 구독한다)
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(DOM_STAGE_TIMEOUT), DOM_STAGE_TIMEOUT_MS) })
      const result = await Promise.race([run, timeout])
      if (result !== DOM_STAGE_TIMEOUT) return result
      // M2-LIVE N1(A8): 제출 클릭이 이미 나갔으면 timeout 결과로 덮지 않는다 — 클릭 헬퍼가 30s 안에 돌아오고 post-click 경로가 판정한다.
      if (ctl.clickStarted) return await run
      ctl.aborted = true
      console.warn(`${tag} DOM stage timed out after ${DOM_STAGE_TIMEOUT_MS / 1000}s before the submit click → refusing`)
      return kindResult('flow-settings-not-applied', { reason: 'dom-stage-timeout' })
    } finally {
      if (timer) clearTimeout(timer)
      // M2-LIVE N1: 방패는 레이아웃 복원 전에 — 뷰가 사용자 위에 있는 동안은 언제나 방패가 있다.
      if (shield) { try { shield.remove() } catch (_e) { /* 창이 이미 없을 수 있다 */ } }
      if (viewport) {
        updateBounds(deps.getMainWindow(), flowView)
        await sleep(200)
      }
      if (viewport || !hadFocus) {
        try { deps.getMainWindow()?.webContents?.focus() } catch (_e) { /* 창이 이미 없을 수 있다 */ }
      }
    }
  }

  /** 완료된 rpc gen → 렌더러 결과(다운로드 포함). 맵 삭제는 호출자가. */
  async function collectRpcGen(gen) {
    if (gen.error) {
      // R2-2#6(§12 #47): 진단 보고는 기다리지 않는다 — 훅이 영영 settle 하지 않으면 collect 가 매달려 배치가 ITEM_TIMEOUT 까지 멈춘다.
      if (typeof gen.error === 'string' && gen.error.startsWith('rpc-shape:')) void report(gen.error, 'shape', { rpc: gen.rpc })
      else if (SUBMIT_FAILURE_KINDS.has(gen.errorKind)) void report(`submit:${gen.errorKind}`, gen.errorKind, { rpc: gen.rpc, bound: gen.doc != null })
      return {
        success: false,
        errorKind: gen.errorKind || 'flow-rpc-error',
        error: gen.error,
        ...(gen.errorParams ? { errorParams: gen.errorParams } : {}),
        ...(gen.rpcCode != null ? { rpcCode: gen.rpcCode } : {}),
        ...(gen.rpcStatus != null ? { rpcStatus: gen.rpcStatus } : {}),
        ...(gen.authFailed ? { authFailed: true } : {}),
      }
    }
    const results = Array.isArray(gen.results) ? gen.results : []
    if (results.length === 0) return kindResult('flow-rpc-error')
    console.log(`[Flow API] [Angular] image ${results[0].width}x${results[0].height} ratio=ok count=${results.length}`)
    const images = []
    for (const r of results) {
      const { host, media } = describeMediaUrl(r.url)
      let buffer
      let contentType = 'image/png'
      // R1#9: 본문 읽기(arrayBuffer)·base64 도 try 안 — 밖에 두면 IPC 가 reject 되고 비동기 경로는 gen 이 이미 지워져 이미지를 잃는다.
      try {
        const res = await deps.sessionFetch(r.url)
        if (!res || !res.ok) {
          console.warn(`[Flow API] [AsyncCollect] download failed host=${host} media=${media} status=${res ? res.status : 0}`)
          return { success: false, errorKind: 'flow-download-error', error: 'flow-download-error', httpStatus: res ? res.status : 0 }
        }
        buffer = await res.arrayBuffer()
        contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || 'image/png'
      } catch (e) {
        // safe-log: e.name 은 예외 클래스 이름(TypeError 등) — 사용자 내용이 아니다
        console.warn(`[Flow API] [AsyncCollect] download error host=${host} media=${media} reason=${e?.name || 'Error'}`)
        return { success: false, errorKind: 'flow-download-error', error: 'flow-download-error', httpStatus: 0 }
      }
      console.log(`[Flow API] [AsyncCollect] download host=${host} media=${media} bytes=${buffer.byteLength}`)
      images.push({
        base64: `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`,
        mediaId: r.mediaId, width: r.width, height: r.height, seed: r.seed,
      })
    }
    return { success: true, images }
  }

  /** flow:generate-image(Flow 모드). */
  async function generateImage(payload = {}) {
    const { prompt, aspectRatio, model, projectId, referenceImages, batchCount, asyncMode } = payload
    console.log('[Flow API] [Angular] generate-image:', { promptLen: prompt?.length ?? 0, model, aspectRatio, batchCount: batchCount ?? 1, asyncMode: !!asyncMode })
    if (!prompt) return { success: false, error: 'No prompt' }
    const flowView = deps.getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    const gate = await sessionGate(flowView)
    if (gate) return gate
    if (deps.getFlowAgentOn && deps.getFlowAgentOn()) return kindResult('flow-agent-mode-unsupported')
    if (Array.isArray(referenceImages) && referenceImages.length > 0) return kindResult('flow-references-unsupported')

    const projectCheck = await deps.ensureOnProjectComposer(flowView, projectId)
    if (!projectCheck?.ok) {
      return { success: false, errorKind: projectCheck?.errorKind || 'flow-project-open-failed', error: projectCheck?.error || 'flow-project-open-failed' }
    }

    let generationId = null
    let gen = null
    let waiter = null
    let click = null
    // DOM 단계 — 자동화 뷰포트·포커스 반환 래퍼 안에서(조기 반환은 결과 객체로, 클릭까지 갔으면 null).
    const early = await withAutomationViewport(flowView, '[Flow API] [Angular]', async (ctl) => {
      // 1. 에이전트 OFF (ON 이면 페이지가 streamChat 로 보내 캡처가 안 잡힌다)
      const agent = await deps.ensureAgentOff()
      if (!agent?.success) return kindResult('flow-agent-off-failed')

      // 2. 캡처 주입 설치 확인 — 없으면 주입 → 재프로브
      let armed = false
      try { armed = !!(await exec(flowView, CAPTURE_FLAG_PROBE)) } catch (_e) { armed = false }
      if (!armed) {
        try { await exec(flowView, FLOW_RPC_CAPTURE_INJECTION) } catch (_e) { /* 아래 재프로브가 판정 */ }
        try { armed = !!(await exec(flowView, CAPTURE_FLAG_PROBE)) } catch (_e) { armed = false }
      }
      if (!armed) {
        await report('rpc-capture', 'not-installed')
        return kindResult('flow-capture-not-installed')
      }

      // 3. 설정 패널 — 모드(이미지)·비율·개수, 모델은 검증만
      if (ctl.aborted) return kindResult('flow-settings-not-applied', { reason: 'dom-stage-timeout' })   // M2-LIVE N1: 워치독이 이미 닫았다(좀비)
      const settings = await applyComposerSettings(flowView, { mode: 'image', ratio: aspectRatio, count: batchCount, model }, { trustedClickOnFlowView: deps.trustedClickOnFlowView })
      if (!settings.ok) {
        await report(`settings:${settings.reason || settings.kind}`, settings.reason || settings.kind, { steps: settings.steps, ...(settings.shape ? { shape: settings.shape } : {}) })
        return { success: false, errorKind: settings.kind || 'flow-settings-not-applied', error: settings.kind || 'flow-settings-not-applied', ...(settings.params ? { errorParams: settings.params } : {}) }
      }

      // 4. 편집기 — OS 포커스를 준 뒤 신뢰 클릭으로 캐럿 → 주입 → 재판독(주입 실패는 재판독이 잡는다).
      if (ctl.aborted) return kindResult('flow-settings-not-applied', { reason: 'dom-stage-timeout' })   // M2-LIVE N1
      try { flowView.webContents.focus() } catch (_e) { /* 포커스 실패는 재판독이 잡는다 */ }
      await sleep(120)
      const focus = await deps.trustedClickOnFlowView(FIND_PROMPT_EDITOR_JS, { required: true, step: 'compose-editor' })
      if (!focus?.success) return kindResult('text-injection-failed')
      await sleep(120)
      let readBack = null
      try { await exec(flowView, SET_EDITOR_TEXT_JS(prompt)) } catch (_e) { /* 재판독이 판정 */ }
      try { readBack = await exec(flowView, READ_EDITOR_TEXT_JS) } catch (_e) { readBack = null }
      const normPrompt = normalizePrompt(prompt)
      if (normalizePrompt(readBack || '') !== normPrompt) {
        await report('compose-text', 'mismatch', { promptLen: normPrompt.length, editorLen: normalizePrompt(readBack || '').length })
        return kindResult('text-injection-failed')
      }

      // 5. 제출 가능(텍스트가 등록돼 버튼이 활성)
      let enabled = false
      try { enabled = !!(await exec(flowView, SUBMIT_ENABLED_PROBE)) } catch (_e) { enabled = false }
      if (!enabled) return kindResult('generate-button-unavailable')

      // 6. arm — 클릭 전에 gen 을 맵에 넣는다(캡처의 send 가 바인딩할 후보). 초 단위 시각.
      if (ctl.aborted) return kindResult('flow-settings-not-applied', { reason: 'dom-stage-timeout' })   // M2-LIVE N1: 좀비는 arm·클릭하지 않는다
      generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      gen = {
        rpc: 'ogiZ0b', doc: null, seq: null, sentAt: null, normPrompt, wantRatio: aspectRatio || null, wantModelKey: null,
        results: null, error: null, errorKind: null, completed: false, allowDomFallback: false, waiter: null, deadlines: {},
        setAt: Date.now() / 1000, generationId, expectedCount: Number(batchCount) || 1,
      }
      waiter = new Promise((resolve) => { gen.waiter = { resolve } })
      deps.pendingGenerations.set(generationId, gen)

      // 7. 신뢰 클릭 — 제출은 페이지가 한다(reCAPTCHA 토큰 포함)
      ctl.clickStarted = true   // M2-LIVE N1: 이제부터 워치독은 결과를 덮지 않는다
      click = await deps.trustedClickOnFlowView(FIND_GENERATE_BUTTON_JS, { required: true, step: 'compose-submit' })
      return null
    })
    if (early) return early
    // M2-R1 F4(b): mouseDown 이 나가기 전의 실패만 "클릭 없음"(gen 삭제). dispatched 면 페이지가 제출했을 수 있다 — gen 을 armed 로 두고
    //   waiter/마감 경로로(늦은 send 는 바인딩, 없으면 not-sent).
    if (!click?.success && !click?.dispatched) {
      settleGen(gen, { error: 'generate-button-click-failed', errorKind: 'generate-button-click-failed' })
      deps.pendingGenerations.delete(generationId)
      return kindResult('generate-button-click-failed')
    }
    const dispatchedOnly = !click?.success
    if (dispatchedOnly) console.warn(`[Flow API] [Angular] click failed after dispatch gen=${generationId.slice(-8)} — keeping gen armed`)
    // M2-R1 F4(c): send 마감(15s)은 클릭이 돌아온 **뒤**에 arm — 클릭은 뮤텍스 대기 포함 30s 까지 걸릴 수 있어 클릭 전에 arm 하면 정상 send 가
    //   마감에 잘린다. 클릭 중 이미 send 가 바인딩됐거나 완료됐으면 재arm 하지 않는다.
    if (!gen.completed && gen.sentAt == null) armDeadline(gen, 'send')
    console.log(`[Flow API] [Angular] submitted gen=${generationId.slice(-8)} async=${!!asyncMode}`)
    if (asyncMode) return { success: true, generationId, submitted: true }

    await waiter
    deps.pendingGenerations.delete(generationId)
    const collected = await collectRpcGen(gen)
    return collected.success || !dispatchedOnly ? collected : { ...collected, postClick: true }
  }

  /** flow:check-generation 의 rpc 분기 — DOM 폴백 없음. */
  function checkRpcGeneration(gen) {
    return { success: true, completed: !!gen.completed, via: 'rpc', responseCount: Array.isArray(gen.results) ? gen.results.length : 0, expectedCount: gen.expectedCount || 1 }
  }

  /** flow:collect-generation 의 rpc 분기 — 완료된 것만 맵에서 지운다. */
  async function collectRpcGeneration(generationId, gen) {
    if (!gen.completed) return { success: false, error: 'Generation not completed yet' }
    deps.pendingGenerations.delete(generationId)
    return collectRpcGen(gen)
  }

  /** flow:clear-generations — 대기 중인 waiter 를 settle(동기 호출이 영영 매달리지 않게). */
  function settleRpcGenerations() {
    let n = 0
    for (const gen of deps.pendingGenerations.values()) {
      if (gen && gen.rpc && !gen.completed && settleGen(gen, { error: 'flow-generation-cleared', errorKind: 'flow-generation-cleared' })) n++
    }
    return n
  }

  /** M2-R7 L1: nzlxg 재판독(숫자 또는 null — 읽기 실패·모양 드리프트는 판정 불가). */
  async function readCreditsAgain(flowView) {
    try { return creditsOf(await callFlowRpc(flowView, 'nzlxg', [])) } catch (_e) { return null }
  }

  /**
   * 제출 gen 이 settle 된 뒤의 판정(M2-4) — 클릭 뒤의 실패는 전부 postClick:true.
   *   not-sent(클릭 뒤 100s 까지 send 없음 — M2-R7 L1)는 크레딧을 마지막으로 다시 읽어 줄었으면 flow-submit-lost 로 격상(과금됐는데 미추적 — 감소분은 로그 숫자로만, params 없음).
   *   200 이면 응답 모델키를 표로 검증 — 불일치는 flow-video-settings-mismatch {expected, actual} + rejectedMediaId(새 제출 중단 신호).
   */
  async function finishVideoGen(flowView, gen, want, creditsBefore) {
    if (gen.error) {
      let errorKind = gen.errorKind || 'flow-rpc-error'
      let error = gen.error
      if (errorKind === 'flow-submit-not-sent' && creditsBefore != null && creditsDropped(creditsBefore, await readCreditsAgain(flowView))) {
        errorKind = 'flow-submit-lost'
        error = 'flow-submit-lost'
      }
      // R2-2#6: 진단 보고는 기다리지 않는다.
      if (typeof error === 'string' && error.startsWith('rpc-shape:')) void report(error, 'shape', { rpc: gen.rpc })
      else if (SUBMIT_FAILURE_KINDS.has(errorKind)) void report(`submit:${errorKind}`, errorKind, { rpc: gen.rpc, bound: gen.doc != null })
      return {
        success: false, errorKind, error, postClick: true,
        ...(gen.errorParams ? { errorParams: gen.errorParams } : {}),
        ...(gen.rpcCode != null ? { rpcCode: gen.rpcCode } : {}),
        ...(gen.rpcStatus != null ? { rpcStatus: gen.rpcStatus } : {}),
        ...(gen.authFailed ? { authFailed: true } : {}),
        ...(typeof gen.rejectedMediaId === 'string' ? { rejectedMediaId: gen.rejectedMediaId } : {}),
        ...(Array.isArray(gen.rejectedMediaIds) ? { rejectedMediaIds: gen.rejectedMediaIds } : {}),
      }
    }
    if (!modelKeyMatches(gen.modelKey, want)) {
      console.warn(`[Flow Video T2V] [Angular] model key mismatch media=${short(gen.mediaId)} modelKey=${gen.modelKey} → flow-video-settings-mismatch`)
      void report('submit:flow-video-settings-mismatch', 'flow-video-settings-mismatch', { rpc: gen.rpc, modelKey: gen.modelKey })
      return {
        success: false, errorKind: 'flow-video-settings-mismatch', error: 'flow-video-settings-mismatch',
        errorParams: { expected: describeWant(want), actual: String(gen.modelKey) }, rejectedMediaId: gen.mediaId, postClick: true,
      }
    }
    console.log(`[Flow Video T2V] [Angular] submitted media=${short(gen.mediaId)} creditsLeft=${gen.creditsLeft} modelKey=${gen.modelKey}`)
    return { success: true, generationId: gen.mediaId, creditsLeft: gen.creditsLeft }
  }

  /** flow:generate-video-t2v(Flow 모드) — M2-4. 동기(YhhmEf 는 ~6s 에 돌아온다); 상태·다운로드는 checkVideoStatus 가 맡는다. */
  async function generateVideoT2V(payload = {}) {
    const { prompt, projectId, model, aspectRatio, duration, resolution, videoBatchCount, segments } = payload
    console.log('[Flow Video T2V] [Angular] generate-video-t2v:', { promptLen: prompt?.length ?? 0, model, aspectRatio, duration, resolution, videoBatchCount: videoBatchCount ?? 1 })
    if (!prompt) return { success: false, error: 'No prompt' }
    const flowView = deps.getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }

    const gate = await sessionGate(flowView)
    if (gate) return gate
    if (deps.getFlowAgentOn && deps.getFlowAgentOn()) return kindResult('flow-agent-mode-unsupported')
    // 이중 방어(엔진 게이트가 먼저 거른다): @멘션 칩 영상은 새 Flow 미지원.
    if (Array.isArray(segments) && segments.length > 0) return kindResult('flow-mention-chips-unsupported')
    // M2-R1 F11(a)(A11/B2): 해상도 미지정/무효는 렌더러 배관 결함 — 720p 기본값을 주면 1080p 요청이 조용히 720p 로 과금된다. 클릭 전 거부.
    if (typeof resolution !== 'string' || !resolution.trim()) {
      console.warn('[Flow Video T2V] [Angular] resolution missing → flow-settings-not-applied')
      return kindResult('flow-settings-not-applied', { reason: 'resolution-missing' })   // M2-R2 G4: 배치 전체 이유 — 훅의 F8 서명용 reason
    }

    const projectCheck = await deps.ensureOnProjectComposer(flowView, projectId)
    if (!projectCheck?.ok) {
      return { success: false, errorKind: projectCheck?.errorKind || 'flow-project-open-failed', error: projectCheck?.error || 'flow-project-open-failed' }
    }

    // 요청 설정 — 해상도는 요청값 그대로(기본값 없음), 개수는 항상 1(videoBatchCount 무시 — P3).
    const want = { model, duration: Number(duration), ratio: aspectRatio || null, resolution: String(resolution) }
    let generationId = null
    let gen = null
    let waiter = null
    let click = null
    let creditsBefore = null
    const early = await withAutomationViewport(flowView, '[Flow Video T2V] [Angular]', async (ctl) => {
      // 1. 에이전트 OFF
      const agent = await deps.ensureAgentOff()
      if (!agent?.success) return kindResult('flow-agent-off-failed')

      // 2. 캡처 주입 설치 확인 — 없으면 주입 → 재프로브
      let armed = false
      try { armed = !!(await exec(flowView, CAPTURE_FLAG_PROBE)) } catch (_e) { armed = false }
      if (!armed) {
        try { await exec(flowView, FLOW_RPC_CAPTURE_INJECTION) } catch (_e) { /* 아래 재프로브가 판정 */ }
        try { armed = !!(await exec(flowView, CAPTURE_FLAG_PROBE)) } catch (_e) { armed = false }
      }
      if (!armed) {
        await report('rpc-capture', 'not-installed')
        return kindResult('flow-capture-not-installed')
      }

      // 3. 크레딧 before — 클릭 전 판독(not-sent 판정 때 재판독해 감소 여부를 본다). 읽기 실패는 fail-closed(클릭 없이 매핑 결과).
      try {
        creditsBefore = creditsOf(await callFlowRpc(flowView, 'nzlxg', []))
      } catch (e) {
        console.warn(`[Flow Video T2V] [Angular] credits read failed before click kind=${(e && e.kind) || 'error'}`)
        // M2-R1 F5(A5/B4): 읽기 RPC 실패는 중립 — code 8 도 'RESOURCE_EXHAUSTED' 문구를 싣지 않는다(훅의 quota 감지가 **읽기**에서 발화해
        //   배치를 멈추면 안 된다 — D5: 읽기 code 8 은 일시). rpcCode/rpcStatus 필드는 그대로.
        const mapped = rpcErrorToRendererResult(e)
        if (mapped.error === 'RESOURCE_EXHAUSTED') mapped.error = 'flow-rpc-error'
        return mapped
      }
      if (creditsBefore === null) {
        // M2-R1 F5: nzlxg 모양 드리프트(payload[0] 가 숫자 아님) — null 로 진행하면 not-sent→lost 격상이 조용히 꺼진다. 클릭 전에 거부(fail-closed).
        console.warn('[Flow Video T2V] [Angular] credits read shape unexpected — refusing before click')
        void report('rpc-shape:nzlxg@[0]', 'shape', { rpc: 'nzlxg' })
        return kindResult('flow-rpc-error')
      }
      console.log(`[Flow Video T2V] [Angular] credits before=${creditsBefore}`)

      // 4. 설정 패널 — video · ratio · count 1 · model · duration · resolution({360p,720p} 밖은 클릭 전 거부)
      if (ctl.aborted) return kindResult('flow-settings-not-applied', { reason: 'dom-stage-timeout' })   // M2-LIVE N1: 워치독이 이미 닫았다(좀비)
      const settings = await applyComposerSettings(flowView, { mode: 'video', ratio: aspectRatio, count: 1, model, duration: want.duration, resolution: want.resolution }, { trustedClickOnFlowView: deps.trustedClickOnFlowView })
      if (!settings.ok) {
        await report(`settings:${settings.reason || settings.kind}`, settings.reason || settings.kind, { steps: settings.steps, ...(settings.shape ? { shape: settings.shape } : {}) })
        // M2-R2 G4(B2): flow-settings-not-applied 는 params 가 {} 라 훅의 F8 서명(kind+params)이 항상 같다 — 드라이버 reason 을 **params 아닌** 필드로 실어
        //   훅이 배치 전체 이유(model-/ratio-not-offered·input-mode·submenu·menu-not-open)만 종결하게 한다. 렌더되지 않는다(errorParams 는 그대로 없음).
        const kind = settings.kind || 'flow-settings-not-applied'
        return {
          success: false, errorKind: kind, error: kind,
          ...(settings.params ? { errorParams: settings.params } : {}),
          ...(kind === 'flow-settings-not-applied' && settings.reason ? { reason: String(settings.reason) } : {}),
        }
      }

      // 5. 편집기 — OS 포커스 → 신뢰 클릭 캐럿 → 주입 → 재판독
      if (ctl.aborted) return kindResult('flow-settings-not-applied', { reason: 'dom-stage-timeout' })   // M2-LIVE N1
      try { flowView.webContents.focus() } catch (_e) { /* 포커스 실패는 재판독이 잡는다 */ }
      await sleep(120)
      const focus = await deps.trustedClickOnFlowView(FIND_PROMPT_EDITOR_JS, { required: true, step: 'compose-editor' })
      if (!focus?.success) return kindResult('text-injection-failed')
      await sleep(120)
      let readBack = null
      try { await exec(flowView, SET_EDITOR_TEXT_JS(prompt)) } catch (_e) { /* 재판독이 판정 */ }
      try { readBack = await exec(flowView, READ_EDITOR_TEXT_JS) } catch (_e) { readBack = null }
      const normPrompt = normalizePrompt(prompt)
      if (normalizePrompt(readBack || '') !== normPrompt) {
        await report('compose-text', 'mismatch', { promptLen: normPrompt.length, editorLen: normalizePrompt(readBack || '').length })
        return kindResult('text-injection-failed')
      }

      // 6. 제출 가능
      let enabled = false
      try { enabled = !!(await exec(flowView, SUBMIT_ENABLED_PROBE)) } catch (_e) { enabled = false }
      if (!enabled) return kindResult('generate-button-unavailable')

      // 7. arm — YhhmEf gen(send 마감 15s). 비율은 키에 없어 wantRatio 검사는 없다(패널이 보장).
      if (ctl.aborted) return kindResult('flow-settings-not-applied', { reason: 'dom-stage-timeout' })   // M2-LIVE N1: 좀비는 arm·클릭하지 않는다
      generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      gen = {
        rpc: 'YhhmEf', doc: null, seq: null, sentAt: null, normPrompt, wantRatio: null, wantModelKey: null, want,
        results: null, error: null, errorKind: null, completed: false, allowDomFallback: false, waiter: null, deadlines: {},
        setAt: Date.now() / 1000, generationId, expectedCount: 1,
      }
      waiter = new Promise((resolve) => { gen.waiter = { resolve } })
      deps.pendingGenerations.set(generationId, gen)

      // 8. 신뢰 클릭 — 제출은 페이지가 한다(reCAPTCHA 토큰 포함)
      ctl.clickStarted = true   // M2-LIVE N1: 이제부터 워치독은 결과를 덮지 않는다
      click = await deps.trustedClickOnFlowView(FIND_GENERATE_BUTTON_JS, { required: true, step: 'compose-submit' })
      return null
    })
    if (early) return early
    // M2-R1 F4(b)(A4/B5): mouseDown 이 나가기 전의 실패만 "클릭 없음"(gen 삭제, postClick 없음). dispatched 면 페이지가 제출(과금)했을 수
    //   있다 — gen 을 armed 로 두고 waiter/마감 경로로(늦은 send 는 바인딩, 없으면 not-sent + 크레딧 재판독 → lost 격상). finishVideoGen 이
    //   모든 실패에 postClick:true 를 단다.
    if (!click?.success && !click?.dispatched) {
      settleGen(gen, { error: 'generate-button-click-failed', errorKind: 'generate-button-click-failed' })
      deps.pendingGenerations.delete(generationId)
      return kindResult('generate-button-click-failed')
    }
    if (!click?.success) console.warn(`[Flow Video T2V] [Angular] click failed after dispatch gen=${generationId.slice(-8)} — keeping gen armed (postClick)`)
    // M2-R1 F4(c)(d): send 마감(15s)은 클릭이 돌아온 **뒤**에 arm — 클릭은 뮤텍스 대기 포함 30s 까지 걸릴 수 있어 클릭 전에 arm 하면 정상 send 가
    //   마감에 잘리고 과금된 영상이 not-sent("다시 시도")로 둔갑한다. 클릭 중 이미 send 가 바인딩됐거나 완료됐으면 재arm 하지 않는다.
    //   not-sent 의 크레딧 재판독은 이 마감이 울린 뒤라 arm 직후가 아니다.
    // M2-R7 L1(A1): 그 send 마감은 영상에선 최종이 아니다 — 라우터가 gen 을 sendDeadlinePassed 로 표시하고 클릭 뒤 100s 까지 바인딩 가능하게 둔다(유예).
    //   페이지의 reCAPTCHA execute + batchexecute send 가 15s 를 넘기는 경우(모달로 뷰가 0×0 이라 throttle · 느린 네트워크)에 전엔 gen 이 닫혀 맵에서 지워지고
    //   그 뒤의 send/loadend 가 unbound 로 버려졌다 — 서버는 10크레딧을 과금했는데 행은 id 없이 "다시 시도"(다음 Start 가 같은 씬에 또 과금). 15s 시점의 훅은
    //   크레딧을 한 번 재판독해 줄었으면 flow-submit-lost 로 즉시 닫고(과금됐는데 send 를 못 잡았다), 같으면 계속 기다린다: 유예 안의 늦은 send 는 정상 바인딩
    //   → loadend → finishVideoGen. 재판독이 돌아오기 전에 send 가 바인딩됐으면 여기서 닫지 않는다(loadend 가 판정). 100s 까지 send 가 없으면 라우터가
    //   not-sent 로 닫고 finishVideoGen 이 마지막으로 재판독한다.
    gen.onSendDeadline = async () => {
      const after = await readCreditsAgain(flowView)
      // M2-R8 M1: 재판독 중에 늦은 send 가 바인딩됐으면(gen.doc) 닫지 않는다 — 그 send 의 과금이 재판독에 보여도 loadend 가 판정한다.
      if (gen.completed || gen.doc != null) return
      if (creditsDropped(creditsBefore, after)) settleGen(gen, { error: 'flow-submit-lost', errorKind: 'flow-submit-lost' })
      // M2-R8 M5(A5): 재판독 실패(null)는 "unchanged" 가 아니다 — unreadable(숫자 없음). 유예는 그대로(100s 마감이 마지막으로 재판독한다).
      else if (after == null) console.log(`[Flow Video T2V] [Angular] send deadline passed gen=${generationId.slice(-8)} credits unreadable — waiting for a late send (grace)`)
      else console.log(`[Flow Video T2V] [Angular] send deadline passed gen=${generationId.slice(-8)} credits unchanged — waiting for a late send (grace)`)
    }
    if (!gen.completed && gen.sentAt == null) armDeadline(gen, 'send')
    console.log(`[Flow Video T2V] [Angular] clicked gen=${generationId.slice(-8)} — waiting for YhhmEf`)
    await waiter
    deps.pendingGenerations.delete(generationId)
    return finishVideoGen(flowView, gen, want, creditsBefore)
  }

  /** as29s 연속 실패 수(mediaId 별) — 3회까지 pending, 4회째 flow-video-fetch-failed. 성공하면 리셋. */
  const as29sFailures = new Map()
  const AS29S_MAX_FAILURES = 3
  /** M2-R1 F7(A7): jwpduf 가 폴한 id 의 레코드를 안 주는 횟수(id 별) — 같은 유계(3회 pending, 4회째 fetch-failed + mediaId). 레코드가 오면 리셋. */
  const noRecordFailures = new Map()
  /** M2-R1 F7: 무효 id(문자열 아님·빈 문자열)는 회수할 것이 없다 — mediaId 없이 failed. 입력 id 마다 정확히 하나의 status(순서 유지). */
  const isValidId = (x) => typeof x === 'string' && x.length > 0
  const invalidIdStatus = () => ({ status: 'failed', errorKind: 'flow-video-fetch-failed', error: 'flow-video-fetch-failed' })
  /** M2-R2 G2(A2): 폴의 세션 게이트 **연속** 실패 수(핸들러 인스턴스) — 3회째(≈30s)면 뷰 재로드가 아니라 실제 로그아웃이다. 통과·발화 시 리셋. */
  let gateFailures = 0
  const GATE_MAX_FAILURES = 3
  /** M2-R3 H7(B3): 호출 수만으로는 Phase 0 의 병렬 재시도 5개·짧은 재시도·배치 사이 잔여 카운트가 한 번의 일시 실패를 authFailed 로 격상시킨다 — 첫 실패 시각을 적어 두고
   *  "연속 ≥3회 **그리고** 첫 실패로부터 ≥25s" 일 때만 발화(10s 폴 루프에선 4회째 = 첫 실패 30s 뒤). 통과·발화 시 시각도 리셋. */
  let gateFirstFailedAt = null
  const GATE_MIN_SPAN_MS = 25000
  /** M2-R4 I3(A2 = B2): 연속은 시간으로 만료된다 — 첫 시각은 통과·발화 때만 리셋됐으므로 옛 실패 하나(Stop 직전 마지막 폴·수동 Retry)가 ≥25s 를 영원히 참으로 두고, 10분 뒤 재로드 한 번에
   *  Phase 0 병렬 재시도 5개 중 둘째가 최상위 authFailed 가 됐다. 직전 실패(lastFailedAt)에서 20s(10s 폴 간격보다 길게) 넘게 지난 실패는 새 연속(횟수·첫 시각 리셋)이고,
   *  직전 실패에서 1s 안의 호출(동시 재시도 5개·연쇄 청크)은 같은 실패로 한 번만 센다 — 횟수 조건(≥3)이 시간과 갈라지는 자리. */
  let gateLastFailedAt = null
  const GATE_STREAK_GAP_MS = 20000
  const GATE_BURST_MS = 1000
  /** 미지 상태 warn 은 id·상태당 1회. */
  const unknownStateWarned = new Set()
  /** 읽기 RPC 실패 → 항목 결과(pending + pollError, 코드/상태는 필드). */
  const pollErrorStatus = (mapped) => ({
    status: 'pending', pollError: 'flow-rpc-error',
    ...(mapped.rpcCode != null ? { rpcCode: mapped.rpcCode } : {}),
    ...(mapped.rpcStatus != null ? { rpcStatus: mapped.rpcStatus } : {}),
  })

  /** flow:check-video-status(Flow 모드) — M2-5. token 없이(페이지 컨텍스트 XHR 이 쿠키·at 을 든다). */
  async function checkVideoStatus(payload = {}) {
    // M2-R1 F7: 입력 id 마다 정확히 하나의 status 를 입력 순서로 — 무효 id 를 걸러내 statuses 가 짧아지면 engineFlow 의 index-zip 이
    //   aligned=false 로 전원(완료된 과금 항목 포함) pending 에 묶는다.
    const ids = Array.isArray(payload.generationIds) ? payload.generationIds : []
    const flowView = deps.getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    const gate = await sessionGate(flowView)
    if (gate) {
      // M2-R1 F3(A3/B3): 폴의 세션 게이트 실패(다른 페이지·WIZ 없음)는 일시적일 수 있다(뷰 재로드 중) — 최상위 authFailed 로 닫으면 훅이
      //   이미 과금된 pending 전부를 errorKind:'auth'(mediaId null, 회수 불가) 로 잃는다. 요청 id 마다 {pending, pollError} 로 항목별 폴 예산만
      //   소모한다. authFailed 는 읽기 RPC 의 HTTP 401 / code 16 만(아래 rpcErrorToRendererResult).
      // M2-R2 G2(A2): 연속 3회째는 실제 로그아웃(accounts.google.com 에 앉음)으로 보고 최상위 authFailed 로 배치를 끝낸다 — 안 그러면 훅이 120×10s 를
      //   "Polling…" 으로 흘리고 원인 없는 "Polling timeout" 으로 닫는다. error 에 raw reason 토큰은 싣지 않는다. 발화 뒤 카운터 리셋(다음 배치의 첫 일시 실패가 바로 auth 가 되지 않게).
      const now = Date.now()
      // M2-R4 I3: 직전 실패에서 20s 넘게 비었으면 새 연속; 1s 안이면 같은 실패(한 번만 센다)
      if (gateLastFailedAt != null && now - gateLastFailedAt > GATE_STREAK_GAP_MS) { gateFailures = 0; gateFirstFailedAt = null }
      if (gateFailures === 0 || now - gateLastFailedAt >= GATE_BURST_MS) gateFailures++
      gateLastFailedAt = now
      if (gateFirstFailedAt == null) gateFirstFailedAt = now
      const spanS = Math.round((now - gateFirstFailedAt) / 1000)
      if (gateFailures >= GATE_MAX_FAILURES && now - gateFirstFailedAt >= GATE_MIN_SPAN_MS) {
        console.warn(`[Flow VideoStatus] [Angular] session gate failed ${gateFailures}x in a row over ${spanS}s reason=${gate.error} → authFailed`)
        gateFailures = 0
        gateFirstFailedAt = null
        gateLastFailedAt = null
        return { success: false, errorKind: 'flow-session-missing', error: 'flow-session-missing', authFailed: true }
      }
      console.warn(`[Flow VideoStatus] [Angular] session gate failed reason=${gate.error} n=${gateFailures} span=${spanS}s → pollError for ${ids.length} ids`)
      return { success: true, statuses: ids.map((id) => (isValidId(id) ? { status: 'pending', pollError: 'flow-session-missing' } : invalidIdStatus())) }
    }
    gateFailures = 0
    gateFirstFailedAt = null
    gateLastFailedAt = null   // M2-R4 I3
    if (ids.length === 0) return { success: true, statuses: [] }

    const statuses = []
    for (const id of ids) {
      if (!isValidId(id)) {
        console.warn('[Flow VideoStatus] [Angular] invalid generation id → flow-video-fetch-failed')
        statuses.push(invalidIdStatus())
        continue
      }
      // 1. jwpduf — id 당 1회. 레코드의 mediaId 가 폴한 id 와 다르면 오배정하지 않고 폴 실패로 본다.
      let record = null
      try {
        const { records } = parseVideoStatusResponse(await callFlowRpc(flowView, 'jwpduf', [null, null, [[id]]]))
        record = records.find((r) => r.mediaId === id) || null
      } catch (e) {
        const mapped = rpcErrorToRendererResult(e)
        if (mapped.authFailed) return mapped
        if (typeof mapped.error === 'string' && mapped.error.startsWith('rpc-shape:')) void report(mapped.error, 'shape', { rpc: 'jwpduf' })
        console.warn(`[Flow VideoStatus] [Angular] ${short(id)} poll failed kind=${(e && e.kind) || 'error'} code=${e && e.code != null ? e.code : '-'} status=${e && e.status != null ? e.status : '-'}`)
        statuses.push(pollErrorStatus(mapped))
        continue
      }
      if (!record) {
        // M2-R1 F7: 폴한 id 의 레코드 없음(삭제·옛 세션 잔존·미지 id) — 영원한 일시 실패로 두면 그 항목 하나가 배치를 20분 붙잡는다.
        //   as29s 와 같은 유계: 3회 pending+pollError, 4회째 종결(+mediaId — 회수 시도는 남긴다).
        // M2-R2 G3(B6): 4회째는 fetch-failed("Flow 에서 확인 뒤 다시 시도") 가 아니라 자기 kind flow-video-not-found — Flow 에 그 미디어가 없다(삭제·옛 id)는 뜻이라
        //   Retry 를 반복해도 같다; 문구가 재생성을 가리킨다. mediaId 는 그대로 둔다(과금 안전 — Start 가 재제출하지 않고, 새 생성은 Regenerate 만).
        const n = (noRecordFailures.get(id) || 0) + 1
        noRecordFailures.set(id, n)
        void report('rpc-shape:jwpduf@[2]', 'shape', { rpc: 'jwpduf' })
        console.warn(`[Flow VideoStatus] [Angular] ${short(id)} no record for the polled media n=${n}`)
        if (n > AS29S_MAX_FAILURES) {
          noRecordFailures.delete(id)
          statuses.push({ status: 'failed', errorKind: 'flow-video-not-found', error: 'flow-video-not-found', mediaId: id })
        } else {
          statuses.push(pollErrorStatus({}))
        }
        continue
      }
      noRecordFailures.delete(id)
      const st = mediaStateToStatus(record.state)
      if (st === 'pending') {
        console.log(`[Flow VideoStatus] [Angular] ${short(id)} state=${record.state} → pending`)
        statuses.push({ status: 'pending' })
        continue
      }
      if (st === 'unknown') {
        const key = `${id}:${record.state}`
        if (!unknownStateWarned.has(key)) { unknownStateWarned.add(key); console.warn(`[Flow VideoStatus] [Angular] ${short(id)} unknown state=${record.state} → pending`) }
        statuses.push({ status: 'pending', unknownState: record.state })
        continue
      }
      // 2. 완료(3) → as29s 로 mp4 서명 URL(호스트 flow-content.google 필수). 실패는 유계 pending 뒤 fetch-failed(mediaId 유지).
      try {
        const rec = parseMediaRecord(await callFlowRpc(flowView, 'as29s', [id]))
        if (rec.mediaId !== id) throw new FlowRpcShapeError('as29s response is for another media', { rpcid: 'as29s', path: '[0]' })
        if (!rec.videoUrl) throw new FlowRpcShapeError('as29s response has no video url', { rpcid: 'as29s', path: '[7][0][8]' })
        as29sFailures.delete(id)
        const { host } = describeMediaUrl(rec.videoUrl)
        console.log(`[Flow VideoStatus] [Angular] ${short(id)} state=3 → complete, as29s host=${host} bytes=${rec.bytes}`)
        statuses.push({ status: 'complete', mediaId: id, videoUrl: rec.videoUrl })
      } catch (e) {
        const mapped = rpcErrorToRendererResult(e)
        if (mapped.authFailed) return mapped
        if (typeof mapped.error === 'string' && mapped.error.startsWith('rpc-shape:')) void report(mapped.error, 'shape', { rpc: 'as29s' })
        const n = (as29sFailures.get(id) || 0) + 1
        as29sFailures.set(id, n)
        console.warn(`[Flow VideoStatus] [Angular] ${short(id)} as29s failed n=${n} kind=${(e && e.kind) || 'error'} status=${e && e.status != null ? e.status : '-'}`)
        if (n > AS29S_MAX_FAILURES) {
          as29sFailures.delete(id)
          statuses.push({ status: 'failed', errorKind: 'flow-video-fetch-failed', error: 'flow-video-fetch-failed', mediaId: id })
        } else {
          statuses.push(pollErrorStatus(mapped))
        }
      }
    }
    return { success: true, statuses }
  }

  return { generateImage, checkRpcGeneration, collectRpcGeneration, settleRpcGenerations, generateVideoT2V, checkVideoStatus, unsupportedOnAngular }
}
