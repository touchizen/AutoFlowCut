import { createPortal } from 'react-dom'
import { computeBalloonPosition } from '../utils/balloonPosition'

/**
 * 썸네일/마우스 hover 시 뜨는 미리보기 풍선.
 * portal 로 document.body 에 렌더하고, 측정 없이 앵커+뷰포트만으로 edge-aware 배치한다.
 * wrapper 에 maxHeight + overflow 를 적용해 풍선 전체(이미지 + children)가 가용 공간을
 * 넘지 않게 한다. 공간이 모자라면 이미지(flex-shrink)가 줄고 children(캡션)은 잘리지 않는다.
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
      style={{
        position: 'fixed',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        maxHeight,
        ...boxStyle,
      }}
    >
      {src && (
        <img
          src={src}
          alt={alt}
          className={imgClassName}
          decoding="sync"
          style={{ maxWidth: '100%', maxHeight, minHeight: 0, objectFit: 'contain' }}
        />
      )}
      {children != null && <div style={{ flexShrink: 0 }}>{children}</div>}
    </div>,
    document.body
  )
}
