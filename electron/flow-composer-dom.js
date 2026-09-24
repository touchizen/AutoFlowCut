/**
 * electron/flow-composer-dom.js
 *
 * flow.google.com(Angular, 2026-09) 컴포저 DOM 파인더 — 순수 함수(jsdom 테스트), 같은 함수를 toString() 으로
 * 페이지에 주입한다(각 *_JS 는 단일 표현식, 자기완결 — 다른 헬퍼를 이름으로 부르지 않는다).
 *
 * 라이브 마크업(docs/handoffs/evidence/2026-09-24-flow-composer-markup.html):
 *   편집기      flow-rich-text-editor > div.prosemirror-editor > div.ProseMirror[contenteditable=true] > p…
 *   에이전트 칩 flow-agent-mode-toggle-chip > button.agent-mode-chip[aria-pressed]   (flow-agent-toggle.js)
 *   설정 트리거 button.settings-trigger-button > span.mdc-button__label > span.settings-summary(텍스트 + <mat-icon>)
 *   생성 버튼   flow-generate-icon-button > button.generate-icon-button[type=submit] > <mat-icon>arrow_forward</mat-icon>
 * 아이콘은 <mat-icon class="… google-symbols …">ligature</mat-icon> — 옛 <i>/<span> 변형도 같이 본다.
 * 로케일 텍스트(aria-label "생성 시작" 등)는 절대 보지 않는다 — 클래스·타입·리거처만.
 * tests/electron/flow-composer-dom.test.js · tests/electron/flow-injections-minified.test.js
 */

/** 생성(제출) 버튼 — button.generate-icon-button[type=submit] 이고 아이콘 리거처가 arrow_forward 인 것. 없으면 null. */
export function findGenerateButton(doc) {
  const buttons = Array.from(doc.querySelectorAll('button.generate-icon-button[type="submit"]'))
  const matches = buttons.filter((b) => {
    const icons = Array.from(b.querySelectorAll("mat-icon, i, span[class*='symbols'], [class*='google-symbols']"))
    return icons.some((i) => (i.textContent || '').trim() === 'arrow_forward')
  })
  return matches.length === 1 ? matches[0] : null
}

/** 설정 트리거 버튼(요약 텍스트를 품은 button.settings-trigger-button). 정확히 하나일 때만. */
export function findSettingsTrigger(doc) {
  const triggers = Array.from(doc.querySelectorAll('button.settings-trigger-button'))
    .filter((b) => !!b.querySelector('.settings-summary'))
  return triggers.length === 1 ? triggers[0] : null
}

/** 닫힌 설정 트리거의 요약 → { text(아이콘 제거·공백 압축), ligatures[] }. 트리거 없으면 null. */
export function readSettingsSummary(doc) {
  const triggers = Array.from(doc.querySelectorAll('button.settings-trigger-button'))
    .filter((b) => !!b.querySelector('.settings-summary'))
  if (triggers.length !== 1) return null
  const summary = triggers[0].querySelector('.settings-summary')
  const iconEls = Array.from(summary.querySelectorAll("mat-icon, i, span[class*='symbols'], [class*='google-symbols']"))
  const ligatures = iconEls.map((i) => (i.textContent || '').trim()).filter(Boolean)
  const clone = summary.cloneNode(true)
  Array.from(clone.querySelectorAll("mat-icon, i, span[class*='symbols'], [class*='google-symbols']")).forEach((i) => i.remove())
  const text = (clone.textContent || '').replace(/\s+/g, ' ').trim()
  return { text, ligatures }
}

/** 프롬프트 편집기 — ProseMirror 우선, 그다음 옛 Slate, 그다음 보이는 contenteditable. 없으면 null. */
export function findPromptEditor(doc) {
  return doc.querySelector('div.ProseMirror[contenteditable="true"]')
    || doc.querySelector("[data-slate-editor='true']")
    || doc.querySelector("div[role='textbox'][contenteditable='true']:not([aria-hidden='true'])")
    || null
}

/** 편집기 텍스트 — ProseMirror 는 <p> 문단을 '\n' 로 결합, 그 외는 textContent. 편집기 없으면 null. */
export function readEditorText(doc) {
  const editor = doc.querySelector('div.ProseMirror[contenteditable="true"]')
    || doc.querySelector("[data-slate-editor='true']")
    || doc.querySelector("div[role='textbox'][contenteditable='true']:not([aria-hidden='true'])")
  if (!editor) return null
  const paragraphs = Array.from(editor.querySelectorAll('p'))
  if (editor.classList.contains('ProseMirror') && paragraphs.length > 0) {
    return paragraphs.map((p) => (p.textContent || '').replace(/​|﻿/g, '')).join('\n').trim()
  }
  return (editor.textContent || '').replace(/​|﻿/g, '').trim()
}

// ─── 페이지 주입 표현식(단일 표현식, 자기완결) ──────────────────────────────
export const FIND_GENERATE_BUTTON_JS = `(${findGenerateButton.toString()})(document)`
export const FIND_SETTINGS_TRIGGER_JS = `(${findSettingsTrigger.toString()})(document)`
export const READ_SETTINGS_SUMMARY_JS = `(${readSettingsSummary.toString()})(document)`
export const READ_EDITOR_TEXT_JS = `(${readEditorText.toString()})(document)`
