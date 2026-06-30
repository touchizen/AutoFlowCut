// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { computeOffscreenBounds } from '../../electron/offscreen-bounds.js'

describe('computeOffscreenBounds', () => {
  it('모든 디스플레이의 오른쪽 끝 너머로 — 멀티모니터에서도 어느 화면에도 안 보임', () => {
    const displays = [
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { bounds: { x: 1920, y: 0, width: 2560, height: 1440 } }, // 오른쪽 보조 모니터
    ]
    // maxRight = 1920 + 2560 = 4480; x = 4480 - winX(100) + 200 = 4580
    expect(computeOffscreenBounds(displays, 100, 1200, 800)).toEqual({ x: 4580, y: 0, width: 1200, height: 800 })
  })

  it('창이 보조 모니터 위(winX 큰 값)여도 모든 디스플레이 너머로 계산', () => {
    const displays = [
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
    ]
    // maxRight = 3840; winX = 2000; x = 3840 - 2000 + 200 = 2040
    expect(computeOffscreenBounds(displays, 2000, 1280, 720).x).toBe(2040)
  })

  it('디스플레이 정보 없으면 창 오른쪽으로 폴백', () => {
    // maxRight = winX(100)+width(1200) = 1300; x = 1300 - 100 + 200 = 1400
    expect(computeOffscreenBounds([], 100, 1200, 800)).toEqual({ x: 1400, y: 0, width: 1200, height: 800 })
  })
})
