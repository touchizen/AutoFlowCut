// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { computeOffscreenBounds, MIN_INJECT_WIDTH } from '../../electron/offscreen-bounds.js'

describe('computeOffscreenBounds', () => {
  it('모든 디스플레이의 오른쪽 끝 너머로 — 멀티모니터에서도 어느 화면에도 안 보임', () => {
    const displays = [
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { bounds: { x: 1920, y: 0, width: 2560, height: 1440 } }, // 오른쪽 보조 모니터
    ]
    // maxRight = 1920 + 2560 = 4480; x = 4480 - winX(100) + 200 = 4580
    // width 1600 은 min(1280) 이상이라 그대로 유지
    expect(computeOffscreenBounds(displays, 100, 1600, 800)).toEqual({ x: 4580, y: 0, width: 1600, height: 800 })
  })

  it('창이 보조 모니터 위(winX 큰 값)여도 모든 디스플레이 너머로 계산', () => {
    const displays = [
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
    ]
    // maxRight = 3840; winX = 2000; x = 3840 - 2000 + 200 = 2040
    expect(computeOffscreenBounds(displays, 2000, 1280, 720).x).toBe(2040)
  })

  it('디스플레이 정보 없으면 창 오른쪽으로 폴백 (위치는 원본 width 로 계산)', () => {
    // maxRight = winX(100)+width(1200) = 1300; x = 1300 - 100 + 200 = 1400
    // width 1200 은 min(1280) 미만이라 반환 width 는 1280 으로 clamp — 단 x 계산은 원본 1200 사용
    expect(computeOffscreenBounds([], 100, 1200, 800)).toEqual({ x: 1400, y: 0, width: MIN_INJECT_WIDTH, height: 800 })
  })

  describe('오프스크린 주입 최소 너비 강제 (Flow 반응형 붕괴 → 캐릭터 탭 접힘 방지)', () => {
    it(`min(${MIN_INJECT_WIDTH}) 미만이면 반환 width 를 최소값으로 올린다`, () => {
      const displays = [{ bounds: { x: 0, y: 0, width: 800, height: 600 } }]
      // 창을 800px 로 줄였을 때: 반환 width 는 MIN_INJECT_WIDTH 로 강제
      expect(computeOffscreenBounds(displays, 0, 800, 600).width).toBe(MIN_INJECT_WIDTH)
    })

    it('min 이상이면 원본 width 유지', () => {
      const displays = [{ bounds: { x: 0, y: 0, width: 3000, height: 1600 } }]
      expect(computeOffscreenBounds(displays, 0, 2200, 1600).width).toBe(2200)
    })

    it('MIN_INJECT_WIDTH 는 Flow 풀 레이아웃(탭 미접힘) 확보용 상수', () => {
      expect(MIN_INJECT_WIDTH).toBeGreaterThanOrEqual(1024)
    })

    it('height 는 그대로 통과 (붕괴는 너비 기준)', () => {
      expect(computeOffscreenBounds([], 0, 500, 480).height).toBe(480)
    })
  })
})
