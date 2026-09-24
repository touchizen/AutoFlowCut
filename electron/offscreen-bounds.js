/**
 * electron/offscreen-bounds.js
 *
 * Flow WebContentsView 를 프롬프트 주입(Slate focus / execCommand)용으로 잠깐 "보이게"
 * 해야 하는데, 기존엔 창 오른쪽 +5000px 로 옮겼다. 멀티모니터에서 그 위치가 두 번째
 * 모니터 위라 사용자 화면에 Flow 페이지가 깜빡여 혼동을 줬다(특히 Flow 모드 생성 시).
 *
 * 이 헬퍼는 "모든 디스플레이의 오른쪽 끝 너머" view bounds 를 계산해 어느 화면에도
 * 안 보이게 한다. WebContentsView bounds 는 창 content 기준이라, 화면좌표 기준 오른쪽
 * 끝(maxRight)이 되도록 창의 화면 x(winX)를 빼고 여유(200px)를 더한다.
 *
 * @param {Array<{bounds?:{x?:number,width?:number}}>} displays - screen.getAllDisplays()
 * @param {number} winX - mainWindow.getBounds().x (창의 화면 x)
 * @param {number} width
 * @param {number} height
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function computeOffscreenBounds(displays, winX, width, height) {
  let maxRight = (winX || 0) + (width || 0) // 폴백: 디스플레이 정보 없으면 창 오른쪽
  if (Array.isArray(displays) && displays.length) {
    maxRight = Math.max(...displays.map(d => ((d && d.bounds && d.bounds.x) || 0) + ((d && d.bounds && d.bounds.width) || 0)))
  }
  return { x: Math.round(maxRight - (winX || 0)) + 200, y: 0, width, height }
}

/** DOM 자동화가 요구하는 최소 뷰 크기. 2026-09-25 실기: flow.google.com 은 597px 폭(Material handset 분기점 600 미만)
 *  에서 에이전트 칩 등 컴포저 컨트롤을 아예 렌더하지 않았고 957px 에선 정상이었다. 700 은 600 위 여유, 957 아래. */
export const AUTOMATION_MIN_WIDTH = 700
export const AUTOMATION_MIN_HEIGHT = 600

/** 이 bounds 로는 DOM 자동화(에이전트 칩·설정 패널·편집기 주입)를 믿을 수 없나 — 숨음(0×0/없음) 또는 좁음. 순수. */
export function needsAutomationViewport(bounds) {
  if (!bounds) return true
  const w = Number(bounds.width) || 0
  const h = Number(bounds.height) || 0
  return w < AUTOMATION_MIN_WIDTH || h < AUTOMATION_MIN_HEIGHT
}

/** 화면 밖 자동화 뷰포트 크기 — 창 콘텐츠 크기 이상, 최소값 이상. 순수. */
export function automationViewportSize(contentBounds) {
  const w = Number(contentBounds && contentBounds.width) || 0
  const h = Number(contentBounds && contentBounds.height) || 0
  return { width: Math.max(w, AUTOMATION_MIN_WIDTH), height: Math.max(h, AUTOMATION_MIN_HEIGHT) }
}

