// M3(레퍼런스) 테스트 공용 가짜 — 계획서 docs/plans/2026-09-25-flow-M3-references-plan.md §4 "가짜 페이지".
//
// (1) 가짜 Electron clipboard·nativeImage(electron/flow-clipboard.js · flow-reference-driver.js).
//   clipboard 는 Electron API 의 부분집합(availableFormats·readText·readHTML·readRTF·readImage·writeImage·writeText·write·clear)이고 호출을 calls 에 적는다.
//   formats 는 명시 목록(앱 전용 형식 application/x-lexical-editor · Finder 파일 복사 text/uri-list 를 그대로 싣는다 — PR P1d).
//   nativeImage.createFromBuffer 는 PNG·JPEG 서명만 디코드된 것으로 본다(그 밖은 isEmpty — image-decode-failed 케이스).
// (2) createFakeFlowComposer — jsdom 문서(JSDOM, runScripts outside-only)에 칩 바·편집기·애셋 창을 그리고 **프로브에서 본 대로** 동작한다(PR P1–P5).
//   드라이버의 페이지 스크립트는 exec(js) 로 이 문서의 window.eval 에서 **실제로** 돈다. 신뢰 클릭 가짜는 표현식이 돌려준 요소에 mousemove(hover)·click 을 보낸다.
// (3) makeRefDriverHarness — 가짜 페이지 + 가짜 클립보드 + **실제** 라우터 ctx(routeReportResponse·buildReportCtx) + maseQ send/loadend 예약 + 드라이버 ctx.
//   파일 로더(flow-m3-samples.js)가 fs·file URL 을 쓰므로 이 헬퍼를 쓰는 테스트는 `@vitest-environment node` 다(jsdom 환경의 URL 은 file 스킴을 못 푼다).
import { JSDOM } from 'jsdom'
import { buildComposer, buildAssetPicker, chipHtml, mentionHtml, EMPTY_EDITOR, uuid } from '../fixtures/flow-live-dom-m3.js'
import { routeReportResponse, buildReportCtx } from '../../electron/reportResponseRouter.js'
import { refMediaCache } from '../../electron/flow-ref-media-cache.js'
import { READ_COMPOSER_STATE_JS } from '../../electron/flow-composer-refs.js'
import { s3Payload } from '../fixtures/flow-m3-samples.js'
import { respBodyWithPayload } from '../fixtures/flow-batchexecute-samples.js'

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47]
const JPEG_SIG = [0xff, 0xd8]
const startsWith = (buf, sig) => !!buf && buf.length >= sig.length && sig.every((b, i) => buf[i] === b)

/** 가짜 NativeImage — toPNG 는 넣은 바이트 그대로(서명 비교가 바이트를 본다). */
export function fakeImage(buf) {
  const bytes = buf ? Buffer.from(buf) : Buffer.alloc(0)
  const empty = !(startsWith(bytes, PNG_SIG) || startsWith(bytes, JPEG_SIG))
  return { isEmpty: () => empty, toPNG: () => (empty ? Buffer.alloc(0) : Buffer.from(bytes)), _fake: true }
}

export const fakeNativeImage = { createFromBuffer: (buf) => fakeImage(buf) }

/** PNG 서명 + 꼬리 바이트(서로 다른 이미지 = 다른 꼬리). */
export const pngBytes = (tail = 'red') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(String(tail))])

/**
 * @param {{formats?:string[], text?:string, html?:string, rtf?:string, image?:Buffer|null}} [init]
 * @param {(tag:string) => void} [onCall] 호출마다 'clipboard:<method>' 로 알린다(테스트 trace)
 */
export function makeFakeClipboard(init = {}, onCall) {
  const st = { formats: [...(init.formats || [])], text: init.text || '', html: init.html || '', rtf: init.rtf || '', image: init.image || null }
  const calls = []
  const note = (m) => { calls.push(m); if (onCall) onCall('clipboard:' + m) }
  const failures = {}
  const maybeThrow = (m) => { if (failures[m]) throw new Error('fake clipboard ' + m + ' failed') }
  const reset = () => { st.formats = []; st.text = ''; st.html = ''; st.rtf = ''; st.image = null }
  return {
    calls, state: st,
    /** 다음 호출을 throw 하게(restore-threw 케이스). */
    failOn(m) { failures[m] = true },
    availableFormats() { note('availableFormats'); maybeThrow('availableFormats'); return [...st.formats] },
    readText() { note('readText'); return st.text },
    readHTML() { note('readHTML'); return st.html },
    readRTF() { note('readRTF'); return st.rtf },
    /** macOS 원시 형식 읽기(폴백 없음) — 'public.html' 은 진짜 HTML 이 있을 때만 바이트가 있다. */
    readBuffer(type) { note('readBuffer'); return type === 'public.html' && st.formats.includes('text/html') && st.html ? Buffer.from(st.html) : Buffer.alloc(0) },
    readImage() { note('readImage'); return fakeImage(st.image) },
    writeImage(img) { note('writeImage'); maybeThrow('writeImage'); reset(); st.image = img.toPNG(); st.formats = ['image/png'] },
    writeText(s) { note('writeText'); reset(); st.text = String(s); st.formats = ['text/plain'] },
    write(data) {
      note('write'); maybeThrow('write'); reset()
      if (data.text) { st.text = data.text; st.formats.push('text/plain') }
      if (data.html) { st.html = data.html; st.formats.push('text/html') }
      if (data.rtf) { st.rtf = data.rtf; st.formats.push('text/rtf') }
      if (data.image) { st.image = data.image.toPNG(); st.formats.push('image/png') }
    },
    clear() { note('clear'); maybeThrow('clear'); reset() },
    /** 사용자가 업로드 도중 다른 것을 복사했다(테스트가 부른다 — calls 에 남기지 않는다). */
    userCopiesText(s) { reset(); st.text = String(s); st.formats = ['text/plain'] },
    userCopiesImage(buf) { reset(); st.image = Buffer.from(buf); st.formats = ['image/png'] },
  }
}

// ─── (2) 가짜 페이지 ─────────────────────────────────────────────────────────────

/** 캡처 주입의 문서 nonce(가짜 페이지에 미리 심어 둔다 — 캐시 키의 doc). */
export const FAKE_DOC = 'f'.repeat(32)
export const FAKE_PROJECT = '134cf5b5-6a64-47b8-8709-6de4c6b0e44c'

const short = (id) => String(id || '').slice(0, 8)

/**
 * @param {object} [opts]
 *   chips            처음 칩 [{id, busy?}] (id null = img 없음)
 *   editorHtml       처음 편집기 내용(기본 빈 문단)
 *   assets           프로젝트 애셋(최신이 앞) [{id, session?:boolean, name?}] — session:true 만 id 썸네일(PR P5), 나머지는 불투명(추가하면 칩엔 진짜 id)
 *   picker           처음부터 열린 창: 'add'(＋) | 'at'(@) | null
 *   focus            처음 포커스: 'editor' | 'picker-search' | 'header-search' | null
 *   firstOpenMissing true → **첫** 열기에 session 애셋이 목록에 없다(앱 재시작 뒤 첫 창 누락, P5)
 *   triggerDudClicks n → 처음 n 번의 ＋ 트리거 클릭이 헛돈다
 *   atOpens          false → insertText('@') 가 창을 열지 않는다(기본 true: **정확히 '@'** 일 때만 연다, P4)
 *   search           창이 열릴 때 애셋 검색창 값(오염)
 *   preview          미리보기 덮어쓰기 {id} | {opaque:n}
 *   addAlsoSwaps     {from, to} — ＋ 추가 때 **기존** 칩 from 의 id 가 to 로 바뀐다(칩 수는 같고 id 하나가 다름; 추가한 칩은 맞다)
 *   extraChipOnAdd   id — ＋ 추가 때 이 칩이 하나 더 붙는다
 *   clearLeavesChips true → 지우기가 텍스트만 지우고 칩은 남긴다(칩 hover+클릭 경로)
 *   clipboard        가짜 클립보드(붙여넣기가 이미지를 싣는지 본다)
 *   upload           {ids?:string[], busyMs?, imgMs?, extraChip?:boolean, onUpload?({id, n})} — 편집기 붙여넣기 → 새 칩(busy·img 없음 → busyMs 에 busy 해제·img 없음 → imgMs 에 id img)
 *   pasteTarget      셀렉터 — 붙여넣기 이벤트를 activeElement 대신 이 요소에(대상이 편집기 밖인 케이스)
 *   onEvent(tag)     페이지 사건 알림(trace)
 */
export function createFakeFlowComposer(opts = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true })
  const window = dom.window
  const document = window.document
  const log = []
  const ev = (tag) => { log.push(tag); if (opts.onEvent) opts.onEvent(tag) }
  const later = (ms, fn) => { if (Number.isFinite(ms)) setTimeout(fn, Math.max(0, ms)) }   // Infinity = 영영 안 온다

  const clearBtnHtml = (() => { const d = document.createElement('div'); d.innerHTML = buildComposer({ clear: true }); return d.querySelector('button.clear-button').outerHTML })()
  document.body.innerHTML = `<div class="af-header"><input type="text" aria-label="검색" class="search-input" value=""></div>` + buildComposer({ editorHtml: opts.editorHtml || EMPTY_EDITOR })
  window.__autoflowcut_rpc_doc__ = FAKE_DOC

  const chips = (opts.chips || []).map((c) => ({ id: c.id || null, busy: !!c.busy, img: !!c.id }))
  const assets = (opts.assets || []).map((a) => ({ ...a }))
  const st = { picker: null, tab: 'dashboard', active: 0, opens: 0, duds: Number(opts.triggerDudClicks) || 0, hovered: null, visible: [] }
  const editor = () => document.querySelector('div.ProseMirror[contenteditable="true"]')
  const trigger = () => document.querySelector('button.add-menu-trigger')
  const lastPara = () => { const ps = editor().querySelectorAll('p'); return ps[ps.length - 1] }

  function renderChips() {
    document.querySelector('.af-ingredient-list').innerHTML = chips.map((c) => chipHtml({ id: c.img ? c.id : null, busy: c.busy })).join('')
    syncClear()
  }
  function editorPlain() { return (editor().textContent || '').replace(/[​﻿]/g, '') }
  function syncClear() {
    const show = chips.length > 0 || editorPlain().trim() !== '' || !!editor().querySelector('span.mention-chip')
    document.querySelector('.top-right-actions').innerHTML = show ? clearBtnHtml : '<!---->'
  }
  function normalizePara(p) {
    Array.from(p.querySelectorAll('br.ProseMirror-trailingBreak, img.ProseMirror-separator')).forEach((n) => n.remove())
    if (!p.childNodes.length) p.innerHTML = '<br class="ProseMirror-trailingBreak">'
  }
  function appendTextNode(p, s) {
    Array.from(p.querySelectorAll('br.ProseMirror-trailingBreak, img.ProseMirror-separator')).forEach((n) => n.remove())
    const last = p.lastChild
    if (last && last.nodeType === 3) last.nodeValue += s
    else p.appendChild(document.createTextNode(s))
  }
  /** 마지막 문단의 마지막 '@' 부터 끝까지 지운다(Escape · @ 창 추가). */
  function removeAtTail() {
    const p = lastPara()
    const texts = Array.from(p.childNodes).filter((n) => n.nodeType === 3)
    for (let i = texts.length - 1; i >= 0; i--) {
      const k = texts[i].nodeValue.lastIndexOf('@')
      if (k < 0) continue
      texts[i].nodeValue = texts[i].nodeValue.slice(0, k)
      let n = texts[i].nextSibling
      while (n) { const nx = n.nextSibling; n.remove(); n = nx }
      break
    }
    if (!p.textContent && !p.querySelector('span.mention-chip')) p.innerHTML = '<br class="ProseMirror-trailingBreak">'
  }

  // 편집기의 execCommand — 캐럿 끝에 넣는다. 정확히 '@' 이면 @ 창이 열린다(P4: 한 번에 넣은 텍스트 속 '@' 는 안 연다).
  document.execCommand = (cmd, _ui, value) => {
    if (cmd !== 'insertText') return false
    const s = String(value ?? '')
    if (!s) return false
    appendTextNode(lastPara(), s)
    ev('insert:' + s.length)
    if (s === '@' && opts.atOpens !== false) openPicker('at')
    syncClear()
    return true
  }

  function visibleAssets() {
    const hideSession = !!opts.firstOpenMissing && st.opens === 1
    return assets.filter((a) => !(hideSession && a.session))
  }
  function renderPicker() {
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove())
    if (!st.picker) return
    st.visible = visibleAssets()
    let opaqueN = 0
    const items = st.visible.map((a) => (a.session ? { id: a.id, name: a.name } : { opaque: ++opaqueN, name: a.name }))
    const activeItem = items[st.active] || null
    const preview = opts.preview && st.clickedItem ? opts.preview : activeItem
    document.body.insertAdjacentHTML('beforeend', buildAssetPicker({ tab: st.tab, items, preview, search: st.search || '' }))
  }
  function openPicker(kind) {
    st.picker = kind
    st.opens++
    st.tab = 'dashboard'   // 창은 전체 탭으로 열린다 — 드라이버가 업로드 탭을 고른다
    st.active = 0
    st.clickedItem = false
    st.search = opts.search || ''
    if (kind === 'add') setTrigger(true)
    renderPicker()
    const s = document.querySelector('input.search-input[cdkfocusinitial]')
    if (s) s.focus()
    ev('picker:open:' + kind + (st.opens === 1 && opts.firstOpenMissing ? ':missing' : ''))
  }
  function closePicker(how) {
    st.picker = null
    setTrigger(false)
    renderPicker()
    ev('picker:close:' + how)
  }
  function setTrigger(open) {
    const t = trigger()
    t.setAttribute('aria-expanded', String(open))
    t.classList.toggle('add-menu-trigger-active', open)
    t.querySelector('mat-icon').textContent = open ? ' close ' : ' add '
  }
  function addChip(id) {
    const at = chips.findIndex((c) => c.id === id)
    if (at >= 0) chips.splice(at, 1)   // P3: 같은 미디어는 칩 하나로 합쳐지고 끝으로
    chips.push({ id, busy: false, img: true })
  }

  if (opts.picker) openPicker(opts.picker)
  renderChips()
  const focusOf = opts.focus === undefined ? 'editor' : opts.focus
  if (focusOf === 'editor') editor().focus()
  else if (focusOf === 'picker-search') document.querySelector('input.search-input[cdkfocusinitial]').focus()
  else if (focusOf === 'header-search') document.querySelector('.af-header input.search-input').focus()

  document.addEventListener('mousemove', (e) => { st.hovered = e.target.closest ? e.target.closest('button.chip-container') : null })
  document.addEventListener('keydown', (e) => {
    if (e.keyCode !== 27 || e.target !== document.body || !st.picker) return
    const kind = st.picker
    if (kind === 'at') removeAtTail()   // P4: Escape 는 '@' 뒤에 친 글자까지 지운다
    closePicker('escape')
    syncClear()
  })
  document.addEventListener('click', (e) => {
    const t = e.target
    if (!t || !t.closest) return
    if (t.closest('button.add-menu-trigger')) {
      if (st.duds > 0) { st.duds--; ev('trigger:dud'); return }
      if (st.picker === 'at') { ev('trigger:ignored'); return }   // P4: @ 로 연 창은 트리거로 안 닫힌다
      if (st.picker === 'add') { closePicker('trigger'); return }
      openPicker('add')
      return
    }
    const tab = t.closest('[role="tab"]')
    if (tab && st.picker) {
      const lig = (tab.querySelector('mat-icon')?.textContent || '').trim()
      st.tab = lig; st.active = 0; st.clickedItem = false
      renderPicker()
      ev('tab:' + lig)
      return
    }
    const item = t.closest('button.asset-item')
    if (item && st.picker) {
      const idx = Array.from(document.querySelectorAll('button.asset-item')).indexOf(item)
      const a = st.visible[idx]
      st.active = idx; st.clickedItem = true
      renderPicker()
      ev('item:' + (a && a.session ? short(a.id) : 'opaque'))
      return
    }
    if (t.closest('button.detail-add-to-prompt-btn') && st.picker) {
      const a = st.visible[st.active]
      const kind = st.picker
      closePicker('add')
      if (!a) return
      if (kind === 'at') {
        const id = a.id
        removeAtTail()
        const p = lastPara()
        normalizePara(p)
        if (p.firstChild && p.firstChild.nodeName === 'BR') p.innerHTML = ''
        p.insertAdjacentHTML('beforeend', mentionHtml(id, a.name || 'image.png'))
        p.appendChild(document.createTextNode(' '))   // P3: 멘션 뒤 자동 공백
        addChip(id)
        ev('mention:' + short(id))
      } else {
        const id = a.id
        if (opts.addAlsoSwaps) { const c = chips.find((x) => x.id === opts.addAlsoSwaps.from); if (c) c.id = opts.addAlsoSwaps.to }
        addChip(id)
        if (opts.extraChipOnAdd) chips.push({ id: opts.extraChipOnAdd, busy: false, img: true })
        ev('add:' + short(id))
      }
      renderChips()
      return
    }
    if (t.closest('button.clear-button')) {
      if (st.picker) { ev('clear:ignored'); return }   // P2: 애셋 창이 열린 동안엔 지우기가 먹지 않는다
      if (!opts.clearLeavesChips) chips.length = 0
      editor().innerHTML = EMPTY_EDITOR
      renderChips()
      ev('clear')
      return
    }
    const chip = t.closest('button.chip-container')
    if (chip) {
      if (st.hovered !== chip) { ev('chip:click-without-hover'); return }
      const idx = Array.from(document.querySelectorAll('button.chip-container')).indexOf(chip)
      const [gone] = chips.splice(idx, 1)
      renderChips()
      ev('chip:remove:' + short(gone && gone.id))
    }
  })

  let uploadN = 0
  const uploadIds = [...((opts.upload && opts.upload.ids) || [uuid(3)])]
  const page = {
    window, document, log,
    counts: { paste: 0 },
    /** 드라이버의 exec — 페이지 스크립트를 이 문서에서 실제로 돌린다(executeJavaScript 처럼 비동기). */
    exec: (js) => new Promise((resolve, reject) => { try { resolve(window.eval(String(js))) } catch (e) { reject(e) } }),
    /** 신뢰 클릭 가짜 — 표현식이 돌려준 요소에 mousemove(hover) 뒤 click(편집기·입력은 focus 도). */
    async trustedClick(js, o = {}) {
      let el = null
      try { el = window.eval(String(js)) } catch (_e) { el = null }
      ev('tclick:' + (o.step || '?') + (el ? '' : ':missing'))
      if (!el || !el.dispatchEvent) return { success: false, error: 'Button not found or zero-size' }
      if (el.disabled) return { success: false, error: 'Button is disabled' }
      el.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }))
      if (el.matches('div.ProseMirror, input')) el.focus()
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      return { success: true }
    },
    /** webContents.paste() 흉내 — 포커스된 요소(또는 pasteTarget)에 paste 이벤트(files = 클립보드 이미지 유무). 편집기면 업로드 칩 수명을 시작한다. */
    paste() {
      page.counts.paste++
      const target = opts.pasteTarget ? document.querySelector(opts.pasteTarget) : (document.activeElement || document.body)
      const files = opts.clipboard && opts.clipboard.state.image ? 1 : 0
      const e = new window.Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(e, 'clipboardData', { value: { files: { length: files }, types: files ? ['Files'] : [] } })
      target.dispatchEvent(e)
      const inEditor = editor().contains(target)
      ev('paste:' + (inEditor ? 'editor' : 'other'))
      if (!inEditor || !files || e.defaultPrevented) return
      const u = opts.upload || {}
      const n = ++uploadN
      const id = uploadIds.length > 1 ? uploadIds.shift() : uploadIds[0]
      const born = [{ id, busy: true, img: false }]
      if (u.extraChip) born.push({ id: uuid(8), busy: true, img: false })
      chips.push(...born)
      renderChips()
      later(u.busyMs ?? 7900, () => { born.forEach((c) => { c.busy = false }); renderChips() })
      later(u.imgMs ?? 9600, () => {
        born.forEach((c) => { c.img = true })
        if (!assets.some((a) => a.id === id)) assets.unshift({ id, session: true, name: 'image.png' })
        renderChips()
        ev('chip-id')
      })
      if (u.onUpload) u.onUpload({ id, n })
    },
    chipIds: () => chips.map((c) => (c.img ? c.id : null)),
    mentionIds: () => Array.from(editor().querySelectorAll('span.mention-chip')).map((s) => s.getAttribute('data-mention-id')),
    editorText: () => editorPlain(),
    pickerKind: () => st.picker,
  }
  return page
}

// ─── (3) 드라이버 하네스 ─────────────────────────────────────────────────────────

/** maseQ 응답 본문 — S3#4 의 id(U3)를 바꾼 사본(파일명 image.png 는 그대로 — 로그에 새지 않아야 한다). */
export function maseQBody(id) {
  const U3 = uuid(3)
  return respBodyWithPayload('maseQ', JSON.parse(JSON.stringify(s3Payload(4)).split(U3).join(id)))
}

/**
 * 드라이버 ctx(flow-reference-driver.js) + 가짜 페이지 + 가짜 클립보드 + 실제 라우터.
 * @param {object} [o]
 *   page      createFakeFlowComposer 옵션(upload 의 onUpload 는 하네스가 채운다)
 *   clipboard 가짜 클립보드 초기값(기본: 앱 텍스트창에서 복사한 텍스트 — Lexical 형식 포함)
 *   upload    {sendMs=300, loadendMs=7500, noSend, responseText(id)→string, onPaste()} maseQ 예약
 *   hangObserver  true → 붙여넣기 뒤의 관찰 exec 가 영영 settle 하지 않는다(죽은 문서)
 *   aborted() 드라이버의 isAborted
 */
export function makeRefDriverHarness(o = {}) {
  const trace = []
  let wrote = false
  const clipboard = makeFakeClipboard(o.clipboard || { formats: ['text/plain', 'text/html', 'application/x-lexical-editor'], text: 'user text', html: '<p>user text</p>' }, (tag) => {
    // 계획서 trace 이름으로: 쓰기 전 첫 availableFormats = 스냅샷, 쓰기 뒤 clear = 복원
    if (tag === 'clipboard:writeImage') { wrote = true; trace.push(tag); return }
    if (tag === 'clipboard:availableFormats' && !wrote && !trace.includes('clipboard:snapshot')) trace.push('clipboard:snapshot')
    if (tag === 'clipboard:clear' && wrote) trace.push('clipboard:restore')
  })
  const pendingGenerations = new Map()
  const reportCtx = buildReportCtx({
    getPendingGeneration: () => null, setPendingGeneration: () => {}, pendingGenerations,
    getPendingVideoGeneration: () => null, setPendingVideoGeneration: () => {},
  })
  const up = { sendMs: 300, loadendMs: 7500, ...(o.upload || {}) }
  const router = {
    send: (seq) => { trace.push('maseQ:send'); return routeReportResponse({ kind: 'batchexecute-send', doc: FAKE_DOC, rpcid: 'maseQ', rpcids: ['maseQ'], seq, prompts: [], sentAt: Date.now() / 1000 }, reportCtx) },
    loadend: (seq, responseText) => { trace.push('maseQ:loadend'); return routeReportResponse({ kind: 'batchexecute', doc: FAKE_DOC, rpcid: 'maseQ', seq, status: 200, responseText, endedAt: Date.now() / 1000 }, reportCtx) },
  }
  const page = createFakeFlowComposer({
    ...(o.page || {}),
    clipboard,
    onEvent: (tag) => { if (tag === 'chip-id') trace.push('chip-id') },
    upload: {
      ...((o.page && o.page.upload) || {}),
      onUpload: ({ id, n }) => {
        if (up.onPaste) up.onPaste({ id, n })
        if (up.noSend) return
        setTimeout(() => router.send(n), up.sendMs)
        setTimeout(() => router.loadend(n, up.responseText ? up.responseText(id) : maseQBody(id)), up.loadendMs)
      },
    },
  })
  let obsBase = null
  const exec = (js) => {
    const s = String(js)
    if (s === READ_COMPOSER_STATE_JS) trace.push('state-read')
    if (s.includes('__af_paste_observer__')) {
      if (o.hangObserver && page.counts.paste > 0) { trace.push('observer:hang'); return new Promise(() => {}) }
      return page.exec(s).then((r) => {
        if (r && typeof r.n === 'number') {
          if (obsBase == null) obsBase = r.n
          else if (r.n > obsBase && !trace.includes('paste-observed')) trace.push('paste-observed')
        }
        return r
      })
    }
    return page.exec(s)
  }
  const report = []
  const cache = {
    get: (...a) => refMediaCache.get(...a),
    set: (...a) => { trace.push('cache:set'); refMediaCache.set(...a) },
    delete: (...a) => { trace.push('cache:delete'); refMediaCache.delete(...a) },
  }
  const ctx = {
    exec,
    trustedClick: (js, opts) => page.trustedClick(js, opts),
    clipboard,
    nativeImage: fakeNativeImage,
    paste: () => { trace.push('paste'); page.paste() },
    pendingGenerations,
    cache,
    projectId: FAKE_PROJECT,
    isAborted: () => !!(o.aborted && o.aborted()),
    report: async (step, reason, extra) => { report.push({ step, reason, extra }) },
  }
  return { ctx, page, trace, clipboard, pendingGenerations, report, router }
}
