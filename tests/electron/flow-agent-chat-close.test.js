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
