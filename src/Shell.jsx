/**
 * Shell - Electron Desktop 외부 쉘
 *
 * 듀얼 모드:
 * - api 모드: Flow 뷰 없음 → App 을 전체폭으로 렌더링.
 * - flow 모드: Flow WebContentsView(electron overlay)와 App 을 split 으로 나란히 배치하고,
 *   둘 사이 드래그 리사이저로 비율 조절. 기본 split-left (Flow 왼쪽 / App 오른쪽).
 *   레이아웃 모드/비율은 localStorage 영속.
 *
 * Flow 뷰의 실제 위치/크기는 electron(ipc/layout.js updateBounds)이 그리고, 여기서는 App
 * 콘텐츠 박스를 그 반대편에 배치하고(splitAppStyle) 리사이저로 setLayout/updateSplit 을 호출한다.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { I18nProvider } from './hooks/useI18n'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './components/Toast'
import { QuotaExhaustedModalProvider } from './components/QuotaExhaustedModal'
import { ModeProvider, useMode } from './contexts/ModeContext'
import ModeGate from './components/ModeGate'
import App from './App'
import {
  DEFAULT_SPLIT_MODE, DEFAULT_SPLIT_RATIO, isHorizontalSplit,
  splitAppStyle, splitResizerStyle, ratioFromDrag,
} from './utils/appLayout'

function ShellContent() {
  const { mode } = useMode()
  const isFlow = mode === 'flow'

  const [layoutMode, setLayoutMode] = useState(DEFAULT_SPLIT_MODE)
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO)
  const [isDragging, setIsDragging] = useState(false)
  const shellRef = useRef(null)

  // 저장된 레이아웃 로드 + main 의 layout-changed 구독 (단일 소스 동기화)
  useEffect(() => {
    const offLayoutChanged = window.electronAPI?.onLayoutChanged?.(({ mode: m, splitRatio: ratio }) => {
      if (m) setLayoutMode(m)
      if (typeof ratio === 'number') setSplitRatio(ratio)
    })
    try {
      const saved = JSON.parse(localStorage.getItem('layoutSettings') || 'null')
      if (saved?.mode && saved.mode !== 'tab') {
        setLayoutMode(saved.mode)
        setSplitRatio(saved.ratio || DEFAULT_SPLIT_RATIO)
      }
    } catch { /* ignore */ }
    return () => { offLayoutChanged?.() }
  }, [])

  // 레이아웃 영속 + flow 모드에서 electron 으로 동기화(Flow 뷰 bounds 갱신)
  useEffect(() => {
    localStorage.setItem('layoutSettings', JSON.stringify({ mode: layoutMode, ratio: splitRatio }))
    if (isFlow) window.electronAPI?.setLayout?.({ mode: layoutMode, ratio: splitRatio })
  }, [layoutMode, splitRatio, isFlow])

  // ── 드래그 리사이저 ──
  const handleMouseDown = useCallback((e) => { e.preventDefault(); setIsDragging(true) }, [])
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
  }, [isDragging, layoutMode])

  // api 모드: split 없이 전체폭.
  if (!isFlow) {
    return (
      <div className="shell-root" style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
        <div className="app-content-full" style={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
          <App />
        </div>
      </div>
    )
  }

  // flow 모드: split + 리사이저.
  const horizontal = isHorizontalSplit(layoutMode)
  return (
    <div
      className="shell-root split-mode"
      ref={shellRef}
      style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}
    >
      <div className="app-content-split" style={splitAppStyle(layoutMode, splitRatio)}>
        <App />
      </div>

      {/* 드래그 리사이저 (Flow/App 경계) */}
      <div
        className="split-resizer"
        style={splitResizerStyle(layoutMode, splitRatio)}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        title="드래그로 크기 조절 · 더블클릭 50:50"
      >
        <div className="split-resizer-handle" />
      </div>

      {/* 드래그 중 Flow WebContentsView 위 마우스 이벤트 캡처 */}
      {isDragging && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 99, cursor: horizontal ? 'col-resize' : 'row-resize' }} />
      )}
    </div>
  )
}

export default function Shell() {
  return (
    <ModeProvider>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <QuotaExhaustedModalProvider>
              <ModeGate>
                <ShellContent />
              </ModeGate>
            </QuotaExhaustedModalProvider>
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </ModeProvider>
  )
}
