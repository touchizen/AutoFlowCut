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
import { resolveImageSrc } from '../utils/formatters'
import useFlowArchiveBrowser, { ARCHIVE_LABELS } from '../hooks/useFlowArchiveBrowser'
import { toast } from './Toast'
import { StopwatchIcon, ElapsedTime } from './StopwatchIcon'

// 갤러리 ID prefix
const GALLERY_PREFIX = 'gallery::'

// 커스텀 드롭다운 — 썸네일 + 레이블 + 갤러리
// view 상태: 'main' (기본), 'dates' (Flow 프로젝트=날짜 목록), 'media' (선택한 날짜의 업로드)
function SceneSelect({
  value, onChange, placeholder, disabled: selectDisabled,
  options, getLabel, onThumbClick,
  galleryItems, galleryLoading, onLoadGallery, onUploadFromDisk,
  onListFlowProjects, onFetchProjectGallery, onPickArchiveImage,
}) {
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false) // 'main' vs archive view
  const archive = useFlowArchiveBrowser({ onListFlowProjects, onFetchProjectGallery })
  const fileInputRef = useRef(null)
  const ref = useRef(null)

  // 드롭다운 닫히면 archive view 리셋 (다음에 열 때 main으로 돌아감)
  useEffect(() => {
    if (!open) {
      setArchiveOpen(false)
      archive.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const enterDatesView = () => {
    if (!onListFlowProjects || selectDisabled) return
    setArchiveOpen(true)
    archive.openDates()
  }

  const pickDate = (project) => {
    if (selectDisabled) return
    archive.pickProject(project)
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
      {open && !archiveOpen && (
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
              <span className="scene-dropdown-item-label">{ARCHIVE_LABELS.browse}</span>
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

      {open && archiveOpen && archive.view === 'dates' && (
        <div className="scene-dropdown-menu">
          <div
            className="scene-dropdown-item gallery-back-btn"
            onClick={(e) => { e.stopPropagation(); setArchiveOpen(false); archive.reset() }}
          >
            <span className="scene-dropdown-empty-thumb" />
            <span className="scene-dropdown-item-label">{ARCHIVE_LABELS.back}</span>
          </div>
          <div className="scene-dropdown-divider">{ARCHIVE_LABELS.archiveHeader}</div>
          {archive.projectsLoading && (
            <div className="scene-dropdown-item gallery-loading">
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">{ARCHIVE_LABELS.loadingProjects}</span>
            </div>
          )}
          {!archive.projectsLoading && archive.projects.length === 0 && (
            <div className="scene-dropdown-item gallery-loading">
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">{ARCHIVE_LABELS.noProjects}</span>
            </div>
          )}
          {archive.projects.map(p => (
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

      {open && archiveOpen && archive.view === 'media' && (
        <div className="scene-dropdown-menu">
          <div
            className="scene-dropdown-item gallery-back-btn"
            onClick={(e) => { e.stopPropagation(); archive.backToDates() }}
          >
            <span className="scene-dropdown-empty-thumb" />
            <span className="scene-dropdown-item-label">← {archive.selectedProject?.title || 'Dates'}</span>
          </div>
          <div className="scene-dropdown-divider">{ARCHIVE_LABELS.imagesHeader}</div>
          {archive.mediaLoading && (
            <div className="scene-dropdown-item gallery-loading">
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">{ARCHIVE_LABELS.loadingImages}</span>
            </div>
          )}
          {!archive.mediaLoading && archive.media.length === 0 && (
            <div className="scene-dropdown-item gallery-loading">
              <span className="scene-dropdown-empty-thumb" />
              <span className="scene-dropdown-item-label">{ARCHIVE_LABELS.noImages}</span>
            </div>
          )}
          {archive.media.map(item => (
            <div
              key={`dmedia_${item.mediaId}`}
              className={`scene-dropdown-item gallery-item${value === GALLERY_PREFIX + item.mediaId ? ' selected' : ''}`}
              onClick={() => {
                if (selectDisabled) return
                onPickArchiveImage?.(item)
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

// 빈 패널에서 외부 이미지(디스크 / Flow archive)로 첫 페어를 시작하는 CTA.
// onAdded(item) — item: { mediaId, url?, displayName? } (disk 업로드 시 url 없음)
function EmptyStateUpload({
  onUploadFromDisk, onAdded, disabled = false,
  onListFlowProjects, onFetchProjectGallery,
}) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [browseOpen, setBrowseOpen] = useState(false)
  const archive = useFlowArchiveBrowser({ onListFlowProjects, onFetchProjectGallery })

  const handleChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || disabled || !onUploadFromDisk) return
    setBusy(true)
    try {
      const result = await onUploadFromDisk(file)
      if (result?.success && result.mediaId) {
        onAdded({ mediaId: result.mediaId })
      } else {
        console.warn('[EmptyStateUpload] upload failed:', result?.error)
      }
    } catch (err) {
      console.error('[EmptyStateUpload] upload error:', err)
    } finally {
      setBusy(false)
    }
  }

  const openArchive = () => {
    if (disabled || !onListFlowProjects) return
    setBrowseOpen(true)
    archive.openDates()
  }

  const cancelArchive = () => {
    setBrowseOpen(false)
    archive.reset()
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
          {ARCHIVE_LABELS.browse}
        </button>
      )}

      {browseOpen && archive.view === 'dates' && (
        <div className="empty-archive-list">
          <button className="empty-archive-back" onClick={cancelArchive}>{ARCHIVE_LABELS.cancel}</button>
          {archive.projectsLoading && <div>{ARCHIVE_LABELS.loadingProjects}</div>}
          {!archive.projectsLoading && archive.projects.length === 0 && <div>{ARCHIVE_LABELS.noProjects}</div>}
          {archive.projects.map(p => (
            <button
              key={p.projectId}
              className="empty-archive-date"
              disabled={disabled}
              onClick={() => archive.pickProject(p)}
            >{p.title}</button>
          ))}
        </div>
      )}

      {browseOpen && archive.view === 'media' && (
        <div className="empty-archive-list">
          <button className="empty-archive-back" onClick={archive.backToDates}>
            ← {archive.selectedProject?.title || 'Dates'}
          </button>
          {archive.mediaLoading && <div>{ARCHIVE_LABELS.loadingImages}</div>}
          {!archive.mediaLoading && archive.media.length === 0 && <div>{ARCHIVE_LABELS.noImages}</div>}
          {archive.media.map(item => (
            <button
              key={item.mediaId}
              className="empty-archive-image"
              disabled={disabled}
              onClick={() => { if (!disabled) onAdded(item) }}
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
  onScenePromptUpdate,  // image 모드 input 편집을 scene 본체로 라우팅 (단일 진실 소스 = scene.prompt)
  onSceneVideoPromptUpdate,  // video 모드 input 편집을 scene.videoT2VPrompt 로 라우팅 (단일 진실 소스 = T2V prompt)
  onShowSceneDetail, onVideoRetry, disabled, t, galleryItems, galleryLoading, onLoadGallery,
  onUploadFromDisk, onListFlowProjects, onFetchProjectGallery, onPickArchiveImage,
  hasFlowArchive = false,
  seedNo = null, seedLocked = false, onSeedChange, onSeedLockToggle, onSeedRandom,
  onRequestNewScene,
  onRequestSceneTrim,
  endImageDisabled = false,  // OmniFlash 는 종료프레임 미지원 → End Image 선택 비활성화
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

  // 생성 이미지가 있는 씬만 드롭다운에 표시.
  // cloud(Veo): imagePath(디스크)/image(메모리) 기준. legacy Flow: mediaId 도 허용.
  const availableScenes = useMemo(
    () => scenes.filter(s => s.mediaId || s.imagePath || s.image),
    [scenes]
  )

  // 한 씬당 1개 owning row invariant — addRow/autoBatch/auto-add 가드 + 버튼
  // disabled 상태가 모두 같은 데이터를 본다. useMemo로 한 번만 계산해 재렌더
  // 마다 Set 새로 만드는 부담 제거.
  const usedOwners = useMemo(
    () => new Set(framePairs.map(p => p.ownerSceneId).filter(Boolean)),
    [framePairs]
  )
  const hasUnusedScene = useMemo(
    () => availableScenes.some(s => !usedOwners.has(s.id)),
    [availableScenes, usedOwners]
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
  useEffect(() => {
    onUpdate(prev => {
      // Dedup by ownerSceneId (immutable row-to-scene binding) not startSceneId
      // (mutable input field). Without this, a row whose start image was changed
      // would no longer count as "owning" its original scene, and auto-add would
      // re-create a duplicate row.
      //
      // NOTE: usedOwners is also memoized at component scope for addRow/autoBatch/
      // button-disabled. Recomputed here from `prev` (functional updater) to avoid
      // stale closure — render-scope memo could lag a render behind setState batches.
      const usedOwners = new Set(prev.map(p => p.ownerSceneId).filter(Boolean))
      const unusedScenes = availableScenes.filter(s => !usedOwners.has(s.id))

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
          ownerSceneId: scene.id,    // immutable owner — never changed by dropdowns
          startSceneId: scene.id,    // mutable input; user can repoint via dropdown
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

  // Mutates only the named field. `ownerSceneId` is intentionally NOT exposed via
  // any dropdown — it stays whatever auto-add set at row creation.
  const updatePair = (index, field, value) => {
    const updated = [...framePairs]
    updated[index] = { ...updated[index], [field]: value }
    onUpdate(updated)
  }

  const addRow = () => {
    // 기본값: 순서대로 자동 채움
    const nextStart = availableScenes.find(s => !usedOwners.has(s.id))
    if (!nextStart) {
      // 모든 씬이 owned → 새 씬을 만들고 그 씬을 owner 로 하는 F→V 행을 즉시 생성.
      // 새 씬은 mediaId 가 없어서 availableScenes 필터에서 빠짐 → start/end image dropdown
      // 에선 안 보이지만, 행 자체는 시각적으로 즉시 추가됨.
      const newSceneId = onRequestNewScene?.()
      if (!newSceneId) {
        toast.warning(t('frameToVideo.addRowFail'))
        return
      }
      onUpdate([
        ...framePairs,
        {
          id: `fp_${getNextPairId(framePairs)}`,
          ownerSceneId: newSceneId,
          startSceneId: '',
          endSceneId: '',
          prompt: '',
          videoPrompt: '',
          customPrompt: '',
          status: 'waiting',
          selected: false,
        },
      ])
      toast.info(t('frameToVideo.addRowNewScene'))
      return
    }

    const nextStartId = nextStart.id
    const startIdx = availableScenes.findIndex(s => s.id === nextStartId)
    const nextEnd = startIdx >= 0 ? availableScenes[startIdx + 1] : null

    onUpdate([
      ...framePairs,
      {
        id: `fp_${getNextPairId(framePairs)}`,
        ownerSceneId: nextStartId,
        startSceneId: nextStartId,
        endSceneId: nextEnd?.id || '',
        prompt: nextStart.prompt || '',
        videoPrompt: '',
        customPrompt: '',
        status: 'waiting',
      },
    ])
    toast.success(t('frameToVideo.addRowOk'))
  }

  // Auto Batch — 아직 배치 안 된 씬 전부를 프레임 페어로 자동 생성
  const autoBatch = () => {
    const unusedScenes = availableScenes.filter(s => !usedOwners.has(s.id))

    if (unusedScenes.length === 0) {
      // 모든 씬에 이미 F→V 행이 있음. silently no-op 대신 toast 로 알려줌.
      toast.info(t('frameToVideo.autoBatchNoop'))
      return
    }

    let nextId = getNextPairId(framePairs)
    const newPairs = unusedScenes.map((scene) => {
      const globalIdx = availableScenes.indexOf(scene)
      const nextScene = globalIdx >= 0 ? availableScenes[globalIdx + 1] : null
      return {
        id: `fp_${nextId++}`,
        ownerSceneId: scene.id,    // immutable owner — never changed by dropdowns
        startSceneId: scene.id,    // mutable input; user can repoint via dropdown
        endSceneId: nextScene?.id || '',
        prompt: scene.prompt || '',
        videoPrompt: '',
        customPrompt: '',
        status: 'waiting',
        selected: false,
      }
    })

    onUpdate([...framePairs, ...newPairs])
    toast.success(t('frameToVideo.autoBatchOk', { count: newPairs.length }))
  }

  const removeRow = (index) => {
    const updated = framePairs.filter((_, i) => i !== index)
    onUpdate(updated)
    // After the framePair removal, ask parent to re-evaluate trim — the row's
    // owner scene may now be fully empty (no image/video/subtitle, no F→V row),
    // in which case trim removes it. Non-empty scenes survive because the
    // auto-add useEffect immediately re-creates a row owning them.
    onRequestSceneTrim?.(updated)
  }

  const getSceneLabel = (scene) => {
    const idx = scenes.indexOf(scene) + 1
    return `#${idx} ${scene.prompt?.substring(0, 25) || scene.id}`
  }

  // §3.1.2: archive 버튼은 hasFlowArchive=true (Flow 모드)일 때만 표시.
  const archiveListProjects = hasFlowArchive ? onListFlowProjects : undefined
  const archiveFetchGallery = hasFlowArchive ? onFetchProjectGallery : undefined

  if (availableScenes.length === 0 && framePairs.length === 0) {
    return (
      <div className="video-panel-empty">
        <p>🎞️ {t('frameToVideo.noScenesWithMedia')}</p>
        {(onUploadFromDisk || archiveListProjects) && (
          <EmptyStateUpload
            onUploadFromDisk={onUploadFromDisk}
            onListFlowProjects={archiveListProjects}
            onFetchProjectGallery={archiveFetchGallery}
            disabled={disabled}
            onAdded={(item) => {
              // archive에서 픽한 항목이면 galleryItems에도 추가 (트리거 라벨 렌더용)
              if (item.url && onPickArchiveImage) onPickArchiveImage(item)
              onUpdate([{
                id: `fp_${getNextPairId([])}`,
                ownerSceneId: null,  // gallery-rooted: no owning project scene
                startSceneId: GALLERY_PREFIX + item.mediaId,
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
            <span className="mapping-col col-num">
              {(() => {
                if (!pair.ownerSceneId) return '—'
                const idx = scenes.findIndex(s => s.id === pair.ownerSceneId)
                return idx >= 0 ? `#${idx + 1}` : '⚠'
              })()}
            </span>

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
                onListFlowProjects={archiveListProjects}
                onFetchProjectGallery={archiveFetchGallery}
                onPickArchiveImage={onPickArchiveImage}
              />
            </div>

            {/* End Image 드롭다운 — OmniFlash 는 종료프레임 미지원이라 비활성화 */}
            <div className="mapping-col col-image" title={endImageDisabled ? (t('frameToVideo.omniNoEndImage') || 'OmniFlash는 종료 프레임을 지원하지 않습니다') : undefined}>
              <SceneSelect
                value={endImageDisabled ? '' : pair.endSceneId}
                onChange={(val) => updatePair(index, 'endSceneId', val)}
                placeholder={endImageDisabled ? (t('frameToVideo.omniNoEndImage') || 'OmniFlash 미지원') : t('frameToVideo.noEndImage')}
                disabled={disabled || pair.status === 'generating' || endImageDisabled}
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
                onListFlowProjects={archiveListProjects}
                onFetchProjectGallery={archiveFetchGallery}
                onPickArchiveImage={onPickArchiveImage}
              />
            </div>

            {/* 프롬프트 — 이미지/비디오/직접입력 모드 */}
            <div className="mapping-col col-prompt">
              {promptSource === 'image' && (() => {
                // Image 모드의 단일 진실 소스 = owner scene.prompt. 행 생성 시 pair.prompt 가
                // 스냅샷으로 복사돼서 이후 scene 쪽에서 prompt 가 바뀌면 pair.prompt 가 stale.
                // 따라서 scene-bound 행은 항상 owner scene 의 현재 prompt 를 표시/편집하고,
                // gallery-rooted (ownerSceneId=null) 행만 pair.prompt 를 폴백으로 사용.
                const ownerScene = pair.ownerSceneId ? scenes.find(s => s.id === pair.ownerSceneId) : null
                const value = ownerScene ? (ownerScene.prompt || '') : (pair.prompt || '')
                const handleChange = (v) => {
                  if (ownerScene && onScenePromptUpdate) onScenePromptUpdate(ownerScene.id, v)
                  else updatePair(index, 'prompt', v)
                }
                return (
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    disabled={disabled || pair.status === 'generating'}
                    placeholder={t('frameToVideo.promptPlaceholder')}
                  />
                )
              })()}
              {promptSource === 'video' && (() => {
                // Video 모드의 단일 진실 소스 = owner scene.videoT2VPrompt. T2V 탭에서 video
                // prompt 를 수정하면 F→V 에도 즉시 sync. legacy pair.videoPrompt 는 scene 에
                // videoT2VPrompt 필드 자체가 없을 때만 fallback (legacy/image-only scene 케이스).
                // owner-binding: startSceneId 가 아닌 ownerSceneId 기준이어야 dropdown 만 바꿔도
                // video prompt 가 다른 씬 것으로 튀지 않음.
                //
                // 주의: useVideoScenes 의 derived videoScenes 는 truthy 필터(s.videoT2VPrompt)
                // 라 빈 문자열이면 vscene 이 사라진다. 따라서 derived 가 아니라 owner scene 자체에서
                // videoT2VPrompt 를 lookup — '필드가 string 으로 정의됨' 을 authoritative 로 판단해야
                // 사용자가 prompt 를 "지우면" 진짜 비어 보이고 legacy pair.videoPrompt 가 부활 안 함.
                const ownerScene = pair.ownerSceneId ? scenes.find(s => s.id === pair.ownerSceneId) : null
                const sceneT2VDefined = ownerScene && typeof ownerScene.videoT2VPrompt === 'string'
                const value = sceneT2VDefined ? ownerScene.videoT2VPrompt : (pair.videoPrompt || '')
                const handleChange = (v) => {
                  if (ownerScene && onSceneVideoPromptUpdate) onSceneVideoPromptUpdate(ownerScene.id, v)
                  else updatePair(index, 'videoPrompt', v)
                }
                return (
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    disabled={disabled || pair.status === 'generating'}
                    placeholder={t('frameToVideo.videoPromptPlaceholder')}
                  />
                )
              })()}
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
                // 에러 배지 + 재시도 버튼 한 그룹. 인라인 style 대신 CSS 클래스로 통일 —
                // btn-icon-retry 가 btn-remove (✕) 와 동일한 크기/스타일 베이스를 공유해
                // 행 우측 액션 버튼들이 시각적으로 정렬됨.
                <span className="status-error-group">
                  <span className="status error status-badge" title={pair.error}>
                    {STATUS_ICONS.error} {t(`frameToVideo.${pair.status}`)}
                  </span>
                  {onVideoRetry && !disabled && (
                    <button
                      type="button"
                      className="btn-icon-retry"
                      onClick={() => onVideoRetry(pair)}
                      title={pair.error || t('actions.retryDownload') || 'Retry download'}
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
          title={t('frameToVideo.addRowHint')}
        >
          {t('frameToVideo.addRow')}
        </button>
        <button
          className="btn-add-row btn-auto-batch"
          onClick={autoBatch}
          disabled={disabled}
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
