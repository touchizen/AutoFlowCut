/**
 * electron/flow-composer-refs.js
 *
 * M3-4 — flow.google.com 컴포저의 **레퍼런스** DOM 파인더(칩 바·인라인 멘션·애셋 창). 순수 함수(jsdom 테스트)이고 같은 함수를
 * toString() 으로 페이지에 주입한다 — 각 *_JS 는 단일 표현식, 자기완결(다른 헬퍼를 이름으로 부르지 않는다 — minified 빌드 안전).
 * 계획서 docs/plans/2026-09-25-flow-M3-references-plan.md §1-4 ③⑤⑥ · D4 · D7 · D8 · D9.
 *
 *   칩        button.chip-container[aria-busy] + 자손 img(src https://flow-content.google/image/<mediaId>?…) — 칩 순서 = DOM 순서.
 *   id 판독  2026-10-31: Flow 가 칩·애셋 항목·미리보기 src 를 https://flow.google.com/asb/<토큰>=s1600-rw 로 바꿨다(이번 세션 업로드 포함, id 없음).
 *             img 에서 id 는 ① flow-content.google/image/<id> ② asb 토큰 → tokens 지도(as29s 로 배운 {토큰: id}) 순으로 읽는다(mediaIdOfImg).
 *             업로드 중엔 aria-busy="true"·img 없음, busy 해제 뒤에도 ~2s img 없음(PR P1a) → 그동안 mediaId null.
 *   멘션      편집기 div.ProseMirror[contenteditable=true] 안 span.mention-chip[data-mention-id](텍스트 = 애셋 라벨, PR P3).
 *   트리거    button.add-menu-trigger(＋, 열리면 aria-expanded="true") — 헤더의 "미디어 메뉴 추가"(mat-mdc-menu-trigger)와 다르다.
 *   애셋 창   탭 [role=tab] + 아이콘 리거처(drive_folder_upload = 업로드) · 항목 button.asset-item[role=option] + 자손 썸네일 img ·
 *             미리보기 img.detail-preview-image · 추가 button.detail-add-to-prompt-btn · 검색 input.search-input[cdkfocusinitial]
 *             (헤더의 전역 input.search-input 에는 cdkfocusinitial 이 없다). 이번 페이지 세션 업로드만 썸네일이 id 를 드러내고
 *             나머지(lh3…/asb/…)는 불투명 — 불투명 항목은 어떤 id 로도 잡히지 않는다(PR P5).
 *   지우기    button.clear-button(칩·텍스트 모두 제거, PR P2).
 * 로케일 문구(aria-label "소재"·탭 "업로드" 등)는 절대 보지 않는다 — 클래스·역할·속성·아이콘 리거처·URL 모양만.
 * id 모양은 UUID(src/utils/flowMediaId.js 와 같은 식) — 파인더 결과는 id·불리언·라벨(멘션 노드의 텍스트)뿐, URL·서명은 내보내지 않는다.
 * tests/electron/flow-composer-refs.test.js
 */

/**
 * 2026-10-31: img → mediaId 또는 null. Flow 가 칩·애셋 항목·미리보기 src 를 https://flow.google.com/asb/<토큰>=… 로 바꿔(이번 세션 업로드 포함 — id 없음)
 *   ① flow-content.google/image/<id>(옛 모양) ② asb 토큰 → tokens 지도({토큰: mediaId}, as29s 로 배운 것) 순으로 읽는다. img 의 data-media-id 는
 *   그리드 타일에만 있어(칩·항목·미리보기엔 없다) 보지 않는다.
 *   자기완결 — *_JS 빌더가 호출 지점에서 판독기(…With)에 resolveImg 로 넘긴다(이름으로 부르지 않는다 — minified 빌드 안전).
 */
export function mediaIdOfImg(img, tokens) {
  var ID_SRC = /^https:\/\/flow-content\.google\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?|$)/i
  var ASB_SRC = /^https:\/\/(?:flow\.google\.com|lh3\.googleusercontent\.com)\/asb\/([A-Za-z0-9_-]+)(?:[=?#]|$)/
  var UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  var src = img.getAttribute('src') || ''
  var m = ID_SRC.exec(src)
  if (m) return m[1]
  var a = ASB_SRC.exec(src)
  var v = a && tokens && Object.prototype.hasOwnProperty.call(tokens, a[1]) ? tokens[a[1]] : null
  return typeof v === 'string' && UUID_ID.test(v) ? v : null
}

/**
 * 컴포저 상태 한 번에 → { chips:[{mediaId, busy}], segments:[{t:'text', text} | {t:'mention', mediaId, label}], editorText,
 *   pickerOpen, searchDirty, activeInEditor }.
 *   segments 는 편집기 문단을 순서대로 걷는다(문단 사이 '\n'); 멘션 노드는 id·라벨로 빠지고 라벨은 텍스트 부분에 들어가지 않는다.
 *   editorText 는 라벨을 포함한 편집기 텍스트(READ_EDITOR_TEXT_JS 와 같은 규칙), 편집기가 없으면 null.
 *   pickerOpen 은 열림 흔적 전부(트리거 expanded · 항목 · 애셋 검색 · 추가 버튼) — 닫힘 게이트가 fail-closed 가 되게.
 */
export function readComposerStateWith(doc, tokens, resolveImg) {
  var idOf = function (img) { return resolveImg(img, tokens) }
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  var ZW = /[​﻿]/g
  var chips = Array.from(doc.querySelectorAll('button.chip-container')).map(function (btn) {
    var mediaId = null
    var imgs = btn.querySelectorAll('img')
    for (var i = 0; i < imgs.length && !mediaId; i++) mediaId = idOf(imgs[i])
    return { mediaId: mediaId, busy: btn.getAttribute('aria-busy') === 'true' }
  })
  var editor = doc.querySelector('div.ProseMirror[contenteditable="true"]')
  var segments = []
  var editorText = null
  if (editor) {
    var buf = ''
    var flush = function () { if (buf) { segments.push({ t: 'text', text: buf }); buf = '' } }
    var walk = function (node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { buf += (c.nodeValue || '').replace(ZW, ''); continue }
        if (c.nodeType !== 1) continue
        if (c.matches('span.mention-chip[data-mention-id]')) {
          flush()
          var id = c.getAttribute('data-mention-id') || ''
          segments.push({ t: 'mention', mediaId: UUID.test(id) ? id : null, label: c.textContent || '' })
          continue
        }
        walk(c)
      }
    }
    var paras = Array.from(editor.querySelectorAll('p'))
    var blocks = paras.length ? paras : [editor]
    for (var b = 0; b < blocks.length; b++) {
      if (b > 0) buf += '\n'
      walk(blocks[b])
    }
    flush()
    editorText = paras.length
      ? paras.map(function (p) { return (p.textContent || '').replace(ZW, '') }).join('\n').trim()
      : (editor.textContent || '').replace(ZW, '').trim()
  }
  var expanded = Array.from(doc.querySelectorAll('button.add-menu-trigger')).some(function (t) { return t.getAttribute('aria-expanded') === 'true' })
  var pickerOpen = expanded || !!doc.querySelector('button.asset-item, input.search-input[cdkfocusinitial], button.detail-add-to-prompt-btn')
  var searchDirty = Array.from(doc.querySelectorAll('input.search-input[cdkfocusinitial]')).some(function (i) { return (i.value || '') !== '' })
  var active = doc.activeElement
  var activeInEditor = !!(editor && active && (active === editor || editor.contains(active)))
  return { chips: chips, segments: segments, editorText: editorText, pickerOpen: pickerOpen, searchDirty: searchDirty, activeInEditor: activeInEditor }
}
/** readComposerStateWith + mediaIdOfImg(직접 호출용 — 페이지엔 *_JS 빌더가 조합한다). */
export function readComposerState(doc, tokens) { return readComposerStateWith(doc, tokens, mediaIdOfImg) }

/** 애셋 창 항목 중 자손 썸네일 src 가 https://flow-content.google/image/<mediaId>(? 또는 끝) 인 것 — 정확히 하나일 때만(불투명 항목은 안 잡힌다). */
export function findAssetItemByMediaIdWith(doc, mediaId, tokens, resolveImg) {
  var idOf = function (img) { return resolveImg(img, tokens) }
  if (typeof mediaId !== 'string' || !mediaId) return null
  var hits = Array.from(doc.querySelectorAll('button.asset-item[role="option"]')).filter(function (item) {
    return Array.from(item.querySelectorAll('img')).some(function (img) { return idOf(img) === mediaId })
  })
  return hits.length === 1 ? hits[0] : null
}
/** findAssetItemByMediaIdWith + mediaIdOfImg(직접 호출용 — 페이지엔 *_JS 빌더가 조합한다). */
export function findAssetItemByMediaId(doc, mediaId, tokens) { return findAssetItemByMediaIdWith(doc, mediaId, tokens, mediaIdOfImg) }

/** 애셋 창의 id 썸네일 항목들의 mediaId(DOM 순서) — 불투명 항목은 빠진다. */
export function listIdAssetMediaIdsWith(doc, tokens, resolveImg) {
  var idOf = function (img) { return resolveImg(img, tokens) }
  var out = []
  Array.from(doc.querySelectorAll('button.asset-item[role="option"]')).forEach(function (item) {
    var imgs = item.querySelectorAll('img')
    for (var i = 0; i < imgs.length; i++) {
      var id = idOf(imgs[i])
      if (id) { out.push(id); return }
    }
  })
  return out
}
/** listIdAssetMediaIdsWith + mediaIdOfImg(직접 호출용 — 페이지엔 *_JS 빌더가 조합한다). */
export function listIdAssetMediaIds(doc, tokens) { return listIdAssetMediaIdsWith(doc, tokens, mediaIdOfImg) }

/** 애셋 창 탭 — [role=tab] 중 아이콘 리거처가 ligature 인 것, 정확히 하나일 때만(라벨 문구는 보지 않는다). */
export function findPickerTab(doc, ligature) {
  var tabs = Array.from(doc.querySelectorAll('[role="tab"]')).filter(function (tab) {
    return Array.from(tab.querySelectorAll("mat-icon, i, span[class*='symbols'], [class*='google-symbols']"))
      .some(function (i) { return (i.textContent || '').trim() === ligature })
  })
  return tabs.length === 1 ? tabs[0] : null
}

/** 미리보기(img.detail-preview-image, 정확히 하나)의 mediaId — 불투명 썸네일이거나 미리보기가 없으면 null. */
export function readPickerPreviewMediaIdWith(doc, tokens, resolveImg) {
  var idOf = function (img) { return resolveImg(img, tokens) }
  var imgs = doc.querySelectorAll('img.detail-preview-image')
  if (imgs.length !== 1) return null
  return idOf(imgs[0])
}
/** readPickerPreviewMediaIdWith + mediaIdOfImg(직접 호출용 — 페이지엔 *_JS 빌더가 조합한다). */
export function readPickerPreviewMediaId(doc, tokens) { return readPickerPreviewMediaIdWith(doc, tokens, mediaIdOfImg) }

/** 컴포저 ＋ 트리거(button.add-menu-trigger) — 정확히 하나일 때만. */
export function findAddMenuTrigger(doc) {
  var els = doc.querySelectorAll('button.add-menu-trigger')
  return els.length === 1 ? els[0] : null
}

/** 프롬프트 지우기(button.clear-button) — 정확히 하나일 때만. 빈 컴포저엔 없다. */
export function findClearPromptButton(doc) {
  var els = doc.querySelectorAll('button.clear-button')
  return els.length === 1 ? els[0] : null
}

/** 애셋 창 "프롬프트에 추가"(button.detail-add-to-prompt-btn) — 정확히 하나일 때만. */
export function findAddToPromptButton(doc) {
  var els = doc.querySelectorAll('button.detail-add-to-prompt-btn')
  return els.length === 1 ? els[0] : null
}

/** 칩(button.chip-container) 중 자손 img 가 그 mediaId 의 id 썸네일인 것 — 정확히 하나일 때만(img 없는 칩은 안 잡힌다). */
export function findChipByMediaIdWith(doc, mediaId, tokens, resolveImg) {
  var idOf = function (img) { return resolveImg(img, tokens) }
  if (typeof mediaId !== 'string' || !mediaId) return null
  var hits = Array.from(doc.querySelectorAll('button.chip-container')).filter(function (chip) {
    return Array.from(chip.querySelectorAll('img')).some(function (img) { return idOf(img) === mediaId })
  })
  return hits.length === 1 ? hits[0] : null
}
/** findChipByMediaIdWith + mediaIdOfImg(직접 호출용 — 페이지엔 *_JS 빌더가 조합한다). */
export function findChipByMediaId(doc, mediaId, tokens) { return findChipByMediaIdWith(doc, mediaId, tokens, mediaIdOfImg) }

/**
 * 2026-10-30 I2V — 프레임 모드 컴포저의 칸(크롬 실기 DOM): flow-ingredient-bar 안 `.frame-trigger` 둘(시작 · 끝, DOM 순서). 빈 칸은 button.empty-chip,
 *   채운 칸은 button.chip-container[aria-busy] + img(src https://flow-content.google/image/<mediaId>?…). 소재 모드면 `.frame-trigger` 가 없다.
 *   → { framesMode, slots:[{mediaId, busy, empty}] } — 로케일 문구("시작"/"종료")는 보지 않는다.
 */
export function readFrameSlotsWith(doc, tokens, resolveImg) {
  var idOf = function (img) { return resolveImg(img, tokens) }
  var triggers = Array.from(doc.querySelectorAll('flow-ingredient-bar .frame-trigger'))
  var slots = triggers.map(function (t) {
    var chip = t.querySelector('button.chip-container')
    if (!chip) return { mediaId: null, busy: false, empty: true }
    var mediaId = null
    var imgs = chip.querySelectorAll('img')
    for (var i = 0; i < imgs.length && !mediaId; i++) mediaId = idOf(imgs[i])
    return { mediaId: mediaId, busy: chip.getAttribute('aria-busy') === 'true', empty: false }
  })
  return { framesMode: triggers.length > 0, slots: slots }
}
/** readFrameSlotsWith + mediaIdOfImg(직접 호출용 — 페이지엔 *_JS 빌더가 조합한다). */
export function readFrameSlots(doc, tokens) { return readFrameSlotsWith(doc, tokens, mediaIdOfImg) }

/**
 * 2026-10-31: 한 번의 판독 → { doc: 문서 nonce(window.__autoflowcut_rpc_doc__, 32 hex) | null, chips: [{ token, busy }] (DOM 순) } — token 은 칩 img 의
 *   asb 토큰(img 가 없거나 asb 주소가 아니면 null). 드라이버가 "우리가 방금 붙인 칩 하나"를 업로드가 바인딩된 문서·붙여넣기 전 칩들과 견줘 그 토큰을
 *   maseQ 가 준 id 로 등록할 때만 쓴다(갓 올린 이미지는 as29s 가 옛 주소만 준다 — 10-31 실기). 토큰은 미디어 접근 주소 — 호출자는 로그에 싣지 않는다.
 */
export function readChipSnapshot(doc) {
  var ASB_SRC = /^https:\/\/(?:flow\.google\.com|lh3\.googleusercontent\.com)\/asb\/([A-Za-z0-9_-]+)(?:[=?#]|$)/
  var w = doc.defaultView
  var nonce = w && typeof w.__autoflowcut_rpc_doc__ === 'string' && /^[0-9a-f]{32}$/.test(w.__autoflowcut_rpc_doc__) ? w.__autoflowcut_rpc_doc__ : null
  var chips = Array.from(doc.querySelectorAll('button.chip-container')).map(function (btn) {
    var token = null
    var imgs = btn.querySelectorAll('img')
    for (var i = 0; i < imgs.length && !token; i++) {
      var m = ASB_SRC.exec(imgs[i].getAttribute('src') || '')
      if (m) token = m[1]
    }
    return { token: token, busy: btn.getAttribute('aria-busy') === 'true' }
  })
  return { doc: nonce, chips: chips }
}

// ─── 페이지 주입 표현식(단일 표현식, 자기완결) ──────────────────────────────
// 2026-10-31: id 를 읽는 판독은 asb 토큰 지도({토큰: mediaId}, as29s 로 배운 것)를 함께 싣는다. 모양이 맞는 항목만 싣는다(토큰 글자·UUID).
const TOKEN_RE = /^[A-Za-z0-9_-]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function tokensArg(tokens) {
  const out = {}
  if (tokens && typeof tokens === 'object') {
    for (const [k, v] of Object.entries(tokens)) if (TOKEN_RE.test(k) && typeof v === 'string' && UUID_RE.test(v)) out[k] = v
  }
  return JSON.stringify(out)
}
/** 판독기(…With)에 mediaIdOfImg 를 호출 지점에서 조합 — 단일 표현식. */
const withResolver = (core, args) => `(function () { var resolveImg = ${mediaIdOfImg.toString()}; return (${core.toString()})(document, ${args}, resolveImg) })()`
export const frameSlotsJs = (tokens) => withResolver(readFrameSlotsWith, tokensArg(tokens))
export const composerStateJs = (tokens) => withResolver(readComposerStateWith, tokensArg(tokens))
export const listIdAssetMediaIdsJs = (tokens) => withResolver(listIdAssetMediaIdsWith, tokensArg(tokens))
export const readPickerPreviewMediaIdJs = (tokens) => withResolver(readPickerPreviewMediaIdWith, tokensArg(tokens))
/** 지도 없는 판독(옛 flow-content 주소·data-media-id 만). */
export const READ_FRAME_SLOTS_JS = frameSlotsJs()
export const READ_COMPOSER_STATE_JS = composerStateJs()
export const LIST_ID_ASSET_MEDIA_IDS_JS = listIdAssetMediaIdsJs()
export const READ_PICKER_PREVIEW_MEDIA_ID_JS = readPickerPreviewMediaIdJs()
export const READ_CHIP_SNAPSHOT_JS = `(${readChipSnapshot.toString()})(document)`
export const FIND_ADD_MENU_TRIGGER_JS = `(${findAddMenuTrigger.toString()})(document)`
export const FIND_CLEAR_PROMPT_BUTTON_JS = `(${findClearPromptButton.toString()})(document)`
export const FIND_ADD_TO_PROMPT_BUTTON_JS = `(${findAddToPromptButton.toString()})(document)`
export const FIND_ASSET_ITEM_BY_MEDIA_ID_JS = (mediaId, tokens) => withResolver(findAssetItemByMediaIdWith, `${JSON.stringify(String(mediaId))}, ${tokensArg(tokens)}`)
export const FIND_PICKER_TAB_JS = (ligature) => `(${findPickerTab.toString()})(document, ${JSON.stringify(String(ligature))})`
export const FIND_CHIP_BY_MEDIA_ID_JS = (mediaId, tokens) => withResolver(findChipByMediaIdWith, `${JSON.stringify(String(mediaId))}, ${tokensArg(tokens)}`)
