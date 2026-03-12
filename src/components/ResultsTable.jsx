/**
 * ResultsTable Component - 결과 테이블 (Generic)
 * Supports mediaType: 'image' | 'video' | 'frame-pair' | 'ref-pair'
 */

import { useState, useEffect } from 'react'
import { useI18n } from '../hooks/useI18n'
import { getRatioClass } from '../utils/formatters'

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

/** 경과 시간 표시 (1초마다 업데이트) */
function ElapsedTime({ startedAt }) {
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0
  )

  useEffect(() => {
    if (!startedAt) return
    setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [startedAt])

  const min = Math.floor(elapsed / 60)
  const sec = elapsed % 60
  return <span>{min > 0 ? `${min}분 ${sec}초` : `${sec}초`}</span>
}

export default function ResultsTable({
  items,
  scenes,
  mediaType = 'image',
  onRetry,
  aspectRatio = '16:9',
  onShowDetail,
}) {
  const { t } = useI18n()

  // backward compat: accept `scenes` as fallback for `items`
  const data = items || scenes || []

  if (data.length === 0) {
    return (
      <div className="results-empty">
        {t('results.empty')}
      </div>
    )
  }

  const isVideoType = mediaType === 'video' || mediaType === 'frame-pair' || mediaType === 'ref-pair'
  const isPairType = mediaType === 'frame-pair' || mediaType === 'ref-pair'

  // done statuses: 'done' (image automation) or 'complete' (video automation) both count
  const doneCount = data.filter(s => s.status === 'done' || s.status === 'complete').length
  const errorCount = data.filter(s => s.status === 'error').length

  const ratioClass = getRatioClass(aspectRatio)

  // Column header for media
  const mediaHeader = isVideoType
    ? (t('results.video') || 'Video')
    : t('results.image')

  /**
   * Determine if the item has displayable media
   */
  const hasMedia = (item) => {
    if (mediaType === 'image') return !!item.image
    if (mediaType === 'video') return !!item.video
    if (isPairType) return !!item.base64
    return false
  }

  /**
   * Render the media thumbnail for a given item
   */
  const renderMedia = (item, index) => {
    if (mediaType === 'image' && item.image) {
      return (
        <img
          src={item.image}
          alt={`Scene ${index + 1}`}
          className="result-thumbnail"
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
          <StopwatchIcon size={16} /> <ElapsedTime startedAt={item.generatingStartedAt} />
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
      <div className="results-summary">
        <span>✅ {doneCount}</span>
        {errorCount > 0 && <span className="error-count">❌ {errorCount}</span>}
      </div>

      <table className="results-table">
        <thead>
          <tr>
            <th className="col-id">#</th>
            <th className="col-img">{mediaHeader}</th>
            <th className="col-prompt">{t('results.prompt')}</th>
            <th className="col-status">{t('results.status')}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item, index) => (
            <tr key={item.id} className={`status-${item.status}`}>
              <td className="col-id">{index + 1}</td>

              <td className="col-img">
                <div
                  className={`image-cell ${ratioClass} ${hasMedia(item) ? 'clickable' : ''}`}
                  onClick={() => onShowDetail && onShowDetail(item)}
                  title={t('headerExtra.clickToDetail')}
                >
                  {hasMedia(item) ? (
                    renderMedia(item, index)
                  ) : item.status === 'generating' ? (
                    <div className="generating-indicator">
                      <span className="spinner">⚙️</span>
                    </div>
                  ) : (
                    <div className="empty-cell">-</div>
                  )}
                </div>
              </td>

              <td className="col-prompt">
                <div className="prompt-preview" title={item.prompt}>
                  {(item.prompt || '').substring(0, 50)}
                  {(item.prompt || '').length > 50 && '...'}
                </div>
              </td>

              <td className="col-status">
                {renderStatus(item)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
