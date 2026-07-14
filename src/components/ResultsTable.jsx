/**
 * ResultsTable Component - 결과 테이블 (Generic)
 * Supports mediaType: 'image' | 'video' | 'frame-pair'
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
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

const VIRTUALIZATION_THRESHOLD = 200
const VIRTUAL_OVERSCAN = 8
const TABLE_ROW_ESTIMATE = 76
const GRID_ROW_ESTIMATE = 180
const GRID_GAP = 10
const GRID_PADDING = 10
const GRID_MIN_CARD_WIDTH = {
  'ratio-landscape': 160,
  'ratio-portrait': 104,
  'ratio-square': 132,
}
const EMPTY_RESULTS = []
const EMPTY_VIRTUAL_ITEMS = Object.freeze([])

function measureResultRow(element) {
  return Math.round(element.getBoundingClientRect().height)
}

function measureResultGridRow(element) {
  return Math.round(element.getBoundingClientRect().height)
}

function getGridColumnCount(width, ratioClass) {
  if (!(width > 0)) return 0
  const contentWidth = Math.max(0, width - (GRID_PADDING * 2))
  const minCardWidth = GRID_MIN_CARD_WIDTH[ratioClass] || GRID_MIN_CARD_WIDTH['ratio-landscape']
  return Math.max(1, Math.floor((contentWidth + GRID_GAP) / (minCardWidth + GRID_GAP)))
}

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
  // backward compat: accept `scenes` as fallback for `items`
  const data = items || scenes || EMPTY_RESULTS
  const ratioClass = getRatioClass(aspectRatio)
  const shouldVirtualize = data.length > VIRTUALIZATION_THRESHOLD
  const tableScrollRef = useRef(null)
  const gridScrollRef = useRef(null)
  const previousStatusesRef = useRef(null)
  const pendingScrollIndexRef = useRef(-1)
  const [gridWidth, setGridWidth] = useState(null)
  const measuredItemsPerRow = layout === 'grid'
    ? getGridColumnCount(gridWidth, ratioClass)
    : 0
  // 작은 grid는 숨겨진 panel/jsdom처럼 폭이 아직 0이어도 기존처럼 즉시 렌더한다.
  // 큰 grid만 측정 전 0개 mount 원칙을 유지한다.
  const itemsPerRow = measuredItemsPerRow || (
    layout === 'grid' && !shouldVirtualize && data.length > 0 ? 1 : 0
  )
  const gridRowCount = itemsPerRow > 0 ? Math.ceil(data.length / itemsPerRow) : 0

  const getTableItemKey = useCallback(
    index => data[index]?.id ?? `row-${index}`,
    [data]
  )
  const getGridRowKey = useCallback(
    rowIndex => `${itemsPerRow}:${data[rowIndex * itemsPerRow]?.id ?? rowIndex}`,
    [data, itemsPerRow]
  )
  const tableVirtualizer = useVirtualizer({
    count: layout !== 'grid' ? data.length : 0,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => TABLE_ROW_ESTIMATE,
    getItemKey: getTableItemKey,
    measureElement: measureResultRow,
    overscan: VIRTUAL_OVERSCAN,
    enabled: layout !== 'grid' && data.length > 0,
  })
  const gridVirtualizer = useVirtualizer({
    count: layout === 'grid' ? gridRowCount : 0,
    getScrollElement: () => gridScrollRef.current,
    estimateSize: () => GRID_ROW_ESTIMATE,
    getItemKey: getGridRowKey,
    measureElement: measureResultGridRow,
    overscan: VIRTUAL_OVERSCAN,
    paddingStart: GRID_PADDING,
    paddingEnd: GRID_PADDING,
    enabled: layout === 'grid' && itemsPerRow > 0,
  })

  // grid는 threshold 양쪽에서 같은 row 구조를 유지해야 하므로 항상 열 수를 측정한다.
  // 첫 양수 폭은 paint 전 읽고, 이후 panel resize는 같은 observer로 반영한다.
  useLayoutEffect(() => {
    if (layout !== 'grid') {
      setGridWidth(null)
      return
    }
    const element = gridScrollRef.current
    if (!element) return
    const commitWidth = (nextWidth) => {
      const normalized = Number.isFinite(nextWidth) && nextWidth > 0 ? nextWidth : null
      setGridWidth(previous => previous === normalized ? previous : normalized)
    }
    const readBorderBoxWidth = () => element.getBoundingClientRect().width || element.offsetWidth
    commitWidth(readBorderBoxWidth())
    const observer = new ResizeObserver(() => {
      // 초기 측정과 observer 갱신 모두 border-box를 사용한다. contentRect를 섞으면
      // 아래 getGridColumnCount가 padding을 두 번 빼 열 수가 흔들린다.
      commitWidth(readBorderBoxWidth())
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [layout])

  const tableVirtualItems = shouldVirtualize && layout !== 'grid'
    ? tableVirtualizer.getVirtualItems()
    : EMPTY_VIRTUAL_ITEMS
  const gridVirtualRows = shouldVirtualize && layout === 'grid' && itemsPerRow > 0
    ? gridVirtualizer.getVirtualItems()
    : EMPTY_VIRTUAL_ITEMS
  const gridRowsToRender = layout === 'grid' && itemsPerRow > 0
    ? (
        shouldVirtualize
          ? gridVirtualRows
          : Array.from({ length: gridRowCount }, (_, index) => ({
              index,
              key: getGridRowKey(index),
            }))
      )
    : EMPTY_VIRTUAL_ITEMS

  // 초기 mount와 status 전환 모두 마지막 generating 항목을 따른다. 큰 grid가 아직
  // 미측정이면 index를 보류했다가 열 수가 정해진 직후 해당 virtual row로 이동한다.
  useEffect(() => {
    const previousStatuses = previousStatusesRef.current
    let latestGeneratingIndex = -1
    for (let index = 0; index < data.length; index++) {
      const item = data[index]
      if (item.status !== 'generating') continue
      // 처음 본 generating id도 전환으로 취급한다. import/삽입된 항목도 기존
      // pending→generating 전환과 똑같이 자동 스크롤해야 한다.
      if (!previousStatuses || (
        !previousStatuses.has(item.id)
        || previousStatuses.get(item.id) !== 'generating'
      )) {
        latestGeneratingIndex = index
      }
    }
    previousStatusesRef.current = new Map(data.map(item => [item.id, item.status]))
    if (latestGeneratingIndex >= 0) pendingScrollIndexRef.current = latestGeneratingIndex

    const pendingIndex = pendingScrollIndexRef.current
    if (pendingIndex < 0 || !data[pendingIndex]) return
    if (shouldVirtualize) {
      if (layout === 'grid') {
        if (itemsPerRow <= 0) return
        gridVirtualizer.scrollToIndex(Math.floor(pendingIndex / itemsPerRow), { align: 'auto' })
      } else {
        tableVirtualizer.scrollToIndex(pendingIndex, { align: 'auto' })
      }
    } else {
      const key = data[pendingIndex].id ?? `${layout === 'grid' ? 'card' : 'row'}-${pendingIndex}`
      rowRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    pendingScrollIndexRef.current = -1
  }, [data, gridVirtualizer, itemsPerRow, layout, shouldVirtualize, tableVirtualizer])

  const mountedItemKeys = useMemo(() => {
    if (!shouldVirtualize) return null
    const keys = new Set()
    if (layout === 'grid') {
      for (const row of gridVirtualRows) {
        const start = row.index * itemsPerRow
        const end = Math.min(data.length, start + itemsPerRow)
        for (let index = start; index < end; index++) {
          keys.add(data[index]?.id ?? `card-${index}`)
        }
      }
    } else {
      for (const item of tableVirtualItems) {
        keys.add(data[item.index]?.id ?? `row-${item.index}`)
      }
    }
    return keys
  }, [data, gridVirtualRows, itemsPerRow, layout, shouldVirtualize, tableVirtualItems])

  // 부모에 있던 hover state가 virtual row unmount 뒤 남으면 스크롤 복귀 시 비디오가
  // hover 없이 다시 mount된다. 현재 window에서 빠진 즉시 둘 다 해제한다.
  useEffect(() => {
    if (!mountedItemKeys) return
    if (hoveredVideoKey != null && !mountedItemKeys.has(hoveredVideoKey)) setHoveredVideoKey(null)
    if (hoverPreview?.itemKey != null && !mountedItemKeys.has(hoverPreview.itemKey)) setHoverPreview(null)
  }, [hoverPreview, hoveredVideoKey, mountedItemKeys])

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
  const renderMedia = (item, index, isVideoHovered = false, itemKey = item.id ?? `item-${index}`) => {
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
              itemKey,
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

  const renderGridCard = (item, index, keepDomRef = false) => {
    const cardKey = item.id ?? `card-${index}`
    return (
      <div
        key={cardKey}
        role="listitem"
        ref={keepDomRef ? (element) => {
          if (element) rowRefs.current[cardKey] = element
          else delete rowRefs.current[cardKey]
        } : undefined}
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
              {renderMedia(item, index, hoveredVideoKey === cardKey, cardKey)}
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
  }

  const renderTableRow = (item, index, virtualized = false) => {
    const rowKey = item.id ?? `row-${index}`
    return (
      <tr
        key={rowKey}
        ref={virtualized ? tableVirtualizer.measureElement : (element) => {
          if (element) rowRefs.current[rowKey] = element
          else delete rowRefs.current[rowKey]
        }}
        data-index={virtualized ? index : undefined}
        className={`status-${item.status} ${selectable && item.selected === false ? 'deselected' : ''}`}
      >
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
            onMouseEnter={isVideoType && hasMedia(item) ? () => setHoveredVideoKey(rowKey) : undefined}
            onMouseLeave={isVideoType && hasMedia(item) ? () => setHoveredVideoKey(null) : undefined}
            onClick={() => onShowDetail && onShowDetail(item)}
            title={t('headerExtra.clickToDetail')}
          >
            {hasMedia(item) ? (
              <>
                {renderMedia(item, index, hoveredVideoKey === rowKey, rowKey)}
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
    )
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
        <div
          ref={gridScrollRef}
          className={`results-grid ${ratioClass} has-grid-rows${shouldVirtualize ? ' is-virtualized' : ''}`}
          role="list"
        >
          <div
            key="virtual-spacer-top"
            data-virtual-spacer="top"
            role="presentation"
            aria-hidden="true"
            style={{
              height: shouldVirtualize && gridVirtualRows.length > 0
                ? gridVirtualRows[0].start
                : 0,
            }}
          />
          {gridRowsToRender.map((row) => {
            const start = row.index * itemsPerRow
            const end = Math.min(data.length, start + itemsPerRow)
            return (
              <div
                key={row.key}
                ref={shouldVirtualize ? gridVirtualizer.measureElement : undefined}
                data-index={row.index}
                className="results-grid-row"
                role="presentation"
                style={{
                  gridTemplateColumns: `repeat(${itemsPerRow}, minmax(0, 1fr))`,
                  paddingBottom: row.index < gridRowCount - 1 ? GRID_GAP : 0,
                }}
              >
                {data.slice(start, end).map((item, offset) => (
                  renderGridCard(item, start + offset, !shouldVirtualize)
                ))}
              </div>
            )
          })}
          <div
            key="virtual-spacer-bottom"
            data-virtual-spacer="bottom"
            role="presentation"
            aria-hidden="true"
            style={{
              height: shouldVirtualize && gridVirtualRows.length > 0
                ? Math.max(0, gridVirtualizer.getTotalSize() - gridVirtualRows[gridVirtualRows.length - 1].end)
                : 0,
            }}
          />
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
      <div ref={tableScrollRef} className="results-table-body">
      <table className="results-table">
        <tbody>
          <tr key="virtual-spacer-top" data-virtual-spacer="top">
            <td
              colSpan={selectable ? 6 : 5}
              style={{
                height: shouldVirtualize && tableVirtualItems.length > 0
                  ? tableVirtualItems[0].start
                  : 0,
                padding: 0,
                border: 0,
              }}
            />
          </tr>
          {shouldVirtualize
            ? tableVirtualItems.map(item => renderTableRow(data[item.index], item.index, true))
            : data.map((item, index) => renderTableRow(item, index))}
          <tr key="virtual-spacer-bottom" data-virtual-spacer="bottom">
            <td
              colSpan={selectable ? 6 : 5}
              style={{
                height: shouldVirtualize
                  ? (
                      tableVirtualItems.length > 0
                        ? Math.max(0, tableVirtualizer.getTotalSize() - tableVirtualItems[tableVirtualItems.length - 1].end)
                        : tableVirtualizer.getTotalSize()
                    )
                  : 0,
                padding: 0,
                border: 0,
              }}
            />
          </tr>
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
