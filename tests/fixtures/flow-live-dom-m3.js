// 2026-09-25 M3(레퍼런스) 컴포저 칩 바·멘션·애셋 창 DOM 픽스처(마스킹) — M3 계획서 §1-4 ③⑤⑥ · §4 "M3 픽스처".
//
// 근거(관측):
//   덤프 docs/handoffs/evidence/2026-09-25-m3-dom-*.elements.json(D3) — 요소의 태그·클래스·속성:
//     칩 button.chip-container[aria-label=소재][aria-busy] + img(alt "소재 이미지", src flow-content.google/image/<id>?Expires…&Signature…)
//     지우기 button.clear-button[aria-label="프롬프트 지우기"](아이콘 close) · 트리거 button.add-menu-trigger[aria-haspopup=true][aria-expanded]
//     (닫힘 add / 열림 close + add-menu-trigger-active) · 헤더 검색 input.search-input[aria-label=검색](항상 있다 — cdkfocusinitial 없음)
//     애셋 창: 탭 mat-list-item[role=tab](리거처 dashboard·image·videocam·voice_selection·accessibility_new·face·drive_folder_upload + 라벨),
//     검색 input.search-input[cdkfocusinitial][aria-label="애셋 검색"], 정렬 mat-select.sort-selector-dropdown, 업로드 button.sidebar-upload-btn,
//     항목 button.asset-item[role=option][aria-selected](활성 항목 asset-item-active), 추가 button.detail-add-to-prompt-btn("프롬프트에 추가").
//   RAW bodyHtml(저장소 밖, 마스킹해 읽은 사실): flow-ingredient-bar > … > flow-image-ingredient-chip > button.chip-container >
//     div.chip-image-wrapper > img.chip-image + div.hover-icon-overlay > mat-icon(cancel) · div.top-right-actions > button.clear-button.
//   프로브(PR): P3 멘션 노드 span.mention-chip[data-mention-id][data-reference-type=media][contenteditable=false](라벨 텍스트) + 삽입 뒤 자동 공백 ·
//     P5 목록 cdk-virtual-scroll-viewport.asset-list-viewport · 미리보기 img.detail-preview-image · 이번 페이지 세션 업로드만 id 썸네일
//     (flow-content.google/image/<id>), 나머지는 불투명 lh3…/asb/… · P1a 업로드 중 칩은 aria-busy="true"·img 없음 → busy 해제 뒤에도 한동안 img 없음.
// 재구성(파인더가 보지 않는 것): `af-*` 클래스 래퍼, 항목 안 썸네일·이름 배치, 영어 문구 대부분. 컴포저 뼈대는 09-24 라이브 마크업
//   (flow-live-dom-20260924.js IMAGE_COMPOSER_KO)에 칩 바·지우기·트리거 상태만 끼운다.
// 영어 변형(lang:'en'): 문구만 바뀐다(탭 "Uploads", 칩 aria-label "Ingredient" 등 — 앞 둘은 계획서가 지정, 나머지는 예시) — 파인더가 문구를 안 보는 증명.
import { IMAGE_COMPOSER_KO } from './flow-live-dom-20260924.js'

const ICON = (lig) => `<mat-icon role="img" class="mat-icon notranslate google-symbols mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">${lig}</mat-icon>`

export const PICKER_TABS = ['dashboard', 'image', 'videocam', 'voice_selection', 'accessibility_new', 'face', 'drive_folder_upload']

const TEXT = {
  ko: {
    chip: '소재', chipImg: '소재 이미지', clear: '프롬프트 지우기', trigger: '프롬프트 상자에 소재 추가', headerSearch: '검색',
    assetSearch: '애셋 검색', sort: '애셋 정렬', sortRecent: '최근', project: '프로젝트 선택', upload: '미디어 업로드', addToPrompt: '프롬프트에 추가',
    kind: { image: '이미지', video: '동영상' },
    tabs: { dashboard: '전체', image: '이미지', videocam: '동영상', voice_selection: '음성', accessibility_new: '캐릭터', face: '아바타', drive_folder_upload: '업로드' },
  },
  en: {
    chip: 'Ingredient', chipImg: 'Ingredient image', clear: 'Clear prompt', trigger: 'Add ingredients to the prompt box', headerSearch: 'Search',
    assetSearch: 'Search assets', sort: 'Sort assets', sortRecent: 'Recent', project: 'Select project', upload: 'Upload media', addToPrompt: 'Add to prompt',
    kind: { image: 'Image', video: 'Video' },
    tabs: { dashboard: 'All', image: 'Images', videocam: 'Videos', voice_selection: 'Voices', accessibility_new: 'Characters', face: 'Avatars', drive_folder_upload: 'Uploads' },
  },
}

/** 마스킹 id `<uuid#n>` 의 UUID 모양 — flow-batchexecute-samples.js maskedUuid 와 같은 식(그 로더는 fs 를 읽어 jsdom 환경에서 import 할 수 없다). */
export const uuid = (n) => String(n).padStart(8, '0') + '-0000-4000-8000-000000000000'

/** 이번 페이지 세션 업로드의 id 썸네일(서명 쿼리 포함 — 파인더는 UUID 만 읽어야 한다). */
export const idSrc = (id) => `https://flow-content.google/image/${id}?Expires=1790338020&KeyName=labs-flow-prod-cdn-key&Signature=SIGSECRET`
/** 앞 세션 업로드·생성 이미지의 불투명 썸네일(id 를 드러내지 않는다). */
export const opaqueSrc = (n) => `https://lh3.googleusercontent.com/asb/OPAQUE-TOKEN-${n}=s512`

/** P3 멘션 노드. */
export const mentionHtml = (id, label) => `<span class="mention-chip" data-mention-id="${id}" data-reference-type="media" contenteditable="false">${label}</span>`

/** ProseMirror 문단 하나 — 끝이 인라인 노드면 ProseMirror 가 separator img + trailing br 을 붙인다(텍스트 아님). */
export const paragraph = (...parts) => `<p>${parts.join('')}${/<\/span>$/.test(parts[parts.length - 1] || '') ? '<img class="ProseMirror-separator" alt=""><br class="ProseMirror-trailingBreak">' : ''}</p>`
export const EMPTY_EDITOR = '<p><br class="ProseMirror-trailingBreak"></p>'

/** 칩 하나. id 가 null 이면 img 없음(업로드 중 · busy 해제 직후). */
export function chipHtml({ id = null, busy = false, lang = 'ko' } = {}) {
  const T = TEXT[lang]
  const img = id ? `<img class="chip-image" alt="${T.chipImg}" src="${idSrc(id)}">` : ''
  return `<flow-image-ingredient-chip><button cdkoverlayorigin="" class="chip-container" aria-label="${T.chip}" aria-busy="${busy}"><div class="chip-image-wrapper">${img}</div><div class="hover-icon-overlay">${ICON('cancel')}</div></button></flow-image-ingredient-chip>`
}

function must(html, from, to) {
  if (!html.includes(from)) throw new Error('fixture anchor missing: ' + from.slice(0, 60))
  return html.split(from).join(to)
}

/**
 * 컴포저(09-24 라이브 마크업) + 칩 바 · 편집기 내용 · 지우기 버튼 · 트리거 상태.
 * @param {{chips?: Array<{id?:string|null, busy?:boolean}>, editorHtml?: string, expanded?: boolean, clear?: boolean, lang?: 'ko'|'en'}} [o]
 *   clear 생략 = 칩이나 텍스트가 있으면 보인다(D3:c 빈 컴포저엔 없고 b2 칩만 있어도 있다).
 */
export function buildComposer({ chips = [], editorHtml = EMPTY_EDITOR, expanded = false, clear, lang = 'ko' } = {}) {
  const T = TEXT[lang]
  const showClear = clear ?? (chips.length > 0 || editorHtml !== EMPTY_EDITOR)
  const bar = `<flow-ingredient-bar><div class="af-ingredient-list">${chips.map((c) => chipHtml({ ...c, lang })).join('')}</div></flow-ingredient-bar>`
  const clearBtn = `<button mat-icon-button="" type="button" class="mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-tooltip-trigger clear-button clear-button-no-touch-target mat-unthemed" aria-label="${T.clear}">${ICON('close')}</button>`
  let html = IMAGE_COMPOSER_KO
  html = must(html, '<flow-rich-text-editor', bar + '<flow-rich-text-editor')
  html = must(html, `<div contenteditable="true" translate="no" class="ProseMirror ProseMirror-focused">${EMPTY_EDITOR}</div>`, `<div contenteditable="true" translate="no" class="ProseMirror">${editorHtml}</div>`)
  html = must(html, '<div class="top-right-actions"><!----></div>', `<div class="top-right-actions">${showClear ? clearBtn : '<!---->'}</div>`)
  if (expanded) {
    html = must(html, 'add-menu-trigger mat-unthemed"', 'add-menu-trigger mat-unthemed add-menu-trigger-active"')
    html = must(html, 'aria-expanded="false" aria-describedby="cdk-describedby-message-ng-1-14"', 'aria-expanded="true" aria-describedby="cdk-describedby-message-ng-1-14"')
    html = must(html, '<!----> add <!---->', '<!----> close <!---->')
  }
  if (lang === 'en') {
    html = must(html, 'aria-label="프롬프트 상자에 소재 추가"', `aria-label="${T.trigger}"`)
    html = must(html, '무엇을 만들고 싶으신가요?', 'What do you want to create?')
    html = must(html, '>에이전트<', '>Agent<')
    html = must(html, 'aria-label="생성 시작"', 'aria-label="Start generating"')
    html = must(html, 'aria-label="설정 트리거"', 'aria-label="Settings trigger"')
  }
  return html
}

/**
 * 열린 애셋 창(cdk 오버레이 — 컴포저 밖). items 는 {id} (id 썸네일) 또는 {opaque:n} (불투명), 선택 name·kind.
 * preview 생략 = 첫 항목(활성)의 미리보기, null = 상세 창 없음(D3:e 빈 탭), {id}|{opaque} 로 따로 지정.
 */
export function buildAssetPicker({ tab = 'dashboard', items = [], preview, search = '', lang = 'ko' } = {}) {
  const T = TEXT[lang]
  const tabs = PICKER_TABS.map((lig) => {
    const sel = lig === tab
    return `<mat-list-item role="tab" class="mat-mdc-list-item mdc-list-item mat-mdc-tooltip-trigger side-nav-list-item mat-mdc-list-item-interactive${sel ? ' side-nav-list-item-active mdc-list-item--activated' : ''} mdc-list-item--with-leading-icon" aria-selected="${sel}" aria-disabled="false"><span class="mdc-list-item__start">${ICON(lig)}</span><span class="mdc-list-item__content"><span class="mdc-list-item__primary-text">${T.tabs[lig]}</span></span></mat-list-item>`
  }).join('')
  const src = (it) => (it.id ? idSrc(it.id) : opaqueSrc(it.opaque))
  const list = items.map((it, i) => `<button type="button" role="option" class="asset-item${i === 0 ? ' asset-item-active' : ''}" aria-selected="false"><div class="af-asset-thumb"><img alt="" src="${src(it)}"></div><span class="af-asset-name">${it.name || 'image.png'}</span><span class="af-asset-kind">${T.kind[it.kind || 'image']}</span></button>`).join('')
  const pv = preview === undefined ? items[0] || null : preview
  const detail = pv ? `<div class="af-asset-detail"><img class="detail-preview-image" alt="" src="${src(pv)}"><button type="button" mat-button="" flow-button="" class="mdc-button mat-mdc-button-base detail-add-to-prompt-btn mat-tonal-button mat-unthemed flow-button-secondary flow-button-medium flow-button-no-touch-target">${T.addToPrompt}</button></div>` : ''
  return `<div class="cdk-overlay-container"><div class="cdk-overlay-pane"><div class="af-asset-picker">`
    + `<div class="af-asset-sidebar"><mat-select role="combobox" aria-haspopup="listbox" aria-label="${T.project}" class="mat-mdc-select sidebar-project-selector" tabindex="0" aria-expanded="false"></mat-select>${tabs}`
    + `<button mat-button="" flow-button="" type="button" mattooltip="${T.upload}" class="mdc-button mat-mdc-button-base mat-mdc-tooltip-trigger sidebar-upload-btn mat-mdc-button mat-unthemed">${ICON('upload')}<span class="mdc-button__label">${T.upload}</span></button></div>`
    + `<div class="af-asset-main"><input type="text" cdkfocusinitial="" aria-label="${T.assetSearch}" placeholder="${T.assetSearch}" class="search-input" value="${search}">`
    + `<mat-select role="combobox" aria-haspopup="listbox" aria-label="${T.sort}" class="mat-mdc-select sort-selector-dropdown" tabindex="0" aria-expanded="false">${T.sortRecent}</mat-select>`
    + `<cdk-virtual-scroll-viewport class="cdk-virtual-scroll-viewport asset-list-viewport"><div class="cdk-virtual-scroll-content-wrapper">${list}</div></cdk-virtual-scroll-viewport></div>`
    + detail + `</div></div></div>`
}

/** 헤더(프로젝트 페이지 상단) — 전역 검색 input.search-input 은 애셋 창과 무관하게 항상 있다(cdkfocusinitial 없음). */
export function buildHeader({ search = '', lang = 'ko' } = {}) {
  const T = TEXT[lang]
  return `<div class="af-header"><button flow-icon-button="" maticonbutton="" class="mdc-icon-button mat-mdc-icon-button mat-mdc-button-base icon-button-inside-search-input search-button" aria-label="${T.headerSearch}">${ICON('search')}</button><input type="text" aria-label="${T.headerSearch}" class="search-input" value="${search}"></div>`
}

/** 페이지 = 헤더 + 컴포저(애셋 창이 열려 있으면 트리거 expanded) + 애셋 창. */
export function buildPage({ composer = {}, picker = null, headerSearch = '', lang = 'ko' } = {}) {
  return buildHeader({ search: headerSearch, lang })
    + buildComposer({ expanded: !!picker, ...composer, lang })
    + (picker ? buildAssetPicker({ ...picker, lang }) : '')
}
