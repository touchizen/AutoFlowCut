import { describe, expect, it } from 'vitest'
import {
  clampAgentPanelPosition,
  effectiveAgentPanelMode,
  floatingPanelBox,
  normalizeAgentPanelMode,
  reclampAgentPanelPosition,
} from '../../../src/components/agent/agentPanelLayout.js'

describe('agentPanelLayout', () => {
  it('stored slide는 API에서 slide, Flow에서 floating이며 저장값 객체를 바꾸지 않는다', () => {
    const preference = { value: 'slide' }

    expect(effectiveAgentPanelMode('api', preference.value)).toBe('slide')
    expect(effectiveAgentPanelMode('flow', preference.value)).toBe('floating')
    expect(effectiveAgentPanelMode('api', preference.value)).toBe('slide')
    expect(preference).toEqual({ value: 'slide' })
  })

  it('invalid stored mode만 floating으로 정규화한다', () => {
    expect(normalizeAgentPanelMode('floating')).toBe('floating')
    expect(normalizeAgentPanelMode('slide')).toBe('slide')
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
