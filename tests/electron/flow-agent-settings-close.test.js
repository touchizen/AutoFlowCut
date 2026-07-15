// @vitest-environment jsdom
//
// The "에이전트 설정"(agent settings / defaults) panel — containing the
// '이미지 생성 기본값' and '동영상 생성 기본값' labels — can cover the compose bar's
// Agent toggle, just like the chat panel does. Before forcing the toggle OFF/ON we
// must close it via its header close(X)/back button. This mirrors findAgentChatCloseButton
// but targets the settings panel. Markup below is shaped after a real flow-dom-dump.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  AGENT_SETTINGS_CLOSE_SELECTOR,
  findAgentSettingsCloseButton,
} from '../../electron/flow-agent-toggle.js'
import { ENGLISH_AGENT_SETTINGS } from '../fixtures/flow-live-dom-20260714.js'

beforeEach(() => {
  // jsdom 은 레이아웃이 없어 getBoundingClientRect 가 0 → isVis 가 항상 false 가 된다.
  //   보이는 요소를 흉내내도록 0 이 아닌 크기를 돌려준다.
  Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30, x: 0, y: 0 })
})

describe('findAgentSettingsCloseButton', () => {
  it('finds the arrow_back control in the real English settings panel', () => {
    document.body.innerHTML = ENGLISH_AGENT_SETTINGS

    const btn = findAgentSettingsCloseButton(document)
    const injected = window.eval(AGENT_SETTINGS_CLOSE_SELECTOR)

    expect(btn).toBeTruthy()
    expect(injected).toBe(btn)
    expect([...btn.querySelectorAll('i')].map((i) => i.textContent.trim())).toContain('arrow_back')
  })

  it('returns null when the settings panel is not open (only the toggle visible)', () => {
    document.body.innerHTML = `
      <button type="button" aria-pressed="true"><span class="content">에이전트</span></button>`
    expect(findAgentSettingsCloseButton(document)).toBeNull()
  })

  it('returns null for a translated-label lookalike without the settings roles and state controls', () => {
    document.body.innerHTML = `
      <div><span>이미지 생성 기본값</span><button aria-label="닫기"><i>close</i></button></div>`
    expect(findAgentSettingsCloseButton(document)).toBeNull()
  })
})
