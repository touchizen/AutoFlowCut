/**
 * LazyImage — IntersectionObserver 기반 뷰포트 진입/이탈 이미지 로딩
 *
 * - 뷰포트 밖: placeholder div 만 렌더링 → 디코딩 VRAM 없음
 * - 뷰포트 진입: img src 로드 → 디코딩
 * - 뷰포트 이탈: img 언마운트 → 브라우저 GC 가 비트맵 메모리 회수
 *
 * rootMargin 200px 여유: 스크롤 시 빈 화면 노출 방지
 */
import { useState, useEffect, useRef } from 'react'

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
      style={style}
    >
      {visible && src ? (
        <img src={src} alt={alt} {...props} />
      ) : (
        <div className="lazy-image-placeholder" />
      )}
    </div>
  )
}
