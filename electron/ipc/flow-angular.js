/**
 * electron/ipc/flow-angular.js
 *
 * flow.google.com(Angular, 2026-09) 전용 핸들러 — M1: 이미지 생성(ogiZ0b). 옛 labs.google 핸들러(flow-api.js)는
 * 301 로 도달 불가라 남겨 두되 Flow 모드에서는 **무조건** 여기로 온다(dispatch 는 flow-api.js).
 *
 * 원칙(플랜 D2–D8):
 *   - 제출은 페이지의 신뢰 클릭으로만 — 앱은 제출 RPC 를 만들지도, 본문을 바꾸지도, reCAPTCHA 를 부르지도 않는다.
 *   - 페이지가 보낸 XHR 은 캡처 주입(flow-rpc-capture.js)이 send/loadend 로 보고하고 라우터가 {doc, seq} 로
 *     pendingGenerations 의 gen 에 바인딩한다. 핸들러는 클릭 전에 gen 을 arm 하고(send 마감 15s) 응답을 기다린다.
 *   - 순서: 세션(URL·WIZ) → 에이전트 모드/레퍼런스 거부 → 프로젝트 컴포저 → ensureAgentOff → 캡처 플래그(없으면 주입→재프로브)
 *     → 설정 패널(모드·비율·개수·모델 검증) → 편집기 클릭·텍스트 주입·재판독 → 제출 가능 → arm → 신뢰 클릭.
 *   - 실패는 kind 로 닫는다(문구 중립, 코드는 필드). 로그엔 내용 없음(길이·id 앞 8자·숫자·상태어만).
 *
 * tests/electron/ipc/flowGenerateImageAngular.test.js · tests/electron/flowRpcPipeline.test.js
 */
import { screen } from 'electron'
import { isFlowPageUrl, isLegacyFlowUrl } from '../flowUrl.js'
import { updateBounds } from './layout.js'
import { computeOffscreenBounds } from '../offscreen-bounds.js'
import { FLOW_RPC_CAPTURE_INJECTION } from '../flow-rpc-capture.js'
import { armDeadline, settleGen } from '../flow-rpc-router.js'
import { normalizePrompt, describeMediaUrl } from '../flow-rpc-protocol.js'
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

  /** 완료된 rpc gen → 렌더러 결과(다운로드 포함). 맵 삭제는 호출자가. */
  async function collectRpcGen(gen) {
    if (gen.error) {
      if (typeof gen.error === 'string' && gen.error.startsWith('rpc-shape:')) await report(gen.error, 'shape', { rpc: gen.rpc })
      else if (SUBMIT_FAILURE_KINDS.has(gen.errorKind)) await report(`submit:${gen.errorKind}`, gen.errorKind, { rpc: gen.rpc, bound: gen.doc != null })
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

    // 4. 편집기 — 뷰가 0×0(모달 열림·드래그 중)이면 execCommand('insertText') 가 no-op 이라(옛 flow-api.js "execCommand 방식이
    //    작동하려면 flowView가 보여야 함") 화면 밖으로 키워 두고, OS 포커스를 준 뒤 신뢰 클릭으로 캐럿 → 주입 → 재판독.
    //    키운 뷰는 재판독까지 유지하고 finally 에서 레이아웃(updateBounds)으로 원복한다. 보이는 뷰는 손대지 않는다(R2#1;
    //    실기 게이트는 957×1022 로 통과). 신뢰 클릭은 자기가 키운 경우에만 되돌리므로 여기서 키운 뷰를 접지 않는다.
    const startBounds = flowView.getBounds ? flowView.getBounds() : null
    const wasHidden = !startBounds || !(startBounds.width > 0) || !(startBounds.height > 0)
    let readBack = null
    try {
      if (wasHidden) {
        const mainWindow = deps.getMainWindow()
        const { width, height } = mainWindow.getContentBounds()
        const displays = (screen && typeof screen.getAllDisplays === 'function') ? screen.getAllDisplays() : []
        flowView.setBounds(computeOffscreenBounds(displays, mainWindow.getBounds().x, width, height))
        await sleep(300)
        console.log('[Flow API] [Angular] view was hidden — enlarged offscreen for text injection')
      }
      try { flowView.webContents.focus() } catch (_e) { /* 포커스 실패는 재판독이 잡는다 */ }
      await sleep(120)
      const focus = await deps.trustedClickOnFlowView(FIND_PROMPT_EDITOR_JS, { required: true, step: 'compose-editor' })
      if (!focus?.success) return kindResult('text-injection-failed')
      await sleep(120)
      try { await exec(flowView, SET_EDITOR_TEXT_JS(prompt)) } catch (_e) { /* 재판독이 판정 */ }
      try { readBack = await exec(flowView, READ_EDITOR_TEXT_JS) } catch (_e) { readBack = null }
    } finally {
      if (wasHidden) {
        updateBounds(deps.getMainWindow(), flowView)
        await sleep(200)
      }
    }
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
    const generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const gen = {
      rpc: 'ogiZ0b', doc: null, seq: null, sentAt: null, normPrompt, wantRatio: aspectRatio || null, wantModelKey: null,
      results: null, error: null, errorKind: null, completed: false, allowDomFallback: false, waiter: null, deadlines: {},
      setAt: Date.now() / 1000, generationId, expectedCount: Number(batchCount) || 1,
    }
    const waiter = new Promise((resolve) => { gen.waiter = { resolve } })
    deps.pendingGenerations.set(generationId, gen)
    armDeadline(gen, 'send')

    // 7. 신뢰 클릭 — 제출은 페이지가 한다(reCAPTCHA 토큰 포함)
    const click = await deps.trustedClickOnFlowView(FIND_GENERATE_BUTTON_JS, { required: true, step: 'compose-submit' })
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

  // M2 가 본문을 채운다 — M1 은 fail-closed 스텁(옛 'No token' 같은 무의미 실패로 20분 폴링이 돌지 않게).
  async function generateVideoT2V() { return unsupportedOnAngular('generate-video-t2v') }
  async function checkVideoStatus() { return unsupportedOnAngular('check-video-status') }

  return { generateImage, checkRpcGeneration, collectRpcGeneration, settleRpcGenerations, generateVideoT2V, checkVideoStatus, unsupportedOnAngular }
}
