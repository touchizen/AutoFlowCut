// @vitest-environment jsdom
//
// The Agent toggle (<button aria-pressed>에이전트) lives in the main compose bar.
// When a prior Agent-ON generation leaves the agent CHAT panel open, that panel
// covers the compose bar and the toggle isn't rendered → ensureAgentOn returned
// `not_found`. The chat panel's header close button (icon 'close' / label '닫기',
// next to '기록'/'새로운 세션') must be clicked first. Markup below is copied from
// a real flow-dom-dump (Cmd+Shift+E).
import { describe, it, expect } from 'vitest'
import { findAgentChatCloseButton } from '../../electron/flow-agent-toggle.js'
import { buildComposer, paragraph, uuid } from '../fixtures/flow-live-dom-m3.js'

describe('findAgentChatCloseButton', () => {
  it('finds the agent-chat panel close button by real markup', () => {
    document.body.innerHTML = `
      <div class="agent-panel-header">
        <button><i class="google-symbols">menu</i><span style="position:absolute;clip:rect(0,0,0,0)">기록</span></button>
        <button><i class="google-symbols">edit_square</i><span style="position:absolute;clip:rect(0,0,0,0)">새로운 세션</span></button>
        <button><i class="google-symbols">close</i><span style="position:absolute;clip:rect(0,0,0,0)">닫기</span></button>
      </div>`
    const btn = findAgentChatCloseButton(document)
    expect(btn).toBeTruthy()
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.querySelector('i').textContent).toBe('close')
  })

  it('returns null when no close button is present (toggle already visible)', () => {
    document.body.innerHTML = `
      <button type="button" aria-pressed="true"><span class="content">에이전트</span></button>
      <button><i class="google-symbols">add_2</i><span>만들기</span></button>`
    expect(findAgentChatCloseButton(document)).toBeNull()
  })

  // 2026-09-26 실기(M3 G5): 새 flow.google.com 엔 에이전트 채팅 창이 없는데, 'close' 아이콘 버튼이 하나뿐이면 그게 뭐든 눌렀다 —
  //   사용자가 붙인 칩이 ensureAgentOff 에서 입력창 지우기로 조용히 사라졌다. 아래 마크업은 M3 캡처(docs/handoffs/evidence/
  //   2026-09-25-m3-dom-*.elements.json)에서 'close' 버튼이 그것 하나뿐인 세 화면이다. 에이전트 창이 아니면 누르지 않는다.
  it('new flow.google.com, chip attached: the lone close button is the composer clear — returns null', () => {
    document.body.innerHTML = `
      <div class="composer"><div class="chips"><img src="blob:x"></div>
        <button type="button" class="mdc-icon-button mat-mdc-icon-button clear-button clear-button-no-touch-target" aria-label="프롬프트 지우기"><i class="google-symbols">close</i></button>
        <button type="button"><i class="google-symbols">arrow_forward</i></button>
      </div>`
    expect(findAgentChatCloseButton(document)).toBeNull()
  })

  it('new flow.google.com, asset picker open: the add trigger shows close — returns null', () => {
    document.body.innerHTML = `
      <div class="composer">
        <button type="button" class="mdc-icon-button mat-mdc-icon-button" aria-label="프롬프트 상자에 소재 추가"><i class="google-symbols">close</i></button>
      </div>`
    expect(findAgentChatCloseButton(document)).toBeNull()
  })

  it('new flow.google.com home: a banner close alone — returns null', () => {
    document.body.innerHTML = `<div class="banner"><span>공지</span><button aria-label="배너 닫기"><i class="google-symbols">close</i></button></div>`
    expect(findAgentChatCloseButton(document)).toBeNull()
  })

  it('agent-chat header in another locale is found by its untranslated icons (edit_square)', () => {
    document.body.innerHTML = `
      <div class="agent-panel-header">
        <button aria-label="History"><i class="google-symbols">menu</i></button>
        <button aria-label="New session"><i class="google-symbols">edit_square</i></button>
        <button class="target" aria-label="Close"><i class="google-symbols">close</i></button>
      </div>`
    expect(findAgentChatCloseButton(document)?.classList.contains('target')).toBe(true)
  })

  // 리뷰 R1: 한글 라벨 앵커는 입력창 글자에도 걸렸다 — 지우기 버튼의 둘째 조상이 편집기를 품어, 프롬프트에 '기록'이 있으면
  //   지우기 버튼을 에이전트 창 닫기로 봤다. 라벨은 쓰지 않고 번역되지 않는 edit_square 리거처만 본다. 실제 입력창(09-24 라이브 마크업).
  it('live composer: a chip plus 기록 / 새로운 세션 in the prompt text → null (page text is not an agent anchor)', () => {
    for (const text of ['조선 왕실의 기록 보관소', '새로운 세션을 시작한다']) {
      document.body.innerHTML = buildComposer({ chips: [{ id: uuid(1) }], editorHtml: paragraph(text) })
      expect(document.querySelector('button.clear-button')).toBeTruthy()
      expect(findAgentChatCloseButton(document)).toBeNull()
    }
  })

  it('Korean header labels alone (no edit_square icon) do not qualify', () => {
    document.body.innerHTML = `<div class="hdr"><span>기록</span><span>새로운 세션</span><button><i class="google-symbols">close</i></button></div>`
    expect(findAgentChatCloseButton(document)).toBeNull()
  })

  it('an edit icon is not edit_square', () => {
    document.body.innerHTML = `<div class="hdr"><button><i class="google-symbols">edit</i></button><button><i class="google-symbols">close</i></button></div>`
    expect(findAgentChatCloseButton(document)).toBeNull()
  })

  it('the agent header anchor counts up to the 3rd ancestor of the close button', () => {
    document.body.innerHTML = `<div class="hdr"><button><i class="google-symbols">edit_square</i></button>
      <div><div><button class="target"><i class="google-symbols">close</i></button></div></div></div>`
    expect(findAgentChatCloseButton(document)?.classList.contains('target')).toBe(true)
  })

  it('…but not at the 4th ancestor', () => {
    document.body.innerHTML = `<div class="hdr"><button><i class="google-symbols">edit_square</i></button>
      <div><div><div><button class="target"><i class="google-symbols">close</i></button></div></div></div></div>`
    expect(findAgentChatCloseButton(document)).toBeNull()
  })

  it('agent-chat header and a chip-bearing composer together → the header close, never the composer clear', () => {
    document.body.innerHTML = `
      <div class="composer"><button class="clear-button" aria-label="프롬프트 지우기"><i class="google-symbols">close</i></button></div>
      <div class="agent-panel"><div class="header">
        <button><i class="google-symbols">menu</i></button>
        <button><i class="google-symbols">edit_square</i></button>
        <button class="target"><i class="google-symbols">close</i></button>
      </div></div>`
    expect(findAgentChatCloseButton(document)?.classList.contains('target')).toBe(true)
  })

  it('prefers the close button inside the agent-chat header over an unrelated one', () => {
    document.body.innerHTML = `
      <div class="some-modal"><button aria-label="close"><i>close</i></button></div>
      <div class="agent-panel">
        <div class="header">
          <button><i class="google-symbols">menu</i><span>기록</span></button>
          <button><i class="google-symbols">edit_square</i><span>새로운 세션</span></button>
          <button class="target"><i class="google-symbols">close</i><span>닫기</span></button>
        </div>
      </div>`
    const btn = findAgentChatCloseButton(document)
    expect(btn.classList.contains('target')).toBe(true)
  })
})
