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
// 주입 시 Flow 뷰 최소 너비. 창(=Flow 뷰)이 좁으면 Flow 웹 UI 가 반응형으로 접혀 멘션 피커의
// "캐릭터" 탭이 [role=tab] 로 안 남고(overflow), __findCharTab 이 실패한다(character-tab-not-found).
// 주입 중 뷰는 오프스크린이라 안 보이므로, 반환 너비를 이 최소값으로 올려 Flow 를 풀 레이아웃으로
// 렌더시킨다(탭 미접힘). x(오프스크린 위치)는 원본 width 로 계산해 그대로 둔다.
export const MIN_INJECT_WIDTH = 1280

export function computeOffscreenBounds(displays, winX, width, height) {
  let maxRight = (winX || 0) + (width || 0) // 폴백: 디스플레이 정보 없으면 창 오른쪽
  if (Array.isArray(displays) && displays.length) {
    maxRight = Math.max(...displays.map(d => ((d && d.bounds && d.bounds.x) || 0) + ((d && d.bounds && d.bounds.width) || 0)))
  }
  const injectWidth = Math.max(MIN_INJECT_WIDTH, width || 0)
  return { x: Math.round(maxRight - (winX || 0)) + 200, y: 0, width: injectWidth, height }
}
