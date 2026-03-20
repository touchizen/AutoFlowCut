/**
 * FrameToVideoPanel — Frame to Video 매핑 테이블
 *
 * 이미지 씬(mediaId 있는)을 Start/End Image로 선택하여
 * 비디오 생성 요청을 구성하는 UI.
 *
 * Props:
 *   scenes             — 전체 씬 배열 (이미지)
 *   videoScenes        — 비디오 씬 배열 (비디오 탭 프롬프트)
 *   framePairs         — [{ id, startSceneId, endSceneId, prompt, videoPrompt, customPrompt, status }]
 *   onUpdate           — framePairs 업데이트 콜백
 *   onShowSceneDetail  — 씬 상세 모달 열기 콜백
 *   disabled           — 생성 중 비활성화
 *   t                  — i18n 함수
 */

import { useMemo, useEffect, useRef, useState, useCallback } from 'react'
import { resolveImageSrc, formatElapsed } from '../utils/formatters'
import { useElapsedTimer } from '../hooks/useElapsedTimer'

/** 초시계 아이콘 — 초침이 실시간 회전 */
function StopwatchIcon({ size = 16 }) {
  const r = size / 2
  const cx = r, cy = r
  const handLen = r * 0.6
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="stopwatch-icon">
      <circle cx={cx} cy={cy} r={r - 1.5} fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1={cx} y1={cy - r + 1.5} x2={cx} y2={cy - r + 3.5} stroke="currentColor" strokeWidth="1.2" />
      <rect x={cx - 1} y={0} width={2} height={2} rx={0.5} fill="currentColor" />
      <line
        className="stopwatch-hand"
        x1={cx} y1={cy}
        x2={cx} y2={cy - handLen}
        stroke="var(--accent, #3b82f6)" strokeWidth="1.5" strokeLinecap="round"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      <circle cx={cx} cy={cy} r={1.2} fill="var(--accent, #3b82f6)" />
    </svg>
  )
}

/** 경과 시간 표시 (1초마다 업데이트, endedAt 있으면 멈춤) */
function ElapsedTime({ startedAt, endedAt }) {
  const elapsed = useElapsedTimer(startedAt, endedAt)
  return <span>{formatElapsed(elapsed)}</span>
}

// 갤러리 ID prefix
const GALLERY_PREFIX = 'gallery::'

// 커스텀 드롭다운 — 썸네일 + 레이블 + 갤러리
function SceneSelect({
  value, onChange, placeholder, disabled: selectDisabled,
  options, getLabel, onThumbClick,
  galleryItems, galleryLoading, onLoadGallery
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const isGalleryValue = value?.startsWith(GALLERY_PREFIX)
  const galleryMediaId = isGalleryValue ? value.slice(GALLERY_PREFIX.length) : null
  const gallerySelected = isGalleryValue ? galleryItems?.find(g => g.mediaId === galleryMediaId) : null

  const selected = isGalleryValue ? null : options.find(s => s.id === value)
  const selectedLabel = gallerySelected
    ? `📂 ${galleryMediaId.substring(0, 16)}...`
    : selected ? getLabel(selected) : (placeholder || '—')
  const selectedThumb = gallerySelected?.url || (selected ? resolveImageSrc(selected) : null)

  return (
    <div className={`scene-dropdown${open ? ' open' : ''}${selectDisabled ? ' disabled' : ''}`} ref={ref}>
      <div
        className="scene-dropdown-trigger"
        onClick={() => { if (!selectDisabled) setOpen(!open) }}
      >
        {selectedThumb && (
          <img
            src={selectedThumb}
            alt=""
            className="scene-dropdown-thumb scene-dropdown-thumb-clickable"
            onClick={(e) => {
              e.stopPropagation()
              if (!isGalleryValue && onThumbClick) onThumbClick(value)
            }}
          />
        )}
        {!selectedThumb && value && <span className="scene-dropdown-empty-thumb" />}
        <span className="scene-dropdown-label">{selectedLabel}</span>
        <span className="scene-dropdown-arrow">{open ? '▴' : '▾'}</span>
      </div>
      {open && (
        <div className="scene-dropdown-menu">
          {/* None 옵션 */}
          <div
            className={`scene-dropdown-item${!value ? ' selected' : ''}`}
            onClick={() => { onChange(''); setOpen(false) }}
          >
            <span className="scene-dropdown-empty-thumb" />
            <span className="scene-dropdown-item-label">{placeholder || '—'}</span>
          </div>

          {/* 씬 옵션들 */}
          {options.map(scene => {
            const thumb = resolveImageSrc(scene)
            return (
              <div
                key={scene.id}
                className={`scene-dropdown-item${scene.id === value ? ' selected' : ''}`}
                onClick={() => { onChange(scene.id); setOpen(false) }}
              >
                {thumb
                  ? <img src={thumb} alt="" className="scene-dropdown-thumb" />
                  : <span className="scene-dropdown-empty-thumb" />
                }
                <span className="scene-dropdown-item-label">{getLabel(scene)}</span>
              </div>
            )
          })}

          {/* 갤러리 섹션 */}
          <div className="scene-dropdown-divider">📂 Gallery</div>

          {galleryItems && galleryItems.length > 0 && galleryItems.map(item => (
            <div
              key={`gal_${item.mediaId}`}
              className={`scene-dropdown-item gallery-item${value === GALLERY_PREFIX + item.mediaId ? ' selected' : ''}`}
              onClick={() => { onChange(GALLERY_PREFIX + item.mediaId); setOpen(false) }}
            >
              <img src={item.url} alt="" className="scene-dropdown-thumb" />
              <span className="scene-dropdown-item-label">{item.mediaId.substring(0, 20)}...</span>
            </div>
          ))}

          {galleryLoading && (
            <div className="scene-dropdown-item gallery-loading">
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">⏳ Loading...</span>
            </div>
          )}

          {!galleryItems?.length && !galleryLoading && onLoadGallery && (
            <div
              className="scene-dropdown-item gallery-load-btn"
              onClick={(e) => { e.stopPropagation(); onLoadGallery() }}
            >
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">📂 Load Gallery</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const STATUS_ICONS = {
  waiting: '⏳',
  generating: '⚙️',
  complete: '✅',
  error: '❌',
}

let nextPairId = 1

export { GALLERY_PREFIX }

export default function FrameToVideoPanel({ scenes, videoScenes = [], framePairs, onUpdate, promptSource = 'image', onPromptSourceChange, onShowSceneDetail, disabled, t, galleryItems, galleryLoading, onLoadGallery }) {

  // mediaId 있는 씬만 드롭다운에 표시
  const availableScenes = useMemo(
    () => scenes.filter(s => s.mediaId),
    [scenes]
  )

  // 새로운 이미지 씬이 생기면 자동으로 프레임 페어 추가 (unselected)
  const prevAvailableCountRef = useRef(availableScenes.length)
  useEffect(() => {
    const usedStart = new Set(framePairs.map(p => p.startSceneId))
    const unusedScenes = availableScenes.filter(s => !usedStart.has(s.id))

    if (unusedScenes.length === 0) {
      prevAvailableCountRef.current = availableScenes.length
      return
    }

    // 마운트 시 또는 새 이미지 씬 추가됐을 때만 실행
    const newPairs = unusedScenes.map((scene) => {
      const globalIdx = availableScenes.indexOf(scene)
      const nextScene = globalIdx >= 0 ? availableScenes[globalIdx + 1] : null
      return {
        id: `fp_${nextPairId++}`,
        startSceneId: scene.id,
        endSceneId: nextScene?.id || '',
        prompt: scene.prompt || '',
        videoPrompt: '',
        customPrompt: '',
        status: 'waiting',
        selected: false,
      }
    })

    onUpdate([...framePairs, ...newPairs])
    prevAvailableCountRef.current = availableScenes.length
  }, [availableScenes.length]) // 이미지 씬 수가 바뀔 때만

  const toggleSelect = (id) => {
    onUpdate(framePairs.map(p =>
      p.id === id ? { ...p, selected: p.selected === false ? true : false } : p
    ))
  }

  const toggleSelectAll = () => {
    const allSelected = framePairs.every(p => p.selected !== false)
    onUpdate(framePairs.map(p => ({ ...p, selected: !allSelected })))
  }

  const updatePair = (index, field, value) => {
    const updated = [...framePairs]
    updated[index] = { ...updated[index], [field]: value }
    onUpdate(updated)
  }

  const addRow = () => {
    // 기본값: 순서대로 자동 채움
    const usedStart = new Set(framePairs.map(p => p.startSceneId))
    const nextStart = availableScenes.find(s => !usedStart.has(s.id))
    const nextStartId = nextStart?.id || ''

    const startIdx = availableScenes.findIndex(s => s.id === nextStartId)
    const nextEnd = startIdx >= 0 ? availableScenes[startIdx + 1] : null

    onUpdate([
      ...framePairs,
      {
        id: `fp_${nextPairId++}`,
        startSceneId: nextStartId,
        endSceneId: nextEnd?.id || '',
        prompt: nextStart?.prompt || '',
        videoPrompt: '',
        customPrompt: '',
        status: 'waiting',
      },
    ])
  }

  // Auto Batch — 아직 배치 안 된 씬 전부를 프레임 페어로 자동 생성
  const autoBatch = () => {
    const usedStart = new Set(framePairs.map(p => p.startSceneId))
    const unusedScenes = availableScenes.filter(s => !usedStart.has(s.id))

    if (unusedScenes.length === 0) return

    const newPairs = unusedScenes.map((scene, i) => {
      const globalIdx = availableScenes.indexOf(scene)
      const nextScene = globalIdx >= 0 ? availableScenes[globalIdx + 1] : null
      return {
        id: `fp_${nextPairId++}`,
        startSceneId: scene.id,
        endSceneId: nextScene?.id || '',
        prompt: scene.prompt || '',
        videoPrompt: '',
        customPrompt: '',
        status: 'waiting',
        selected: false,
      }
    })

    onUpdate([...framePairs, ...newPairs])
  }

  const removeRow = (index) => {
    onUpdate(framePairs.filter((_, i) => i !== index))
  }

  const getSceneLabel = (scene) => {
    const idx = scenes.indexOf(scene) + 1
    return `#${idx} ${scene.prompt?.substring(0, 25) || scene.id}`
  }

  if (availableScenes.length === 0) {
    return (
      <div className="video-panel-empty">
        <p>🎞️ {t('frameToVideo.noScenesWithMedia')}</p>
      </div>
    )
  }

  return (
    <div className="video-panel">
      <div className="video-panel-header">
        <p className="video-panel-description">{t('frameToVideo.description')}</p>
      </div>

      <div className="video-mapping-table">
        {/* 테이블 헤더 */}
        <div className="mapping-row mapping-header">
          <span className="col-check"><input
            type="checkbox"
            checked={framePairs.length > 0 && framePairs.every(p => p.selected !== false)}
            onChange={toggleSelectAll}
            disabled={disabled}
          /></span>
          <span className="mapping-col col-num">#</span>
          <span className="mapping-col col-image">{t('frameToVideo.startImage')}</span>
          <span className="mapping-col col-image">{t('frameToVideo.endImage')}</span>
          <span className="mapping-col col-prompt">
            <select
              value={promptSource}
              onChange={(e) => onPromptSourceChange(e.target.value)}
              className="prompt-source-toggle"
            >
              <option value="image">{t('frameToVideo.imagePrompt')}</option>
              <option value="video">{t('frameToVideo.videoPromptLabel')}</option>
              <option value="none">{t('frameToVideo.noPrompt')}</option>
            </select>
          </span>
          <span className="mapping-col col-status">{t('frameToVideo.status')}</span>
          <span className="mapping-col col-action"></span>
        </div>

        {/* 매핑 행들 */}
        {framePairs.map((pair, index) => (
          <div key={pair.id} className="mapping-row">
            <span className="col-check"><input
              type="checkbox"
              checked={pair.selected !== false}
              onChange={() => toggleSelect(pair.id)}
              disabled={disabled}
            /></span>
            <span className="mapping-col col-num">{index + 1}</span>

            {/* Start Image 드롭다운 */}
            <div className="mapping-col col-image">
              <SceneSelect
                value={pair.startSceneId}
                onChange={(val) => updatePair(index, 'startSceneId', val)}
                placeholder="—"
                disabled={disabled || pair.status === 'generating'}
                options={availableScenes}
                getLabel={getSceneLabel}
                onThumbClick={(sceneId) => {
                  const scene = scenes.find(s => s.id === sceneId)
                  if (scene && onShowSceneDetail) onShowSceneDetail(scene)
                }}
                galleryItems={galleryItems}
                galleryLoading={galleryLoading}
                onLoadGallery={onLoadGallery}
              />
            </div>

            {/* End Image 드롭다운 */}
            <div className="mapping-col col-image">
              <SceneSelect
                value={pair.endSceneId}
                onChange={(val) => updatePair(index, 'endSceneId', val)}
                placeholder={t('frameToVideo.noEndImage')}
                disabled={disabled || pair.status === 'generating'}
                options={availableScenes}
                getLabel={getSceneLabel}
                onThumbClick={(sceneId) => {
                  const scene = scenes.find(s => s.id === sceneId)
                  if (scene && onShowSceneDetail) onShowSceneDetail(scene)
                }}
                galleryItems={galleryItems}
                galleryLoading={galleryLoading}
                onLoadGallery={onLoadGallery}
              />
            </div>

            {/* 프롬프트 — 이미지/비디오/직접입력 모드 */}
            <div className="mapping-col col-prompt">
              {promptSource === 'image' && (
                <input
                  type="text"
                  value={pair.prompt || ''}
                  onChange={(e) => updatePair(index, 'prompt', e.target.value)}
                  disabled={disabled || pair.status === 'generating'}
                  placeholder={t('frameToVideo.promptPlaceholder')}
                />
              )}
              {promptSource === 'video' && (
                <input
                  type="text"
                  value={pair.videoPrompt || videoScenes[index]?.prompt || ''}
                  onChange={(e) => updatePair(index, 'videoPrompt', e.target.value)}
                  disabled={disabled || pair.status === 'generating'}
                  placeholder={t('frameToVideo.videoPromptPlaceholder')}
                />
              )}
              {promptSource === 'none' && (
                <input
                  type="text"
                  value={pair.customPrompt || ''}
                  onChange={(e) => updatePair(index, 'customPrompt', e.target.value)}
                  disabled={disabled || pair.status === 'generating'}
                  placeholder={t('frameToVideo.customPromptPlaceholder')}
                />
              )}
            </div>

            {/* 상태 */}
            <span className="mapping-col col-status">
              {pair.status === 'generating' ? (
                <span className="status generating">
                  <StopwatchIcon size={16} /> <ElapsedTime startedAt={pair.generatingStartedAt} endedAt={pair.generatingEndedAt} />
                </span>
              ) : (
                <span className={`status ${pair.status || 'waiting'}`}>
                  {STATUS_ICONS[pair.status] || '⏳'} {t(`frameToVideo.${pair.status}`)}
                </span>
              )}
            </span>

            {/* 삭제 */}
            <div className="mapping-col col-action">
              <button
                className="btn-remove"
                onClick={() => removeRow(index)}
                disabled={disabled || pair.status === 'generating'}
                title={t('frameToVideo.removeRow')}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 행 추가 + 자동 배치 버튼 */}
      <div className="video-panel-actions">
        <button
          className="btn-add-row"
          onClick={addRow}
          disabled={disabled}
        >
          {t('frameToVideo.addRow')}
        </button>
        <button
          className="btn-add-row btn-auto-batch"
          onClick={autoBatch}
          disabled={disabled || availableScenes.filter(s => !new Set(framePairs.map(p => p.startSceneId)).has(s.id)).length === 0}
          title={t('frameToVideo.autoBatchHint')}
        >
          {t('frameToVideo.autoBatch')}
        </button>
      </div>
    </div>
  )
}
