/**
 * electron/flow-reference-driver.js
 *
 * M3-7·M3-8 — flow.google.com 컴포저에 **레퍼런스**를 UI 로 붙이는 드라이버(계획서 docs/plans/2026-09-25-flow-M3-references-plan.md D4·D6–D9 · D16).
 * 페이지가 요청을 만든다 — 앱은 maseQ·제출 RPC 를 만들지 않고, 요청 본문을 바꾸지 않고, CDP·키 sendInputEvent 를 쓰지 않는다.
 * 페이지 접촉은 ctx.exec(단일 표현식 executeJavaScript)·ctx.trustedClick(마우스 sendInputEvent — 신뢰 클릭 헬퍼)·ctx.paste(webContents.paste)뿐.
 *
 *   업로드(D4)  uploadReferenceByPaste — 사전 판독(편집기 포커스·창 닫힘·바쁜 칩 없음, 클립보드에 손대기 전) → 클립보드 스냅샷(text/uri-list 면
 *               거부, flow-clipboard.js) → 디코드 → maseQ gen arm → 붙여넣기 관찰 주입 → writeImage → paste → 관찰(≤3s, exec 마다 1s race — 죽은 문서의
 *               exec 는 영영 settle 하지 않는다) → **관찰 즉시 복원**(finally + 붙여넣기 뒤 5s 백스톱 타이머 — 페이지 exec 와 무관) → send 마감 15s →
 *               loadend(라우터가 settleGen({mediaId})) → 칩 검증(**id img 까지** ≤15s — busy 해제 뒤 ~2s 동안 img 가 없다, PR P1a) → 세션 캐시 기록(D6).
 *   컴포즈(D7–D9) composeReferencePlan — 정리 → 애셋 창 사전 스캔(캐시 힌트 확인, 없으면 한 번 다시 열기) → 필요한 업로드 → 정리 → 세그먼트 순서대로
 *               텍스트(execCommand insertText)·멘션(insertText('@') → 애셋 창 → 추가) → 첨부(＋ → 추가) → 게이트(한 번의 판독: 창 닫힘·바쁜 칩 없음·
 *               칩 집합·멘션 순서열(중복 포함)·텍스트 정규화·설정 요약).
 * 실패는 전부 **클릭 전**(0크레딧) — { ok:false, kind:'flow-reference-attach-failed', reason }(reason 어휘는 D14) 또는 kind 'flow-reference-clipboard-busy'.
 * 워치독이 버린 좀비(ctx.isAborted())는 클립보드·붙여넣기·클릭·exec 앞에서 멈춘다 → { ok:false, kind:'flow-settings-not-applied', reason:'dom-stage-aborted' }.
 * 로그 접두 [Flow Refs](계획·캐시·애셋 창·멘션·게이트) · [Flow Upload](클립보드·붙여넣기·maseQ) — 개수·불리언·id 앞 8자·ms 만(프롬프트·라벨·
 * 파일명·경로·클립보드 내용 없음). 진단 보고 스텝 refs:<reason> · upload:<reason>.
 *
 * ctx = { exec(js), trustedClick(js, opts), clipboard, nativeImage, paste(), pendingGenerations, cache:{get,set,delete}, projectId,
 *         isAborted(), report?(step, reason, extra) }
 * tests/electron/flow-reference-upload.test.js · tests/electron/flow-reference-compose.test.js
 */
import { armDeadline, settleGen } from './flow-rpc-router.js'
import { normalizePrompt } from './flow-rpc-protocol.js'
import { snapshotClipboard, writeUploadImage, restoreClipboard } from './flow-clipboard.js'
import {
  READ_COMPOSER_STATE_JS, LIST_ID_ASSET_MEDIA_IDS_JS, READ_PICKER_PREVIEW_MEDIA_ID_JS, FIND_ADD_MENU_TRIGGER_JS, FIND_CLEAR_PROMPT_BUTTON_JS,
  FIND_ADD_TO_PROMPT_BUTTON_JS, FIND_ASSET_ITEM_BY_MEDIA_ID_JS, FIND_PICKER_TAB_JS,
} from './flow-composer-refs.js'
import { findPromptEditor, READ_SETTINGS_SUMMARY_JS } from './flow-composer-dom.js'

const ATTACH_FAILED = 'flow-reference-attach-failed'
const CLIPBOARD_BUSY = 'flow-reference-clipboard-busy'
// 좀비 sentinel — guard 가 동기 throw, 공개 함수가 결과로 바꾼다(flow-composer-settings.js 의 DOM_STAGE_ABORTED 와 같은 방식).
const DOM_STAGE_ABORTED = Symbol('dom-stage-aborted')

export const PASTE_OBSERVE_MS = 3000
export const PASTE_RESTORE_BACKSTOP_MS = 5000
export const UPLOAD_CHIP_ID_WAIT_MS = 15000
const EXEC_RACE_MS = 1000
const OBSERVE_POLL_MS = 50
const CHIP_POLL_MS = 200
// M3-8 대기(D7·D8·D9): 창 열림·추가 뒤 자동 닫힘·@ 창 열림 ≤3s · 지우기 ≤2s · 닫기 단계(트리거·Escape)마다 ≤2s · 미리보기 ≤1s
const PICKER_OPEN_MS = 3000
const PICKER_CLOSE_STEP_MS = 2000
const ADD_CLOSE_MS = 3000
const TAB_WAIT_MS = 3000
const LIST_SETTLE_MS = 300
const PREVIEW_WAIT_MS = 1000
const CHIP_WAIT_MS = 3000
const MENTION_OPEN_MS = 3000
const CLEAR_WAIT_MS = 2000
const TEXT_PICKER_CHECK_MS = 300
const STATE_POLL_MS = 100
const UPLOAD_TAB = 'drive_folder_upload'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const short = (v) => String(v ?? '').slice(0, 8)

// ─── 페이지 주입(자기완결 · 멱등) ────────────────────────────────────────────────

/**
 * 붙여넣기 관찰 — 문서 capture 단계 paste 리스너가 카운터·대상이 편집기 안인가·clipboardData.files 수만 적는다(내용·파일명 없음).
 * preventDefault/stopPropagation 없음(페이지의 붙여넣기 처리를 그대로 둔다). 멱등 — 설치돼 있으면 상태만 돌려준다(관찰 폴도 이 문자열).
 * 문서가 바뀌면 새로 설치돼 n=0 부터 — 이전 카운터보다 커질 수 없으니 "관찰 안 됨"이 된다.
 */
export const FLOW_PASTE_OBSERVER_INJECTION = `/* __af_paste_observer__ */(function () {
  var st = window.__autoflowcut_paste_obs__;
  if (!st || typeof st !== 'object') {
    st = { n: 0, inEditor: null, files: 0 };
    window.__autoflowcut_paste_obs__ = st;
    document.addEventListener('paste', function (e) {
      var ed = document.querySelector('div.ProseMirror[contenteditable="true"]');
      var t = e.target;
      st.inEditor = !!(ed && t && (t === ed || ed.contains(t)));
      var cd = e.clipboardData;
      st.files = cd && cd.files && typeof cd.files.length === 'number' ? cd.files.length : 0;
      st.n++;
    }, true);
  }
  return { n: st.n, inEditor: st.inEditor, files: st.files };
})()`

/**
 * 텍스트 세그먼트를 캐럿 끝에 **통째로** 넣는다(D8-1) — editor.focus() + 마지막 문단 끝 접힌 선택 + execCommand('insertText').
 * M2 의 SET_EDITOR_TEXT_JS 에서 전체 선택·삭제를 뺀 것(동기 — 대기는 main 이 한다). 편집기 텍스트가 그만큼 늘었는지(공백 무시 — 줄바꿈·nbsp 변환)만 답한다.
 * '@' 한 글자도 이 스크립트로 넣는다(D8-2 — 키 이벤트 없음, 입력기 무관).
 */
export function APPEND_EDITOR_TEXT_JS(text) {
  return `/* __af_append_editor_text__ */(function (text) {
  var editor = document.querySelector('div.ProseMirror[contenteditable="true"]');
  if (!editor) return { ok: false, grew: 0 };
  var strip = function (s) { return String(s || '').replace(/[\\s\\u200b\\ufeff]/g, '') };
  var before = strip(editor.textContent).length;
  try { editor.focus() } catch (_) {}
  try {
    var paras = editor.querySelectorAll('p');
    var last = paras.length ? paras[paras.length - 1] : editor;
    var range = document.createRange();
    range.selectNodeContents(last);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) {}
  var inserted = false;
  try { inserted = document.execCommand('insertText', false, text) } catch (_) { inserted = false }
  var grew = strip(editor.textContent).length - before;
  return { ok: !!inserted && grew === strip(text).length, grew: grew };
})(${JSON.stringify(String(text))})`
}

/** 문서 body 에 합성 Escape(keyCode 27 — CDK 오버레이의 판정, M2 설정 드라이버와 같은 방식). Flow 뷰에 키 sendInputEvent 를 보내지 않는다. */
export const DISPATCH_ESCAPE_JS = `/* __af_escape__ */(function () {
  try {
    var ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true });
    ['keyCode', 'which'].forEach(function (k) { if (ev[k] !== 27) { try { Object.defineProperty(ev, k, { value: 27, configurable: true }) } catch (_) {} } });
    (document.body || document).dispatchEvent(ev);
    return true;
  } catch (_) { return false }
})()`

/** 캡처 주입의 문서 nonce(D6 캐시 키의 doc) — 없거나 모양이 틀리면 null(캐시를 안 쓴다 = 업로드). */
export const READ_RPC_DOC_JS = `(function () { var d = window.__autoflowcut_rpc_doc__; return typeof d === 'string' && /^[0-9a-f]{32}$/.test(d) ? d : null })()`

/** ＋ 창 상태 — 트리거 expanded · 항목 수 · 업로드 탭(리거처 drive_folder_upload, 정확히 하나) 'none'|'selected'|'unselected'. 문구는 보지 않는다. */
export function readPickerStatus(doc) {
  var expanded = Array.from(doc.querySelectorAll('button.add-menu-trigger')).some(function (t) { return t.getAttribute('aria-expanded') === 'true' })
  var items = doc.querySelectorAll('button.asset-item[role="option"]').length
  var tabs = Array.from(doc.querySelectorAll('[role="tab"]')).filter(function (tab) {
    return Array.from(tab.querySelectorAll("mat-icon, i, span[class*='symbols'], [class*='google-symbols']"))
      .some(function (i) { return (i.textContent || '').trim() === 'drive_folder_upload' })
  })
  var uploadTab = tabs.length !== 1 ? 'none' : (tabs[0].getAttribute('aria-selected') === 'true' ? 'selected' : 'unselected')
  return { expanded: expanded, items: items, uploadTab: uploadTab }
}

/** i 번째 칩(button.chip-container, DOM 순) — id img 가 없는 칩도 hover+클릭으로 지울 수 있게(D9). */
export function findChipAt(doc, i) {
  var chips = doc.querySelectorAll('button.chip-container')
  return chips.length > i ? chips[i] : null
}

export const READ_PICKER_STATUS_JS = `(${readPickerStatus.toString()})(document)`
export const FIND_CHIP_AT_JS = (i) => `(${findChipAt.toString()})(document, ${Number(i) || 0})`
const CARET_EDITOR_JS = `(${findPromptEditor.toString()})(document)`

// ─── 공용 ────────────────────────────────────────────────────────────────────

function guard(ctx) { if (typeof ctx.isAborted === 'function' && ctx.isAborted()) throw DOM_STAGE_ABORTED }
/** 가드된 exec — 실패(throw·reject)는 null. */
async function ex(ctx, js) {
  guard(ctx)
  try { return await ctx.exec(js) } catch (_e) { return null }
}
/** 가드된 exec + ms race(죽은 문서의 exec 는 영영 settle 하지 않는다 — H2 §5). 시간 초과는 null. */
async function raceExec(ctx, js, ms = EXEC_RACE_MS) {
  guard(ctx)
  let timer = null
  try {
    return await Promise.race([
      Promise.resolve().then(() => ctx.exec(js)).catch(() => null),
      new Promise((r) => { timer = setTimeout(() => r(null), ms) }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}
const readState = (ctx) => ex(ctx, READ_COMPOSER_STATE_JS)
const abortedResult = () => ({ ok: false, kind: 'flow-settings-not-applied', reason: 'dom-stage-aborted' })
/** 공개 함수의 catch — 좀비 sentinel 만 결과로, 나머지는 다시 던진다(버그는 드러나야 한다). */
function abortedOr(e) {
  if (e !== DOM_STAGE_ABORTED) throw e
  console.warn('[Flow Refs] aborted by the DOM-stage watchdog — no further clicks or page reads')
  return abortedResult()
}
/** 가드된 신뢰 클릭 — 실패·throw 는 {success:false}. */
async function tclick(ctx, js, step, required) {
  guard(ctx)
  try { return (await ctx.trustedClick(js, { required: !!required, step })) || { success: false } } catch (_e) { return { success: false } }
}
/** 판독 → pred 가 참이 될 때까지 ≤ms(STATE_POLL_MS 간격). 참이 된 판독 또는 null. */
async function pollJs(ctx, js, pred, ms) {
  const until = Date.now() + ms
  for (;;) {
    const v = await ex(ctx, js)
    if (v && pred(v)) return v
    if (Date.now() >= until) return null
    await sleep(STATE_POLL_MS)
  }
}
const pollState = (ctx, pred, ms) => pollJs(ctx, READ_COMPOSER_STATE_JS, pred, ms)
const refTag = (i) => `ref#${Number.isInteger(i) ? i : '?'}`

/** 실패 결과 + 로그 한 줄 + 진단 보고(기다리지 않는다 — 먹통 보고가 흐름을 막지 않게). area = 'upload' | 'refs'. */
function fail(ctx, area, reason, tag, kind = ATTACH_FAILED) {
  console.warn(`[Flow ${area === 'upload' ? 'Upload' : 'Refs'}] ${tag ? tag + ' ' : ''}failed reason=${reason}`)
  if (typeof ctx.report === 'function') {
    try { const p = ctx.report(`${area}:${reason}`, reason, {}); if (p && typeof p.catch === 'function') p.catch(() => {}) } catch (_e) { /* 진단 실패는 흐름을 막지 않는다 */ }
  }
  return kind === ATTACH_FAILED ? { ok: false, kind, reason } : { ok: false, kind }
}

// ─── M3-7 업로드 ───────────────────────────────────────────────────────────────

/** 사전 판독의 거부 사유(D4-1) — 편집기 포커스 · 애셋 창 닫힘 · 바쁜 칩 없음(busy 해제 뒤 id img 가 아직 없는 칩도 아직 올라가는 중으로 본다). */
function preUploadProblem(st) {
  if (!st || !Array.isArray(st.chips) || !st.activeInEditor) return 'focus-not-editor'
  if (st.pickerOpen) return 'picker-open'
  if (st.chips.some((c) => c.busy || !c.mediaId)) return 'chip-busy'
  return null
}

/** maseQ gen 의 실패 → reason(D4-12). */
function uploadReasonOf(gen) {
  if (gen.errorKind === 'flow-submit-not-sent') return 'upload-not-sent'
  if (gen.errorKind === 'flow-submit-lost' || gen.errorKind === 'flow-generation-cleared') return 'upload-lost'
  if (typeof gen.error === 'string' && gen.error.startsWith('rpc-shape:')) return 'upload-shape'
  return 'upload-rpc-error'
}

/** 관찰 카운터가 n0 보다 커질 때까지 ≤ PASTE_OBSERVE_MS(exec 마다 1s race). 관찰 결과 또는 null. */
async function observePaste(ctx, n0) {
  const until = Date.now() + PASTE_OBSERVE_MS
  for (;;) {
    const r = await raceExec(ctx, FLOW_PASTE_OBSERVER_INJECTION)
    if (r && typeof r.n === 'number' && r.n > n0) return r
    if (Date.now() >= until) return null
    await sleep(OBSERVE_POLL_MS)
  }
}

/**
 * loadend 뒤 칩 검증(D4-13): 모든 칩이 id img 를 갖고 바쁘지 않게 되면 판정 — 칩 수 = L0+1 이고 응답 id 의 칩이 정확히 하나여야 한다(아니면 chip-mismatch).
 *   ≤ UPLOAD_CHIP_ID_WAIT_MS 안에 그렇게 되지 않으면 chip-no-id. aria-busy="false" 만으로는 성공하지 않는다(P1a).
 */
async function waitUploadChip(ctx, mediaId, L0) {
  const t0 = Date.now()
  const until = t0 + UPLOAD_CHIP_ID_WAIT_MS
  for (;;) {
    const st = await readState(ctx)
    const chips = st && Array.isArray(st.chips) ? st.chips : null
    if (chips && chips.length > L0 && chips.every((c) => c.mediaId && !c.busy)) {
      const mine = chips.filter((c) => c.mediaId === mediaId).length
      if (chips.length === L0 + 1 && mine === 1) return { ok: true, ms: Date.now() - t0 }
      return { ok: false, reason: 'chip-mismatch' }
    }
    if (Date.now() >= until) return { ok: false, reason: 'chip-no-id' }
    await sleep(CHIP_POLL_MS)
  }
}

/**
 * 레퍼런스 이미지 하나를 편집기 붙여넣기로 올린다(D4). 호출자가 캐럿을 편집기에 둔 뒤(신뢰 클릭) 부른다 — 이 함수는 포커스를 옮기지 않는다.
 * @param {object} ctx 드라이버 ctx(파일 머리)
 * @param {{index:number, bytes:Buffer, sha:string}} ref 로컬 이미지 바이트와 그 sha256(main 이 계산)
 * @returns {Promise<{ok:true, mediaId:string} | {ok:false, kind:string, reason?:string}>}
 */
export async function uploadReferenceByPaste(ctx, ref) {
  const tag = `ref#${ref && Number.isInteger(ref.index) ? ref.index : '?'}`
  let gen = null
  let generationId = null
  const dropGen = () => {
    if (!gen) return
    settleGen(gen, { error: 'flow-generation-cleared', errorKind: 'flow-generation-cleared' })
    ctx.pendingGenerations.delete(generationId)
    gen = null
  }
  try {
    // 1. 사전 판독 — 클립보드에 손대기 전
    const st = await readState(ctx)
    const pre = preUploadProblem(st)
    if (pre) return fail(ctx, 'upload', pre, tag)
    const L0 = st.chips.length

    // 2. 클립보드 스냅샷(D4-c) — 파일 복사면 쓰지도 붙이지도 않는다
    guard(ctx)
    const saved = snapshotClipboard(ctx.clipboard)
    const bytesLen = ref && ref.bytes ? ref.bytes.length : 0
    console.log(`[Flow Upload] ${tag} bytes=${bytesLen} sha=${short(ref && ref.sha)} formats=${saved.formats} fileCopy=${saved.fileCopy}`)
    if (saved.fileCopy) return fail(ctx, 'upload', 'clipboard-busy', tag, CLIPBOARD_BUSY)

    // 3. 디코드(webp·gif 등은 범위 밖 — D2)
    let img = null
    try { img = ctx.nativeImage.createFromBuffer(ref.bytes) } catch (_e) { img = null }
    if (!img || img.isEmpty()) return fail(ctx, 'upload', 'image-decode-failed', tag)

    // 4. 업로드 gen arm — 붙여넣기 전(캡처의 send 가 바인딩할 후보). 시각은 초.
    generationId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    gen = {
      rpc: 'maseQ', doc: null, seq: null, sentAt: null, normPrompt: '', wantRatio: null, wantModelKey: null,
      results: null, error: null, errorKind: null, completed: false, allowDomFallback: false, waiter: null, deadlines: {},
      setAt: Date.now() / 1000, generationId,
    }
    const waiter = new Promise((resolve) => { gen.waiter = { resolve } })
    ctx.pendingGenerations.set(generationId, gen)

    // 5. 붙여넣기 관찰 주입 → n0
    const obs0 = await raceExec(ctx, FLOW_PASTE_OBSERVER_INJECTION)
    if (!obs0 || typeof obs0.n !== 'number') { dropGen(); return fail(ctx, 'upload', 'paste-not-observed', tag) }

    // 6–9. 쓰기 → 붙여넣기 → 관찰 → **관찰 즉시 복원**(finally · 5s 백스톱 — 관찰 실패·exec 매달림에도 반드시)
    let written = null
    let restored = false
    const restoreOnce = () => { if (restored || !written) return; restored = true; restoreClipboard(ctx.clipboard, saved, written) }
    let backstop = null
    let obs = null
    let pastedAt = 0
    try {
      guard(ctx)
      written = writeUploadImage(ctx.clipboard, img)
      guard(ctx)
      ctx.paste()
      pastedAt = Date.now()
      backstop = setTimeout(restoreOnce, PASTE_RESTORE_BACKSTOP_MS)
      obs = await observePaste(ctx, obs0.n)
      if (obs) restoreOnce()   // 관찰 즉시(노출 ≈ 수 ms, P1a) — 관찰 실패·매달림·좀비는 아래 finally·백스톱이
    } finally {
      if (backstop) clearTimeout(backstop)
      restoreOnce()
    }

    // 10. 관찰 판정
    if (!obs) { dropGen(); return fail(ctx, 'upload', 'paste-not-observed', tag) }
    const obsFiles = obs.files
    console.log(`[Flow Upload] paste observed files=${obsFiles} target=${obs.inEditor ? 'editor' : 'other'} ms=${Date.now() - pastedAt}`)
    if (!obs.inEditor) { dropGen(); return fail(ctx, 'upload', 'paste-wrong-target', tag) }

    // 11–12. send 마감(15s)은 붙여넣기 뒤 — 이미 바인딩됐으면 두지 않는다. loadend 마감(100s)은 라우터가 바인딩 때 건다.
    if (!gen.completed && gen.sentAt == null) armDeadline(gen, 'send')
    await waiter
    const done = gen
    ctx.pendingGenerations.delete(generationId)
    gen = null
    if (done.error || typeof done.mediaId !== 'string') return fail(ctx, 'upload', done.error ? uploadReasonOf(done) : 'upload-shape', tag)

    // 13. 칩 검증 — id img 까지
    const chip = await waitUploadChip(ctx, done.mediaId, L0)
    if (!chip.ok) return fail(ctx, 'upload', chip.reason, tag)
    console.log(`[Flow Upload] ${tag} uploaded media=${short(done.mediaId)} chipIdAfter=${chip.ms}`)

    // 14. 세션 캐시 — 바인딩된 maseQ gen 의 문서로(D6)
    ctx.cache.set(done.doc, ctx.projectId, ref.sha, done.mediaId)
    console.log(`[Flow Refs] cache set media=${short(done.mediaId)}`)
    return { ok: true, mediaId: done.mediaId }
  } catch (e) {
    if (e !== DOM_STAGE_ABORTED) throw e
    console.warn(`[Flow Upload] ${tag} aborted by the DOM-stage watchdog — no clipboard write or paste`)
    return abortedResult()
  } finally {
    dropGen()
  }
}

// ─── M3-8 컴포즈 ───────────────────────────────────────────────────────────────

const isEmptyComposer = (st) => st.chips.length === 0 && st.editorText === ''
const mentionCount = (st, mediaId) => st.segments.filter((x) => x.t === 'mention' && x.mediaId === mediaId).length
const endsWithAt = (st) => /@$/.test(st.editorText || '')

/** 추가 없이 닫기(D7) — 트리거 신뢰 클릭 → 닫힘 확인 → 안 닫혔으면(@ 로 연 창은 트리거로 안 닫힌다, P4) 문서 합성 Escape → 확인. 닫혔으면 true. */
async function closePickerInner(ctx) {
  const st = await readState(ctx)
  if (st && !st.pickerOpen) return true
  await tclick(ctx, FIND_ADD_MENU_TRIGGER_JS, 'refs-picker-close', false)
  if (await pollState(ctx, (s) => !s.pickerOpen, PICKER_CLOSE_STEP_MS)) return true
  await ex(ctx, DISPATCH_ESCAPE_JS)
  if (await pollState(ctx, (s) => !s.pickerOpen, PICKER_CLOSE_STEP_MS)) return true
  console.warn('[Flow Refs] asset picker still open after the trigger and Escape')
  return false
}

/** 애셋 창(＋)을 추가 없이 닫는다. 이미 닫혔으면 아무것도 하지 않는다. */
export async function closePicker(ctx) {
  try {
    return (await closePickerInner(ctx)) ? { ok: true } : fail(ctx, 'refs', 'picker-not-closed')
  } catch (e) { return abortedOr(e) }
}

/**
 * ＋ 열기(D7) — 트리거 신뢰 클릭 → ≤3s: 트리거 expanded ∧ (항목 ≥ 1 ∨ 업로드 탭 있음). 열림 흔적이 전혀 없으면(헛클릭) 1회 재클릭,
 *   흔적이 있으면 재클릭하지 않는다(토글로 닫힌다). 항목이 하나도 없는 창(새 프로젝트의 빈 목록)도 탭이 있으면 열린 것으로 본다.
 */
async function openPickerInner(ctx) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await tclick(ctx, FIND_ADD_MENU_TRIGGER_JS, 'refs-picker-open', true)
    if (await pollJs(ctx, READ_PICKER_STATUS_JS, (p) => p.expanded && (p.items > 0 || p.uploadTab !== 'none'), PICKER_OPEN_MS)) return true
    const st = await readState(ctx)
    const ps = await ex(ctx, READ_PICKER_STATUS_JS)
    if ((st && st.pickerOpen) || (ps && ps.expanded)) return false
    if (attempt === 0) console.warn('[Flow Refs] asset picker did not open — clicking the trigger once more')
  }
  return false
}

/** 업로드 탭(리거처 drive_folder_upload) — 이미 선택돼 있으면 생략, 없으면 현재 탭('all'). 'upload'|'all'. */
async function selectUploadTab(ctx) {
  const ps = await ex(ctx, READ_PICKER_STATUS_JS)
  if (!ps || ps.uploadTab === 'none') return 'all'
  if (ps.uploadTab === 'selected') return 'upload'
  await tclick(ctx, FIND_PICKER_TAB_JS(UPLOAD_TAB), 'refs-picker-tab', true)
  if (!(await pollJs(ctx, READ_PICKER_STATUS_JS, (p) => p.uploadTab === 'selected', TAB_WAIT_MS))) {
    console.warn('[Flow Refs] upload tab not selected — using the current tab')
    return 'all'
  }
  await sleep(LIST_SETTLE_MS)   // 목록 교체 대기
  return 'upload'
}

/**
 * 열린 창에서 mediaId 를 골라 추가(D7) — 업로드 탭 → 검색 오염 검사 → id 썸네일 항목(정확히 하나 — 불투명 항목은 절대 시도하지 않는다) 신뢰 클릭 →
 *   미리보기(id 가 보이면 같아야 한다, 불투명이면 건너뛴다) → 추가 신뢰 클릭 → 창이 저절로 닫힘(≤3s). 실패 사유 또는 null.
 */
async function pickFromOpenPicker(ctx, mediaId) {
  await selectUploadTab(ctx)
  const st = await readState(ctx)
  if (!st) return 'picker-not-open'
  if (st.searchDirty) return 'picker-search-dirty'
  if (!(await ex(ctx, `!!(${FIND_ASSET_ITEM_BY_MEDIA_ID_JS(mediaId)})`))) return 'asset-not-found'
  const item = await tclick(ctx, FIND_ASSET_ITEM_BY_MEDIA_ID_JS(mediaId), 'refs-asset-item', true)
  if (!item.success) return 'asset-not-found'
  let shown = null
  const until = Date.now() + PREVIEW_WAIT_MS
  for (;;) {
    shown = await ex(ctx, READ_PICKER_PREVIEW_MEDIA_ID_JS)
    if (shown === mediaId || Date.now() >= until) break
    await sleep(STATE_POLL_MS)
  }
  if (shown && shown !== mediaId) return 'preview-mismatch'
  await tclick(ctx, FIND_ADD_TO_PROMPT_BUTTON_JS, 'refs-add-to-prompt', true)
  if (!(await pollState(ctx, (s) => !s.pickerOpen, ADD_CLOSE_MS))) return 'picker-not-closed'
  return null
}

/**
 * 컴포저 정리(D9) — 창이 열려 있으면 먼저 닫는다(창이 열린 동안엔 지우기가 먹지 않는다, P2) → 칩이나 텍스트가 있으면 지우기 신뢰 클릭 →
 *   ≤2s 칩 0 ∧ 편집기 빔; 칩이 남으면 칩마다 hover+신뢰 클릭 → 그래도면 composer-not-clear.
 */
export async function clearComposer(ctx) {
  try {
    let st = await readState(ctx)
    if (st && st.pickerOpen) {
      if (!(await closePickerInner(ctx))) return fail(ctx, 'refs', 'picker-not-closed')
      st = await readState(ctx)
    }
    if (!st || !Array.isArray(st.chips)) return fail(ctx, 'refs', 'composer-not-clear')
    const chipsBefore = st.chips.length
    const lenBefore = st.editorText ? st.editorText.length : 0
    if (isEmptyComposer(st)) {
      console.log('[Flow Refs] composer clear chips=0 editorLen=0')
      return { ok: true }
    }
    await tclick(ctx, FIND_CLEAR_PROMPT_BUTTON_JS, 'refs-clear', true)
    st = (await pollState(ctx, isEmptyComposer, CLEAR_WAIT_MS)) || (await readState(ctx))
    for (let n = 0; st && st.chips.length > 0 && n <= chipsBefore; n++) {
      const left = st.chips.length
      await tclick(ctx, FIND_CHIP_AT_JS(0), 'refs-chip-remove', false)
      st = (await pollState(ctx, (s) => s.chips.length < left, CLEAR_WAIT_MS)) || (await readState(ctx))
    }
    if (!st || !isEmptyComposer(st)) return fail(ctx, 'refs', 'composer-not-clear')
    console.log(`[Flow Refs] composer clear chips=${chipsBefore}→0 editorLen=${lenBefore}→0`)
    return { ok: true }
  } catch (e) { return abortedOr(e) }
}

/**
 * 애셋 창 사전 스캔(D7) — ＋ → 업로드 탭 → id 썸네일 항목 id 수집. wantIds(세션 캐시 힌트) 중 목록에 없는 것이 있으면 닫고 **한 번 다시 열어**
 *   재수집(앱 재시작 뒤 첫 창의 누락, P5). 창을 닫고 나온다. → {ok, ids, tab:'upload'|'all', reopened:0|1}
 */
export async function scanUploadedAssets(ctx, { wantIds = [] } = {}) {
  try {
    const once = async () => {
      if (!(await openPickerInner(ctx))) return { why: 'picker-not-open' }
      const tab = await selectUploadTab(ctx)
      const st = await readState(ctx)
      if (!st) return { why: 'picker-not-open' }
      if (st.searchDirty) return { why: 'picker-search-dirty' }
      const ids = await ex(ctx, LIST_ID_ASSET_MEDIA_IDS_JS)
      return { tab, ids: Array.isArray(ids) ? ids : [] }
    }
    let r = await once()
    let reopened = 0
    if (!r.why && wantIds.some((id) => !r.ids.includes(id))) {
      if (!(await closePickerInner(ctx))) return fail(ctx, 'refs', 'picker-not-closed')
      reopened = 1
      r = await once()
    }
    const closed = await closePickerInner(ctx)
    if (r.why) return fail(ctx, 'refs', r.why)
    if (!closed) return fail(ctx, 'refs', 'picker-not-closed')
    return { ok: true, ids: r.ids, tab: r.tab, reopened }
  } catch (e) { return abortedOr(e) }
}

/** ＋ 로 첨부(D7) — 열기 → 고르기 → 추가 → 칩 id 로 확정(원하는 id 의 칩이 ≤3s 안에 있어야 한다, 아니면 chip-mismatch). 실패 정리는 추가 없이 닫기. */
export async function attachAsset(ctx, mediaId, refIndex) {
  const tag = refTag(refIndex)
  try {
    if (!(await openPickerInner(ctx))) { await closePickerInner(ctx); return fail(ctx, 'refs', 'picker-not-open', tag) }
    const why = await pickFromOpenPicker(ctx, mediaId)
    if (why) { await closePickerInner(ctx); return fail(ctx, 'refs', why, tag) }
    if (!(await pollState(ctx, (s) => s.chips.some((c) => c.mediaId === mediaId), CHIP_WAIT_MS))) return fail(ctx, 'refs', 'chip-mismatch', tag)
    console.log(`[Flow Refs] attach ${tag} media=${short(mediaId)} via=add-menu chip=ok`)
    return { ok: true }
  } catch (e) { return abortedOr(e) }
}

/**
 * 인라인 멘션(D8-2) — 캐럿 끝 insertText('@') → ≤3s: 편집기가 '@' 로 끝남 ∧ 애셋 창 열림(아니면 mention-trigger-not-working) → 고르기·추가 →
 *   검증: 끝의 '@' 가 사라지고 그 id 의 멘션 노드가 하나 늘었으며 칩 집합에 id 가 있다. 실패 정리는 추가 없이 닫기(이 창은 Escape 로만 닫힌다).
 */
export async function insertMention(ctx, mediaId, refIndex) {
  const tag = refTag(refIndex)
  try {
    const before = await readState(ctx)
    if (!before || !Array.isArray(before.segments)) return fail(ctx, 'refs', 'mention-trigger-not-working', tag)
    const n0 = mentionCount(before, mediaId)
    const put = await ex(ctx, APPEND_EDITOR_TEXT_JS('@'))
    const opened = put && put.ok ? await pollState(ctx, (s) => s.pickerOpen && endsWithAt(s), MENTION_OPEN_MS) : null
    if (!opened) { await closePickerInner(ctx); return fail(ctx, 'refs', 'mention-trigger-not-working', tag) }
    const why = await pickFromOpenPicker(ctx, mediaId)
    if (why) { await closePickerInner(ctx); return fail(ctx, 'refs', why, tag) }
    const placed = (s) => mentionCount(s, mediaId) === n0 + 1 && !endsWithAt(s)
    const after = await pollState(ctx, (s) => placed(s) && s.chips.some((c) => c.mediaId === mediaId), CHIP_WAIT_MS)
    if (!after) {
      const s = await readState(ctx)
      return fail(ctx, 'refs', s && placed(s) ? 'chip-mismatch' : 'mention-mismatch', tag)
    }
    console.log(`[Flow Refs] mention ${tag} media=${short(mediaId)} ok`)
    return { ok: true }
  } catch (e) { return abortedOr(e) }
}

/**
 * 텍스트 세그먼트(D8-1) — 통째로 넣고 늘었는지 확인 → **애셋 창이 닫혀 있어야 한다**(그 텍스트의 '@' 가 창을 열었으면 at-sign-opened-picker —
 *   렌더러는 '@' 를 미리 거르지 않는다; 단어 안·뒤에 글자가 이어지는 '@' 는 창을 열지 않는다, P4).
 */
export async function appendText(ctx, segText) {
  try {
    const s = String(segText ?? '')
    if (!s) return { ok: true }
    const r = await ex(ctx, APPEND_EDITOR_TEXT_JS(s))
    if (!r || !r.ok) return fail(ctx, 'refs', 'text-mismatch')
    if (await pollState(ctx, (st) => st.pickerOpen, TEXT_PICKER_CHECK_MS)) {
      await closePickerInner(ctx)
      return fail(ctx, 'refs', 'at-sign-opened-picker')
    }
    return { ok: true }
  } catch (e) { return abortedOr(e) }
}

/** 게이트 판정(D9) — 첫 실패 사유 또는 null. */
function gateProblem(st, summaryNow, want) {
  if (!st || !Array.isArray(st.chips) || !Array.isArray(st.segments)) return 'chip-set-mismatch'
  if (st.pickerOpen) return 'picker-open'
  if (st.chips.some((c) => c.busy)) return 'chip-busy'
  const ids = st.chips.map((c) => c.mediaId)
  const wantSet = [...new Set(want.refs)]
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length || ids.length !== wantSet.length || !wantSet.every((id) => ids.includes(id))) return 'chip-set-mismatch'
  const got = st.segments.filter((x) => x.t === 'mention').map((x) => x.mediaId)
  if (got.length !== want.mentions.length || got.some((id, i) => id !== want.mentions[i])) return 'mention-mismatch'
  const parts = st.segments.filter((x) => x.t === 'text').map((x) => x.text)
  if (normalizePrompt(parts) !== normalizePrompt(want.texts)) return 'text-mismatch'
  const a = summaryNow
  const b = want.summary
  if (!a || !b || a.text !== b.text || JSON.stringify(a.ligatures || []) !== JSON.stringify(b.ligatures || [])) return 'summary-changed'
  return null
}

/**
 * 클릭 전 게이트(D9) — 한 번의 READ_COMPOSER_STATE_JS(+ 닫힌 설정 요약): (1) 애셋 창 닫힘 (2) 바쁜 칩 없음 (3) 칩 id 에 null·중복 없음, 집합 == refs
 *   (4) 멘션 id 순서열 == mentions(중복 포함 — 같은 미디어 두 번 멘션, PR §4) (5) 멘션 노드를 뺀 텍스트의 normalizePrompt == normalizePrompt(texts)
 *   — 공백 압축이 멘션 뒤 자동 공백(P3)을 흡수한다 (6) 설정 요약 == summary. 통과 → editorExpected = normalizePrompt(편집기 텍스트, 라벨 포함).
 * @param {{refs:string[], mentions:string[], texts:string[], summary:{text:string, ligatures:string[]}}} want
 */
export async function readGate(ctx, { refs = [], mentions = [], texts = [], summary = null } = {}) {
  try {
    const st = await readState(ctx)
    const summaryNow = await ex(ctx, READ_SETTINGS_SUMMARY_JS)
    const why = gateProblem(st, summaryNow, { refs, mentions, texts, summary })
    const nChips = st && Array.isArray(st.chips) ? st.chips.length : 0
    const nMentions = st && Array.isArray(st.segments) ? st.segments.filter((x) => x.t === 'mention').length : 0
    if (why) {
      console.warn(`[Flow Refs] gate chips=${nChips} mentions=${nMentions} ok=false`)
      return fail(ctx, 'refs', why)
    }
    console.log(`[Flow Refs] gate chips=${nChips} mentions=${nMentions} text=ok summary=same ok=true`)
    return { ok: true, editorExpected: normalizePrompt(st.editorText || '') }
  } catch (e) { return abortedOr(e) }
}

/**
 * 레퍼런스 계획 전체(D9 순서): 정리 → 사전 스캔(캐시 힌트 확인) → 필요한 업로드(캐럿 신뢰 클릭 → uploadReferenceByPaste) → 정리 →
 *   세그먼트 순서대로 텍스트/멘션 → 첨부 ref 마다 ＋ 추가 → 게이트. 설정 요약은 시작 때(설정 단계 직후) 읽어 게이트가 비교한다.
 *   같은 sha 의 ref 는 한 번만 올린다. 컴포즈 도중 원하는 id 가 안 보이면(사전 스캔 뒤라 드물다) 재업로드하지 않고 asset-not-found + 캐시 항목 삭제.
 * @param {{refs:Array<{bytes:Buffer, sha:string}>, plan:{segments:Array<{t:'text', text:string}|{t:'mention', ref:number}>, attach:number[]}}} input
 * @returns {Promise<{ok:true, expectedRefs:string[], expectedMentions:string[], normPrompt:string, editorExpected:string} | {ok:false, kind, reason?}>}
 */
export async function composeReferencePlan(ctx, { refs = [], plan = {} } = {}) {
  try {
    const segs = plan && Array.isArray(plan.segments) ? plan.segments : null
    const attach = plan && Array.isArray(plan.attach) ? plan.attach : null
    const refList = Array.isArray(refs) ? refs : []
    const badIdx = (i) => !Number.isInteger(i) || i < 0 || i >= refList.length
    const badSeg = (x) => !x || (x.t === 'mention' ? badIdx(x.ref) : x.t !== 'text' || typeof x.text !== 'string')
    if (!segs || !attach || segs.some(badSeg) || attach.some(badIdx) || refList.some((x) => !x || typeof x.sha !== 'string')) return fail(ctx, 'refs', 'bad-plan')

    const summary = await ex(ctx, READ_SETTINGS_SUMMARY_JS)
    const docRaw = await ex(ctx, READ_RPC_DOC_JS)
    const doc = typeof docRaw === 'string' && /^[0-9a-f]{32}$/.test(docRaw) ? docRaw : null

    let r = await clearComposer(ctx)
    if (!r.ok) return r

    // 사전 스캔 — 캐시(힌트)의 id 가 이번 세션 목록에 id 썸네일로 있어야 재사용한다
    const firstOfSha = new Map()
    refList.forEach((x, i) => { if (!firstOfSha.has(x.sha)) firstOfSha.set(x.sha, i) })
    const shas = [...firstOfSha.keys()]
    const cached = new Map()
    for (const s of shas) { const id = doc ? ctx.cache.get(doc, ctx.projectId, s) : null; if (id) cached.set(s, id) }
    const scan = await scanUploadedAssets(ctx, { wantIds: [...cached.values()] })
    if (!scan.ok) return scan
    const mediaOf = new Map()
    for (const s of shas) {
      const id = cached.get(s)
      if (id && scan.ids.includes(id)) mediaOf.set(s, id)
      else if (id) ctx.cache.delete(doc, ctx.projectId, s)
    }
    const toUpload = shas.filter((s) => !mediaOf.has(s))
    console.log(`[Flow Refs] assets scan tab=${scan.tab} idItems=${scan.ids.length} cached=${cached.size} found=${mediaOf.size} missing=${toUpload.length} reopened=${scan.reopened}`)

    // 필요한 업로드(직렬) → 정리
    for (const s of toUpload) {
      const i = firstOfSha.get(s)
      const caret = await tclick(ctx, CARET_EDITOR_JS, 'refs-caret', true)
      if (!caret.success) return fail(ctx, 'upload', 'focus-not-editor', refTag(i))
      const up = await uploadReferenceByPaste(ctx, { index: i, bytes: refList[i].bytes, sha: s })
      if (!up.ok) return up
      mediaOf.set(s, up.mediaId)
    }
    if (toUpload.length) {
      r = await clearComposer(ctx)
      if (!r.ok) return r
    }

    // 세그먼트 순서대로 → 첨부 → 게이트
    const idOf = (i) => mediaOf.get(refList[i].sha)
    const forgetIfMissing = (res, i) => { if (res.reason === 'asset-not-found') ctx.cache.delete(doc, ctx.projectId, refList[i].sha) }
    const texts = []
    const expectedMentions = []
    for (const x of segs) {
      if (x.t === 'text') {
        texts.push(x.text)
        r = await appendText(ctx, x.text)
      } else {
        expectedMentions.push(idOf(x.ref))
        r = await insertMention(ctx, idOf(x.ref), x.ref)
        if (!r.ok) forgetIfMissing(r, x.ref)
      }
      if (!r.ok) return r
    }
    for (const i of attach) {
      r = await attachAsset(ctx, idOf(i), i)
      if (!r.ok) { forgetIfMissing(r, i); return r }
    }
    const expectedRefs = [...new Set(refList.map((x) => mediaOf.get(x.sha)))]
    const gate = await readGate(ctx, { refs: expectedRefs, mentions: expectedMentions, texts, summary })
    if (!gate.ok) return gate
    return { ok: true, expectedRefs, expectedMentions, normPrompt: normalizePrompt(texts), editorExpected: gate.editorExpected }
  } catch (e) { return abortedOr(e) }
}
