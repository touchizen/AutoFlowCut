/**
 * LazyImage — IntersectionObserver 기반 뷰포트 진입/이탈 이미지 로딩
 *
 * 모드:
 * - 기본 (lazy): 초기 렌더에 img 마운트 안 함 → IO 진입 신호 시 마운트.
 *   긴 리스트 / 그리드에서 초기 CPU·VRAM 스파이크 방지. (SceneList, ResultsTable,
 *   StylePicker)
 * - eager=true: 초기 렌더에 img 즉시 마운트. 깜빡임 0. 카드 1-2개짜리 단일
 *   썸네일에서 placeholder spinner 회피용. (ReferenceCard)
 *
 * 두 모드 모두 IO 가 isIntersecting:false 판정하면 img 를 unmount 해서 비트맵
 * VRAM 을 회수한다. 스크롤로 재진입하면 다시 mount.
 *
 * rootMargin 200px 여유: 스크롤 시 빈 화면 노출 방지.
 *
 * 크기 보장: wrapper/placeholder/img 모두 컴포넌트 차원에서 부모 fill 을 inline
 * style 로 보장. CSS 파일 의존 없이 어느 부모 컨텍스트(block/flex)에서도 동작.
 */
import { useState, useEffect, useRef } from 'react'

const WRAPPER_STYLE = { width: '100%', height: '100%', display: 'block' }
const PLACEHOLDER_STYLE = { width: '100%', height: '100%', display: 'block' }
const IMG_STYLE = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }

export default function LazyImage({ src, alt, className, style, eager = false, ...props }) {
  // eager=true: 즉시 mount (작은 단독 카드 등에서 placeholder spinner 회피)
  // 기본 lazy: IO 진입 신호 후 mount (긴 리스트/그리드에서 첫 렌더 스파이크 방지)
  const [visible, setVisible] = useState(eager)
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
        <img src={src} alt={alt} decoding="async" style={IMG_STYLE} {...props} />
      ) : (
        <div className="lazy-image-placeholder" style={PLACEHOLDER_STYLE} />
      )}
    </div>
  )
}
