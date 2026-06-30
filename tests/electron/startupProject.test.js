// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { resolveStartupProjectDecision } from '../../electron/startupProject.js'

describe('resolveStartupProjectDecision', () => {
  it('저장 flowProjectId(string) → open-saved', () => {
    expect(resolveStartupProjectDecision('abc-123')).toEqual({ action: 'open-saved', flowProjectId: 'abc-123' })
  })
  it('null(저장 프로젝트 없음) → create-new', () => {
    expect(resolveStartupProjectDecision(null)).toEqual({ action: 'create-new' })
  })
  it('undefined(아직 미선언) → wait', () => {
    expect(resolveStartupProjectDecision(undefined)).toEqual({ action: 'wait' })
  })
  it('빈 문자열 → create-new (유효한 id 아님)', () => {
    expect(resolveStartupProjectDecision('')).toEqual({ action: 'create-new' })
  })
})
