/**
 * ResultsTable Component - 결과 테이블 (Generic)
 * Supports mediaType: 'image' | 'video' | 'frame-pair'
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useI18n } from '../hooks/useI18n'
import { getRatioClass, resolveImageSrc, hasImageData } from '../utils/formatters'
import { resolveVideoSrc } from '../utils/videoSrc'
import { resolveDisplayError } from '../utils/errorDisplay'
import { getVideoPoster } from '../utils/videoPoster'
import { modelLabel } from '../config/genModels'
import InfinityLoader from './InfinityLoader'
import LazyImage from './LazyImage'
import HoverImageBalloon from './HoverImageBalloon'
import { StopwatchIcon, ElapsedTime } from './StopwatchIcon'

function VideoPosterThumbnail({ videoSrc, fallbackSrc, alt }) {
  const [posterSrc, setPosterSrc] = useState(null)

  useEffect(() => {
    if (!videoSrc || fallbackSrc) return

    let cancelled = false
    const controller = new AbortController()
    setPosterSrc(null)
    getVideoPoster(videoSrc, { signal: controller.signal }).then((src) => {
      if (!cancelled && src) setPosterSrc(src)
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [videoSrc, fallbackSrc])

  if (posterSrc) {
    return (
      <img
        src={posterSrc}
        alt={alt}
        className="result-thumbnail"
        loading="lazy"
        decoding="async"
      />
    )
  }

  if (fallbackSrc) {
    return (
      <LazyImage
        src={fallbackSrc}
        alt={alt}
        className="result-thumbnail"
        eager
        loading="lazy"
      />
    )
  }

  return <div className="video-placeholder" />
}

export default function ResultsTable({
  items,
  scenes,
  mediaType = 'image',
  onRetry,
  onVideoRetry,             // (item) => void — 비디오 전용 재시도 (다운로드 우선)
  aspectRatio = '16:9',
  onShowDetail,
  // ── 선택/편집 props ──
  selectable = false,       // 체크박스 표시 여부
  onToggle,                 // (id) => void — 개별 선택 토글
  onToggleAll,              // () => void — 전체 선택 토글
  onPromptEdit,             // (id, newPrompt) => void — 프롬프트 인라인 편집
  onClearMedia,             // (id) => void — 미디어만 제거
  disabled = false,         // 생성 중 편집 비활성화
  layout = 'table',         // 'table'(기본 결과표) | 'grid'(카드형 그리드)
}) {
  const { t } = useI18n()
  const [hoverPreview, setHoverPreview] = useState(null)
  const [hoveredVideoKey, setHoveredVideoKey] = useState(null)
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
    // T2V 비디오 — base64(item.video) 또는 file path 둘 다 인정 (path-only 로드 지원)
    if (mediaType === 'video') return !!(item.video || item.videoPath)
    if (isPairType) return !!(item.base64 || item.videoPath)
    return false
  }

  /**
   * Render the media thumbnail for a given item
   */
  const renderMedia = (item, index, isVideoHovered = false) => {
    const itemImgSrc = resolveImageSrc(item)
    const renderLazyVideo = (videoSrc, posterAlt) => (
      <>
        {isVideoHovered ? (
          <video
            src={videoSrc}
            muted
            preload="metadata"
            className="result-thumbnail-video"
          />
        ) : (
          <VideoPosterThumbnail
            videoSrc={videoSrc}
            fallbackSrc={itemImgSrc}
            alt={posterAlt}
          />
        )}
        <div className="play-button-overlay">▶</div>
      </>
    )

    if (mediaType === 'image' && hasImageData(item)) {
      // R37 fix: LazyImage — 뷰포트 이탈 시 img 언마운트해 VRAM 회수
      return (
        <LazyImage
          src={itemImgSrc}
          alt={`Scene ${index + 1}`}
          className="result-thumbnail"
          onMouseEnter={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setHoverPreview({
              src: itemImgSrc,
              rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
            })
          }}
          onMouseLeave={() => setHoverPreview(null)}
        />
      )
    }

    if (mediaType === 'video' && (item.video || item.videoPath)) {
      // 공용 utils/videoSrc — base64 우선, 없으면 file path (T2V path-only 모드 지원).
      // useProjectData 가 T2V 도 path-only 로 로드하므로 item.video 가 비어도 path 만으로 재생 가능.
      const videoSrc = resolveVideoSrc(item.video, item.videoPath, { version: item.generatedAt })
      return renderLazyVideo(videoSrc, `Video ${index + 1} poster`)
    }

    if (isPairType && (item.base64 || item.videoPath)) {
      const videoSrc = resolveVideoSrc(item.base64, item.videoPath, { version: item.generatedAt })
      return renderLazyVideo(videoSrc, `Frame pair ${index + 1} poster`)
    }

    return null
  }

  /**
   * Check whether a given status counts as "done/complete"
   */
  const isDone = (status) => status === 'done' || status === 'complete'

  /**
   * Resolve the displayable error message for an item via the shared util —
   * keeps i18n / unknown-kind fallback policy aligned with ErrorSection.
   */
  const getDisplayError = (item) => resolveDisplayError(t, item.errorKind, item.error)

  /**
   * Render the status cell for a given item
   */
  const renderStatus = (item) => {
    const { status } = item
    const errorMessage = getDisplayError(item)

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
            title={errorMessage || t('actions.retryOne')}
          >
            🔄 {t('actions.retryOne')}
          </button>
        )
      }
      // video / frame-pair — download-only retry when generationId+mediaId known
      if (isVideoType && onVideoRetry) {
        const canDownloadOnly = !!(item.generationId && item.mediaId)
        const label = canDownloadOnly
          ? (t('actions.retryDownload') || 'Retry download')
          : t('actions.retryOne')
        return (
          <button
            className="status error retry-btn"
            onClick={() => onVideoRetry(item)}
            title={errorMessage || label}
          >
            🔄 {label}
          </button>
        )
      }
      return (
        <span className="status error" title={errorMessage}>
          ❌{t('status.error') || '오류'}
        </span>
      )
    }

    return null
  }

  // ── 그리드 레이아웃 ──
  // 테이블과 동일한 데이터/핸들러를 카드형으로 렌더. renderMedia/renderStatus/hasMedia 등
  // 헬퍼를 그대로 재사용 — 호버 비디오/미디어 제거/재시도/체크박스 동작이 결과표와 일치한다.
  if (layout === 'grid') {
    return (
      <div className="results-table-container results-grid-container">
        {selectable && (
          <div className="results-summary">
            <label className="grid-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                disabled={disabled}
              />
              <span>☑ {selectedCount}/{data.length}</span>
            </label>
          </div>
        )}
        <div className={`results-grid ${ratioClass}`} role="list">
          {data.map((item, index) => {
            const cardKey = item.id ?? `card-${index}`
            return (
              <div
                key={cardKey}
                role="listitem"
                ref={el => { if (el) rowRefs.current[cardKey] = el }}
                className={`result-card status-${item.status} ${selectable && item.selected === false ? 'deselected' : ''}`}
                title={item.prompt || ''}
              >
                {selectable && (
                  <input
                    className="card-check"
                    type="checkbox"
                    checked={item.selected !== false}
                    onChange={() => onToggle(item.id)}
                    disabled={disabled}
                  />
                )}
                <div
                  className={`image-cell ${ratioClass} ${hasMedia(item) ? 'clickable' : ''}`}
                  onMouseEnter={isVideoType && hasMedia(item) ? () => setHoveredVideoKey(cardKey) : undefined}
                  onMouseLeave={isVideoType && hasMedia(item) ? () => setHoveredVideoKey(null) : undefined}
                  onClick={() => onShowDetail && onShowDetail(item)}
                  title={t('headerExtra.clickToDetail')}
                >
                  {hasMedia(item) ? (
                    <>
                      {renderMedia(item, index, hoveredVideoKey === cardKey)}
                      {onClearMedia && !disabled && (
                        <button
                          className="btn-clear-media"
                          onClick={(e) => { e.stopPropagation(); if (window.confirm(t('results.confirmClear') || 'Remove this media?')) onClearMedia(item.id) }}
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
                <div className="card-footer">
                  <span className="card-id">#{index + 1}</span>
                  <span className="card-status">{renderStatus(item)}</span>
                </div>
                {item.status === 'error' && getDisplayError(item) && (
                  <div className="prompt-error card-error" title={String(getDisplayError(item))}>
                    {String(getDisplayError(item))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 호버 풍선 프리뷰 */}
        {hoverPreview && (
          <HoverImageBalloon
            anchorRect={hoverPreview.rect}
            src={hoverPreview.src}
            className="ref-hover-balloon"
          />
        )}
      </div>
    )
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
              <th className="col-model">{t('results.model')}</th>
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
                  onMouseEnter={isVideoType && hasMedia(item) ? () => setHoveredVideoKey(item.id ?? `row-${index}`) : undefined}
                  onMouseLeave={isVideoType && hasMedia(item) ? () => setHoveredVideoKey(null) : undefined}
                  onClick={() => onShowDetail && onShowDetail(item)}
                  title={t('headerExtra.clickToDetail')}
                >
                  {hasMedia(item) ? (
                    <>
                      {renderMedia(item, index, hoveredVideoKey === (item.id ?? `row-${index}`))}
                      {onClearMedia && !disabled && (
                        <button
                          className="btn-clear-media"
                          onClick={(e) => { e.stopPropagation(); if (window.confirm(t('results.confirmClear') || 'Remove this media?')) onClearMedia(item.id) }}
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
                {item.status === 'error' && getDisplayError(item) && (
                  <div className="prompt-error" title={String(getDisplayError(item))}>
                    {String(getDisplayError(item))}
                  </div>
                )}
              </td>

              <td className="col-model" title={item.model || ''}>
                {modelLabel(item.model) || '—'}
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
      {hoverPreview && (
        <HoverImageBalloon
          anchorRect={hoverPreview.rect}
          src={hoverPreview.src}
          className="ref-hover-balloon"
        />
      )}
    </div>
  )
}
