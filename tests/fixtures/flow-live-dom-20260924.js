// 2026-09-24 flow.google.com(Angular) 라이브 컴포저 마크업 픽스처 — docs/handoffs/evidence/2026-09-24-flow-composer-markup.html
// (flow-dom-dump bodyHtml, _ngcontent/_nghost 제거) 그대로. 덤프는 컴포저 트리 중간에서 시작하므로(닫히지 않은
// submit-controls/bottom-controls, 여분의 </div>) 래퍼 둘(af-composer > af-prompt)로 감싸 편집기와 bottom-controls 가
// 공통 조상을 갖게 한다. 카드 more_vert(aria-haspopup=menu) 버튼들은 실제 페이지처럼 컴포저 **앞**에 둔다(D 덤프의 배치).
//
//   아이콘은 <mat-icon class="… google-symbols …">ligature</mat-icon> · 에이전트 칩 button.agent-mode-chip[aria-pressed]
//   · 설정 트리거 button.settings-trigger-button > span.settings-summary · 생성 button.generate-icon-button[type=submit]
//   · 편집기 flow-rich-text-editor > div.prosemirror-editor > div.ProseMirror[contenteditable=true]

/** 카드 더보기 메뉴 버튼 3개(aria-haspopup=menu) — 컴포저 밖의 메뉴 트리거. */
export const CARD_MENU_BUTTONS = "<div class=\"af-card\"><button type=\"button\" class=\"mat-mdc-menu-trigger mat-mdc-tooltip-trigger\" aria-label=\"옵션 더보기\" aria-haspopup=\"menu\" aria-expanded=\"false\"><mat-icon role=\"img\" class=\"mat-icon notranslate google-symbols mat-icon-no-color\" aria-hidden=\"true\" data-mat-icon-type=\"font\">more_vert</mat-icon></button></div><div class=\"af-card\"><button type=\"button\" class=\"mat-mdc-menu-trigger mat-mdc-tooltip-trigger\" aria-label=\"옵션 더보기\" aria-haspopup=\"menu\" aria-expanded=\"false\"><mat-icon role=\"img\" class=\"mat-icon notranslate google-symbols mat-icon-no-color\" aria-hidden=\"true\" data-mat-icon-type=\"font\">more_vert</mat-icon></button></div><div class=\"af-card\"><button type=\"button\" class=\"mat-mdc-menu-trigger mat-mdc-tooltip-trigger\" aria-label=\"옵션 더보기\" aria-haspopup=\"menu\" aria-expanded=\"false\"><mat-icon role=\"img\" class=\"mat-icon notranslate google-symbols mat-icon-no-color\" aria-hidden=\"true\" data-mat-icon-type=\"font\">more_vert</mat-icon></button></div>"

/** 영상 모드 컴포저(ko): 요약 " 동영상 · 720p · 6초 <crop_16_9> x1 ", 에이전트 OFF, 생성 버튼 disabled(빈 편집기). */
export const VIDEO_COMPOSER_KO = "<div class=\"af-composer\"><div class=\"af-prompt\"><flow-rich-text-editor class=\"prompt-input\"><span class=\"prosemirror-placeholder\">무엇을 만들고 싶으신가요?</span><!----><div class=\"prosemirror-editor\"><div contenteditable=\"true\" translate=\"no\" class=\"ProseMirror\"><p><br class=\"ProseMirror-trailingBreak\"></p></div></div></flow-rich-text-editor><!----><!----><!----><div class=\"top-right-actions\"><!----></div></div><!----><!----><div class=\"bottom-controls\"><flow-add-menu><div cdkoverlayorigin=\"\" class=\"add-menu-container\"><button maticonbutton=\"\" type=\"button\" aria-haspopup=\"true\" class=\"mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-tooltip-trigger add-menu-trigger mat-unthemed\" mat-ripple-loader-uninitialized=\"\" mat-ripple-loader-class-name=\"mat-mdc-button-ripple\" mat-ripple-loader-centered=\"\" aria-label=\"프롬프트 상자에 소재 추가\" aria-expanded=\"false\" aria-describedby=\"cdk-describedby-message-ng-1-14\" cdk-describedby-host=\"ng-1\"><span class=\"mat-mdc-button-persistent-ripple mdc-icon-button__ripple\"></span><mat-icon role=\"img\" class=\"mat-icon notranslate add-menu-icon google-symbols mat-icon-no-color\" aria-hidden=\"true\" data-mat-icon-type=\"font\"><!----> add <!----></mat-icon><!----><span class=\"mat-focus-indicator\"></span><span class=\"mat-mdc-button-touch-target\"></span></button><!----><!----></div><!----><!----><!----></flow-add-menu><!----><flow-agent-mode-toggle-chip bottomcontrolextra=\"\"><button class=\"agent-mode-chip\" aria-pressed=\"false\"><!----><span class=\"agent-mode-chip-label\">에이전트</span></button></flow-agent-mode-toggle-chip><!----><div class=\"submit-controls\"><button matbutton=\"\" flow-button=\"\" aria-label=\"설정 트리거\" cdkoverlayorigin=\"\" class=\"mdc-button mat-mdc-button-base settings-trigger-button mdc-button--unelevated mat-mdc-unelevated-button mat-unthemed flow-button-primary flow-button-small\" mat-ripple-loader-class-name=\"mat-mdc-button-ripple\"><span class=\"mat-mdc-button-persistent-ripple mdc-button__ripple\"></span><span class=\"mdc-button__label\"><span settingstriggercontent=\"\" class=\"settings-summary\"> 동영상 · 720p · 6초 <mat-icon role=\"img\" class=\"mat-icon notranslate flow-icon-m google-symbols mat-icon-no-color\" aria-hidden=\"true\" data-mat-icon-type=\"font\">crop_16_9</mat-icon> x1 </span></span><!----><span class=\"mat-focus-indicator\"></span><span class=\"mat-mdc-button-touch-target\"></span><span class=\"mat-ripple mat-mdc-button-ripple\"></span></button><!----><!----><!----><flow-generate-icon-button class=\"mat-mdc-tooltip-trigger\" aria-describedby=\"cdk-describedby-message-ng-1-17\" cdk-describedby-host=\"ng-1\"><button flow-icon-button=\"\" maticonbutton=\"\" type=\"submit\" aria-label=\"생성 시작\" cdkoverlayorigin=\"\" class=\"mdc-icon-button mat-mdc-icon-button mat-mdc-button-base generate-icon-button mat-unthemed flow-icon-button-secondary flow-button-small flow-icon-button-no-touch-target mat-mdc-button-disabled\" mat-ripple-loader-class-name=\"mat-mdc-button-ripple\" mat-ripple-loader-centered=\"\" disabled=\"true\"><span class=\"mat-mdc-button-persistent-ripple mdc-icon-button__ripple\"></span><!----><mat-icon role=\"img\" class=\"mat-icon notranslate flow-icon-m mat-icon-rtl-mirror google-symbols mat-icon-no-color\" aria-hidden=\"true\" data-mat-icon-type=\"font\">arrow_forward</mat-icon><!----><!----><span class=\"mat-focus-indicator\"></span><span class=\"mat-mdc-button-touch-target\"></span><span class=\"mat-ripple mat-mdc-button-ripple\"></span></button><!----></flow-generate-icon-button></div></div></div>"

/** 이미지 모드 컴포저(ko): 요약 " 🍌 Nano Banana 2 <crop_16_9> x1 ". */
export const IMAGE_COMPOSER_KO = "<div class=\"af-composer\"><div class=\"af-prompt\"><flow-rich-text-editor class=\"prompt-input\"><span class=\"prosemirror-placeholder\">무엇을 만들고 싶으신가요?</span><!----><div class=\"prosemirror-editor\"><div contenteditable=\"true\" translate=\"no\" class=\"ProseMirror ProseMirror-focused\"><p><br class=\"ProseMirror-trailingBreak\"></p></div></div></flow-rich-text-editor><!----><!----><!----><div class=\"top-right-actions\"><!----></div></div><!----><!----><div class=\"bottom-controls\"><flow-add-menu><div cdkoverlayorigin=\"\" class=\"add-menu-container\"><button maticonbutton=\"\" type=\"button\" aria-haspopup=\"true\" class=\"mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-tooltip-trigger add-menu-trigger mat-unthemed\" mat-ripple-loader-uninitialized=\"\" mat-ripple-loader-class-name=\"mat-mdc-button-ripple\" mat-ripple-loader-centered=\"\" aria-label=\"프롬프트 상자에 소재 추가\" aria-expanded=\"false\" aria-describedby=\"cdk-describedby-message-ng-1-14\" cdk-describedby-host=\"ng-1\"><span class=\"mat-mdc-button-persistent-ripple mdc-icon-button__ripple\"></span><mat-icon role=\"img\" class=\"mat-icon notranslate add-menu-icon google-symbols mat-icon-no-color\" aria-hidden=\"true\" data-mat-icon-type=\"font\"><!----> add <!----></mat-icon><!----><span class=\"mat-focus-indicator\"></span><span class=\"mat-mdc-button-touch-target\"></span></button><!----><!----></div><!----><!----><!----></flow-add-menu><!----><flow-agent-mode-toggle-chip bottomcontrolextra=\"\"><button class=\"agent-mode-chip\" aria-pressed=\"false\"><!----><span class=\"agent-mode-chip-label\">에이전트</span></button></flow-agent-mode-toggle-chip><!----><div class=\"submit-controls\"><button matbutton=\"\" flow-button=\"\" aria-label=\"설정 트리거\" cdkoverlayorigin=\"\" class=\"mdc-button mat-mdc-button-base settings-trigger-button mdc-button--unelevated mat-mdc-unelevated-button mat-unthemed flow-button-primary flow-button-small\" mat-ripple-loader-class-name=\"mat-mdc-button-ripple\"><span class=\"mat-mdc-button-persistent-ripple mdc-button__ripple\"></span><span class=\"mdc-button__label\"><span settingstriggercontent=\"\" class=\"settings-summary\"> 🍌 Nano Banana 2 <mat-icon role=\"img\" class=\"mat-icon notranslate flow-icon-m google-symbols mat-icon-no-color\" aria-hidden=\"true\" data-mat-icon-type=\"font\">crop_16_9</mat-icon> x1 </span></span><!----><span class=\"mat-focus-indicator\"></span><span class=\"mat-mdc-button-touch-target\"></span><span class=\"mat-ripple mat-mdc-button-ripple\"></span></button><!----><!----><!----><flow-generate-icon-button class=\"mat-mdc-tooltip-trigger\" aria-describedby=\"cdk-describedby-message-ng-1-17\" cdk-describedby-host=\"ng-1\"><button flow-icon-button=\"\" maticonbutton=\"\" type=\"submit\" aria-label=\"생성 시작\" cdkoverlayorigin=\"\" class=\"mdc-icon-button mat-mdc-icon-button mat-mdc-button-base generate-icon-button mat-unthemed flow-icon-button-secondary flow-button-small flow-icon-button-no-touch-target mat-mdc-button-disabled\" mat-ripple-loader-class-name=\"mat-mdc-button-ripple\" mat-ripple-loader-centered=\"\" disabled=\"true\"><span class=\"mat-mdc-button-persistent-ripple mdc-icon-button__ripple\"></span><!----><mat-icon role=\"img\" class=\"mat-icon notranslate flow-icon-m mat-icon-rtl-mirror google-symbols mat-icon-no-color\" aria-hidden=\"true\" data-mat-icon-type=\"font\">arrow_forward</mat-icon><!----><!----><span class=\"mat-focus-indicator\"></span><span class=\"mat-mdc-button-touch-target\"></span><span class=\"mat-ripple mat-mdc-button-ripple\"></span></button><!----></flow-generate-icon-button></div></div></div>"

/** 영어 변형 — 에이전트 칩 라벨만 Agent. 파인더는 라벨을 보지 않는다. */
export const IMAGE_COMPOSER_EN = IMAGE_COMPOSER_KO.replace('>에이전트<', '>Agent<')

/** 실제 페이지 배치: 카드들 뒤에 컴포저. */
export const PAGE_IMAGE_KO = CARD_MENU_BUTTONS + IMAGE_COMPOSER_KO
export const PAGE_VIDEO_KO = CARD_MENU_BUTTONS + VIDEO_COMPOSER_KO
export const PAGE_IMAGE_EN = CARD_MENU_BUTTONS + IMAGE_COMPOSER_EN

// ─── 설정 패널(D 덤프 재구성: 2026-09-24-flow-composer-dom-{image,video}-panel-open.elements.json) ────────────
// Material button-toggle: button.mat-button-toggle-button[role=radio][aria-checked] 이 자동 번호 name(mat-button-toggle-group-N)
// 으로 묶인다(id 도 자동 번호). 라벨에는 <mat-icon> 리거처가 섞인다(image/videocam, crop_*, info). 모델 트리거는
// button[aria-haspopup=menu](페이지에 여럿 — 카드 more_vert, 프로젝트 메뉴) 라 패널 스코프 안에서만 찾아야 한다.
// 패널은 cdk 오버레이(컴포저 밖)에 뜬다.

const ICON = (lig) => `<mat-icon role="img" class="mat-icon notranslate google-symbols mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">${lig}</mat-icon>`

/** 프로젝트 옵션 더보기(aria-haspopup=menu) — 헤더의 메뉴 트리거. */
export const PROJECT_MENU_BUTTON = `<button class="mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-menu-trigger more-options-button" aria-label="프로젝트 옵션 더보기" aria-haspopup="menu" aria-expanded="false">${ICON('more_vert')}</button>`

// D 의 자동 번호 그대로(offset 0). 셔플 사본은 offset 으로 번호를 통째로 옮긴다 — 번호로 매칭하면 깨진다.
const GROUPS = {
  mode: { group: 28, ids: [85, 86], options: [['image', '이미지'], ['videocam', '동영상']] },
  ratioImage: { group: 27, ids: [91, 92, 93, 94, 95], options: [['crop_16_9', '16:9'], ['crop_landscape', '4:3'], ['crop_square', '1:1'], ['crop_portrait', '3:4'], ['crop_9_16', '9:16']] },
  ratioVideo: { group: 27, ids: [91, 95], options: [['crop_16_9', '16:9'], ['crop_9_16', '9:16']] },
  inputMode: { group: 30, ids: [96, 97], options: [['crop_free', '프레임'], ['chrome_extension', '소재']] },
  resolution: { group: 31, ids: [98, 99], options: [[null, '360p', 'info'], [null, '720p']] },
  duration: { group: 32, ids: [100, 101, 102, 103], options: [[null, '4초'], [null, '6초'], [null, '8초'], [null, '10초']] },
  count: { group: 29, ids: [87, 88, 89, 90], options: [[null, 'x1'], [null, 'x2'], [null, 'x3'], [null, 'x4']] },
}

function toggleGroup(spec, checkedKey, offset, material = true) {
  const name = `mat-button-toggle-group-${spec.group + offset}`
  const buttons = spec.options.map(([lig, text, trailing], i) => {
    const key = lig || text
    const checked = key === checkedKey
    const label = `${lig ? ICON(lig) : ''}${text}${trailing ? ICON(trailing) : ''}`
    const cls = material ? 'mat-button-toggle-button mat-focus-indicator' : 'plain-radio'
    return `<mat-button-toggle class="mat-button-toggle${checked ? ' mat-button-toggle-checked' : ''}"><button type="button" class="${cls}" id="mat-button-toggle-${spec.ids[i] + offset}-button" role="radio" tabindex="${checked ? 0 : -1}" aria-checked="${checked}" name="${name}"><span class="mat-button-toggle-label-content">${label}</span></button><span class="mat-button-toggle-focus-overlay"></span></mat-button-toggle>`
  }).join('')
  return `<mat-button-toggle-group role="group" class="mat-button-toggle-group mat-button-toggle-group-appearance-standard" aria-disabled="false">${buttons}</mat-button-toggle-group>`
}

function modelTrigger(label, { expanded = false, controls = null } = {}) {
  return `<button matbutton="" class="mdc-button mat-mdc-button-base mat-mdc-menu-trigger mdc-button--unelevated mat-mdc-unelevated-button mat-unthemed flow-button-primary flow-button-medium" aria-label="모델 제품군 선택" aria-haspopup="menu" aria-expanded="${expanded}"${controls ? ` aria-controls="${controls}"` : ''}><span class="mdc-button__label">${label}</span>${ICON('arrow_drop_down')}</button>`
}

/**
 * 열린 설정 패널. mode 'image' | 'video'. checked 로 각 그룹의 선택값(리거처 또는 텍스트)을 바꾼다.
 * offset 은 자동 번호(id/name) 셔플, material:false 는 Material 이 아닌 라디오(input-mode-not-material 케이스).
 */
export function buildSettingsPanel({ mode = 'image', checked = {}, offset = 0, model, material = true, durations = null } = {}) {
  const c = { mode: mode === 'video' ? 'videocam' : 'image', ratio: 'crop_16_9', count: 'x1', inputMode: 'chrome_extension', resolution: '720p', duration: '6초', ...checked }
  const parts = [toggleGroup(GROUPS.mode, c.mode, offset, material)]
  if (mode === 'video') {
    parts.push(toggleGroup(GROUPS.inputMode, c.inputMode, offset, material))
    parts.push(toggleGroup(GROUPS.ratioVideo, c.ratio, offset, material))
    parts.push(modelTrigger(model || 'Omni 1.1 Flash'))
    parts.push(toggleGroup(GROUPS.resolution, c.resolution, offset, material))
    // M2-R3 H4: durations 로 현재 모델의 길이 옵션을 바꿀 수 있다(예: 8초 없는 모델)
    parts.push(durations ? buildDurationGroup(durations, c.duration, offset, material) : toggleGroup(GROUPS.duration, c.duration, offset, material))
  } else {
    parts.push(toggleGroup(GROUPS.ratioImage, c.ratio, offset, material))
    parts.push(modelTrigger(model || '🍌 Nano Banana 2'))
  }
  parts.push(toggleGroup(GROUPS.count, c.count, offset, material))
  return `<div class="cdk-overlay-container"><div class="cdk-overlay-pane"><div class="flow-settings-panel">${parts.map((p) => `<div class="setting-row">${p}</div>`).join('')}</div></div></div>`
}

/** M2-R3 H4: 길이 그룹만(라벨 목록으로) — 모델 선택이 길이 옵션을 갈아끼우는 가짜 Angular 가 쓴다. checked 가 목록에 없으면 첫 항목. */
export function buildDurationGroup(labels, checkedLabel, offset = 0, material = true) {
  const spec = { group: GROUPS.duration.group, ids: labels.map((_, i) => GROUPS.duration.ids[0] + i), options: labels.map((l) => [null, l]) }
  return toggleGroup(spec, labels.includes(checkedLabel) ? checkedLabel : labels[0], offset, material)
}

/** 열린 모델 메뉴(video-model-menu 덤프): div#mat-menu-panel-N[role=menu] > button.mat-mdc-menu-item[role=menuitem]. */
export function buildModelMenu(id = 'mat-menu-panel-20', items = ['Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality']) {
  const buttons = items.map((t) => `<button class="mat-mdc-menu-item mat-focus-indicator mat-mdc-menu-trigger flow-internal-menu-item" role="menuitem" aria-expanded="false">${ICON('volume_up')}<span class="mat-mdc-menu-item-text">${t}</span></button>`).join('')
  return `<div class="cdk-overlay-pane"><div role="menu" class="mat-mdc-menu-panel flow-menu-panel flow-model-picker-panel mat-menu-above mat-menu-after" id="${id}"><div class="mat-mdc-menu-content">${buttons}</div></div></div>`
}
