// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { findComposeEditor, isComposeEditorReady } from '../../electron/flow-compose-editor.js'

describe('findComposeEditor', () => {
  it('Slate 에디터를 찾는다', () => {
    document.body.innerHTML = `<div data-slate-editor="true">x</div>`
    expect(findComposeEditor(document)).toBeTruthy()
  })

  it("role='textbox' contenteditable 을 찾는다", () => {
    document.body.innerHTML = `<div role="textbox" contenteditable="true">x</div>`
    expect(findComposeEditor(document)).toBeTruthy()
  })

  it('Agent ON 컴포저: role 없이 contenteditable 만 있어도 찾는다 (generate-scene 진입 실패 회귀)', () => {
    document.body.innerHTML = `<div contenteditable="true">무엇을 만들고 싶으신가요?</div>`
    expect(isComposeEditorReady(document)).toBe(true)
  })

  it('aria-hidden 인 contenteditable 은 제외 (숨은 0px 요소 오선택 방지)', () => {
    document.body.innerHTML = `<div contenteditable="true" aria-hidden="true">hidden</div>`
    expect(findComposeEditor(document)).toBeNull()
  })

  it('recaptcha textarea(=contenteditable 아님)는 안 잡는다', () => {
    document.body.innerHTML = `<textarea id="g-recaptcha-response"></textarea>`
    expect(isComposeEditorReady(document)).toBe(false)
  })
})
