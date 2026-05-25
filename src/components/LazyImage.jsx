/**
 * LazyImage — IntersectionObserver 기반 뷰포트 언로드
 *
 * 초기 렌더는 img 를 즉시 마운트 (visible=true 기본값) — file:// 같은 로컬
 * 이미지는 거의 0프레임에 표시되므로 placeholder 가 보이지 않음. IO 콜백이
 * fire 된 후에 화면 밖 항목만 unmount 되어 VRAM 을 회수한다.
 *
 * - 초기: img 즉시 표시 (지연 없음)
 * - IO 가 isIntersecting:false → img unmount → 브라우저 GC 가 비트맵 회수
 * - IO 가 isIntersecting:true → img 다시 mount
 *
 * rootMargin 200px 여유: 스크롤 시 빈 화면 노출 방지
 *
 * 크기 보장: wrapper/placeholder/img 모두 컴포넌트 차원에서 부모 fill 을 inline
 * style 로 보장. CSS 파일 의존 없이 어느 부모 컨텍스트(block/flex)에서도 동작.
 */
import { useState, useEffect, useRef } from 'react'

const WRAPPER_STYLE = { width: '100%', height: '100%', display: 'block' }
const PLACEHOLDER_STYLE = { width: '100%', height: '100%', display: 'block' }
const IMG_STYLE = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }

export default function LazyImage({ src, alt, className, style, ...props }) {
  // 초기 visible=true: 로컬 file:// 이미지는 즉시 로드되어 placeholder 가 보이지
  // 않음. IO 콜백이 fire 된 후 화면 밖 항목만 unmount 되어 VRAM 회수.
  const [visible, setVisible] = useState(true)
  const wrapperRef = useRef(null)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return

    // IntersectionObserver 미지원 환경(구형 브라우저, SSR, 일부 테스트)에서는
    // 항상 표시해서 이미지가 보이지 않는 문제 방지
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '200px 0px 200px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={wrapperRef}
      className={`lazy-image-wrapper${className ? ` ${className}` : ''}`}
      style={{ ...WRAPPER_STYLE, ...style }}
    >
      {visible && src ? (
        <img src={src} alt={alt} style={IMG_STYLE} {...props} />
      ) : (
        <div className="lazy-image-placeholder" style={PLACEHOLDER_STYLE} />
      )}
    </div>
  )
}
