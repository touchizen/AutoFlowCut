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
import { scanAgentToggleCandidates, findAgentToggle } from '../../electron/flow-agent-toggle.js'

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
    document.body.innerHTML = `
      <button type="button" aria-pressed="true"><span class="content">에이전트</span></button>`

    expect(findAgentToggle(document)).toBeTruthy()

    const { candidates } = scanAgentToggleCandidates(document)
    expect(candidates[0]).toMatchObject({ ariaPressed: 'true', text: '에이전트' })
  })
})
