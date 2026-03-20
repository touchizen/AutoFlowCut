/**
 * ResultsTable Component - 결과 테이블 (Generic)
 * Supports mediaType: 'image' | 'video' | 'frame-pair'
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../hooks/useI18n'
import { useElapsedTimer } from '../hooks/useElapsedTimer'
import { getRatioClass, resolveImageSrc, hasImageData, formatElapsed } from '../utils/formatters'
import InfinityLoader from './InfinityLoader'

/** 초시계 아이콘 — 초침이 실시간 회전 */
function StopwatchIcon({ size = 18 }) {
  const r = size / 2
  const cx = r, cy = r
  const handLen = r * 0.6
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="stopwatch-icon">
      {/* 외곽 원 */}
      <circle cx={cx} cy={cy} r={r - 1.5} fill="none" stroke="currentColor" strokeWidth="1.5" />
      {/* 12시 눈금 */}
      <line x1={cx} y1={cy - r + 1.5} x2={cx} y2={cy - r + 3.5} stroke="currentColor" strokeWidth="1.2" />
      {/* 꼭지 버튼 */}
      <rect x={cx - 1} y={0} width={2} height={2} rx={0.5} fill="currentColor" />
      {/* 초침 — CSS로 회전 */}
      <line
        className="stopwatch-hand"
        x1={cx} y1={cy}
        x2={cx} y2={cy - handLen}
        stroke="var(--accent, #3b82f6)" strokeWidth="1.5" strokeLinecap="round"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      {/* 중심점 */}
      <circle cx={cx} cy={cy} r={1.2} fill="var(--accent, #3b82f6)" />
    </svg>
  )
}

/** 경과 시간 표시 (1초마다 업데이트, endedAt 있으면 멈춤) */
function ElapsedTime({ startedAt, endedAt }) {
  const elapsed = useElapsedTimer(startedAt, endedAt)
  return <span>{formatElapsed(elapsed)}</span>
}

export default function ResultsTable({
  items,
  scenes,
  mediaType = 'image',
  onRetry,
  aspectRatio = '16:9',
  onShowDetail,
  // ── 선택/편집 props ──
  selectable = false,       // 체크박스 표시 여부
  onToggle,                 // (id) => void — 개별 선택 토글
  onToggleAll,              // () => void — 전체 선택 토글
  onPromptEdit,             // (id, newPrompt) => void — 프롬프트 인라인 편집
  onClearMedia,             // (id) => void — 미디어만 제거
  disabled = false,         // 생성 중 편집 비활성화
}) {
  const { t } = useI18n()
  const [hoverPreview, setHoverPreview] = useState(null)
  const rowRefs = useRef({})

  // 생성 중인 행으로 자동 스크롤 (status 변경 감지)
  const dataArr = items || scenes || []
  const generatingIds = dataArr.filter(item => item.status === 'generating').map(item => item.id)
  const generatingKey = generatingIds.join(',')
  useEffect(() => {
    // 마지막 generating 행으로 스크롤
    const lastId = generatingIds[generatingIds.length - 1]
    if (lastId && rowRefs.current[lastId]) {
      rowRefs.current[lastId].scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [generatingKey])

  // backward compat: accept `scenes` as fallback for `items`
  const data = items || scenes || []

  if (data.length === 0) {
    return (
      <div className="results-empty">
        {t('results.empty')}
      </div>
    )
  }

  const isVideoType = mediaType === 'video' || mediaType === 'frame-pair'
  const isPairType = mediaType === 'frame-pair'

  // done statuses: 'done' (image automation) or 'complete' (video automation) both count
  const selectedCount = selectable ? data.filter(s => s.selected !== false).length : 0
  const allSelected = selectable && data.length > 0 && data.every(s => s.selected !== false)

  const ratioClass = getRatioClass(aspectRatio)

  // Column header for media
  const mediaHeader = isVideoType
    ? (t('results.video') || 'Video')
    : t('results.image')

  /**
   * Determine if the item has displayable media
   */
  const hasMedia = (item) => {
    if (mediaType === 'image') return hasImageData(item)
    if (mediaType === 'video') return !!item.video
    if (isPairType) return !!item.base64
    return false
  }

  /**
   * Render the media thumbnail for a given item
   */
  const renderMedia = (item, index) => {
    const itemImgSrc = resolveImageSrc(item)
    if (mediaType === 'image' && hasImageData(item)) {
      return (
        <img
          src={itemImgSrc}
          alt={`Scene ${index + 1}`}
          className="result-thumbnail"
          onMouseEnter={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setHoverPreview({ src: e.currentTarget.src, x: rect.right + 8, y: rect.top })
          }}
          onMouseLeave={() => setHoverPreview(null)}
        />
      )
    }

    if (mediaType === 'video' && item.video) {
      const videoSrc = item.video.startsWith('data:') ? item.video : `data:video/mp4;base64,${item.video}`
      return (
        <>
          <video
            src={videoSrc}
            muted
            preload="metadata"
            className="result-thumbnail-video"
          />
          <div className="play-button-overlay">▶</div>
        </>
      )
    }

    if (isPairType && item.base64) {
      const videoSrc = item.base64.startsWith('data:') ? item.base64 : `data:video/mp4;base64,${item.base64}`
      return (
        <>
          <video
            src={videoSrc}
            muted
            preload="metadata"
            className="result-thumbnail-video"
          />
          <div className="play-button-overlay">▶</div>
        </>
      )
    }

    return null
  }

  /**
   * Check whether a given status counts as "done/complete"
   */
  const isDone = (status) => status === 'done' || status === 'complete'

  /**
   * Render the status cell for a given item
   */
  const renderStatus = (item) => {
    const { status } = item

    if (status === 'pending') {
      return <span className="status pending">⏳ {t('status.pending')}</span>
    }

    if (status === 'generating') {
      return (
        <span className="status generating">
          <StopwatchIcon size={16} /> <ElapsedTime startedAt={item.generatingStartedAt} endedAt={item.generatingEndedAt} />
        </span>
      )
    }

    if (isDone(status)) {
      return <span className="status done">✅ {t('status.done')}</span>
    }

    if (status === 'error') {
      // Retry button only for image mediaType; video retry is handled differently
      if (mediaType === 'image') {
        return (
          <button
            className="status error retry-btn"
            onClick={() => onRetry(item.id)}
            title={item.error || t('actions.retryOne')}
          >
            🔄 {t('actions.retryOne')}
          </button>
        )
      }
      return (
        <span className="status error" title={item.error}>
          ❌{t('status.error') || '오류'}
          {item.error && <span className="error-detail">{item.error.substring(0, 80)}</span>}
        </span>
      )
    }

    return null
  }

  return (
    <div className="results-table-container">
      {selectable && (
        <div className="results-summary">
          <span>☑ {selectedCount}/{data.length}</span>
        </div>
      )}

      <div className="results-table-header">
        <table className="results-table">
          <thead>
            <tr>
              {selectable && (
                <th className="col-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleAll}
                    disabled={disabled}
                  />
                </th>
              )}
              <th className="col-id">#</th>
              <th className="col-img">{mediaHeader}</th>
              <th className="col-prompt">{t('results.prompt')}</th>
              <th className="col-status">{t('results.status')}</th>
            </tr>
          </thead>
        </table>
      </div>
      <div className="results-table-body">
      <table className="results-table">
        <tbody>
          {data.map((item, index) => (
            <tr key={item.id} ref={el => { if (el) rowRefs.current[item.id] = el }} className={`status-${item.status} ${selectable && item.selected === false ? 'deselected' : ''}`}>
              {selectable && (
                <td className="col-check">
                  <input
                    type="checkbox"
                    checked={item.selected !== false}
                    onChange={() => onToggle(item.id)}
                    disabled={disabled}
                  />
                </td>
              )}
              <td className="col-id">{index + 1}</td>

              <td className="col-img">
                <div
                  className={`image-cell ${ratioClass} ${hasMedia(item) ? 'clickable' : ''}`}
                  onClick={() => onShowDetail && onShowDetail(item)}
                  title={t('headerExtra.clickToDetail')}
                >
                  {hasMedia(item) ? (
                    <>
                      {renderMedia(item, index)}
                      {onClearMedia && !disabled && (
                        <button
                          className="btn-clear-media"
                          onClick={(e) => { e.stopPropagation(); onClearMedia(item.id) }}
                          title={t('results.clearMedia') || '미디어 제거'}
                        >✕</button>
                      )}
                    </>
                  ) : item.status === 'generating' ? (
                    <div className="generating-indicator">
                      <InfinityLoader />
                    </div>
                  ) : (
                    <div className="empty-cell">-</div>
                  )}
                </div>
              </td>

              <td className="col-prompt">
                {onPromptEdit && !disabled ? (
                  <input
                    className="prompt-edit-input"
                    value={item.prompt || ''}
                    onChange={(e) => onPromptEdit(item.id, e.target.value)}
                    disabled={disabled}
                  />
                ) : (
                  <div className="prompt-preview" title={item.prompt}>
                    {item.prompt || ''}
                  </div>
                )}
              </td>

              <td className="col-status">
                {renderStatus(item)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* 호버 풍선 프리뷰 */}
      {hoverPreview && createPortal(
        <div
          className="ref-hover-balloon"
          style={{
            left: Math.min(hoverPreview.x, window.innerWidth - 420),
            top: Math.max(0, Math.min(hoverPreview.y, window.innerHeight - 400))
          }}
        >
          <img src={hoverPreview.src} alt="preview" decoding="sync" />
        </div>,
        document.body
      )}
    </div>
  )
}
