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
