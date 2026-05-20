import { describe, it, expect } from 'vitest'
import { planRecaptchaWait, shouldResetIncidents } from '../../src/services/recaptchaPolicy'

describe('planRecaptchaWait', () => {
  it('1st incident → 5 min, autoResume true', () => {
    expect(planRecaptchaWait(1)).toEqual({ waitMs: 300000, autoResume: true })
  })
  it('2nd incident → 10 min', () => {
    expect(planRecaptchaWait(2)).toEqual({ waitMs: 600000, autoResume: true })
  })
  it('3rd incident → 30 min', () => {
    expect(planRecaptchaWait(3)).toEqual({ waitMs: 1800000, autoResume: true })
  })
  it('4th incident → no auto-resume (manual)', () => {
    expect(planRecaptchaWait(4)).toEqual({ waitMs: 0, autoResume: false })
  })
  it('beyond 4th stays manual', () => {
    expect(planRecaptchaWait(7)).toEqual({ waitMs: 0, autoResume: false })
  })
})

describe('shouldResetIncidents', () => {
  it('false below threshold', () => {
    expect(shouldResetIncidents(24)).toBe(false)
  })
  it('true at threshold', () => {
    expect(shouldResetIncidents(25)).toBe(true)
  })
  it('true above threshold', () => {
    expect(shouldResetIncidents(40)).toBe(true)
  })
})
