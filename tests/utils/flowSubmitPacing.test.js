/**
 * flowSubmitPacing — Flow 반봇 페이싱 딜레이 계산
 *
 * 기본 7~15초. 설정에서 min/max(ms)를 조정할 수 있어야 한다.
 * 잘못된 값(NaN/음수/역전)은 안전하게 보정한다.
 */
import { describe, it, expect } from 'vitest'
import {
  getFlowSubmitPacingDelayMs,
  FLOW_SUBMIT_PACING_MIN_MS,
  FLOW_SUBMIT_PACING_MAX_MS,
} from '../../src/utils/flowSubmitPacing'

describe('flowSubmitPacing 기본값', () => {
  it('기본 min=7000, max=15000', () => {
    expect(FLOW_SUBMIT_PACING_MIN_MS).toBe(7000)
    expect(FLOW_SUBMIT_PACING_MAX_MS).toBe(15000)
  })

  it('인자 없으면 기본 범위 [7000, 15000]', () => {
    expect(getFlowSubmitPacingDelayMs(undefined, undefined, () => 0)).toBe(7000)
    expect(getFlowSubmitPacingDelayMs(undefined, undefined, () => 0.99999)).toBe(15000)
  })
})

describe('flowSubmitPacing 설정 min/max 반영', () => {
  it('명시한 min/max 범위를 사용한다', () => {
    expect(getFlowSubmitPacingDelayMs(10000, 20000, () => 0)).toBe(10000)
    expect(getFlowSubmitPacingDelayMs(10000, 20000, () => 0.99999)).toBe(20000)
    // 중간값
    expect(getFlowSubmitPacingDelayMs(10000, 20000, () => 0.5)).toBeGreaterThanOrEqual(10000)
    expect(getFlowSubmitPacingDelayMs(10000, 20000, () => 0.5)).toBeLessThanOrEqual(20000)
  })

  it('min===max 이면 그 값으로 고정', () => {
    expect(getFlowSubmitPacingDelayMs(8000, 8000, () => 0.5)).toBe(8000)
  })
})

describe('flowSubmitPacing 잘못된 입력 보정', () => {
  it('NaN/비숫자는 기본값으로 폴백', () => {
    expect(getFlowSubmitPacingDelayMs(NaN, NaN, () => 0)).toBe(7000)
    expect(getFlowSubmitPacingDelayMs('x', null, () => 0)).toBe(7000)
  })

  it('min>max 는 스왑해서 처리(범위 유지)', () => {
    const v = getFlowSubmitPacingDelayMs(20000, 10000, () => 0)
    expect(v).toBe(10000) // 스왑 후 min
    const v2 = getFlowSubmitPacingDelayMs(20000, 10000, () => 0.99999)
    expect(v2).toBe(20000) // 스왑 후 max
  })

  it('음수/0 은 최소 바닥(1000ms)으로 clamp', () => {
    expect(getFlowSubmitPacingDelayMs(-5000, 0, () => 0)).toBeGreaterThanOrEqual(1000)
  })

  it('과도한 상한은 천장(60000ms)으로 clamp — ITEM_TIMEOUT(120s) 충돌·행 방지', () => {
    expect(getFlowSubmitPacingDelayMs(999999999, 999999999, () => 0)).toBe(60000)
    expect(getFlowSubmitPacingDelayMs(30000, 999999999, () => 0.99999)).toBe(60000)
  })
})
