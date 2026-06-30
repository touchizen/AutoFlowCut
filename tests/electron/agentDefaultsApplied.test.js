// @vitest-environment node
//
// #R34-fix: agentDefaultsApplied — applyAgentDefaults 가 "요청한 image/video aspect·model 이 실제로
//   적용됐는지"를 판정한다. 패널 부분 실패(tab_not_found/option_not_found/section_not_found 등)는
//   result.ok 가 true 여도 잘못된 aspect/model 로 생성되므로 success 로 보면 안 된다.
import { describe, it, expect } from 'vitest'
import { agentDefaultsApplied } from '../../electron/ipc/shared.js'

describe('#R34-fix: agentDefaultsApplied', () => {
  it('요청 없음 → applied(true)', () => {
    expect(agentDefaultsApplied({}, { ok: true })).toBe(true)
  })

  it('video aspect/model clicked → applied', () => {
    expect(agentDefaultsApplied(
      { video: { aspectRatio: '16:9', model: 'Veo' } },
      { ok: true, video: { aspect: 'clicked', model: 'clicked' } },
    )).toBe(true)
  })

  it('already/skipped 도 applied 로 본다', () => {
    expect(agentDefaultsApplied(
      { image: { aspectRatio: '1:1', model: 'Nano' } },
      { ok: true, image: { aspect: 'already', model: 'skipped' } },
    )).toBe(true)
  })

  it('요청한 video aspect 가 tab_not_found → not applied', () => {
    expect(agentDefaultsApplied(
      { video: { aspectRatio: '16:9' } },
      { ok: true, video: { aspect: 'tab_not_found', model: 'skipped' } },
    )).toBe(false)
  })

  it('요청한 model 이 option_not_found → not applied', () => {
    expect(agentDefaultsApplied(
      { video: { model: 'Veo 3.1' } },
      { ok: true, video: { aspect: 'skipped', model: 'option_not_found:Veo 2|Veo 3' } },
    )).toBe(false)
  })

  it('section_not_found → not applied', () => {
    expect(agentDefaultsApplied(
      { image: { aspectRatio: '16:9' } },
      { ok: true, image: { error: 'section_not_found' } },
    )).toBe(false)
  })

  it('count 실패는 비치명적(applied 유지) — aspect/model 만 본다', () => {
    expect(agentDefaultsApplied(
      { image: { aspectRatio: '16:9', count: 4 } },
      { ok: true, image: { aspect: 'clicked', count: 'count_not_found', model: 'skipped' } },
    )).toBe(true)
  })
})
