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

/** 2026-11-07 실기: 597px뿐 아니라 네이티브 줌으로 확보한 700px에서도
 * Agent 칩이 렌더되지 않았다. 실제 생성이 통과한 957px 이상을 확보한다.
 * 정확한 Flow CSS 분기점을 추측하지 않고 확인된 폭에 여유를 둔다. */
export const AUTOMATION_MIN_WIDTH = 960
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


/**
 * 창 **안** 제자리 자동화 뷰포트(x=0,y=0, 창 콘텐츠 크기 이상·최소값 이상). 순수.
 *   2026-09-25 M2 실기: 화면 밖(x=1760) 1200×872 로 옮겨도 페이지 innerWidth 가 597 그대로 — 완전히 화면 밖인 뷰는
 *   Chromium 이 다시 레이아웃하지 않아 에이전트 칩이 안 그려졌다(ensureAgentOff not_found). 보이는 뷰(957px)는 실기 통과.
 *   DOM 단계 몇 초 동안 Flow 뷰가 앱 UI 를 덮고, finally 의 updateBounds 가 레이아웃으로 되돌린다.
 */
export function computeInPlaceBounds(contentBounds) {
  const size = automationViewportSize(contentBounds)
  return { x: 0, y: 0, width: size.width, height: size.height }
}
