/**
 * electron/flow-composer-refs.js
 *
 * M3-4 — flow.google.com 컴포저의 **레퍼런스** DOM 파인더(칩 바·인라인 멘션·애셋 창). 순수 함수(jsdom 테스트)이고 같은 함수를
 * toString() 으로 페이지에 주입한다 — 각 *_JS 는 단일 표현식, 자기완결(다른 헬퍼를 이름으로 부르지 않는다 — minified 빌드 안전).
 * 계획서 docs/plans/2026-09-25-flow-M3-references-plan.md §1-4 ③⑤⑥ · D4 · D7 · D8 · D9.
 *
 *   칩        button.chip-container[aria-busy] + 자손 img(src https://flow-content.google/image/<mediaId>?…) — 칩 순서 = DOM 순서.
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
 * 컴포저 상태 한 번에 → { chips:[{mediaId, busy}], segments:[{t:'text', text} | {t:'mention', mediaId, label}], editorText,
 *   pickerOpen, searchDirty, activeInEditor }.
 *   segments 는 편집기 문단을 순서대로 걷는다(문단 사이 '\n'); 멘션 노드는 id·라벨로 빠지고 라벨은 텍스트 부분에 들어가지 않는다.
 *   editorText 는 라벨을 포함한 편집기 텍스트(READ_EDITOR_TEXT_JS 와 같은 규칙), 편집기가 없으면 null.
 *   pickerOpen 은 열림 흔적 전부(트리거 expanded · 항목 · 애셋 검색 · 추가 버튼) — 닫힘 게이트가 fail-closed 가 되게.
 */
export function readComposerState(doc) {
  var ID_SRC = /^https:\/\/flow-content\.google\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?|$)/i
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  var ZW = /[​﻿]/g
  var chips = Array.from(doc.querySelectorAll('button.chip-container')).map(function (btn) {
    var mediaId = null
    var imgs = btn.querySelectorAll('img')
    for (var i = 0; i < imgs.length && !mediaId; i++) {
      var m = ID_SRC.exec(imgs[i].getAttribute('src') || '')
      if (m) mediaId = m[1]
    }
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

/** 애셋 창 항목 중 자손 썸네일 src 가 https://flow-content.google/image/<mediaId>(? 또는 끝) 인 것 — 정확히 하나일 때만(불투명 항목은 안 잡힌다). */
export function findAssetItemByMediaId(doc, mediaId) {
  var ID_SRC = /^https:\/\/flow-content\.google\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?|$)/i
  if (typeof mediaId !== 'string' || !mediaId) return null
  var hits = Array.from(doc.querySelectorAll('button.asset-item[role="option"]')).filter(function (item) {
    return Array.from(item.querySelectorAll('img')).some(function (img) {
      var m = ID_SRC.exec(img.getAttribute('src') || '')
      return !!m && m[1] === mediaId
    })
  })
  return hits.length === 1 ? hits[0] : null
}

/** 애셋 창의 id 썸네일 항목들의 mediaId(DOM 순서) — 불투명 항목은 빠진다. */
export function listIdAssetMediaIds(doc) {
  var ID_SRC = /^https:\/\/flow-content\.google\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?|$)/i
  var out = []
  Array.from(doc.querySelectorAll('button.asset-item[role="option"]')).forEach(function (item) {
    var imgs = item.querySelectorAll('img')
    for (var i = 0; i < imgs.length; i++) {
      var m = ID_SRC.exec(imgs[i].getAttribute('src') || '')
      if (m) { out.push(m[1]); return }
    }
  })
  return out
}

/** 애셋 창 탭 — [role=tab] 중 아이콘 리거처가 ligature 인 것, 정확히 하나일 때만(라벨 문구는 보지 않는다). */
export function findPickerTab(doc, ligature) {
  var tabs = Array.from(doc.querySelectorAll('[role="tab"]')).filter(function (tab) {
    return Array.from(tab.querySelectorAll("mat-icon, i, span[class*='symbols'], [class*='google-symbols']"))
      .some(function (i) { return (i.textContent || '').trim() === ligature })
  })
  return tabs.length === 1 ? tabs[0] : null
}

/** 미리보기(img.detail-preview-image, 정확히 하나)의 mediaId — 불투명 썸네일이거나 미리보기가 없으면 null. */
export function readPickerPreviewMediaId(doc) {
  var ID_SRC = /^https:\/\/flow-content\.google\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?|$)/i
  var imgs = doc.querySelectorAll('img.detail-preview-image')
  if (imgs.length !== 1) return null
  var m = ID_SRC.exec(imgs[0].getAttribute('src') || '')
  return m ? m[1] : null
}

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
export function findChipByMediaId(doc, mediaId) {
  var ID_SRC = /^https:\/\/flow-content\.google\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?|$)/i
  if (typeof mediaId !== 'string' || !mediaId) return null
  var hits = Array.from(doc.querySelectorAll('button.chip-container')).filter(function (chip) {
    return Array.from(chip.querySelectorAll('img')).some(function (img) {
      var m = ID_SRC.exec(img.getAttribute('src') || '')
      return !!m && m[1] === mediaId
    })
  })
  return hits.length === 1 ? hits[0] : null
}

// ─── 페이지 주입 표현식(단일 표현식, 자기완결) ──────────────────────────────
export const READ_COMPOSER_STATE_JS = `(${readComposerState.toString()})(document)`
export const LIST_ID_ASSET_MEDIA_IDS_JS = `(${listIdAssetMediaIds.toString()})(document)`
export const READ_PICKER_PREVIEW_MEDIA_ID_JS = `(${readPickerPreviewMediaId.toString()})(document)`
export const FIND_ADD_MENU_TRIGGER_JS = `(${findAddMenuTrigger.toString()})(document)`
export const FIND_CLEAR_PROMPT_BUTTON_JS = `(${findClearPromptButton.toString()})(document)`
export const FIND_ADD_TO_PROMPT_BUTTON_JS = `(${findAddToPromptButton.toString()})(document)`
export const FIND_ASSET_ITEM_BY_MEDIA_ID_JS = (mediaId) => `(${findAssetItemByMediaId.toString()})(document, ${JSON.stringify(String(mediaId))})`
export const FIND_PICKER_TAB_JS = (ligature) => `(${findPickerTab.toString()})(document, ${JSON.stringify(String(ligature))})`
export const FIND_CHIP_BY_MEDIA_ID_JS = (mediaId) => `(${findChipByMediaId.toString()})(document, ${JSON.stringify(String(mediaId))})`
