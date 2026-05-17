import { useRef, useState, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { computeBalloonPosition } from '../utils/balloonPosition'

/**
 * 썸네일 hover 시 뜨는 이미지 미리보기 풍선.
 * portal 로 document.body 에 렌더하고, 풍선을 실측한 뒤 edge-aware 로 배치한다
 * (오른쪽 공간 부족 → 왼쪽, 아래 부족 → 위). 스크롤 컨테이너 clip 도 회피.
 */
export default function HoverImageBalloon({ anchorRect, src, className, alt = 'preview', children }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  const reposition = useCallback(() => {
    const el = ref.current
    if (!el || !anchorRect) return
    setPos(computeBalloonPosition({
      anchor: anchorRect,
      balloon: { width: el.offsetWidth, height: el.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }))
  }, [anchorRect])

  useLayoutEffect(() => { reposition() }, [reposition, src])

  return createPortal(
    <div
      ref={ref}
      className={className}
      style={{
        position: 'fixed',
        left: pos ? pos.left : 0,
        top: pos ? pos.top : 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <img src={src} alt={alt} onLoad={reposition} />
      {children}
    </div>,
    document.body
  )
}
