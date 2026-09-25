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

// 2026-09-25 실기: flow.google.com 은 뷰 폭이 좁으면(597px, Material handset 분기점 600 미만) 에이전트 칩 등 컴포저
//   컨트롤을 아예 렌더하지 않아 ensureAgentOff 가 not_found 로 fail-closed 됐다. 957px 에선 정상. DOM 자동화 단계는
//   숨은(0×0) 뷰뿐 아니라 좁은 뷰도 화면 밖 정본 크기로 두고 돌린다.
import { needsAutomationViewport, automationViewportSize, computeInPlaceBounds, AUTOMATION_MIN_WIDTH, AUTOMATION_MIN_HEIGHT } from '../../electron/offscreen-bounds.js'

describe('needsAutomationViewport — 숨었거나 좁으면 자동화 뷰포트가 필요하다', () => {
  it('0×0(모달·드래그) 과 없음(null) 은 필요', () => {
    expect(needsAutomationViewport({ x: 0, y: 0, width: 0, height: 0 })).toBe(true)
    expect(needsAutomationViewport(null)).toBe(true)
  })
  it('597×872(실기 실패 폭) 은 필요, 957×1022(실기 통과 폭) 은 불필요', () => {
    expect(needsAutomationViewport({ x: 0, y: 0, width: 597, height: 872 })).toBe(true)
    expect(needsAutomationViewport({ x: 0, y: 0, width: 957, height: 1022 })).toBe(false)
  })
  it('경계값: 최소 폭·높이 미만만 필요', () => {
    expect(needsAutomationViewport({ x: 0, y: 0, width: AUTOMATION_MIN_WIDTH, height: AUTOMATION_MIN_HEIGHT })).toBe(false)
    expect(needsAutomationViewport({ x: 0, y: 0, width: AUTOMATION_MIN_WIDTH - 1, height: AUTOMATION_MIN_HEIGHT })).toBe(true)
    expect(needsAutomationViewport({ x: 0, y: 0, width: AUTOMATION_MIN_WIDTH, height: AUTOMATION_MIN_HEIGHT - 1 })).toBe(true)
  })
})

describe('automationViewportSize — 창 콘텐츠 크기 이상, 최소값 이상', () => {
  it('넓은 창은 창 크기 그대로', () => {
    expect(automationViewportSize({ width: 1280, height: 800 })).toEqual({ width: 1280, height: 800 })
  })
  it('작은 창은 최소값으로 올린다', () => {
    expect(automationViewportSize({ width: 500, height: 400 })).toEqual({ width: AUTOMATION_MIN_WIDTH, height: AUTOMATION_MIN_HEIGHT })
  })
  it('창 정보가 없어도 최소값', () => {
    expect(automationViewportSize(null)).toEqual({ width: AUTOMATION_MIN_WIDTH, height: AUTOMATION_MIN_HEIGHT })
  })
})

// 2026-09-25 M2 실기(597×872 스플릿): 화면 밖(x=1760)으로 1200×872 를 줘도 페이지 innerWidth 가 597 그대로였다 — 완전히
//   화면 밖인 뷰는 Chromium 이 다시 레이아웃하지 않는다(단위 테스트는 우리가 준 bounds 만 봤다: 공허한 검사). 자동화 뷰포트는
//   창 **안** 제자리(x=0,y=0)에서 창 콘텐츠 크기(최소값 이상)로 키운다 — 보이는 뷰는 957px 실기로 증명됐다.
describe('computeInPlaceBounds — 창 안 제자리 자동화 뷰포트', () => {
  it('x=0,y=0 에 창 콘텐츠 크기', () => {
    expect(computeInPlaceBounds({ width: 1200, height: 872 })).toEqual({ x: 0, y: 0, width: 1200, height: 872 })
  })
  it('작은 창은 최소값으로 올린다(창을 넘어도 잘리는 쪽이 낫다)', () => {
    expect(computeInPlaceBounds({ width: 500, height: 400 })).toEqual({ x: 0, y: 0, width: AUTOMATION_MIN_WIDTH, height: AUTOMATION_MIN_HEIGHT })
  })
  it('창 정보가 없어도 최소값', () => {
    expect(computeInPlaceBounds(null)).toEqual({ x: 0, y: 0, width: AUTOMATION_MIN_WIDTH, height: AUTOMATION_MIN_HEIGHT })
  })
})
