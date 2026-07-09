/**
 * useSplitLayout — Flow 모드 화면 분할(Flow | App) 리사이저 상태/효과/핸들러.
 *
 * ShellContent 에서 추출. 레이아웃 모드/비율 state + localStorage 영속 + main(layout-changed)
 * 동기화 + 드래그 리사이저를 한곳에 캡슐화한다. 렌더는 Shell 이 담당.
 *
 * ── 드래그 떨림(jitter) 방지 ──
 * 드래그 중에는 절대로 setLayout(=main 이 layout-changed 로 되쏘는 echo 유발)을 부르지 않고,
 * onMove 의 updateSplit(echo 없음)만으로 실시간 반영한다. setLayout 은 드래그가 끝난 뒤
 * (isDragging=false) 이 effect 가 재실행될 때 최종 비율로 1회만 동기화한다.
 *   과거엔 매 mousemove 마다 setLayout 이 불려 layout-changed 가 쏟아졌고, IPC 왕복이
 *   mousemove 보다 느려 뒤늦게 도착한 낡은(stale) ratio 가 onLayoutChanged 로 다시 반영되며
 *   스플릿터가 좌우로 격렬하게 튀었다. 추가 안전장치로, 드래그 중 도착하는 layout-changed
 *   ratio 는 isDraggingRef 로 무시한다.
 *
 * @param {{ isFlow: boolean, shellRef: import('react').RefObject<HTMLElement> }} args
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  DEFAULT_SPLIT_MODE, DEFAULT_SPLIT_RATIO, isHorizontalSplit, ratioFromDrag,
} from '../utils/appLayout'

const STORAGE_KEY = 'layoutSettings'
// 드래그 dead zone(px) — mousedown 지점에서 이만큼 넘게 움직이기 전엔 비율을 바꾸지 않는다.
// 더블클릭·클릭 시 미세한 커서 흔들림이 onMove 를 발동시켜 스플릿터가 좌우로 튀는 것을 막는다.
const DRAG_THRESHOLD_PX = 4

export function useSplitLayout({ isFlow, shellRef }) {
  const [layoutMode, setLayoutMode] = useState(DEFAULT_SPLIT_MODE)
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO)
  const [isDragging, setIsDragging] = useState(false)
  // 드래그 여부를 안정적인 IPC 구독 콜백 안에서 읽기 위한 ref 미러.
  const isDraggingRef = useRef(false)
  useEffect(() => { isDraggingRef.current = isDragging }, [isDragging])
  // mousedown 시작 좌표 + 임계값 통과 여부 — dead zone 판정용.
  const dragStartRef = useRef(null)

  // 저장된 레이아웃 로드 + main 의 layout-changed 구독 (단일 소스 동기화)
  useEffect(() => {
    const offLayoutChanged = window.electronAPI?.onLayoutChanged?.(({ mode: m, splitRatio: ratio }) => {
      if (m) setLayoutMode(m)
      // 드래그 중엔 main 이 되쏘는 지연·낡은 ratio 를 무시 — 이 echo 가 스플릿터를 좌우로 튀게 한다.
      if (!isDraggingRef.current && typeof ratio === 'number') setSplitRatio(ratio)
    })
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved?.mode && saved.mode !== 'tab') {
        setLayoutMode(saved.mode)
        setSplitRatio(saved.ratio || DEFAULT_SPLIT_RATIO)
      }
    } catch { /* ignore */ }
    return () => { offLayoutChanged?.() }
  }, [])

  // 레이아웃 영속 + flow 모드에서 electron 으로 동기화(Flow 뷰 bounds 갱신).
  // 드래그 중에는 setLayout(echo 유발)을 생략 — 실시간 반영은 onMove 의 updateSplit 담당.
  // 드래그 종료 시 isDragging 이 false 로 바뀌며 이 effect 가 재실행돼 최종 비율을 1회 동기화한다.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: layoutMode, ratio: splitRatio }))
    if (isFlow && !isDragging) window.electronAPI?.setLayout?.({ mode: layoutMode, ratio: splitRatio })
  }, [layoutMode, splitRatio, isFlow, isDragging])

  // ── 드래그 리사이저 ──
  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    // 더블클릭의 두 번째+ 클릭(e.detail>=2)은 드래그로 취급하지 않는다. Flow 는 네이티브
    // WebContentsView 라 z-index 오버레이로 못 가려서, 더블클릭 중 경계 위 커서의 불규칙한
    // 이동이 onMove 로 커밋돼(4px dead-zone 초과) 스플릿터·Flow 뷰가 좌우로 튀었다. 리셋은
    // handleDoubleClick 이 담당하므로 드래그는 첫 클릭만.
    if (e.detail >= 2) return
    dragStartRef.current = { x: e.clientX, y: e.clientY, moved: false }
    setIsDragging(true)
  }, [])
  const handleDoubleClick = useCallback(() => {
    setSplitRatio(DEFAULT_SPLIT_RATIO)
    window.electronAPI?.updateSplit?.({ ratio: DEFAULT_SPLIT_RATIO })
  }, [])

  useEffect(() => {
    if (!isDragging) return
    const horizontal = isHorizontalSplit(layoutMode)
    const onMove = (e) => {
      const el = shellRef.current
      if (!el) return
      // dead zone: mousedown 지점에서 임계값 넘게 움직이기 전엔 무시(더블클릭·미세 흔들림 방지).
      const start = dragStartRef.current
      if (start && !start.moved) {
        const dist = Math.abs((horizontal ? e.clientX : e.clientY) - (horizontal ? start.x : start.y))
        if (dist < DRAG_THRESHOLD_PX) return
        start.moved = true
      }
      const rect = el.getBoundingClientRect()
      const total = horizontal ? rect.width : rect.height
      const pos = horizontal ? (e.clientX - rect.left) : (e.clientY - rect.top)
      const next = ratioFromDrag(layoutMode, pos, total)
      setSplitRatio(next)
      window.electronAPI?.updateSplit?.({ ratio: next })
    }
    const onUp = () => setIsDragging(false)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [isDragging, layoutMode, shellRef])

  return { layoutMode, splitRatio, isDragging, handleMouseDown, handleDoubleClick }
}

export default useSplitLayout
