/**
 * 새 Flow(flow.google.com, Angular) 동영상 업스케일 다운로드 — 미디어 편집 화면의 "미디어 다운로드" 메뉴 → 1080p/4K.
 *
 * 배경: M1/M2(R1#7)는 옛 Radix 다운로드 메뉴 코드가 새 Flow 에서 도달 불가라 보고 `dom-download-video` 를 막았다. 그 뒤로 완료 폴(as29s)의
 *   서명 URL(720p 원본)만 받아 업스케일이 통째로 빠졌다. 2026-10-19 라이브 확인:
 *   - 그리드 타일은 hover 전 미리보기 src(flow.google.com/asb/<token>=mm,…)라 mediaId 로 타일을 찾을 수 없다(hover 해도 그대로).
 *   - as29s 기록은 [mediaId, projectId, editId, …] — 타일을 누르면 열리는 편집 화면이 /project/<projectId>/edit/<editId> 다.
 *   - 편집 화면 상단(cta-buttons)의 download 메뉴 트리거가 해상도 목록 "270p … / 720p … / 1080p … / 4K …"를 바로 연다(플랜 밖이면 disabled).
 *   - Angular 라우터는 history.pushState + popstate 로 페이지 안에서 이동한다(새로고침 없음 — 캡처 주입이 그대로 남는다).
 *
 * 프로브는 Flow 의 번역 문구가 아니라 아이콘 글자(download)·위치(cta-buttons, hotbar 아님)·해상도 숫자로만 찾는다(noLocaleBoundDomAnchors).
 * 프로브 함수는 executeJavaScript 로 문자열화돼 들어가므로 자기완결이어야 한다(함수 선언끼리만 서로 부른다 — PROBE_LIB 로 함께 싣는다).
 */
import path from 'node:path'
import { DISPATCH_ESCAPE_JS } from './flow-reference-driver.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

function editorReady(doc, wantPath) {
  return doc.location.pathname === wantPath && !!findEditorDownloadTrigger(doc)
}

const PROBE_LIB = [iconText, findEditorDownloadTrigger, resolutionOf, isDisabledItem, resolutionPanel, readResolutionItems,
  findResolutionItem, editorReady].map((f) => f.toString()).join('\n')
const probe = (call) => `(function () {\n${PROBE_LIB}\nreturn ${call};\n})()`

export const PAGE_PATH_JS = '(function () { return location.pathname })()'
/** 페이지 안 이동 — Angular 라우터는 popstate 를 듣는다(새로고침 없음). */
export const NAVIGATE_JS = (p) => `(function () {
  history.pushState(history.state, '', ${JSON.stringify(String(p))});
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  return location.pathname;
})()`
export const EDITOR_READY_JS = (p) => probe(`editorReady(document, ${JSON.stringify(String(p))})`)
export const EDITOR_DOWNLOAD_TRIGGER_JS = probe('findEditorDownloadTrigger(document)')
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

async function ex(ctx, js) {
  try { return await ctx.exec(js) } catch (_e) { return null }
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
 * ctx = { exec(js), trustedClick(js, {required, step}), isAborted?(), sleep?(ms) }
 * @returns {Promise<{ok:true, res:string, downgradedFrom?:string} | {ok:false, kind:string, reason:string}>}
 */
export async function driveEditorDownload(ctx, { path: editPath, resolution }) {
  const aborted = () => ({ ok: false, kind: 'flow-download-aborted', reason: 'dom-stage-aborted' })
  await ex(ctx, NAVIGATE_JS(editPath))
  if (!(await poll(ctx, EDITOR_READY_JS(editPath), (v) => v === true, EDITOR_WAIT_MS))) {
    return ctx.isAborted?.() ? aborted() : { ok: false, kind: 'flow-download-editor-not-ready', reason: 'editor-not-ready' }
  }
  const menu = await tclick(ctx, EDITOR_DOWNLOAD_TRIGGER_JS, 'download-menu')
  if (!menu.success) return failClose(ctx, 'flow-download-menu-failed', 'menu-trigger:' + (menu.error || 'click-failed'))
  const items = await poll(ctx, READ_RESOLUTION_ITEMS_JS, (v) => Array.isArray(v) && v.length > 0, MENU_WAIT_MS)
  if (!items) return ctx.isAborted?.() ? aborted() : failClose(ctx, 'flow-download-menu-failed', 'menu-not-open')

  const pick = pickResolution(items, resolution)
  if (!pick) return failClose(ctx, 'flow-upscale-unavailable', 'no-enabled-upscale:' + String(resolution), { items })
  if (ctx.isAborted?.()) return failClose(ctx, 'flow-download-aborted', 'dom-stage-aborted')
  const c = await tclick(ctx, RESOLUTION_ITEM_JS(pick.res), 'download-resolution')
  if (!c.success) return failClose(ctx, 'flow-download-menu-failed', 'resolution-click:' + (c.error || 'click-failed'))
  return pick.downgradedFrom ? { ok: true, res: pick.res, downgradedFrom: pick.downgradedFrom } : { ok: true, res: pick.res }
}

/** 다운로드를 시작한 화면으로 돌아간다(이미 거기면 그대로). 경로가 맞으면 true. */
export async function returnToPath(ctx, backPath) {
  if (!backPath) return false
  if ((await ex(ctx, PAGE_PATH_JS)) === backPath) return true
  await ex(ctx, NAVIGATE_JS(backPath))
  return !!(await poll(ctx, PAGE_PATH_JS, (v) => v === backPath, RETURN_WAIT_MS))
}

/**
 * will-download 가 내려받는 파일이 다 쓰일 때까지(크기가 한 번 더 같은 값) 기다린다. 진행 중 파일(.crdownload·.tmp·.part)과 점파일은 무시.
 * 업스케일은 클릭 뒤 Flow 가 서버에서 처리한 다음 내려보내므로 오래 걸릴 수 있다(VIDEO_DOWNLOAD_TIMEOUT_MS).
 * @returns {Promise<string|null>} 파일 경로, 시간 초과·중단이면 null
 */
export async function waitForDownloadedFile({ dir, fs, timeoutMs, pollMs = 1000, isAborted, sleep = defaultSleep }) {
  const until = Date.now() + timeoutMs
  let last = null
  while (Date.now() < until) {
    if (isAborted?.()) return null
    let names = []
    try { names = fs.readdirSync(dir) } catch (_e) { names = [] }
    const done = names.filter((n) => !n.startsWith('.') && !/\.(crdownload|tmp|part)$/i.test(n))
    if (done.length) {
      const f = path.join(dir, done[0])
      let size = 0
      try { size = fs.statSync(f).size } catch (_e) { size = 0 }
      if (size > 0 && last && last.f === f && last.size === size) return f
      last = { f, size }
    }
    await sleep(pollMs)
  }
  return null
}
