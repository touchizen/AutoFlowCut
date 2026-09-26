// @vitest-environment jsdom
//
// M1-7 — flow.google.com(Angular) 컴포저 DOM 파인더. 2026-09-24 라이브 마크업(K) 픽스처로 핀한다.
//   생성 버튼 button.generate-icon-button[type=submit] + arrow_forward · 에이전트 칩 button.agent-mode-chip[aria-pressed]
//   · 설정 트리거 button.settings-trigger-button · 요약 텍스트/리거처 · ProseMirror 편집기 문단 결합.
// 로케일 텍스트(aria-label "생성 시작" 등)는 절대 보지 않는다 — 클래스·타입·아이콘 리거처만.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  findGenerateButton, findSettingsTrigger, readSettingsSummary, findPromptEditor, readEditorText,
  FIND_GENERATE_BUTTON_JS, FIND_SETTINGS_TRIGGER_JS, READ_SETTINGS_SUMMARY_JS, READ_EDITOR_TEXT_JS,
} from '../../electron/flow-composer-dom.js'
import { findAgentToggle, AGENT_TOGGLE_SELECTOR, AGENT_TOGGLE_PROBE, scanAgentToggleCandidates } from '../../electron/flow-agent-toggle.js'
import { isSubmitEnabled, classifyAgentState } from '../../electron/flow-submit-gate.js'
import { findComposeEditor } from '../../electron/flow-compose-editor.js'
import { PAGE_IMAGE_KO, PAGE_VIDEO_KO, PAGE_IMAGE_EN, IMAGE_COMPOSER_KO, CARD_MENU_BUTTONS } from '../fixtures/flow-live-dom-20260924.js'
import { ENGLISH_COMPOSER, KOREAN_COMPOSER } from '../fixtures/flow-live-dom-20260714.js'

const run = (expr) => window.eval(expr)

beforeEach(() => { document.body.innerHTML = '' })

describe('픽스처 구조(래퍼가 실제 스코프를 재현한다)', () => {
  it('편집기와 bottom-controls 가 공통 조상 af-composer 아래, 카드 메뉴 버튼 3개는 밖', () => {
    document.body.innerHTML = PAGE_IMAGE_KO
    const composer = document.querySelector('.af-composer')
    expect(composer.querySelector('div.ProseMirror[contenteditable="true"]')).toBeTruthy()
    expect(composer.querySelector('.bottom-controls')).toBeTruthy()
    expect(document.querySelectorAll('button[aria-haspopup="menu"]')).toHaveLength(3)
    expect(composer.querySelectorAll('button[aria-haspopup="menu"]')).toHaveLength(0)
  })
})

describe('findGenerateButton', () => {
  it.each([['image', PAGE_IMAGE_KO], ['video', PAGE_VIDEO_KO], ['image-en', PAGE_IMAGE_EN]])('%s: button.generate-icon-button[type=submit] + mat-icon arrow_forward', (_n, html) => {
    document.body.innerHTML = html
    const btn = findGenerateButton(document)
    expect(btn).toBeTruthy()
    expect(btn.classList.contains('generate-icon-button')).toBe(true)
    expect(btn.getAttribute('type')).toBe('submit')
    expect(run(FIND_GENERATE_BUTTON_JS)).toBe(btn)
  })

  it('<i>/<span class="google-symbols"> 아이콘 변형도 인정', () => {
    document.body.innerHTML = PAGE_IMAGE_KO.replace(/<mat-icon([^>]*)>arrow_forward<\/mat-icon>/, '<i class="google-symbols">arrow_forward</i>')
    expect(findGenerateButton(document)).toBeTruthy()
    document.body.innerHTML = PAGE_IMAGE_KO.replace(/<mat-icon([^>]*)>arrow_forward<\/mat-icon>/, '<span class="material-symbols-outlined">arrow_forward</span>')
    expect(findGenerateButton(document)).toBeTruthy()
  })

  it('없거나(아이콘이 stop = 생성 중) 모양이 다르면 null', () => {
    document.body.innerHTML = CARD_MENU_BUTTONS
    expect(findGenerateButton(document)).toBeNull()
    expect(run(FIND_GENERATE_BUTTON_JS)).toBeNull()
    document.body.innerHTML = PAGE_IMAGE_KO.replace('>arrow_forward</mat-icon>', '>stop</mat-icon>')
    expect(findGenerateButton(document)).toBeNull()
    document.body.innerHTML = PAGE_IMAGE_KO.replace('type="submit"', 'type="button"')
    expect(findGenerateButton(document)).toBeNull()
  })

  it('기존 제출 게이트(isSubmitEnabled)가 mat-icon 마크업에서 disabled 를 읽는다', () => {
    document.body.innerHTML = PAGE_IMAGE_KO
    expect(isSubmitEnabled(document)).toBe(false)
    findGenerateButton(document).removeAttribute('disabled')
    expect(isSubmitEnabled(document)).toBe(true)
    expect(classifyAgentState(document)).toBe('idle')
  })
})

describe('findAgentToggle — Angular 칩 + 옛 Slate 픽스처', () => {
  it.each([['ko', PAGE_IMAGE_KO, '에이전트'], ['en', PAGE_IMAGE_EN, 'Agent'], ['video', PAGE_VIDEO_KO, '에이전트']])('%s: button.agent-mode-chip[aria-pressed]', (_n, html, label) => {
    document.body.innerHTML = html
    const el = findAgentToggle(document)
    expect(el?.classList.contains('agent-mode-chip')).toBe(true)
    expect(el.textContent.trim()).toBe(label)
    expect(run(AGENT_TOGGLE_SELECTOR)).toBe(el)
    expect(run(AGENT_TOGGLE_PROBE)).toMatchObject({ found: true, on: false })
  })

  it('옛 Slate 컴포저(2026-07-14)도 그대로 찾는다', () => {
    document.body.innerHTML = ENGLISH_COMPOSER
    expect(findAgentToggle(document)?.textContent.trim()).toBe('Agent')
    document.body.innerHTML = KOREAN_COMPOSER
    expect(findAgentToggle(document)?.textContent.trim()).toBe('에이전트')
  })

  it('진단 스캔은 ProseMirror 편집기를 컴포저로 인식한다', () => {
    document.body.innerHTML = PAGE_IMAGE_KO
    const { context, candidates } = scanAgentToggleCandidates(document)
    expect(context.hasComposeEditor).toBe(true)
    expect(candidates[0]).toMatchObject({ ariaPressed: 'false' })
  })
})

describe('findSettingsTrigger / readSettingsSummary', () => {
  it('button.settings-trigger-button (카드 메뉴 버튼과 무관)', () => {
    document.body.innerHTML = PAGE_VIDEO_KO
    const t = findSettingsTrigger(document)
    expect(t?.classList.contains('settings-trigger-button')).toBe(true)
    expect(run(FIND_SETTINGS_TRIGGER_JS)).toBe(t)
    document.body.innerHTML = CARD_MENU_BUTTONS
    expect(findSettingsTrigger(document)).toBeNull()
  })

  it('video: {text:"동영상 · 720p · 6초 x1", ligatures:["crop_16_9"]}', () => {
    document.body.innerHTML = PAGE_VIDEO_KO
    expect(readSettingsSummary(document)).toEqual({ text: '동영상 · 720p · 6초 x1', ligatures: ['crop_16_9'] })
    expect(run(READ_SETTINGS_SUMMARY_JS)).toEqual({ text: '동영상 · 720p · 6초 x1', ligatures: ['crop_16_9'] })
  })

  it('image: {text:"🍌 Nano Banana 2 x1", ligatures:["crop_16_9"]}; 트리거 없음 → null', () => {
    document.body.innerHTML = PAGE_IMAGE_KO
    expect(readSettingsSummary(document)).toEqual({ text: '🍌 Nano Banana 2 x1', ligatures: ['crop_16_9'] })
    document.body.innerHTML = ''
    expect(readSettingsSummary(document)).toBeNull()
  })
})

describe('findPromptEditor / readEditorText', () => {
  it('ProseMirror 편집기: 빈 문단 → "", 문단 결합은 \\n', () => {
    document.body.innerHTML = PAGE_IMAGE_KO
    const ed = findPromptEditor(document)
    expect(ed?.classList.contains('ProseMirror')).toBe(true)
    expect(findComposeEditor(document)).toBe(ed)   // 기존 readiness 프로브도 같은 요소
    expect(readEditorText(document)).toBe('')
    ed.innerHTML = '<p>궁정안에 있는 왕</p><p>두 번째 문단</p>'
    expect(readEditorText(document)).toBe('궁정안에 있는 왕\n두 번째 문단')
    expect(run(READ_EDITOR_TEXT_JS)).toBe('궁정안에 있는 왕\n두 번째 문단')
  })

  it('옛 Slate 편집기는 textContent, 편집기 없음 → null', () => {
    document.body.innerHTML = KOREAN_COMPOSER
    expect(findPromptEditor(document)?.getAttribute('data-slate-editor')).toBe('true')
    expect(typeof readEditorText(document)).toBe('string')
    document.body.innerHTML = CARD_MENU_BUTTONS
    expect(findPromptEditor(document)).toBeNull()
    expect(readEditorText(document)).toBeNull()
  })

  it('숨은 reCAPTCHA textarea 는 편집기가 아니다', () => {
    document.body.innerHTML = '<textarea id="g-recaptcha-response"></textarea>' + IMAGE_COMPOSER_KO
    expect(findPromptEditor(document)?.classList.contains('ProseMirror')).toBe(true)
  })
})
