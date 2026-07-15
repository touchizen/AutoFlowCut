// @vitest-environment jsdom
//
// When findAgentToggle() returns null, ensureAgentOff fails closed with the
// "Flow Agent 를 OFF 로 전환하지 못했습니다" error — and today that is ALL we get.
// The reason the toggle was rejected evaporates, so a user report is undiagnosable
// (we chased four wrong hypotheses on one such report before writing this).
//
// scanAgentToggleCandidates captures exactly what findAgentToggle REJECTED —
// every agent-ish control plus the attributes the matcher keys on — together with
// the page context (viewport size, lang, url), so a single dump decides the cause.
import { describe, it, expect } from 'vitest'
import {
  AGENT_TOGGLE_DIAGNOSTIC,
  AGENT_TOGGLE_SELECTOR,
  scanAgentToggleCandidates,
  findAgentToggle,
} from '../../electron/flow-agent-toggle.js'
import {
  ENGLISH_COMPOSER,
  KOREAN_COMPOSER,
} from '../fixtures/flow-live-dom-20260714.js'

function run(expr) {
  return window.eval(expr)
}

function japaneseComposer() {
  return ENGLISH_COMPOSER.replace('>Agent<', '>エージェント<')
}

function appendToggle(label) {
  const composer = document.body.firstElementChild
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-pressed', 'false')
  button.innerHTML = `<span class="content">${label}</span>`
  composer.appendChild(button)
  return button
}

describe('findAgentToggle — live composer structure', () => {
  it.each([
    ['English', ENGLISH_COMPOSER, 'Agent'],
    ['Korean', KOREAN_COMPOSER, '에이전트'],
  ])('finds the one aria-pressed button in the real %s composer', (_locale, html, label) => {
    document.body.innerHTML = html

    const toggle = findAgentToggle(document)

    expect(toggle?.textContent.trim()).toBe(label)
    expect(run(AGENT_TOGGLE_SELECTOR)).toBe(toggle)
  })

  it('finds a Japanese toggle from composer structure without translated text knowledge', () => {
    document.body.innerHTML = japaneseComposer()

    const toggle = findAgentToggle(document)

    expect(toggle?.textContent.trim()).toBe('エージェント')
    expect(run(AGENT_TOGGLE_SELECTOR)).toBe(toggle)
  })

  it('uses Agent text only to disambiguate multiple state controls in the composer scope', () => {
    document.body.innerHTML = ENGLISH_COMPOSER
    appendToggle('Pin controls')

    expect(findAgentToggle(document)?.textContent.trim()).toBe('Agent')
  })

  it('returns null and diagnoses every candidate when multiple state controls remain ambiguous', () => {
    document.body.innerHTML = japaneseComposer()
    appendToggle('固定')

    expect(findAgentToggle(document)).toBeNull()
    expect(run(AGENT_TOGGLE_SELECTOR)).toBeNull()
    const diagnostic = run(AGENT_TOGGLE_DIAGNOSTIC)
    expect(diagnostic.candidates).toHaveLength(2)
    expect(diagnostic.context.scopedToggleCount).toBe(2)
  })
})

describe('scanAgentToggleCandidates', () => {
  it('captures an agent control that findAgentToggle rejects for lacking a toggle attribute', () => {
    // Hypothetical Flow redesign: the toggle attribute (aria-pressed) is gone and the
    // button carries an icon ligature, so neither matcher pass hits. findAgentToggle
    // returns null and today we learn nothing. The diagnostic must still see it.
    document.body.innerHTML = `
      <button type="button" data-enabled="false">
        <i class="google-symbols">spark</i><span class="content">에이전트</span>
      </button>`

    expect(findAgentToggle(document)).toBeNull()

    const { candidates } = scanAgentToggleCandidates(document)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      tag: 'button',
      text: expect.stringContaining('에이전트'),
      ariaPressed: null,
      icons: ['spark'],
    })
  })

  it('reports the page context that decides the viewport hypotheses', () => {
    document.documentElement.lang = 'ja'
    document.body.innerHTML = ''

    const { context } = scanAgentToggleCandidates(document)
    expect(context).toMatchObject({
      innerWidth: expect.any(Number),
      innerHeight: expect.any(Number),
      lang: 'ja',
    })
  })

  it('still captures the toggle when it IS found, so a dump proves the probe saw it', () => {
    document.body.innerHTML = KOREAN_COMPOSER
    document.querySelector('button[aria-pressed]').setAttribute('aria-pressed', 'true')

    expect(findAgentToggle(document)).toBeTruthy()

    const { candidates } = scanAgentToggleCandidates(document)
    expect(candidates[0]).toMatchObject({ ariaPressed: 'true', text: '에이전트' })
  })
})
