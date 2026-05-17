/**
 * hover 미리보기 풍선의 fixed 배치 스타일 계산 — 풍선 크기를 측정하지 않는다.
 * 앵커(썸네일 또는 마우스 지점)와 뷰포트만으로:
 *  - 가로: 좌/우 중 넓은 쪽에 배치하고 그 쪽 가용 폭으로 maxWidth 를 제한
 *  - 세로: 위/아래 중 넓은 쪽 기준으로 배치하고 가용 높이로 maxHeight 를 제한
 * → 풍선이 썸네일을 덮거나 화면 밖으로 나가는 일이 없다.
 *
 * @param {object} args
 * @param {{left:number,right:number,top:number,bottom:number}} args.anchor
 *        썸네일의 화면 좌표. 마우스 지점이면 left===right, top===bottom 인 0-크기 사각형을 넘긴다.
 * @param {{width:number,height:number}} args.viewport
 * @param {number} [args.gap=8]
 * @returns {object} 인라인 스타일 일부 — { left|right, top|bottom, maxWidth, maxHeight }
 */
export function computeBalloonPosition({ anchor, viewport, gap = 8 }) {
  const spaceRight = viewport.width - anchor.right - gap
  const spaceLeft = anchor.left - gap
  const spaceBelow = viewport.height - anchor.top - gap
  const spaceAbove = anchor.bottom - gap

  // 가로: 넓은 쪽에 배치 + 그 쪽 가용 폭으로 maxWidth 제한
  const horizontal = spaceRight >= spaceLeft
    ? { left: anchor.right + gap, maxWidth: Math.max(0, spaceRight) }
    : { right: Math.max(0, viewport.width - anchor.left + gap), maxWidth: Math.max(0, spaceLeft) }

  // 세로: 아래 공간이 넓으면 위(anchor.top)에서 아래로, 아니면 아래(anchor.bottom)에서 위로.
  const vertical = spaceBelow >= spaceAbove
    ? { top: Math.max(gap, anchor.top), maxHeight: Math.max(0, spaceBelow) }
    : { bottom: Math.max(0, viewport.height - anchor.bottom), maxHeight: Math.max(0, spaceAbove) }

  return { ...horizontal, ...vertical }
}
