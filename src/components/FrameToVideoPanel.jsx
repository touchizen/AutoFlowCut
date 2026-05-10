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
// view 상태: 'main' (기본), 'dates' (Flow 프로젝트=날짜 목록), 'media' (선택한 날짜의 업로드)
function SceneSelect({
  value, onChange, placeholder, disabled: selectDisabled,
  options, getLabel, onThumbClick,
  galleryItems, galleryLoading, onLoadGallery, onUploadFromDisk,
  onListFlowProjects, onFetchProjectGallery
}) {
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [view, setView] = useState('main')
  const [dateProjects, setDateProjects] = useState([])
  const [dateLoading, setDateLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState(null) // {projectId, title}
  const [dateMedia, setDateMedia] = useState([])
  const [dateMediaLoading, setDateMediaLoading] = useState(false)
  const fileInputRef = useRef(null)
  const ref = useRef(null)

  // 드롭다운 닫히면 view 리셋 (다음에 열 때 main으로 돌아감)
  useEffect(() => {
    if (!open) {
      setView('main')
      setSelectedDate(null)
      setDateMedia([])
    }
  }, [open])

  const enterDatesView = async () => {
    if (!onListFlowProjects || selectDisabled) return
    setView('dates')
    if (dateProjects.length === 0) {
      setDateLoading(true)
      try {
        const result = await onListFlowProjects()
        if (result?.success) setDateProjects(result.items || [])
        else console.warn('[SceneSelect] list projects failed:', result?.error)
      } catch (e) {
        console.error('[SceneSelect] list projects error:', e)
      } finally {
        setDateLoading(false)
      }
    }
  }

  const pickDate = async (project) => {
    if (selectDisabled) return
    setSelectedDate(project)
    setView('media')
    setDateMedia([])
    if (!onFetchProjectGallery) return
    setDateMediaLoading(true)
    try {
      const result = await onFetchProjectGallery(project.projectId)
      if (result?.success) setDateMedia(result.items || [])
      else console.warn('[SceneSelect] fetch project gallery failed:', result?.error)
    } catch (e) {
      console.error('[SceneSelect] fetch project gallery error:', e)
    } finally {
      setDateMediaLoading(false)
    }
  }

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting same file
    if (!file || !onUploadFromDisk || selectDisabled) return
    setUploading(true)
    try {
      const result = await onUploadFromDisk(file)
      if (result?.success && result.mediaId) {
        onChange(GALLERY_PREFIX + result.mediaId)
        setOpen(false)
      } else {
        console.warn('[SceneSelect] upload failed:', result?.error)
      }
    } catch (err) {
      console.error('[SceneSelect] upload error:', err)
    } finally {
      setUploading(false)
    }
  }

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
    ? `📂 ${gallerySelected.displayName || (galleryMediaId.substring(0, 16) + '...')}`
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
      {open && view === 'main' && (
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
              <span className="scene-dropdown-item-label">{item.displayName || (item.mediaId.substring(0, 20) + '...')}</span>
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
              <span className="scene-dropdown-item-label">📂 Load Current Project</span>
            </div>
          )}

          {onListFlowProjects && (
            <div
              className="scene-dropdown-item gallery-load-btn"
              onClick={(e) => { e.stopPropagation(); enterDatesView() }}
            >
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">📅 Browse Flow Archive</span>
            </div>
          )}

          {onUploadFromDisk && (
            <div
              className="scene-dropdown-item gallery-upload-btn"
              onClick={(e) => {
                e.stopPropagation()
                if (selectDisabled || uploading) return
                fileInputRef.current?.click()
              }}
            >
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">
                {uploading ? '⏳ Uploading...' : '📁 Upload from disk'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileChosen}
              />
            </div>
          )}
        </div>
      )}

      {open && view === 'dates' && (
        <div className="scene-dropdown-menu">
          <div
            className="scene-dropdown-item gallery-back-btn"
            onClick={(e) => { e.stopPropagation(); setView('main') }}
          >
            <span className="scene-dropdown-empty-thumb" />
            <span className="scene-dropdown-item-label">← Back</span>
          </div>
          <div className="scene-dropdown-divider">📅 Flow Archive</div>
          {dateLoading && (
            <div className="scene-dropdown-item gallery-loading">
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">⏳ Loading projects...</span>
            </div>
          )}
          {!dateLoading && dateProjects.length === 0 && (
            <div className="scene-dropdown-item gallery-loading">
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">No projects found</span>
            </div>
          )}
          {dateProjects.map(p => (
            <div
              key={`proj_${p.projectId}`}
              className="scene-dropdown-item"
              onClick={(e) => { e.stopPropagation(); pickDate(p) }}
            >
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">{p.title}</span>
            </div>
          ))}
        </div>
      )}

      {open && view === 'media' && (
        <div className="scene-dropdown-menu">
          <div
            className="scene-dropdown-item gallery-back-btn"
            onClick={(e) => { e.stopPropagation(); setView('dates') }}
          >
            <span className="scene-dropdown-empty-thumb" />
            <span className="scene-dropdown-item-label">← {selectedDate?.title || 'Dates'}</span>
          </div>
          <div className="scene-dropdown-divider">🖼 Uploads</div>
          {dateMediaLoading && (
            <div className="scene-dropdown-item gallery-loading">
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">⏳ Loading images...</span>
            </div>
          )}
          {!dateMediaLoading && dateMedia.length === 0 && (
            <div className="scene-dropdown-item gallery-loading">
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">No uploaded images</span>
            </div>
          )}
          {dateMedia.map(item => (
            <div
              key={`dmedia_${item.mediaId}`}
              className={`scene-dropdown-item gallery-item${value === GALLERY_PREFIX + item.mediaId ? ' selected' : ''}`}
              onClick={() => {
                if (selectDisabled) return
                onChange(GALLERY_PREFIX + item.mediaId)
                setOpen(false)
              }}
            >
              <img src={item.url} alt="" className="scene-dropdown-thumb" />
              <span className="scene-dropdown-item-label">
                {item.displayName || (item.mediaId.substring(0, 20) + '...')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// 빈 패널에서 디스크 이미지로 첫 페어를 시작할 때 쓰는 미니 업로드 CTA
function EmptyStateUpload({
  onUploadFromDisk, onAdded, disabled = false,
  onListFlowProjects, onFetchProjectGallery,
}) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [view, setView] = useState('dates') // 'dates' | 'media'
  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [selectedProject, setSelectedProject] = useState(null)
  const [media, setMedia] = useState([])
  const [mediaLoading, setMediaLoading] = useState(false)

  const handleChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || disabled || !onUploadFromDisk) return
    setBusy(true)
    try {
      const result = await onUploadFromDisk(file)
      if (result?.success && result.mediaId) {
        onAdded(result.mediaId)
      } else {
        console.warn('[EmptyStateUpload] upload failed:', result?.error)
      }
    } catch (err) {
      console.error('[EmptyStateUpload] upload error:', err)
    } finally {
      setBusy(false)
    }
  }

  const openArchive = async () => {
    if (disabled || !onListFlowProjects) return
    setBrowseOpen(true)
    setView('dates')
    setSelectedProject(null)
    setMedia([])
    if (projects.length === 0) {
      setProjectsLoading(true)
      try {
        const result = await onListFlowProjects()
        if (result?.success) setProjects(result.items || [])
      } catch (e) {
        console.error('[EmptyStateUpload] list projects error:', e)
      } finally {
        setProjectsLoading(false)
      }
    }
  }

  const pickDate = async (project) => {
    if (disabled) return
    setSelectedProject(project)
    setView('media')
    setMedia([])
    if (!onFetchProjectGallery) return
    setMediaLoading(true)
    try {
      const result = await onFetchProjectGallery(project.projectId)
      if (result?.success) setMedia(result.items || [])
    } catch (e) {
      console.error('[EmptyStateUpload] fetch project gallery error:', e)
    } finally {
      setMediaLoading(false)
    }
  }

  return (
    <div className="video-panel-empty-upload">
      {onUploadFromDisk && (
        <>
          <button
            className="btn-upload-from-disk"
            disabled={busy || disabled}
            onClick={() => { if (!disabled) inputRef.current?.click() }}
          >
            {busy ? '⏳ Uploading...' : '📁 Upload image from disk'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleChange}
          />
        </>
      )}

      {onListFlowProjects && !browseOpen && (
        <button
          className="btn-upload-from-disk"
          disabled={disabled}
          onClick={openArchive}
          style={{ marginLeft: 8 }}
        >
          📅 Browse Flow Archive
        </button>
      )}

      {browseOpen && view === 'dates' && (
        <div className="empty-archive-list">
          <button
            className="empty-archive-back"
            onClick={() => setBrowseOpen(false)}
          >← Cancel</button>
          {projectsLoading && <div>⏳ Loading projects...</div>}
          {!projectsLoading && projects.length === 0 && <div>No projects found</div>}
          {projects.map(p => (
            <button
              key={p.projectId}
              className="empty-archive-date"
              disabled={disabled}
              onClick={() => pickDate(p)}
            >{p.title}</button>
          ))}
        </div>
      )}

      {browseOpen && view === 'media' && (
        <div className="empty-archive-list">
          <button
            className="empty-archive-back"
            onClick={() => setView('dates')}
          >← {selectedProject?.title || 'Dates'}</button>
          {mediaLoading && <div>⏳ Loading images...</div>}
          {!mediaLoading && media.length === 0 && <div>No uploaded images</div>}
          {media.map(item => (
            <button
              key={item.mediaId}
              className="empty-archive-image"
              disabled={disabled}
              onClick={() => { if (!disabled) onAdded(item.mediaId) }}
            >
              {item.url && <img src={item.url} alt="" style={{ width: 32, height: 32, objectFit: 'cover', marginRight: 6 }} />}
              {item.displayName || item.mediaId.substring(0, 16) + '...'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const STATUS_ICONS = {
  waiting: '⏳',
  pending: '🔄',
  generating: '⚙️',
  complete: '✅',
  error: '❌',
}

// 기존 페어들에서 사용 중인 최대 fp_N을 찾아 다음 ID 반환
// 모듈 스코프 카운터를 쓰면 프로젝트 전환/리로드 시 기존 저장된 ID와 충돌(중복 key)하므로
// 항상 현재 framePairs를 기준으로 재계산한다.
const getNextPairId = (pairs) => {
  const maxId = (pairs || []).reduce((max, p) => {
    const n = parseInt(String(p?.id || '').replace('fp_', ''), 10)
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return maxId + 1
}

export { GALLERY_PREFIX }

export default function FrameToVideoPanel({
  scenes, videoScenes = [], framePairs, onUpdate, promptSource = 'image', onPromptSourceChange,
  onShowSceneDetail, onVideoRetry, disabled, t, galleryItems, galleryLoading, onLoadGallery,
  onUploadFromDisk, onListFlowProjects, onFetchProjectGallery,
  seedNo = null, seedLocked = false, onSeedChange, onSeedLockToggle, onSeedRandom,
}) {
  const showSeedUI = typeof onSeedChange === 'function'
  const handleSeedInputChange = (e) => {
    const raw = e.target.value
    if (raw === '') return onSeedChange?.(null)
    const cleaned = raw.replace(/[^0-9]/g, '')
    if (cleaned === '') return onSeedChange?.(null)
    const num = parseInt(cleaned, 10)
    if (Number.isFinite(num)) onSeedChange?.(num)
  }

  // mediaId 있는 씬만 드롭다운에 표시
  const availableScenes = useMemo(
    () => scenes.filter(s => s.mediaId),
    [scenes]
  )

  // 마운트 시점에 기존 저장된 framePairs에 중복 ID가 있으면 정제.
  // 과거 버그(모듈 카운터 고아)로 저장된 프로젝트 데이터를 자동 복구한다.
  useEffect(() => {
    const ids = framePairs.map(p => p?.id)
    if (ids.length === new Set(ids.filter(Boolean)).size && ids.every(Boolean)) return
    console.warn('[FrameToVideoPanel] duplicate/empty framePair IDs detected — reassigning')
    let counter = getNextPairId(framePairs)
    const seen = new Set()
    const fixed = framePairs.map(p => {
      if (p?.id && !seen.has(p.id)) {
        seen.add(p.id)
        return p
      }
      let newId
      do { newId = `fp_${counter++}` } while (seen.has(newId))
      seen.add(newId)
      return { ...p, id: newId }
    })
    onUpdate(fixed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 새로운 이미지 씬이 생기면 자동으로 프레임 페어 추가 (unselected)
  // strict-mode 이중 실행에도 안전하도록 함수형 setter + 중복 ID 가드 사용
  const prevAvailableCountRef = useRef(availableScenes.length)
  useEffect(() => {
    onUpdate(prev => {
      const usedStart = new Set(prev.map(p => p.startSceneId))
      const unusedScenes = availableScenes.filter(s => !usedStart.has(s.id))

      if (unusedScenes.length === 0) return prev

      const existingIds = new Set(prev.map(p => p.id))
      let nextId = getNextPairId(prev)
      const newPairs = unusedScenes.map((scene) => {
        let id
        do { id = `fp_${nextId++}` } while (existingIds.has(id))
        existingIds.add(id)
        const globalIdx = availableScenes.indexOf(scene)
        const nextScene = globalIdx >= 0 ? availableScenes[globalIdx + 1] : null
        return {
          id,
          startSceneId: scene.id,
          endSceneId: nextScene?.id || '',
          prompt: scene.prompt || '',
          videoPrompt: '',
          customPrompt: '',
          status: 'waiting',
          selected: false,
        }
      })
      return [...prev, ...newPairs]
    })
    prevAvailableCountRef.current = availableScenes.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        id: `fp_${getNextPairId(framePairs)}`,
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

    let nextId = getNextPairId(framePairs)
    const newPairs = unusedScenes.map((scene, i) => {
      const globalIdx = availableScenes.indexOf(scene)
      const nextScene = globalIdx >= 0 ? availableScenes[globalIdx + 1] : null
      return {
        id: `fp_${nextId++}`,
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

  if (availableScenes.length === 0 && framePairs.length === 0) {
    return (
      <div className="video-panel-empty">
        <p>🎞️ {t('frameToVideo.noScenesWithMedia')}</p>
        {(onUploadFromDisk || onListFlowProjects) && (
          <EmptyStateUpload
            onUploadFromDisk={onUploadFromDisk}
            onListFlowProjects={onListFlowProjects}
            onFetchProjectGallery={onFetchProjectGallery}
            disabled={disabled}
            onAdded={(mediaId) => {
              onUpdate([{
                id: `fp_${getNextPairId([])}`,
                startSceneId: GALLERY_PREFIX + mediaId,
                endSceneId: '',
                prompt: '',
                videoPrompt: '',
                customPrompt: '',
                status: 'waiting',
                selected: true,
              }])
            }}
          />
        )}
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
                onUploadFromDisk={onUploadFromDisk}
                onListFlowProjects={onListFlowProjects}
                onFetchProjectGallery={onFetchProjectGallery}
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
                onUploadFromDisk={onUploadFromDisk}
                onListFlowProjects={onListFlowProjects}
                onFetchProjectGallery={onFetchProjectGallery}
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
              ) : pair.status === 'error' ? (
                <span className="status error-wrap">
                  <span className="status error" title={pair.error}>
                    {STATUS_ICONS.error} {t(`frameToVideo.${pair.status}`)}
                  </span>
                  {onVideoRetry && !disabled && (
                    <button
                      type="button"
                      className="retry-btn-inline"
                      onClick={() => onVideoRetry(pair)}
                      title={pair.error || t('actions.retryDownload') || 'Retry download'}
                      style={{ marginLeft: '6px', padding: '2px 6px', border: '1px solid #888', borderRadius: '3px', background: 'transparent', cursor: 'pointer' }}
                    >
                      🔄
                    </button>
                  )}
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

      {/* 행 추가 + 자동 배치 버튼 + Seed 컨트롤 (오른쪽) */}
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
        {showSeedUI && (
          <div className="seed-control" style={{ marginLeft: 'auto' }} title={t('prompt.seedTitle') || 'Seed (locked = reuse same video)'}>
            <span className="seed-label">Seed</span>
            <input
              type="text"
              inputMode="numeric"
              className="seed-input"
              value={seedNo ?? ''}
              onChange={handleSeedInputChange}
              placeholder={t('prompt.seedRandom') || 'random'}
              disabled={disabled}
              maxLength={12}
            />
            <button
              type="button"
              className="seed-btn seed-dice"
              onClick={() => onSeedRandom?.()}
              disabled={disabled}
              title={t('prompt.seedDice') || 'New random seed + lock'}
            >
              🎲
            </button>
            <button
              type="button"
              className={`seed-btn seed-lock ${seedLocked ? 'locked' : ''}`}
              onClick={() => onSeedLockToggle?.()}
              disabled={disabled}
              title={seedLocked
                ? (t('prompt.seedUnlock') || 'Unlock (use random each time)')
                : (t('prompt.seedLock') || 'Lock (reuse this seed)')}
            >
              {seedLocked ? '🔒' : '🔓'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
