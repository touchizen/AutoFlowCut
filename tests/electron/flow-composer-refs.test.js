// @vitest-environment jsdom
//
// M3-4 — 컴포저 레퍼런스 DOM 파인더(순수 + 단일 표현식 *_JS). 픽스처 tests/fixtures/flow-live-dom-m3.js(2026-09-25 덤프·RAW·프로브 재구성).
//   칩 button.chip-container[aria-busy] + img(flow-content.google/image/<id>) · 멘션 span.mention-chip[data-mention-id] · 트리거 button.add-menu-trigger ·
//   탭 [role=tab] 리거처 · 항목 button.asset-item[role=option] + 자손 썸네일 img · 미리보기 img.detail-preview-image · 추가 button.detail-add-to-prompt-btn ·
//   지우기 button.clear-button · 애셋 검색 input.search-input[cdkfocusinitial].
// 로케일 문구(aria-label "소재"·탭 "업로드" 등)는 보지 않는다 — 영어 변형 픽스처에서 같은 결과.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readComposerState, findAssetItemByMediaId, listIdAssetMediaIds, findPickerTab, readPickerPreviewMediaId,
  findAddMenuTrigger, findClearPromptButton, findAddToPromptButton, findChipByMediaId,
  READ_COMPOSER_STATE_JS, FIND_ASSET_ITEM_BY_MEDIA_ID_JS, LIST_ID_ASSET_MEDIA_IDS_JS, FIND_PICKER_TAB_JS, READ_PICKER_PREVIEW_MEDIA_ID_JS,
  FIND_ADD_MENU_TRIGGER_JS, FIND_CLEAR_PROMPT_BUTTON_JS, FIND_ADD_TO_PROMPT_BUTTON_JS, FIND_CHIP_BY_MEDIA_ID_JS,
} from '../../electron/flow-composer-refs.js'
import { buildPage, buildComposer, buildAssetPicker, mentionHtml, paragraph, idSrc, uuid } from '../fixtures/flow-live-dom-m3.js'

const U = uuid
const run = (expr) => window.eval(expr)
const LANGS = ['ko', 'en']

/** g2-two-chips-before-submit 재현: 칩 king·queen, 편집기 = @king 멘션 + " and a queen in a garden". */
const twoChips = (lang, extra = {}) => buildPage({
  lang,
  composer: { chips: [{ id: U(2) }, { id: U(3) }], editorHtml: paragraph(mentionHtml(U(2), 'king.jpg'), ' and a queen in a garden') },
  ...extra,
})
/** 애셋 창(업로드 탭): id 썸네일 U2·U3, 불투명 둘. */
const pickerItems = [{ id: U(2), name: 'king.jpg' }, { id: U(3) }, { opaque: 1, name: 'Old upload' }, { opaque: 2, kind: 'video' }]
const pickerPage = (lang, picker = {}) => buildPage({ lang, picker: { tab: 'drive_folder_upload', items: pickerItems, ...picker } })

beforeEach(() => { document.body.innerHTML = '' })

describe('readComposerState(doc) → {chips, segments, editorText, pickerOpen, searchDirty, activeInEditor}', () => {
  it.each(LANGS)('%s: 칩 둘(순서) · 멘션 id/라벨 분리 · 텍스트엔 라벨 없음 · 편집기 텍스트엔 라벨 있음 · 창 닫힘', (lang) => {
    document.body.innerHTML = twoChips(lang)
    const state = readComposerState(document)
    expect(state).toEqual({
      chips: [{ mediaId: U(2), busy: false }, { mediaId: U(3), busy: false }],
      segments: [{ t: 'mention', mediaId: U(2), label: 'king.jpg' }, { t: 'text', text: ' and a queen in a garden' }],
      editorText: 'king.jpg and a queen in a garden',
      pickerOpen: false, searchDirty: false, activeInEditor: false,
    })
    expect(run(READ_COMPOSER_STATE_JS)).toEqual(state)
  })

  it('영어 변형도 같은 결과(문구를 안 본다)', () => {
    document.body.innerHTML = twoChips('ko')
    const ko = readComposerState(document)
    document.body.innerHTML = twoChips('en')
    expect(readComposerState(document)).toEqual(ko)
    expect(document.body.innerHTML).toContain('aria-label="Ingredient"')
  })

  it('칩 순서 그대로(DOM 순) — 같은 id 두 칩도 그대로 둘', () => {
    document.body.innerHTML = buildPage({ composer: { chips: [{ id: U(5) }, { id: U(3) }, { id: U(4) }, { id: U(3) }] } })
    expect(readComposerState(document).chips.map((c) => c.mediaId)).toEqual([U(5), U(3), U(4), U(3)])
  })

  it('aria-busy="true" → busy; aria-busy="false" 인데 img 없음 → mediaId:null·busy:false(id 대기 중); busy 여도 img 가 있으면 id', () => {
    document.body.innerHTML = buildPage({ composer: { chips: [{ id: null, busy: true }, { id: null, busy: false }, { id: U(7), busy: true }] } })
    expect(readComposerState(document).chips).toEqual([
      { mediaId: null, busy: true }, { mediaId: null, busy: false }, { mediaId: U(7), busy: true },
    ])
  })

  it('서명 쿼리 붙은 src 에서 UUID 만 — 결과에 Expires·Signature 없음; flow-content.google 이 아닌 img 는 id 아님', () => {
    document.body.innerHTML = twoChips('ko')
    expect(JSON.stringify(readComposerState(document))).not.toMatch(/Expires|Signature|SIGSECRET|flow-content/)
    document.querySelector('button.chip-container img').setAttribute('src', 'https://evil.example/image/' + U(2) + '?x=1')
    expect(readComposerState(document).chips[0]).toEqual({ mediaId: null, busy: false })
  })

  it('같은 미디어 두 번 멘션(PR §4): 멘션 세그먼트 둘·자동 공백은 텍스트로, 라벨은 텍스트 부분에서 빠진다', () => {
    const html = paragraph(mentionHtml(U(46), 'image.png'), ' walks with ', mentionHtml(U(46), 'image.png'), ' in a garden')
    document.body.innerHTML = buildPage({ composer: { chips: [{ id: U(46) }], editorHtml: html } })
    const s = readComposerState(document)
    expect(s.segments).toEqual([
      { t: 'mention', mediaId: U(46), label: 'image.png' }, { t: 'text', text: ' walks with ' },
      { t: 'mention', mediaId: U(46), label: 'image.png' }, { t: 'text', text: ' in a garden' },
    ])
    expect(s.segments.filter((x) => x.t === 'text').map((x) => x.text).join(' ')).not.toContain('image.png')
    expect(s.editorText).toBe('image.png walks with image.png in a garden')
  })

  it('멘션으로 끝나는 문단의 ProseMirror separator img·trailing br 은 세그먼트가 아니다; 문단 둘은 편집기 텍스트에서 \\n', () => {
    document.body.innerHTML = buildPage({ composer: { chips: [{ id: U(2) }], editorHtml: paragraph('A ', mentionHtml(U(2), 'king.jpg')) + paragraph('second') } })
    const s = readComposerState(document)
    expect(s.segments.filter((x) => x.t === 'mention')).toEqual([{ t: 'mention', mediaId: U(2), label: 'king.jpg' }])
    expect(s.segments.map((x) => (x.t === 'text' ? x.text : '@')).join('')).toBe('A @\nsecond')
    expect(s.editorText).toBe('A king.jpg\nsecond')
  })

  it('data-mention-id 가 UUID 가 아니면 멘션 mediaId null(검증 불가)', () => {
    document.body.innerHTML = buildPage({ composer: { chips: [], editorHtml: paragraph(mentionHtml('king.jpg', 'king.jpg'), ' x') } })
    expect(readComposerState(document).segments[0]).toEqual({ t: 'mention', mediaId: null, label: 'king.jpg' })
  })

  it.each(LANGS)('%s: 애셋 창 열림 → pickerOpen(트리거 expanded); 열림 흔적(항목·애셋 검색·추가 버튼)만 있어도 열림으로 본다', (lang) => {
    document.body.innerHTML = pickerPage(lang)
    expect(readComposerState(document).pickerOpen).toBe(true)
    document.body.innerHTML = buildComposer({ lang }) + buildAssetPicker({ lang, items: pickerItems })   // 트리거는 닫힘 표시
    expect(document.querySelector('button.add-menu-trigger').getAttribute('aria-expanded')).toBe('false')
    expect(readComposerState(document).pickerOpen).toBe(true)
    document.body.innerHTML = buildPage({ lang, picker: { tab: 'accessibility_new', items: [], preview: null } })   // D3:e 빈 탭
    expect(readComposerState(document).pickerOpen).toBe(true)
  })

  it('searchDirty 는 애셋 창 검색(cdkfocusinitial)만 본다 — 헤더 검색 글자는 무관', () => {
    document.body.innerHTML = pickerPage('ko', { search: 'ㅎ' })
    expect(readComposerState(document).searchDirty).toBe(true)
    document.body.innerHTML = buildPage({ picker: { items: pickerItems }, headerSearch: 'potato' })
    expect(readComposerState(document).searchDirty).toBe(false)
    document.body.innerHTML = buildPage({ headerSearch: 'potato' })
    expect(readComposerState(document)).toMatchObject({ searchDirty: false, pickerOpen: false })
    // 속성이 아니라 현재 값(.value)을 본다 — 사용자가 친 글자
    document.body.innerHTML = pickerPage('ko')
    document.querySelector('input.search-input[cdkfocusinitial]').value = 'x'
    expect(readComposerState(document).searchDirty).toBe(true)
  })

  it('activeInEditor: 편집기(또는 그 안)에 포커스면 true, 애셋 검색창이면 false', () => {
    document.body.innerHTML = pickerPage('ko')
    document.querySelector('div.ProseMirror[contenteditable="true"]').focus()
    expect(readComposerState(document).activeInEditor).toBe(true)
    expect(run(READ_COMPOSER_STATE_JS).activeInEditor).toBe(true)
    document.querySelector('input.search-input[cdkfocusinitial]').focus()
    expect(readComposerState(document).activeInEditor).toBe(false)
  })

  it('편집기 없음 → editorText null · segments []', () => {
    document.body.innerHTML = buildAssetPicker({ items: pickerItems })
    expect(readComposerState(document)).toMatchObject({ editorText: null, segments: [], chips: [], activeInEditor: false })
  })
})

describe('findAssetItemByMediaId / listIdAssetMediaIds — id 썸네일 항목만', () => {
  it.each(LANGS)('%s: id 로 정확한 항목; *_JS 도 같은 요소', (lang) => {
    document.body.innerHTML = pickerPage(lang)
    const items = document.querySelectorAll('button.asset-item')
    expect(findAssetItemByMediaId(document, U(3))).toBe(items[1])
    expect(findAssetItemByMediaId(document, U(2))).toBe(items[0])
    expect(run(FIND_ASSET_ITEM_BY_MEDIA_ID_JS(U(3)))).toBe(items[1])
  })

  it('같은 id 항목 둘 → null', () => {
    document.body.innerHTML = pickerPage('ko', { items: [{ id: U(2) }, { id: U(2) }, { id: U(3) }] })
    expect(findAssetItemByMediaId(document, U(2))).toBeNull()
    expect(findAssetItemByMediaId(document, U(3))).toBeTruthy()
  })

  it('불투명 썸네일 항목은 어떤 id 로도 안 잡힌다', () => {
    document.body.innerHTML = pickerPage('ko', { items: [{ opaque: 1 }, { opaque: 2 }] })
    for (const id of [U(1), U(2), U(3)]) expect(findAssetItemByMediaId(document, id)).toBeNull()
    expect(listIdAssetMediaIds(document)).toEqual([])
  })

  it('접두 id 오매칭 없음 — src 는 /image/<id> 뒤에 ? 또는 끝이어야 한다; 인자가 id 가 아니면 null', () => {
    document.body.innerHTML = pickerPage('ko', { items: [{ id: U(2) }] })
    const img = document.querySelector('button.asset-item img')
    img.setAttribute('src', idSrc(U(2)).replace(U(2) + '?', U(2) + 'f?'))
    expect(findAssetItemByMediaId(document, U(2))).toBeNull()
    img.setAttribute('src', 'https://flow-content.google/image/' + U(2) + '/thumb')
    expect(findAssetItemByMediaId(document, U(2))).toBeNull()
    img.setAttribute('src', 'https://flow-content.google/image/' + U(2))
    expect(findAssetItemByMediaId(document, U(2))).toBe(document.querySelector('button.asset-item'))
    expect(findAssetItemByMediaId(document, U(2).slice(0, -1))).toBeNull()
    expect(findAssetItemByMediaId(document, '')).toBeNull()
    expect(findAssetItemByMediaId(document, null)).toBeNull()
  })

  it.each(LANGS)('%s: listIdAssetMediaIds 는 id 썸네일 항목의 id 만(순서대로); *_JS 동일', (lang) => {
    document.body.innerHTML = pickerPage(lang)
    expect(listIdAssetMediaIds(document)).toEqual([U(2), U(3)])
    expect(run(LIST_ID_ASSET_MEDIA_IDS_JS)).toEqual([U(2), U(3)])
    document.body.innerHTML = buildPage({ lang })
    expect(listIdAssetMediaIds(document)).toEqual([])
  })

  it('role=option 이 아닌 asset-item·목록 밖 img 는 보지 않는다', () => {
    document.body.innerHTML = pickerPage('ko', { items: [{ id: U(2) }] })
    document.querySelector('button.asset-item').removeAttribute('role')
    expect(findAssetItemByMediaId(document, U(2))).toBeNull()
    expect(listIdAssetMediaIds(document)).toEqual([])
  })
})

describe('findPickerTab / readPickerPreviewMediaId', () => {
  it.each(LANGS)('%s: findPickerTab(doc,"drive_folder_upload") → 아이콘 리거처로(마지막 탭); *_JS 동일', (lang) => {
    document.body.innerHTML = pickerPage(lang)
    const tabs = document.querySelectorAll('[role="tab"]')
    expect(findPickerTab(document, 'drive_folder_upload')).toBe(tabs[6])
    expect(findPickerTab(document, 'dashboard')).toBe(tabs[0])
    expect(run(FIND_PICKER_TAB_JS('drive_folder_upload'))).toBe(tabs[6])
  })

  it('아이콘 없이 "업로드"/"Uploads" 텍스트만 있는 탭 → null; 같은 리거처 탭 둘 → null; 창 닫힘 → null', () => {
    document.body.innerHTML = pickerPage('ko')
    const tab = document.querySelectorAll('[role="tab"]')[6]
    tab.querySelector('mat-icon').remove()
    expect(tab.textContent).toContain('업로드')
    expect(findPickerTab(document, 'drive_folder_upload')).toBeNull()
    expect(findPickerTab(document, '업로드')).toBeNull()
    document.body.innerHTML = pickerPage('en')
    const dup = document.querySelectorAll('[role="tab"]')[6]
    dup.parentNode.appendChild(dup.cloneNode(true))
    expect(findPickerTab(document, 'drive_folder_upload')).toBeNull()
    document.body.innerHTML = buildPage({})
    expect(findPickerTab(document, 'drive_folder_upload')).toBeNull()
  })

  it.each(LANGS)('%s: readPickerPreviewMediaId → 미리보기 id; 불투명 미리보기·미리보기 없음 → null; *_JS 동일', (lang) => {
    document.body.innerHTML = pickerPage(lang)
    expect(readPickerPreviewMediaId(document)).toBe(U(2))
    expect(run(READ_PICKER_PREVIEW_MEDIA_ID_JS)).toBe(U(2))
    document.body.innerHTML = pickerPage(lang, { preview: { opaque: 1 } })
    expect(readPickerPreviewMediaId(document)).toBeNull()
    document.body.innerHTML = pickerPage(lang, { preview: null })
    expect(readPickerPreviewMediaId(document)).toBeNull()
  })
})

describe('findAddMenuTrigger · findClearPromptButton · findAddToPromptButton · findChipByMediaId — 정확히 하나일 때만', () => {
  it.each(LANGS)('%s: 각각 하나 → 그 요소(*_JS 동일)', (lang) => {
    document.body.innerHTML = twoChips(lang, { picker: { items: pickerItems } })
    const trigger = document.querySelector('button.add-menu-trigger')
    const clear = document.querySelector('button.clear-button')
    const add = document.querySelector('button.detail-add-to-prompt-btn')
    const chips = document.querySelectorAll('button.chip-container')
    expect(findAddMenuTrigger(document)).toBe(trigger)
    expect(findClearPromptButton(document)).toBe(clear)
    expect(findAddToPromptButton(document)).toBe(add)
    expect(findChipByMediaId(document, U(3))).toBe(chips[1])
    expect(run(FIND_ADD_MENU_TRIGGER_JS)).toBe(trigger)
    expect(run(FIND_CLEAR_PROMPT_BUTTON_JS)).toBe(clear)
    expect(run(FIND_ADD_TO_PROMPT_BUTTON_JS)).toBe(add)
    expect(run(FIND_CHIP_BY_MEDIA_ID_JS(U(3)))).toBe(chips[1])
  })

  it('없으면 null: 빈 컴포저엔 지우기 없음(D3:c) · 창 닫힘이면 추가 버튼 없음 · 없는 칩 id · img 없는 칩', () => {
    document.body.innerHTML = buildPage({ composer: { chips: [{ id: null, busy: true }] }, headerSearch: '' })
    expect(findClearPromptButton(document)).toBeTruthy()
    expect(findAddToPromptButton(document)).toBeNull()
    expect(findChipByMediaId(document, U(2))).toBeNull()
    document.body.innerHTML = buildPage({})
    expect(findClearPromptButton(document)).toBeNull()
    expect(findAddMenuTrigger(document)).toBeTruthy()
    document.body.innerHTML = buildAssetPicker({ items: pickerItems })
    expect(findAddMenuTrigger(document)).toBeNull()
  })

  it('둘이면 null: 트리거 둘(컴포저 둘) · 지우기 둘 · 추가 버튼 둘 · 같은 id 칩 둘', () => {
    document.body.innerHTML = twoChips('ko', { picker: { items: pickerItems } }) + buildComposer({ chips: [{ id: U(3) }] }) + buildAssetPicker({ items: pickerItems })
    expect(findAddMenuTrigger(document)).toBeNull()
    expect(findClearPromptButton(document)).toBeNull()
    expect(findAddToPromptButton(document)).toBeNull()
    expect(findChipByMediaId(document, U(3))).toBeNull()
    expect(findChipByMediaId(document, U(2))).toBeTruthy()
  })

  it('헤더의 "미디어 메뉴 추가"(mat-mdc-menu-trigger)·헤더 메뉴 div.add-menu 는 트리거가 아니다', () => {
    document.body.innerHTML = '<button class="mdc-icon-button mat-mdc-menu-trigger" aria-label="미디어 메뉴 추가" aria-haspopup="menu"><mat-icon>add</mat-icon></button><div role="menu" class="mat-mdc-menu-panel add-menu"></div>' + buildPage({})
    expect(findAddMenuTrigger(document)).toBe(document.querySelector('button.add-menu-trigger'))
  })
})
