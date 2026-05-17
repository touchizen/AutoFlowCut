import { createPortal } from 'react-dom'
import { computeBalloonPosition } from '../utils/balloonPosition'

/**
 * 썸네일/마우스 hover 시 뜨는 미리보기 풍선.
 * portal 로 document.body 에 렌더하고, 측정 없이 앵커+뷰포트만으로 edge-aware 배치한다.
 * 풍선은 배치된 쪽 가용 공간으로 maxWidth/maxHeight 가 제한돼 썸네일을 덮지 않는다.
 * src 는 선택 — 없으면 이미지 없이 children 만 렌더한다.
 */
export default function HoverImageBalloon({ anchorRect, src, className, alt = 'preview', imgClassName, children }) {
  if (!anchorRect) return null
  const { maxHeight, ...boxStyle } = computeBalloonPosition({
    anchor: anchorRect,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  })
  return createPortal(
    <div
      className={className}
      style={{ position: 'fixed', boxSizing: 'border-box', ...boxStyle }}
    >
      {src && (
        <img
          src={src}
          alt={alt}
          className={imgClassName}
          decoding="sync"
          style={{ maxWidth: '100%', maxHeight }}
        />
      )}
      {children}
    </div>,
    document.body
  )
}
