/**
 * LazyImage — IntersectionObserver 기반 뷰포트 진입/이탈 이미지 로딩
 *
 * - 뷰포트 밖: placeholder div 만 렌더링 → 디코딩 VRAM 없음
 * - 뷰포트 진입: img src 로드 → 디코딩
 * - 뷰포트 이탈: img 언마운트 → 브라우저 GC 가 비트맵 메모리 회수
 *
 * rootMargin 200px 여유: 스크롤 시 빈 화면 노출 방지
 *
 * 크기 보장: wrapper/placeholder/img 모두 컴포넌트 차원에서 부모 fill 을 inline
 * style 로 보장. CSS 파일 의존 없이 어느 부모 컨텍스트(block/flex)에서도 동작.
 * 호출부가 style prop 을 전달하면 wrapper 기본값과 merge; img 에 style 을 전달하면
 * props spread 로 override 가능.
 */
import { useState, useEffect, useRef } from 'react'

const WRAPPER_STYLE = { width: '100%', height: '100%', display: 'block' }
const PLACEHOLDER_STYLE = { width: '100%', height: '100%', display: 'block' }
const IMG_STYLE = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }

export default function LazyImage({ src, alt, className, style, ...props }) {
  const [visible, setVisible] = useState(false)
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
