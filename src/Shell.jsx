/**
 * Shell - Electron Desktop 외부 쉘
 *
 * 레이아웃 모드 (Split only — Tab 모드 제거):
 * - split-left: Flow 왼쪽 / App 오른쪽 (기본값)
 * - split-right: Flow 오른쪽 / App 왼쪽
 * - split-top: Flow 상단 / App 하단
 * - split-bottom: Flow 하단 / App 상단
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { I18nProvider } from './hooks/useI18n'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './components/Toast'
import { QuotaExhaustedModalProvider } from './components/QuotaExhaustedModal'
import App from './App'

const DEFAULT_LAYOUT = 'split-left'
const DEFAULT_RATIO = 0.5

// 수평 분할인지 판별
function isHorizontalSplit(mode) {
  return mode === 'split-left' || mode === 'split-right'
}

function ShellContent() {
  const [flowStatus, setFlowStatus] = useState({ loaded: false, loggedIn: false })
  const [layoutMode, setLayoutMode] = useState(DEFAULT_LAYOUT)
  const [splitRatio, setSplitRatio] = useState(DEFAULT_RATIO)
  const [isDragging, setIsDragging] = useState(false)
  const shellRef = useRef(null)

  useEffect(() => {
    if (window.electronAPI?.onFlowStatus) {
      window.electronAPI.onFlowStatus((data) => setFlowStatus(data))
    }
    if (window.electronAPI?.onLayoutChanged) {
      window.electronAPI.onLayoutChanged(({ mode, splitRatio: ratio }) => {
        setLayoutMode(mode)
        setSplitRatio(ratio)
      })
    }
    // 저장된 레이아웃 로드
    const saved = localStorage.getItem('layoutSettings')
    if (saved) {
      try {
        const { mode, ratio } = JSON.parse(saved)
        // tab 모드가 저장되어 있으면 기본값으로 변환
        const validMode = (mode && mode !== 'tab') ? mode : DEFAULT_LAYOUT
        const validRatio = ratio || DEFAULT_RATIO
        setLayoutMode(validMode)
        setSplitRatio(validRatio)
        window.electronAPI?.setLayout?.({ mode: validMode, ratio: validRatio })
      } catch (e) { /* ignore */ }
    } else {
      // 저장된 설정 없으면 기본값 적용
      window.electronAPI?.setLayout?.({ mode: DEFAULT_LAYOUT, ratio: DEFAULT_RATIO })
    }
  }, [])

  // 레이아웃 변경 시 localStorage 저장
  useEffect(() => {
    localStorage.setItem('layoutSettings', JSON.stringify({ mode: layoutMode, ratio: splitRatio }))
  }, [layoutMode, splitRatio])

  // 드래그 리사이저
  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  // 더블클릭 → 50:50 리셋
  const handleDoubleClick = useCallback(() => {
    setSplitRatio(DEFAULT_RATIO)
    window.electronAPI?.updateSplit?.({ ratio: DEFAULT_RATIO })
  }, [])

  useEffect(() => {
    if (!isDragging) return
    const horizontal = isHorizontalSplit(layoutMode)

    const handleMouseMove = (e) => {
      if (!shellRef.current) return
      const rect = shellRef.current.getBoundingClientRect()
      const total = horizontal ? rect.width : rect.height
      let rawPos
      if (horizontal) {
        rawPos = e.clientX - rect.left
      } else {
        rawPos = e.clientY - rect.top
      }
      // split-right/bottom: Flow는 반대편이므로 비율을 반전
      const isReversed = layoutMode === 'split-right' || layoutMode === 'split-bottom'
      const newRatio = isReversed
        ? Math.max(0.2, Math.min(0.8, (total - rawPos) / total))
        : Math.max(0.2, Math.min(0.8, rawPos / total))

      window.electronAPI?.updateSplit?.({ ratio: newRatio })
      setSplitRatio(newRatio)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, layoutMode])

  const horizontal = isHorizontalSplit(layoutMode)

  // App 영역 스타일 계산
  const getAppStyle = () => {
    const flowPct = `${splitRatio * 100}%`
    const appPct = `${(1 - splitRatio) * 100}%`

    if (layoutMode === 'split-left') {
      return { position: 'absolute', top: 0, left: flowPct, width: appPct, height: '100%', overflow: 'auto' }
    }
    if (layoutMode === 'split-right') {
      return { position: 'absolute', top: 0, left: 0, width: appPct, height: '100%', overflow: 'auto' }
    }
    if (layoutMode === 'split-top') {
      return { position: 'absolute', top: flowPct, left: 0, width: '100%', height: appPct, overflow: 'auto' }
    }
    if (layoutMode === 'split-bottom') {
      return { position: 'absolute', top: 0, left: 0, width: '100%', height: appPct, overflow: 'auto' }
    }
    return {}
  }

  // 리사이저 스타일
  const getResizerStyle = () => {
    if (layoutMode === 'split-left') {
      return {
        position: 'absolute', top: 0, left: `${splitRatio * 100}%`,
        width: '6px', height: '100%', transform: 'translateX(-3px)',
        cursor: 'col-resize', zIndex: 100
      }
    }
    if (layoutMode === 'split-right') {
      return {
        position: 'absolute', top: 0, left: `${(1 - splitRatio) * 100}%`,
        width: '6px', height: '100%', transform: 'translateX(-3px)',
        cursor: 'col-resize', zIndex: 100
      }
    }
    if (layoutMode === 'split-top') {
      return {
        position: 'absolute', top: `${splitRatio * 100}%`, left: 0,
        width: '100%', height: '6px', transform: 'translateY(-3px)',
        cursor: 'row-resize', zIndex: 100
      }
    }
    if (layoutMode === 'split-bottom') {
      return {
        position: 'absolute', top: `${(1 - splitRatio) * 100}%`, left: 0,
        width: '100%', height: '6px', transform: 'translateY(-3px)',
        cursor: 'row-resize', zIndex: 100
      }
    }
    return {}
  }

  return (
    <div
      className="shell-root split-mode"
      ref={shellRef}
      style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}
    >
      {/* App Content */}
      <div className="app-content-split" style={getAppStyle()}>
        <App />
      </div>

      {/* Drag Resizer */}
      <div
        className="split-resizer"
        style={getResizerStyle()}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <div className="split-resizer-handle" />
      </div>

      {/* Drag Overlay — 드래그 중 Flow WebContentsView 위 마우스 이벤트 캡처 */}
      {isDragging && (
        <div
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 99,
            cursor: horizontal ? 'col-resize' : 'row-resize'
          }}
        />
      )}
    </div>
  )
}

export default function Shell() {
  return (
    <I18nProvider>
      <AuthProvider>
        <ToastProvider>
          <QuotaExhaustedModalProvider>
            <ShellContent />
          </QuotaExhaustedModalProvider>
        </ToastProvider>
      </AuthProvider>
    </I18nProvider>
  )
}
