/**
 * 새 Flow(flow.google.com, Angular) 동영상 업스케일 다운로드 — 미디어 편집 화면의 "미디어 다운로드" 메뉴 → 1080p/4K.
 *
 * 배경: M1/M2(R1#7)는 옛 Radix 다운로드 메뉴 코드가 새 Flow 에서 도달 불가라 보고 `dom-download-video` 를 막았다. 그 뒤로 완료 폴(as29s)의
 *   서명 URL(720p 원본)만 받아 업스케일이 통째로 빠졌다. 2026-10-19 라이브 확인:
 *   - 그리드 타일은 hover 전 미리보기 src(flow.google.com/asb/<token>=mm,…)라 mediaId 로 타일을 찾을 수 없다(hover 해도 그대로).
 *   - as29s 기록은 [mediaId, projectId, editId, …] — 타일을 누르면 열리는 편집 화면이 /project/<projectId>/edit/<editId> 다.
 *   - 편집 화면 상단(cta-buttons)의 download 메뉴 트리거가 해상도 목록 "270p … / 720p … / 1080p … / 4K …"를 바로 연다(플랜 밖이면 disabled).
 *   - Angular 라우터는 history.replaceState + popstate 로 페이지 안에서 이동한다(새로고침 없음 — 캡처 주입이 그대로 남는다).
 *
 * 프로브는 Flow 의 번역 문구가 아니라 아이콘 글자(download)·위치(cta-buttons, hotbar 아님)·해상도 숫자로만 찾는다(noLocaleBoundDomAnchors).
 * 프로브 함수는 executeJavaScript 로 문자열화돼 들어가므로 자기완결이어야 한다(함수 선언끼리만 서로 부른다 — PROBE_LIB 로 함께 싣는다).
 */
import path from 'node:path'
import { DISPATCH_ESCAPE_JS } from './flow-reference-driver.js'

/** Flow 미디어·프로젝트·편집 id 모양(flow-angular 도 이걸 쓴다). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** as29s 기록 → 편집 화면 위치. 그 mediaId 의 기록이 아니거나 id 모양이 틀리면 null. */
export function mediaEditLocation(record, mediaId) {
  if (!Array.isArray(record) || record[0] !== mediaId) return null
  const [, projectId, editId] = record
  return UUID_RE.test(String(projectId || '')) && UUID_RE.test(String(editId || '')) ? { projectId, editId } : null
}

export const editorPath = ({ projectId, editId }) => `/project/${projectId}/edit/${editId}`

function iconText(el) {
  var i = el && el.querySelector('mat-icon')
  return i ? String(i.textContent || '').trim() : ''
}

/** 편집 화면 상단의 다운로드 메뉴 트리거 — 타임라인 hotbar 의 같은 아이콘 버튼(flowhotbarbutton)은 제외. */
export function findEditorDownloadTrigger(doc) {
  var btns = doc.querySelectorAll('button[aria-haspopup="menu"]')
  for (var i = 0; i < btns.length; i++) {
    var b = btns[i]
    if (b.hasAttribute('flowhotbarbutton')) continue
    if (iconText(b) === 'download' && b.closest('[cta-buttons-content-marker], .cta-buttons')) return b
  }
  return null
}

function resolutionOf(el) {
  var t = String(el.textContent || '').trim()
  var m = /^(\d{3,4})\s*p\b/i.exec(t)
  if (m) return m[1] + 'p'
  if (/^4\s*k\b/i.test(t)) return '4k'
  return null
}

function isDisabledItem(el) {
  return el.disabled === true || el.getAttribute('disabled') === 'true' || el.getAttribute('aria-disabled') === 'true' ||
    el.classList.contains('mat-mdc-menu-item-disabled')
}

/** 열린 해상도 메뉴 패널 — 트리거의 aria-controls 가 우선, 없으면 해상도 항목이 둘 이상인 메뉴 패널. */
function resolutionPanel(doc) {
  var trig = findEditorDownloadTrigger(doc)
  var id = trig && trig.getAttribute('aria-expanded') === 'true' && trig.getAttribute('aria-controls')
  if (id) {
    var p = doc.getElementById(id)
    if (p) return p
  }
  var panels = doc.querySelectorAll('[role="menu"]')
  for (var i = 0; i < panels.length; i++) {
    var n = 0
    var items = panels[i].querySelectorAll('[role="menuitem"]')
    for (var j = 0; j < items.length; j++) if (resolutionOf(items[j])) n++
    if (n >= 2) return panels[i]
  }
  return null
}

export function readResolutionItems(doc) {
  var p = resolutionPanel(doc)
  if (!p) return []
  var out = []
  var items = p.querySelectorAll('[role="menuitem"]')
  for (var i = 0; i < items.length; i++) {
    var res = resolutionOf(items[i])
    if (res) out.push({ res: res, disabled: isDisabledItem(items[i]) })
  }
  return out
}

export function findResolutionItem(doc, res) {
  var p = resolutionPanel(doc)
  if (!p) return null
  var items = p.querySelectorAll('[role="menuitem"]')
  for (var i = 0; i < items.length; i++) if (resolutionOf(items[i]) === res) return items[i]
  return null
}

/** 편집 화면 머리말의 미디어 제목(Flow 가 붙인 이름) — 다운로드 파일 이름이 이걸로 시작한다. 편집 화면이 아니면 null. */
function editorTitle(doc) {
  if (!/\/edit\//.test(String(doc.location && doc.location.pathname))) return null
  var h = doc.querySelector('.header-title-heading[role="heading"]')
  var t = h ? String(h.textContent || '').trim() : ''
  return t || null
}

function editorReady(doc, wantPath) {
  return doc.location.pathname === wantPath && !!findEditorDownloadTrigger(doc)
}

const PROBE_LIB = [iconText, findEditorDownloadTrigger, resolutionOf, isDisabledItem, resolutionPanel, readResolutionItems,
  findResolutionItem, editorTitle, editorReady].map((f) => f.toString()).join('\n')
const probe = (call) => `(function () {\n${PROBE_LIB}\nreturn ${call};\n})()`

export const PAGE_PATH_JS = '(function () { return location.pathname })()'
/** 페이지 안 이동 — Angular 라우터는 popstate 를 듣는다(새로고침 없음). replaceState 라 기록이 늘지 않는다 — 뒤로 가기가 임시 편집 화면을 다시 열지 않게(Codex R1 #4). */
export const NAVIGATE_JS = (p) => `(function () {
  history.replaceState(history.state, '', ${JSON.stringify(String(p))});
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  return location.pathname;
})()`
/** 아직 그 편집 화면이면 back 으로 — 비교와 이동을 한 스크립트에서(사이에 사용자가 옮길 틈이 없다, Codex R2 #4). */
export const RETURN_IF_ON_JS = (editPath, back) => `(function () {
  if (location.pathname !== ${JSON.stringify(String(editPath))}) return 'user-moved';
  history.replaceState(history.state, '', ${JSON.stringify(String(back))});
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  return 'navigated';
})()`
export const EDITOR_READY_JS = (p) => probe(`editorReady(document, ${JSON.stringify(String(p))})`)
export const EDITOR_DOWNLOAD_TRIGGER_JS = probe('findEditorDownloadTrigger(document)')
export const EDITOR_TITLE_JS = probe('editorTitle(document)')
export const READ_RESOLUTION_ITEMS_JS = probe('readResolutionItems(document)')
export const RESOLUTION_ITEM_JS = (res) => probe(`findResolutionItem(document, ${JSON.stringify(String(res))})`)

/**
 * 받을 해상도 고르기. 요청 해상도가 열려 있으면 그것, 4K 가 막혀 있으면 1080p 로 내린다(사용자 결정 2026-10-19).
 * 요청 이하에 열린 업스케일이 없으면 null(호출자가 서명 URL 원본으로 물러난다).
 */
export function pickResolution(items, requested) {
  const want = String(requested || '').toLowerCase()
  const enabled = (r) => (items || []).some((i) => i.res === r && !i.disabled)
  if (want === '4k') {
    if (enabled('4k')) return { res: '4k' }
    if (enabled('1080p')) return { res: '1080p', downgradedFrom: '4k' }
    return null
  }
  if (want === '1080p' || want === '720p') return enabled(want) ? { res: want } : null
  return null
}

/** 편집 화면이 그려질 때까지 · 메뉴가 열릴 때까지 · 되돌아간 경로가 맞을 때까지의 한도. */
const EDITOR_WAIT_MS = 10000
const MENU_WAIT_MS = 3000
const RETURN_WAIT_MS = 5000
const POLL_MS = 100
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 죽은 문서의 exec 는 영영 settle 하지 않는다 — 시간 한도 안에 못 받으면 null(Fable #6, flow-reference-driver 의 raceExec 와 같은 규칙). */
const EXEC_RACE_MS = 5000
async function ex(ctx, js) {
  let timer = null
  try {
    return await Promise.race([
      Promise.resolve().then(() => ctx.exec(js)).catch(() => null),
      new Promise((r) => { timer = setTimeout(() => r(null), EXEC_RACE_MS) }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}
async function tclick(ctx, js, step) {
  try { return (await ctx.trustedClick(js, { required: true, step })) || { success: false } } catch (e) { return { success: false, error: e?.message || String(e) } }
}
async function poll(ctx, js, pred, ms) {
  const sleep = ctx.sleep || defaultSleep
  for (let i = 0, n = Math.ceil(ms / POLL_MS); i <= n; i++) {
    if (ctx.isAborted?.()) return null
    const v = await ex(ctx, js)
    if (pred(v)) return v
    await sleep(POLL_MS)
  }
  return null
}
/** 열린 메뉴를 닫고 실패 결과. */
async function failClose(ctx, kind, reason, extra) {
  await ex(ctx, DISPATCH_ESCAPE_JS)
  return { ok: false, kind, reason, ...(extra || {}) }
}

/**
 * 편집 화면으로 가서 해상도를 누른다. 파일 가로채기(will-download)는 이 함수 전에 걸려 있어야 하고, 파일 대기와 원래 화면으로
 *   돌아가기(returnToPath)는 호출자가 한다 — 업스케일이 끝나 Flow 가 파일을 내려보낼 때까지 편집 화면에 머문다.
 * ctx = { exec(js), trustedClick(js, {required, step}), beforeResolutionClick?(res), isAborted?(), sleep?(ms) }
 * @returns {Promise<{ok:true, res:string, downgradedFrom?:string} | {ok:false, kind:string, reason:string}>}
 */
export async function driveEditorDownload(ctx, { path: editPath, resolution }) {
  const aborted = () => ({ ok: false, kind: 'flow-download-aborted', reason: 'dom-stage-aborted' })
  await ex(ctx, NAVIGATE_JS(editPath))
  if (!(await poll(ctx, EDITOR_READY_JS(editPath), (v) => v === true, EDITOR_WAIT_MS))) {
    return ctx.isAborted?.() ? aborted() : { ok: false, kind: 'flow-download-editor-not-ready', reason: 'editor-not-ready' }
  }
  // 편집 화면이 막 그려진 직후엔 버튼이 보여도 첫 클릭이 메뉴를 못 열 때가 있다(2026-10-19 라이브: 앱 재시작 직후) — 한 번 더 누른다.
  let items = null
  for (let attempt = 1; attempt <= 2 && !items; attempt++) {
    const menu = await tclick(ctx, EDITOR_DOWNLOAD_TRIGGER_JS, 'download-menu')
    if (!menu.success) return failClose(ctx, 'flow-download-menu-failed', 'menu-trigger:' + (menu.error || 'click-failed'))
    items = await poll(ctx, READ_RESOLUTION_ITEMS_JS, (v) => Array.isArray(v) && v.length > 0, MENU_WAIT_MS)
    if (ctx.isAborted?.()) return aborted()
  }
  if (!items) return failClose(ctx, 'flow-download-menu-failed', 'menu-not-open')

  const pick = pickResolution(items, resolution)
  if (!pick) return failClose(ctx, 'flow-upscale-unavailable', 'no-enabled-upscale:' + String(resolution), { items })
  if (ctx.isAborted?.()) return failClose(ctx, 'flow-download-aborted', 'dom-stage-aborted')
  // 호출자가 이 시점에 다운로드 가로채기를 건다(클릭 직전 — 열어 두는 창을 짧게, 파일 이름 대조용 해상도와 함께).
  await ctx.beforeResolutionClick?.(pick.res)
  const c = await tclick(ctx, RESOLUTION_ITEM_JS(pick.res), 'download-resolution')
  // 클릭이 이미 나갔으면(mouseDown 뒤 응답 시간 초과) 업스케일은 시작됐을 수 있다 — 실패로 접지 말고 파일을 기다린다(Fable R2 #3).
  if (!c.success && !c.dispatched) return failClose(ctx, 'flow-download-menu-failed', 'resolution-click:' + (c.error || 'click-failed'))
  return pick.downgradedFrom ? { ok: true, res: pick.res, downgradedFrom: pick.downgradedFrom } : { ok: true, res: pick.res }
}

/**
 * 아직 편집 화면에 있으면 다운로드를 시작한 화면으로 돌아간다. 그 사이 사용자가 다른 화면으로 갔으면 그대로 둔다(Codex R1 #2 · R2 #4).
 *   그 편집 화면에서 시작했으면 머문다(R2 #3). DOM 단계가 워치독에 끊긴 뒤(좀비)엔 아무것도 안 한다(Fable #6).
 * @returns {Promise<'returned'|'user-moved'|'aborted'|'failed'>}
 */
export async function returnIfStillOn(ctx, { editPath, back }) {
  if (ctx.isAborted?.()) return 'aborted'
  if (back === editPath) return 'returned'
  const r = await ex(ctx, RETURN_IF_ON_JS(editPath, back))
  if (r === 'user-moved') return 'user-moved'
  return (await poll(ctx, PAGE_PATH_JS, (v) => v === back, RETURN_WAIT_MS)) ? 'returned' : 'failed'
}

/** Flow 가 내려보내는 다운로드의 출처 — 페이지가 만든 blob/data, 또는 Flow·Google 미디어 호스트. 그 밖의 호스트는 사용자 것(Codex R2 #1). */
function isFlowDownloadUrl(url) {
  if (!url) return true
  if (/^(blob|data):/i.test(url)) return true
  let host = ''
  try { host = new URL(url).hostname } catch (_e) { return false }
  return /(^|\.)(flow\.google\.com|labs\.google|flow-content\.google|googleusercontent\.com|storage\.googleapis\.com)$/i.test(host)
}

const hostOf = (url) => { if (/^(blob|data):/i.test(url)) return url.slice(0, url.indexOf(':')); try { return new URL(url).hostname } catch (_e) { return '' } }
/** 대조용 정규화 — 대소문자·기호·공백을 버린 글자와 숫자만. */
const normName = (v) => String(v || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '')
/** 파일 이름 속 해상도 표시(…_1080p_… / …_4k_…). 없으면 null. */
const resToken = (name) => { const m = /(?:^|[^a-z0-9])(270p|360p|720p|1080p|4k)(?:[^a-z0-9]|$)/i.exec(String(name || '')); return m ? m[1].toLowerCase() : null }
/** 긴 제목은 파일 이름에서 잘릴 수 있다 — 앞쪽만 맞춘다. */
const TITLE_PREFIX_CHARS = 16

let activeCaptures = 0
let captureWaiters = []
/**
 * 업스케일 다운로드가 진행 중인가(가로채기를 건 뒤 dispose 까지 — 파일 대기와 원래 화면으로 돌아가기 포함). 그동안 Flow 페이지를
 *   옮기면(loadURL·편집 화면 이탈) 파일을 내보낼 페이지가 사라진다(Fable R2 #1 · 2026-10-19 라이브).
 */
export const isVideoCapturePending = () => activeCaptures > 0
/** 진행 중인 업스케일 다운로드가 모두 끝날 때까지(최대 maxMs). 끝났으면 true, 한도면 false. */
export function waitForVideoCaptures(maxMs) {
  if (activeCaptures === 0) return Promise.resolve(true)
  return new Promise((resolve) => {
    const waiter = (v) => { clearTimeout(timer); resolve(v) }
    const timer = setTimeout(() => { captureWaiters = captureWaiters.filter((w) => w !== waiter); resolve(false) }, maxMs)
    captureWaiters.push(waiter)
  })
}
function releaseCapture() {
  activeCaptures--
  if (activeCaptures === 0) { const ws = captureWaiters; captureWaiters = []; ws.forEach((w) => w(true)) }
}

/**
 * 공유 session 의 다음 Flow *동영상* 다운로드 하나만 dir 로 가로챈다(Codex R1 #1 · R2 #1). 동영상이 아니거나 Flow 밖 호스트의 다운로드는
 *   건드리지 않고(평소대로), 하나를 잡으면 즉시 리스너를 뗀다. 해상도 클릭 직전에 건다(Fable #7 — 열어 두는 창을 짧게).
 *   완료는 폴더 폴링이 아니라 그 DownloadItem 의 'done' 으로 안다. 끝나지 않은 채 정리되면(시간 초과 포함) 취소한다(Fable #3).
 *   title·res 가 있으면 파일 이름(<제목>_<해상도>_<시각>.mp4)이 맞는 것만 잡는다(Codex R3 #1).
 * @returns {{ wait: () => Promise<{path:string}|{error:string}>, dispose: () => void }}
 */
export function armVideoDownloadCapture(session, dir, { timeoutMs, title = null, res = null, onIgnored = null }) {
  let settle
  const done = new Promise((r) => { settle = r })
  let captured = null
  let itemDone = false
  let finished = false
  activeCaptures++
  let released = false
  const finish = (v) => { if (!finished) { finished = true; settle(v) } }
  const wantTitle = normName(title).slice(0, TITLE_PREFIX_CHARS)
  const onWillDownload = (_e, item) => {
    if (captured) return
    const name = String((item.getFilename && item.getFilename()) || '')
    const mime = String((item.getMimeType && item.getMimeType()) || '')
    const url = String((item.getURL && item.getURL()) || '')
    const skip = (reason) => { try { onIgnored?.({ reason, name, mime, host: hostOf(url) }) } catch (_e) { /* 진단은 흐름을 막지 않는다 */ } }
    if (!/^video\//i.test(mime) && !/\.(mp4|webm|mov)$/i.test(name)) return skip('not-video')
    if (!isFlowDownloadUrl(url)) return skip('host')
    // 이 미디어·이 해상도의 파일인지 — Flow 는 "<제목>_<해상도>_<시각>.mp4" 로 내려보낸다(2026-10-19 라이브). 사용자가 받은 다른 영상은 그대로 둔다(Codex R3 #1).
    const tok = resToken(name)
    if (res && tok && tok !== String(res).toLowerCase()) return skip('resolution')
    if (wantTitle && !normName(name).startsWith(wantTitle)) return skip('title')
    captured = item
    const savePath = path.join(dir, path.basename(name) || 'flow-video.mp4')
    item.setSavePath(savePath)
    session.off('will-download', onWillDownload)
    item.once('done', (_ev, state) => {
      itemDone = true
      finish(state === 'completed' ? { path: savePath } : { error: 'download-' + String(state) })
    })
  }
  session.on('will-download', onWillDownload)
  const timer = setTimeout(() => finish({ error: 'timeout' }), timeoutMs)
  return {
    wait: () => done,
    dispose: () => {
      clearTimeout(timer)
      session.off('will-download', onWillDownload)
      if (captured && !itemDone) { try { captured.cancel() } catch (_e) { /* 이미 끝났을 수 있다 */ } }
      finish({ error: 'disposed' })
      if (!released) { released = true; releaseCapture() }
    },
  }
}
