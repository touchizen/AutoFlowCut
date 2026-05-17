/**
 * hover 미리보기 풍선의 fixed 좌표 계산.
 * 기본은 앵커(썸네일) 오른쪽. 오른쪽 공간이 부족하면 왼쪽으로 flip,
 * 아래로 넘치면 위로 shift — 풍선이 썸네일을 가리거나 화면 밖으로 나가지 않게 한다.
 *
 * @param {object} args
 * @param {{left:number,right:number,top:number,bottom:number}} args.anchor 썸네일 화면 좌표
 * @param {{width:number,height:number}} args.balloon 풍선 실측 크기
 * @param {{width:number,height:number}} args.viewport
 * @param {number} [args.gap=8]
 * @returns {{left:number, top:number}}
 */
export function computeBalloonPosition({ anchor, balloon, viewport, gap = 8 }) {
  let left = anchor.right + gap
  if (left + balloon.width > viewport.width) {
    // 오른쪽 공간 부족 → 왼쪽으로 flip
    const flippedLeft = anchor.left - gap - balloon.width
    left = flippedLeft >= 0
      ? flippedLeft
      : Math.max(0, viewport.width - balloon.width)  // 양쪽 다 부족 — 화면 안으로만
  }
  let top = anchor.top
  if (top + balloon.height > viewport.height) {
    top = viewport.height - balloon.height - gap  // 아래로 넘침 → 위로 shift
  }
  top = Math.max(gap, top)
  return { left, top }
}
