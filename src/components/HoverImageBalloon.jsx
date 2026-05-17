import { createPortal } from 'react-dom'
import { computeBalloonPosition } from '../utils/balloonPosition'

/**
 * 썸네일/마우스 hover 시 뜨는 미리보기 풍선.
 * portal 로 document.body 에 렌더하고, 측정 없이 앵커+뷰포트만으로 edge-aware 배치한다.
 * wrapper 에 maxHeight + overflow 를 적용해 풍선 전체가 가용 공간을 넘지 않게 하고,
 * 공간이 모자라면 이미지(flex-shrink)가 줄고 children(캡션)은 잘리지 않는다.
 * 가용 공간은 CSS 변수(--balloon-avail-width/height)로 노출 — 각 풍선 CSS 가
 * max-width/max-height 를 min(var(...), 디자인 상한) 으로 두면
 * "가용 공간 캡"과 "컴포넌트별 디자인 상한"이 함께 적용된다.
 * src 는 선택 — 없으면 이미지 없이 children 만 렌더한다.
 */
export default function HoverImageBalloon({ anchorRect, src, className, alt = 'preview', imgClassName, children }) {
  if (!anchorRect) return null
  // 풍선은 AutoCraft 앱 패널(.app-content-split) 안에만 머문다 — 패널 바깥 영역은
  // 네이티브 Flow WebContentsView 가 깔려 있어 DOM 풍선이 그 뒤로 가려진다.
  const panelEl = typeof document !== 'undefined' ? document.querySelector('.app-content-split') : null
  const bounds = panelEl
    ? (() => {
        const r = panelEl.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      })()
    : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  const { maxWidth, maxHeight, ...boxStyle } = computeBalloonPosition({
    anchor: anchorRect,
    bounds,
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
        '--balloon-avail-width': `${maxWidth}px`,
        '--balloon-avail-height': `${maxHeight}px`,
        ...boxStyle,
      }}
    >
      {src && (
        <img
          src={src}
          alt={alt}
          className={imgClassName}
          decoding="sync"
          style={{ maxWidth: '100%', minHeight: 0, objectFit: 'contain' }}
        />
      )}
      {children != null && <div style={{ flexShrink: 0 }}>{children}</div>}
    </div>,
    document.body
  )
}
