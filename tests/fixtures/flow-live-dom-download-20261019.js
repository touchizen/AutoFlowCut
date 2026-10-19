// flow.google.com(Angular) 미디어 편집 화면(/project/<pid>/edit/<editId>)의 다운로드 메뉴 — 2026-10-19 라이브(Chrome 탭) 판독에서
//   구조만 옮겼다(Angular _ngcontent 속성·ripple span 은 뺐다). 문구는 Flow 의 한국어 UI 그대로 — 프로브는 문구가 아니라
//   아이콘 글자(download)·위치(cta-buttons, hotbar 아님)·해상도 숫자(1080p · 4K)로 찾아야 한다.
//
// 그리드 타일은 hover 전엔 미리보기 src(flow.google.com/asb/<token>=mm,…)라 mediaId 로 찾을 수 없다(같은 날 덤프 비교).
// 편집 id 는 as29s 기록의 [2](= [mediaId, projectId, editId, …]) — 그 경로로 가면 상단 "미디어 다운로드" 메뉴가 해상도 목록을 바로 연다.

export const PROJECT_ID = 'f4f8378f-f606-43ff-9aa7-fabca351d2f4'
export const MEDIA_ID = 'ba1764fb-6f24-49d4-9b1e-6c13af2f1f7b'
export const EDIT_ID = 'd2ac9584-3ba2-47fa-a529-8a4c85416f07'
export const GRID_PATH = `/project/${PROJECT_ID}`
export const EDIT_PATH = `/project/${PROJECT_ID}/edit/${EDIT_ID}`
/** 편집 화면 머리말의 미디어 제목(Flow 가 붙인 이름) — 다운로드 파일 이름이 이걸로 시작한다(Amber_light_particles_drifting_1080p_<시각>.mp4). */
export const MEDIA_TITLE = 'Amber light particles drifting'

const icon = (name) => `<mat-icon role="img" class="mat-icon notranslate google-symbols mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">${name}</mat-icon>`

/** 편집 화면 — 상단 cta-buttons 의 "미디어 다운로드"(메뉴 트리거) + 타임라인 hotbar 의 "다운로드"(같은 아이콘, 고르면 안 된다). */
export function editorPage({ menuOpen = false, fourKDisabled = true, upscale1080Disabled = false } = {}) {
  const trigAttrs = menuOpen ? 'aria-haspopup="menu" aria-expanded="true" aria-controls="mat-menu-panel-0"' : 'aria-haspopup="menu" aria-expanded="false"'
  const header = `
<span class="header-title"><span class="header-title-heading visually-hidden" aria-level="1" aria-label="${MEDIA_TITLE}" role="heading">${MEDIA_TITLE}</span><flow-editable-text><div class="editable-text-container"><input type="text" class="editable-text-input" size="35" placeholder=""></div></flow-editable-text></span>
<div class="header-desktop-main-row"><div cta-buttons-content-marker="" class="cta-buttons">
  <button flow-icon-button="" maticonbutton="" class="mdc-icon-button mat-mdc-icon-button mat-mdc-tooltip-trigger" aria-label="즐겨찾기">${icon('favorite')}</button>
  <button flow-icon-button="" maticonbutton="" class="mdc-icon-button mat-mdc-icon-button mat-mdc-tooltip-trigger" aria-label="공유">${icon('share')}</button>
  <button flow-icon-button="" maticonbutton="" class="mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-menu-trigger mat-unthemed" aria-label="미디어 다운로드" ${trigAttrs}>${icon('download')}</button>
  <button flow-icon-button="" maticonbutton="" class="mdc-icon-button mat-mdc-icon-button mat-mdc-menu-trigger" aria-label="옵션 더보기" aria-haspopup="menu" aria-expanded="false">${icon('more_vert')}</button>
</div></div>`
  const hotbar = `
<div class="hotbar-inner">
  <button flowhotbarbutton="" type="button" class="mat-mdc-tooltip-trigger" aria-label="프로젝트에 저장">${icon('library_add')}</button>
  <button flowhotbarbutton="" type="button" class="mat-mdc-menu-trigger mat-mdc-tooltip-trigger" aria-label="다운로드" aria-haspopup="menu" aria-expanded="false">${icon('download')}</button>
</div>`
  return header + `<main>${hotbar}</main>` + (menuOpen ? overlay(resolutionPanel({ fourKDisabled, upscale1080Disabled })) : '')
}

/** "미디어 다운로드" 메뉴 — 하위 메뉴 없이 해상도 항목이 바로 나온다. 4K 는 플랜 밖이면 disabled(+업그레이드). */
export function resolutionPanel({ fourKDisabled = true, upscale1080Disabled = false, id = 'mat-menu-panel-0' } = {}) {
  const item = (label, disabled) =>
    `<button mat-menu-item="" class="mat-mdc-menu-item mat-mdc-menu-trigger flow-internal-menu-item${disabled ? ' mat-mdc-menu-item-disabled' : ''}" role="menuitem" tabindex="${disabled ? '-1' : '0'}"${disabled ? ' disabled="true"' : ''} aria-expanded="false"><span class="mat-mdc-menu-item-text">${label}</span></button>`
  return `
<div tabindex="-1" role="menu" class="mat-mdc-menu-panel flow-menu-panel mat-menu-after mat-menu-below" id="${id}">
  ${item('270p 애니메이션 GIF', false)}
  ${item('720p 원본 크기', false)}
  ${item('1080p 업스케일링됨', upscale1080Disabled)}
  ${item('4K 업스케일링됨', fourKDisabled)}
  <a class="upgrade-link">업그레이드</a>
</div>`
}

export function overlay(...panels) {
  return `<div class="cdk-overlay-container">${panels.map((p) => `<div class="cdk-overlay-pane">${p}</div>`).join('')}</div>`
}

/** 그리드(편집 화면이 아님) — 타일 hotbar 에도 메뉴 트리거가 있지만 다운로드 아이콘은 없다. */
export function gridPage() {
  return `<main><flow-video-tile><div class="container"><video src="https://flow.google.com/asb/ANqvLOY6ANZaz6JLeeSXV=mm,22,15"></video>
<div class="hotbar-inner"><button flowhotbarbutton="" type="button" class="mat-mdc-menu-trigger" aria-label="옵션 더보기" aria-haspopup="menu" aria-expanded="false">${icon('more_vert')}</button></div>
</div></flow-video-tile></main>`
}
