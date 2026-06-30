import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * useElementWidth — ref 로 단 엘리먼트의 폭(px)을 ResizeObserver 로 추적.
 *
 * 콜백 ref 를 반환해 조건부 렌더(엘리먼트가 붙었다 떨어졌다)에서도 안전하게 (재)관찰한다.
 *   const [ref, width] = useElementWidth()
 *   <button ref={ref}>...</button>
 *
 * @returns {[(el: Element|null) => void, number]}
 */
export function useElementWidth() {
  const [width, setWidth] = useState(0)
  const roRef = useRef(null)

  const ref = useCallback((el) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(el)
    roRef.current = ro
    // 초기 폭 1회 즉시 반영(첫 페인트 전 tier 결정).
    const r = el.getBoundingClientRect()
    if (r && r.width) setWidth(r.width)
  }, [])

  useEffect(() => () => { if (roRef.current) roRef.current.disconnect() }, [])

  return [ref, width]
}

export default useElementWidth
