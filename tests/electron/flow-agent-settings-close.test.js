// @vitest-environment jsdom
//
// The "에이전트 설정"(agent settings / defaults) panel — containing the
// '이미지 생성 기본값' and '동영상 생성 기본값' labels — can cover the compose bar's
// Agent toggle, just like the chat panel does. Before forcing the toggle OFF/ON we
// must close it via its header close(X)/back button. This mirrors findAgentChatCloseButton
// but targets the settings panel. Markup below is shaped after a real flow-dom-dump.
import { describe, it, expect, beforeEach } from 'vitest'
import { findAgentSettingsCloseButton } from '../../electron/flow-agent-toggle.js'

beforeEach(() => {
  // jsdom 은 레이아웃이 없어 getBoundingClientRect 가 0 → isVis 가 항상 false 가 된다.
  //   보이는 요소를 흉내내도록 0 이 아닌 크기를 돌려준다.
  Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30, x: 0, y: 0 })
})

describe('findAgentSettingsCloseButton', () => {
  it('finds the close button of the 에이전트 설정(기본값) panel', () => {
    document.body.innerHTML = `
      <div class="settings-panel">
        <div class="header">
          <span>에이전트 설정</span>
          <button aria-label="닫기"><i class="google-symbols">close</i></button>
        </div>
        <div><span>이미지 생성 기본값</span></div>
        <div><span>동영상 생성 기본값</span></div>
      </div>`
    const btn = findAgentSettingsCloseButton(document)
    expect(btn).toBeTruthy()
    expect(btn.tagName).toBe('BUTTON')
  })

  it('also accepts a back-arrow icon as the close affordance', () => {
    document.body.innerHTML = `
      <div class="settings-panel">
        <button><i class="google-symbols">arrow_back</i></button>
        <span>이미지 생성 기본값</span>
        <span>동영상 생성 기본값</span>
      </div>`
    const btn = findAgentSettingsCloseButton(document)
    expect(btn).toBeTruthy()
    expect(btn.querySelector('i').textContent).toBe('arrow_back')
  })

  it('returns null when the settings panel is not open (only the toggle visible)', () => {
    document.body.innerHTML = `
      <button type="button" aria-pressed="true"><span class="content">에이전트</span></button>`
    expect(findAgentSettingsCloseButton(document)).toBeNull()
  })

  it('returns null when only one of the two label markers is present (not the panel)', () => {
    document.body.innerHTML = `
      <div><span>이미지 생성 기본값</span><button aria-label="닫기"><i>close</i></button></div>`
    expect(findAgentSettingsCloseButton(document)).toBeNull()
  })
})
