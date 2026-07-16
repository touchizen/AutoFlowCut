import { describe, expect, it } from 'vitest'
import {
  AGENT_PANEL_MODES,
  canDockInContainer,
  clampAgentDockWidth,
  clampAgentPanelPosition,
  effectiveAgentPanelMode,
  floatingPanelBox,
  normalizeAgentPanelMode,
  reclampAgentPanelPosition,
} from '../../../src/components/agent/agentPanelLayout.js'

describe('agentPanelLayout', () => {
  describe('clampAgentDockWidth', () => {
    it('최소 280px 아래로 줄지 않는다', () => {
      expect(clampAgentDockWidth(120, 1200)).toBe(280)
    })

    it('절대 최대 폭은 720px이다', () => {
      expect(clampAgentDockWidth(900, 1600)).toBe(720)
    })

    it('container 폭의 60%를 동적 최대 폭으로 쓴다', () => {
      expect(clampAgentDockWidth(700, 1000)).toBe(600)
      expect(clampAgentDockWidth(500, 1000)).toBe(500)
    })

    it('아주 좁은 container에서도 280px 최소 폭을 깨지 않는다', () => {
      expect(clampAgentDockWidth(400, 400)).toBe(280)
    })

    it('NaN이나 숫자가 아닌 값은 기본 400px로 복구한다', () => {
      expect(clampAgentDockWidth(Number.NaN, 1200)).toBe(400)
      expect(clampAgentDockWidth('garbage', 1200)).toBe(400)
    })
  })

  it('지원 모드는 floating과 docked뿐이다', () => {
    expect(AGENT_PANEL_MODES).toEqual(['floating', 'docked'])
  })

  it('stored docked는 appMode와 무관하게 docked이며 저장값 객체를 바꾸지 않는다', () => {
    const preference = { value: 'docked' }

    expect(effectiveAgentPanelMode('api', preference.value)).toBe('docked')
    expect(effectiveAgentPanelMode('flow', preference.value)).toBe('docked')
    expect(effectiveAgentPanelMode('api', preference.value)).toBe('docked')
    expect(preference).toEqual({ value: 'docked' })
  })

  describe('canDockInContainer', () => {
    it('600×420 이상에서만 dock을 허용한다', () => {
      expect(canDockInContainer({ width: 600, height: 420 })).toBe(true)
      expect(canDockInContainer({ width: 601, height: 421 })).toBe(true)
      expect(canDockInContainer({ width: 599, height: 420 })).toBe(false)
      expect(canDockInContainer({ width: 600, height: 419 })).toBe(false)
    })

    it('누락되거나 유한하지 않은 크기는 dock 불가로 처리한다', () => {
      expect(canDockInContainer()).toBe(false)
      expect(canDockInContainer({})).toBe(false)
      expect(canDockInContainer({ width: Number.NaN, height: 420 })).toBe(false)
      expect(canDockInContainer({ width: 600, height: Number.POSITIVE_INFINITY })).toBe(false)
    })
  })

  it('legacy slide를 docked로 마이그레이션하고 invalid mode는 floating으로 정규화한다', () => {
    expect(normalizeAgentPanelMode('floating')).toBe('floating')
    expect(normalizeAgentPanelMode('docked')).toBe('docked')
    expect(normalizeAgentPanelMode('slide')).toBe('docked')
    expect(normalizeAgentPanelMode('drawer')).toBe('floating')
    expect(normalizeAgentPanelMode(null)).toBe('floating')
  })

  it('pointer 좌표를 viewport가 아니라 offset container의 local bounds로 clamp한다', () => {
    const base = {
      offsetX: 12,
      offsetY: 10,
      containerRect: { left: 100, top: 50, width: 300, height: 200 },
      panelRect: { width: 252, height: 140 },
    }

    expect(clampAgentPanelPosition({ ...base, clientX: -500, clientY: -500 }))
      .toEqual({ left: 0, top: 0 })
    expect(clampAgentPanelPosition({ ...base, clientX: 999, clientY: 999 }))
      .toEqual({ left: 48, top: 60 })
  })

  it('저장된 위치를 현재 container bounds로 다시 clamp하고 null은 유지한다', () => {
    const bounds = {
      containerRect: { width: 120, height: 90 },
      panelRect: { width: 100, height: 80 },
    }

    expect(reclampAgentPanelPosition({
      position: { left: 48, top: 60 },
      ...bounds,
    })).toEqual({ left: 20, top: 10 })
    expect(reclampAgentPanelPosition({
      position: { left: 12, top: 8 },
      ...bounds,
    })).toEqual({ left: 12, top: 8 })
    expect(reclampAgentPanelPosition({ position: null, ...bounds })).toBeNull()
  })

  it('288×180 App container에서 panel box가 양축을 넘지 않는다', () => {
    expect(floatingPanelBox({ width: 288, height: 180 })).toEqual({ width: 252, maxHeight: 144 })
    expect(floatingPanelBox({ width: 288, height: 180 }).width).toBeLessThanOrEqual(288)
    expect(floatingPanelBox({ width: 288, height: 180 }).maxHeight).toBeLessThanOrEqual(180)
  })
})
