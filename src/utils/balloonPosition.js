/**
 * hover 미리보기 풍선의 fixed 배치 스타일 계산 — 풍선 크기를 측정하지 않는다.
 *
 * 풍선이 머물 수 있는 영역(bounds)과 앵커만으로:
 *  - 가로: 좌/우 중 넓은 쪽에 배치하고 그 쪽 가용 폭으로 maxWidth 를 제한
 *  - 세로: 위/아래 중 넓은 쪽 기준으로 배치하고 가용 높이로 maxHeight 를 제한
 * bounds 는 AutoCraft 앱 패널 영역 — 네이티브 Flow 뷰가 깔린 바깥으로 풍선이
 * flip 되는 걸 막는다. fixed 좌표(right/bottom)는 실제 창(viewport) 기준이다.
 *
 * @param {object} args
 * @param {{left:number,right:number,top:number,bottom:number}} args.anchor
 *        썸네일의 화면 좌표. 마우스 지점이면 left===right, top===bottom 인 0-크기 사각형.
 * @param {{left:number,top:number,right:number,bottom:number}} args.bounds
 *        풍선이 머물 수 있는 영역(앱 패널)의 화면 좌표.
 * @param {{width:number,height:number}} args.viewport 실제 창 크기 (fixed 좌표용).
 * @param {number} [args.gap=8]
 * @returns {object} 인라인 스타일 일부 — { left|right, top|bottom, maxWidth, maxHeight }
 */
export function computeBalloonPosition({ anchor, bounds, viewport, gap = 8 }) {
  const spaceRight = bounds.right - anchor.right - gap
  const spaceLeft = anchor.left - bounds.left - gap
  const spaceBelow = bounds.bottom - anchor.top - gap
  const spaceAbove = anchor.bottom - bounds.top - gap

  // 가로: 패널 안에서 넓은 쪽에 배치 + 그 쪽 가용 폭으로 maxWidth 제한
  const horizontal = spaceRight >= spaceLeft
    ? { left: anchor.right + gap, maxWidth: Math.max(0, spaceRight) }
    : { right: Math.max(0, viewport.width - anchor.left + gap), maxWidth: Math.max(0, spaceLeft) }

  // 세로: 아래 공간이 넓으면 위(anchor.top)에서 아래로, 아니면 아래(anchor.bottom)에서 위로.
  const vertical = spaceBelow >= spaceAbove
    ? { top: Math.max(bounds.top + gap, anchor.top), maxHeight: Math.max(0, spaceBelow) }
    : { bottom: Math.max(0, viewport.height - anchor.bottom), maxHeight: Math.max(0, spaceAbove) }

  return { ...horizontal, ...vertical }
}
