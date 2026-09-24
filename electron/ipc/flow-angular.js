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
import { screen } from 'electron'
import { isFlowPageUrl, isLegacyFlowUrl } from '../flowUrl.js'
import { updateBounds } from './layout.js'
import { computeOffscreenBounds, needsAutomationViewport, automationViewportSize } from '../offscreen-bounds.js'
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
const short = (v) => String(v ?? '').slice(0, 8)
/** nzlxg payload → 크레딧 잔량(숫자) 또는 null. */
const creditsOf = (payload) => (Array.isArray(payload) && typeof payload[0] === 'number' ? payload[0] : null)
/** 요청 설정 한 줄(errorParams.expected 용 — 값만: 모델 라벨·길이·비율·해상도). */
const describeWant = (w) => `${w.model} ${w.duration}s ${w.ratio || '?'} ${w.resolution}`
/** 제출 단계의 실패 kind — D8-9 의 reportDomFailure('submit:<kind>') 대상(내용 없음). */
const SUBMIT_FAILURE_KINDS = new Set(['flow-submit-not-sent', 'flow-submit-lost', 'flow-rpc-multi-batch'])

/**
 * @param {object} deps flow-api.js 의 deps(main.js flowAPIDeps 와 동일 모양). 필요한 것: getFlowView, getFlowAgentOn,
 *   trustedClickOnFlowView, ensureAgentOff, ensureOnProjectComposer, sessionFetch, pendingGenerations, reportDomFailure?
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
   *   숨었거나(0×0: 모달·드래그) 좁은(< AUTOMATION_MIN_WIDTH) 뷰는 화면 밖 정본 크기로 둔다. flow.google.com 은 좁은 폭에서
   *   에이전트 칩 등 컴포저 컨트롤을 아예 렌더하지 않는다(2026-09-25 실기: 597px 에서 chip 0개 → not_found, 957px 정상).
   *   execCommand 주입도 보이는 뷰를 요구한다. fn 이 어떻게 끝나든(정상·조기 반환·throw) finally 에서 레이아웃(updateBounds —
   *   유일한 진실)으로 원복한다. 넓은 보이는 뷰는 손대지 않는다(실기 게이트 957×1022 통과). 신뢰 클릭 헬퍼는 자기가 키운(0×0)
   *   경우에만 되돌리므로 여기서 키운 뷰를 중간에 접지 않는다.
   *   R2-2#1(§12 #45): DOM 단계 전에 뷰가 OS 포커스를 갖고 있었는지(hadFocus) 적어 두고, 뷰포트에 들어갔거나 애초에 포커스가
   *   없었으면 끝난 뒤 메인 창에 포커스를 돌려준다 — 편집기 주입의 webContents.focus() 가 Flow 뷰로 옮긴 포커스가 모달·입력창에
   *   남지 않게. 조기 반환도 같은 finally 를 지난다.
   * @param {string} tag 로그 접두('[Flow API] [Angular]' | '[Flow Video T2V] [Angular]')
   */
  async function withAutomationViewport(flowView, tag, fn) {
    const startBounds = flowView.getBounds ? flowView.getBounds() : null
    const viewport = needsAutomationViewport(startBounds)
    let hadFocus = false
    try { hadFocus = !!(flowView.webContents.isFocused && flowView.webContents.isFocused()) } catch (_e) { hadFocus = false }
    if (viewport) {
      const mainWindow = deps.getMainWindow()
      const size = automationViewportSize(mainWindow.getContentBounds())
      const displays = (screen && typeof screen.getAllDisplays === 'function') ? screen.getAllDisplays() : []
      flowView.setBounds(computeOffscreenBounds(displays, mainWindow.getBounds().x, size.width, size.height))
      await sleep(300)
      const why = (!startBounds || !(startBounds.width > 0) || !(startBounds.height > 0)) ? 'hidden' : 'narrow'
      console.log(`${tag} view ${why} ${(startBounds && startBounds.width) || 0}x${(startBounds && startBounds.height) || 0} → automation viewport ${size.width}x${size.height} offscreen`)
    }
    try {
      return await fn()
    } finally {
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
    const early = await withAutomationViewport(flowView, '[Flow API] [Angular]', async () => {
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
      const settings = await applyComposerSettings(flowView, { mode: 'image', ratio: aspectRatio, count: batchCount, model }, { trustedClickOnFlowView: deps.trustedClickOnFlowView })
      if (!settings.ok) {
        await report(`settings:${settings.reason || settings.kind}`, settings.reason || settings.kind, { steps: settings.steps })
        return { success: false, errorKind: settings.kind || 'flow-settings-not-applied', error: settings.kind || 'flow-settings-not-applied', ...(settings.params ? { errorParams: settings.params } : {}) }
      }

      // 4. 편집기 — OS 포커스를 준 뒤 신뢰 클릭으로 캐럿 → 주입 → 재판독(주입 실패는 재판독이 잡는다).
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
      generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      gen = {
        rpc: 'ogiZ0b', doc: null, seq: null, sentAt: null, normPrompt, wantRatio: aspectRatio || null, wantModelKey: null,
        results: null, error: null, errorKind: null, completed: false, allowDomFallback: false, waiter: null, deadlines: {},
        setAt: Date.now() / 1000, generationId, expectedCount: Number(batchCount) || 1,
      }
      waiter = new Promise((resolve) => { gen.waiter = { resolve } })
      deps.pendingGenerations.set(generationId, gen)
      armDeadline(gen, 'send')

      // 7. 신뢰 클릭 — 제출은 페이지가 한다(reCAPTCHA 토큰 포함)
      click = await deps.trustedClickOnFlowView(FIND_GENERATE_BUTTON_JS, { required: true, step: 'compose-submit' })
      return null
    })
    if (early) return early
    if (!click?.success) {
      settleGen(gen, { error: 'generate-button-click-failed', errorKind: 'generate-button-click-failed' })
      deps.pendingGenerations.delete(generationId)
      return kindResult('generate-button-click-failed')
    }
    console.log(`[Flow API] [Angular] submitted gen=${generationId.slice(-8)} async=${!!asyncMode}`)
    if (asyncMode) return { success: true, generationId, submitted: true }

    await waiter
    deps.pendingGenerations.delete(generationId)
    return collectRpcGen(gen)
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

  /**
   * 제출 gen 이 settle 된 뒤의 판정(M2-4) — 클릭 뒤의 실패는 전부 postClick:true.
   *   not-sent 는 크레딧을 다시 읽어 줄었으면 flow-submit-lost 로 격상(과금됐는데 미추적 — 감소분은 로그 숫자로만, params 없음).
   *   200 이면 응답 모델키를 표로 검증 — 불일치는 flow-video-settings-mismatch {expected, actual} + rejectedMediaId(새 제출 중단 신호).
   */
  async function finishVideoGen(flowView, gen, want, creditsBefore) {
    if (gen.error) {
      let errorKind = gen.errorKind || 'flow-rpc-error'
      let error = gen.error
      if (errorKind === 'flow-submit-not-sent' && creditsBefore != null) {
        let after = null
        try { after = creditsOf(await callFlowRpc(flowView, 'nzlxg', [])) } catch (_e) { after = null }
        if (after != null && after < creditsBefore) {
          console.warn(`[Flow Video T2V] [Angular] credits dropped without a captured send before=${creditsBefore} after=${after} → flow-submit-lost`)
          errorKind = 'flow-submit-lost'
          error = 'flow-submit-lost'
        }
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

    const projectCheck = await deps.ensureOnProjectComposer(flowView, projectId)
    if (!projectCheck?.ok) {
      return { success: false, errorKind: projectCheck?.errorKind || 'flow-project-open-failed', error: projectCheck?.error || 'flow-project-open-failed' }
    }

    // 요청 설정 — 해상도 미지정은 720p(패널 기본), 개수는 항상 1(videoBatchCount 무시 — P3).
    const want = { model, duration: Number(duration), ratio: aspectRatio || null, resolution: String(resolution || '720p') }
    let generationId = null
    let gen = null
    let waiter = null
    let click = null
    let creditsBefore = null
    const early = await withAutomationViewport(flowView, '[Flow Video T2V] [Angular]', async () => {
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
        return rpcErrorToRendererResult(e)
      }
      console.log(`[Flow Video T2V] [Angular] credits before=${creditsBefore}`)

      // 4. 설정 패널 — video · ratio · count 1 · model · duration · resolution({360p,720p} 밖은 클릭 전 거부)
      const settings = await applyComposerSettings(flowView, { mode: 'video', ratio: aspectRatio, count: 1, model, duration: want.duration, resolution: want.resolution }, { trustedClickOnFlowView: deps.trustedClickOnFlowView })
      if (!settings.ok) {
        await report(`settings:${settings.reason || settings.kind}`, settings.reason || settings.kind, { steps: settings.steps })
        return { success: false, errorKind: settings.kind || 'flow-settings-not-applied', error: settings.kind || 'flow-settings-not-applied', ...(settings.params ? { errorParams: settings.params } : {}) }
      }

      // 5. 편집기 — OS 포커스 → 신뢰 클릭 캐럿 → 주입 → 재판독
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
      generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      gen = {
        rpc: 'YhhmEf', doc: null, seq: null, sentAt: null, normPrompt, wantRatio: null, wantModelKey: null, want,
        results: null, error: null, errorKind: null, completed: false, allowDomFallback: false, waiter: null, deadlines: {},
        setAt: Date.now() / 1000, generationId, expectedCount: 1,
      }
      waiter = new Promise((resolve) => { gen.waiter = { resolve } })
      deps.pendingGenerations.set(generationId, gen)
      armDeadline(gen, 'send')

      // 8. 신뢰 클릭 — 제출은 페이지가 한다(reCAPTCHA 토큰 포함)
      click = await deps.trustedClickOnFlowView(FIND_GENERATE_BUTTON_JS, { required: true, step: 'compose-submit' })
      return null
    })
    if (early) return early
    if (!click?.success) {
      settleGen(gen, { error: 'generate-button-click-failed', errorKind: 'generate-button-click-failed' })
      deps.pendingGenerations.delete(generationId)
      return kindResult('generate-button-click-failed')
    }
    console.log(`[Flow Video T2V] [Angular] clicked gen=${generationId.slice(-8)} — waiting for YhhmEf`)
    await waiter
    deps.pendingGenerations.delete(generationId)
    return finishVideoGen(flowView, gen, want, creditsBefore)
  }

  /** as29s 연속 실패 수(mediaId 별) — 3회까지 pending, 4회째 flow-video-fetch-failed. 성공하면 리셋. */
  const as29sFailures = new Map()
  const AS29S_MAX_FAILURES = 3
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
    const ids = (Array.isArray(payload.generationIds) ? payload.generationIds : []).filter((x) => typeof x === 'string' && x)
    const flowView = deps.getFlowView()
    if (!flowView) return { success: false, error: 'Flow view not ready' }
    const gate = await sessionGate(flowView)
    if (gate) return gate
    if (ids.length === 0) return { success: true, statuses: [] }

    const statuses = []
    for (const id of ids) {
      // 1. jwpduf — id 당 1회. 레코드의 mediaId 가 폴한 id 와 다르면 오배정하지 않고 폴 실패로 본다.
      let record = null
      try {
        const { records } = parseVideoStatusResponse(await callFlowRpc(flowView, 'jwpduf', [null, null, [[id]]]))
        record = records.find((r) => r.mediaId === id) || null
        if (!record) throw new FlowRpcShapeError('jwpduf response has no record for the polled media', { rpcid: 'jwpduf', path: '[2]' })
      } catch (e) {
        const mapped = rpcErrorToRendererResult(e)
        if (mapped.authFailed) return mapped
        if (typeof mapped.error === 'string' && mapped.error.startsWith('rpc-shape:')) void report(mapped.error, 'shape', { rpc: 'jwpduf' })
        console.warn(`[Flow VideoStatus] [Angular] ${short(id)} poll failed kind=${(e && e.kind) || 'error'} code=${e && e.code != null ? e.code : '-'} status=${e && e.status != null ? e.status : '-'}`)
        statuses.push(pollErrorStatus(mapped))
        continue
      }
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
