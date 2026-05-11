import { useState, useRef, useEffect } from 'react'
import Waveform from './Waveform'
import TimelineFlagButton from './TimelineFlagButton'

// 클립 — click vs drag 자동 구분, draggable이면 드래그로 timecode 보정
// onFlag(audioPath, filename, event): hover ⚠️ 버튼 클릭 시 호출 (audioPath 있고 onFlag 전달된 경우만)
// isFlagged(filePath): bool — flagged 시각 표시
export default function Clip({ clip, variant, pxPerMs, height, onClickClip, onDragClip, totalDurationMs, isPlaying, onSceneHover, onFlag, isFlagged }) {
  const [dragOffsetMs, setDragOffsetMs] = useState(null)
  const isDragging = dragOffsetMs !== null
  const flagged = !!(isFlagged && clip.audioPath && isFlagged(clip.audioPath))
  // audioPath 있으면 audio clip — sub-track은 variant가 없어서 audioPath로 판정
  const showActionable = !!clip.audioPath && !!onFlag
  // 드래그 중 unmount되면 onUp 미발화 → 여기서 listener 강제 정리
  const dragCleanupRef = useRef(null)
  useEffect(() => () => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
  }, [])

  const visualStartMs = clip.startMs + (dragOffsetMs || 0)
  const left = visualStartMs * pxPerMs
  const width = Math.max(2, (clip.endMs - clip.startMs) * pxPerMs)
  const style = {
    left,
    width,
    top: 4,
    bottom: 4,
    background: variant === 'text'
      ? `${clip.color}26`
      : `linear-gradient(180deg, ${clip.color}, ${clip.color}88)`,
    border: variant === 'text' ? `1px solid ${clip.color}` : `1px solid ${clip.color}AA`,
    cursor: clip.draggable ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  const onMouseEnter = (e) => {
    if (clip.sceneRef && variant === 'block') {
      onSceneHover?.({ x: e.clientX, y: e.clientY, scene: clip.sceneRef })
    }
  }
  const onMouseLeave = () => onSceneHover?.(null)

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    e.stopPropagation() // 스크럽 트리거 차단
    // 이전 드래그가 살아있다면 먼저 정리
    dragCleanupRef.current?.()
    const startX = e.clientX
    let lastDx = 0
    let didDrag = false

    const onMove = (mv) => {
      const dx = mv.clientX - startX
      lastDx = dx
      if (Math.abs(dx) > 4) {
        didDrag = true
        if (clip.draggable) {
          // 좌측 0 이하로 못 가게 클램프
          const newStart = Math.max(0, Math.min((totalDurationMs || Infinity), clip.startMs + dx / pxPerMs))
          setDragOffsetMs(newStart - clip.startMs)
        }
      }
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      dragCleanupRef.current = null
    }
    const onUp = () => {
      cleanup()
      if (didDrag && clip.draggable) {
        const newStart = Math.max(0, Math.min((totalDurationMs || Infinity), clip.startMs + lastDx / pxPerMs))
        onDragClip?.(clip, newStart)
        setDragOffsetMs(null)
      } else {
        // 클릭으로 처리
        setDragOffsetMs(null)
        onClickClip?.(clip)
      }
    }
    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className={`atl-clip atl-clip-${variant}${isPlaying ? ' atl-clip-playing' : ''}${isDragging ? ' atl-clip-dragging' : ''}${flagged ? ' atl-clip-flagged' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={clip.filename || clip.label || ''}
    >
      {variant === 'block' && clip.imagePath && (
        <img className="atl-clip-img" src={`file://${clip.imagePath}`} alt="" />
      )}
      {variant === 'text' && (
        <span className="atl-clip-text" style={{ color: clip.color }}>{clip.label}</span>
      )}
      {variant === 'audio' && width > 30 && (
        <Waveform color="#fff" />
      )}
      {/* Flagged 영구 indicator (좌측) */}
      {flagged && (
        <span className="atl-clip-flag-indicator" aria-label="flagged">⚠️</span>
      )}
      {/* 호버 시 ⚠️ 액션 버튼 (audioPath + onFlag 전달 시. 얇은 클립은 우측 하단 컴팩트) */}
      {showActionable && !isDragging && (
        <TimelineFlagButton
          audioPath={clip.audioPath}
          filename={clip.filename}
          flagged={flagged}
          narrow={width < 40}
          onFlag={onFlag}
        />
      )}
    </div>
  )
}
