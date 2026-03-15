/**
 * SceneList Component - 목록 탭 (시간 + 자막 + 미디어 선택 + 히스토리)
 */

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../hooks/useI18n'
import { formatTime, getRatioClass, resolveImageSrc, hasImageData } from '../utils/formatters'
import { checkTagMatch } from '../utils/tagMatch'
import { UI } from '../config/defaults'
import SceneDetailModal from './SceneDetailModal'
import VideoDetailModal from './VideoDetailModal'
import TagBatchModal from './TagBatchModal'
import InfinityLoader from './InfinityLoader'
import './SceneList.css'

/**
 * Export 미디어 결정: auto → I2V > T2V > image
 */
function resolveExportMedia(scene) {
  const choice = scene.exportMedia || 'auto'
  if (choice !== 'auto') return choice
  if (scene.videoI2V) return 'i2v'
  if (scene.videoT2V) return 't2v'
  return 'image'
}

function SceneRow({ scene, index, onUpdate, onDelete, disabled, ratioClass, t, onShowDetail, onShowVideoDetail, references, onOpenTag }) {
  const rowRef = useRef(null)
  const [hoverPreview, setHoverPreview] = useState(null)

  // 생성 중이면 자동 스크롤
  useEffect(() => {
    if (scene.status === 'generating' && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [scene.status])

  const statusIcon = {
    pending: '⏳',
    generating: '⚙️',
    done: '✅',
    error: '❌'
  }[scene.status] || '⏳'

  // 태그 매칭 상태 체크
  const charMatch = checkTagMatch(scene.characters, references, 'character')
  const sceneMatch = checkTagMatch(scene.scene_tag, references, 'scene')
  const styleMatch = checkTagMatch(scene.style_tag, references, 'style')

  // 현재 export 미디어 결정
  const activeMedia = resolveExportMedia(scene)
  const isSelected = (type) => activeMedia === type ? 'selected' : ''

  // 미디어 개수 (선택 UI 필요 여부)
  const hasImage = hasImageData(scene)
  const imgSrc = resolveImageSrc(scene)
  const mediaCount = [hasImage, scene.videoT2V, scene.videoI2V].filter(Boolean).length

  // 매칭 상태 아이콘 (클릭 가능 — 태그 선택 모달 열기)
  const MatchIndicator = ({ match, tagType }) => {
    if (!match) return null
    const handleClick = () => onOpenTag?.(tagType, index)
    if (match.allMatched) {
      return (
        <span className="tag-match-indicator matched clickable" onClick={handleClick}>
          ✓
          <span className="tag-tooltip matched">
            {t('sceneList.tagMatched')}: {match.matchedTags.join(', ')}
          </span>
        </span>
      )
    }
    return (
      <span className="tag-match-indicator unmatched clickable" onClick={handleClick}>
        ✗
        <span className="tag-tooltip unmatched">
          {t('sceneList.tagUnmatched')}: {match.unmatchedTags.join(', ')}
        </span>
      </span>
    )
  }

  // 비디오 src 생성 헬퍼
  const toVideoSrc = (data) => {
    if (!data) return ''
    return data.startsWith('data:') ? data : `data:video/mp4;base64,${data}`
  }

  // 비디오 duration 감지 (Promise) — base64 데이터에서 즉시 감지
  const detectVideoDuration = (videoData) => {
    return new Promise((resolve) => {
      if (!videoData) return resolve(null)
      const vid = document.createElement('video')
      vid.preload = 'metadata'
      vid.muted = true
      vid.onloadedmetadata = () => {
        const dur = Math.round(vid.duration * 10) / 10
        resolve(dur > 0 ? dur : null)
        vid.src = ''
      }
      vid.onerror = () => resolve(null)
      vid.src = videoData.startsWith('data:') ? videoData : `data:video/mp4;base64,${videoData}`
      setTimeout(() => resolve(null), 3000) // 3초 타임아웃
    })
  }

  // 비디오 메타데이터 로드 → duration 감지 및 저장 (썸네일 onLoadedMetadata 백업용)
  const handleVideoMetadata = (e, type) => {
    const videoDuration = Math.round(e.target.duration * 10) / 10
    if (!videoDuration || videoDuration <= 0) return

    const durationField = type === 't2v' ? 'videoT2VDuration' : 'videoI2VDuration'

    // 이미 저장된 경우 스킵
    if (scene[durationField] === videoDuration) return

    const updates = { [durationField]: videoDuration }

    // imageDuration 아직 없으면 현재 duration을 이미지 기본 duration으로 저장
    if (!scene.imageDuration) {
      updates.imageDuration = scene.duration
    }

    // 현재 활성 미디어가 이 비디오면 duration도 같이 업데이트
    if (activeMedia === type) {
      updates.duration = videoDuration
      updates.endTime = scene.startTime + videoDuration
    }

    onUpdate(scene.id, updates)
  }

  // Export 미디어 전환 + duration 자동 조정
  const switchExportMedia = async (type) => {
    const updates = { exportMedia: type }

    if (type === 'image') {
      // 이미지 선택 → imageDuration으로 복원 (없으면 현재 유지)
      const imgDur = scene.imageDuration || scene.duration
      updates.duration = imgDur
      updates.endTime = scene.startTime + imgDur
    } else {
      // 비디오 선택 (t2v / i2v)
      const videoData = type === 't2v' ? scene.videoT2V : scene.videoI2V
      const durationField = type === 't2v' ? 'videoT2VDuration' : 'videoI2VDuration'

      // 캐시된 duration 사용, 없으면 즉시 감지
      let videoDur = scene[durationField]
      if (!videoDur && videoData) {
        videoDur = await detectVideoDuration(videoData)
        if (videoDur) updates[durationField] = videoDur
      }

      if (videoDur) {
        if (!scene.imageDuration) {
          updates.imageDuration = scene.duration
        }
        updates.duration = videoDur
        updates.endTime = scene.startTime + videoDur
      }
    }

    onUpdate(scene.id, updates)
  }

  return (
    <tr ref={rowRef} className={`scene-row status-${scene.status}`}>
      <td className="col-id">
        {index + 1}
      </td>

      <td className="col-time">
        <span className="time-display">
          {formatTime(scene.startTime)} ~ {formatTime(scene.endTime)}
        </span>
        <input
          type="number"
          className="duration-input"
          value={scene.duration}
          onChange={(e) => {
            const duration = parseFloat(e.target.value) || 3
            const updates = {
              duration,
              endTime: scene.startTime + duration
            }
            // 이미지 모드에서 수동 변경 → imageDuration도 업데이트
            if (activeMedia === 'image') {
              updates.imageDuration = duration
            }
            onUpdate(scene.id, updates)
          }}
          min={UI.DURATION_MIN}
          max={UI.DURATION_MAX}
          step={UI.DURATION_STEP}
          disabled={disabled}
          title={t('sceneList.durationTitle')}
        />
      </td>

      {/* 자막 컬럼 (프롬프트 제거, 자막만 표시) */}
      <td className="col-subtitle">
        <textarea
          value={scene.subtitle || ''}
          onChange={(e) => onUpdate(scene.id, { subtitle: e.target.value })}
          disabled={disabled}
          rows={2}
          placeholder={t('sceneList.subtitlePlaceholder')}
        />
      </td>

      <td className="col-tags">
        <div className="tag-input-wrapper">
          <input
            type="text"
            placeholder={t('sceneList.character')}
            value={scene.characters || ''}
            onChange={(e) => onUpdate(scene.id, { characters: e.target.value })}
            disabled={disabled}
            title={t('sceneList.characterTitle')}
            className={charMatch ? (charMatch.allMatched ? 'matched' : 'unmatched') : ''}
          />
          <MatchIndicator match={charMatch} tagType="character" />
        </div>
        <div className="tag-input-wrapper">
          <input
            type="text"
            placeholder={t('sceneList.background')}
            value={scene.scene_tag || ''}
            onChange={(e) => onUpdate(scene.id, { scene_tag: e.target.value })}
            disabled={disabled}
            title={t('sceneList.backgroundTitle')}
            className={sceneMatch ? (sceneMatch.allMatched ? 'matched' : 'unmatched') : ''}
          />
          <MatchIndicator match={sceneMatch} tagType="scene" />
        </div>
        <div className="tag-input-wrapper">
          <input
            type="text"
            placeholder={t('sceneList.style')}
            value={scene.style_tag || ''}
            onChange={(e) => onUpdate(scene.id, { style_tag: e.target.value })}
            disabled={disabled}
            title={t('sceneList.styleTitle')}
            className={styleMatch ? (styleMatch.allMatched ? 'matched' : 'unmatched') : ''}
          />
          <MatchIndicator match={styleMatch} tagType="style" />
        </div>
      </td>

      {/* 미디어 컬럼 (이미지 + T2V + I2V 모두 표시, 선택 가능) */}
      <td className="col-media">
        <div className="media-selector">
          {/* 이미지 */}
          {hasImage && (
            <div
              className={`media-thumb ${isSelected('image')} clickable`}
              onClick={(e) => {
                e.stopPropagation()
                if (mediaCount > 1) {
                  switchExportMedia('image')
                } else {
                  onShowDetail(scene)
                }
              }}
              onDoubleClick={() => onShowDetail(scene)}
              title={`IMG${activeMedia === 'image' ? ' ✓' : ''}`}
            >
              <img
                src={imgSrc}
                alt={`Scene ${index + 1}`}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHoverPreview({ src: imgSrc, x: rect.right + 8, y: rect.top })
                }}
                onMouseLeave={() => setHoverPreview(null)}
              />
              {mediaCount > 1 && <span className="media-label">IMG</span>}
            </div>
          )}
          {/* T2V 비디오 */}
          {scene.videoT2V && (
            <div
              className={`media-thumb ${isSelected('t2v')} clickable`}
              onClick={(e) => {
                e.stopPropagation()
                if (mediaCount > 1) {
                  switchExportMedia('t2v')
                } else {
                  onShowVideoDetail({
                    id: `t2v_${scene.id.replace('scene_', '')}`,
                    prompt: scene.prompt,
                    video: scene.videoT2V,
                    videoPath: scene.videoT2VPath,
                    status: 'complete',
                  })
                }
              }}
              onDoubleClick={() => onShowVideoDetail({
                id: `t2v_${scene.id.replace('scene_', '')}`,
                prompt: scene.prompt,
                video: scene.videoT2V,
                videoPath: scene.videoT2VPath,
                status: 'complete',
              })}
              title={`T2V${activeMedia === 't2v' ? ' ✓' : ''} — ${t('sceneList.dblClickToView') || 'Double-click to view'}`}
            >
              <video src={toVideoSrc(scene.videoT2V)} muted preload="metadata" onLoadedMetadata={(e) => handleVideoMetadata(e, 't2v')} />
              <div className="play-button-overlay mini">▶</div>
              {mediaCount > 1 && <span className="media-label">T2V</span>}
            </div>
          )}
          {/* I2V 비디오 */}
          {scene.videoI2V && (
            <div
              className={`media-thumb ${isSelected('i2v')} clickable`}
              onClick={(e) => {
                e.stopPropagation()
                if (mediaCount > 1) {
                  switchExportMedia('i2v')
                } else {
                  onShowVideoDetail({
                    id: `i2v_${scene.id.replace('scene_', '')}`,
                    prompt: scene.prompt,
                    video: scene.videoI2V,
                    videoPath: scene.videoI2VPath,
                    status: 'complete',
                  })
                }
              }}
              onDoubleClick={() => onShowVideoDetail({
                id: `i2v_${scene.id.replace('scene_', '')}`,
                prompt: scene.prompt,
                video: scene.videoI2V,
                videoPath: scene.videoI2VPath,
                status: 'complete',
              })}
              title={`I2V${activeMedia === 'i2v' ? ' ✓' : ''} — ${t('sceneList.dblClickToView') || 'Double-click to view'}`}
            >
              <video src={toVideoSrc(scene.videoI2V)} muted preload="metadata" onLoadedMetadata={(e) => handleVideoMetadata(e, 'i2v')} />
              <div className="play-button-overlay mini">▶</div>
              {mediaCount > 1 && <span className="media-label">I2V</span>}
            </div>
          )}
          {/* 미디어 없음 → 상태 아이콘 */}
          {mediaCount === 0 && (
            <div
              className={`image-cell ${ratioClass} clickable`}
              onClick={() => onShowDetail(scene)}
              title={t('headerExtra.clickToDetail')}
            >
              {scene.status === 'generating' ? (
                <InfinityLoader size={36} />
              ) : (
                <span className="status-icon">{statusIcon}</span>
              )}
            </div>
          )}
        </div>
      </td>

      <td className="col-actions">
        <button
          className="btn-delete"
          onClick={() => onDelete(scene.id)}
          disabled={disabled || scene.status === 'generating'}
          title={t('common.delete')}
        >
          ✕
        </button>
      </td>

      {/* 호버 풍선 프리뷰 */}
      {hoverPreview && createPortal(
        <div
          className="ref-hover-balloon"
          style={{
            left: Math.min(hoverPreview.x, window.innerWidth - 420),
            top: Math.max(0, Math.min(hoverPreview.y, window.innerHeight - 400))
          }}
        >
          <img src={hoverPreview.src} alt="preview" />
        </div>,
        document.body
      )}
    </tr>
  )
}

export default function SceneList({
  scenes,
  onUpdate,
  onDelete,
  onAdd,
  onClearAll,
  defaultDuration,
  disabled,
  aspectRatio = '16:9',
  projectName,
  onGenerate,
  generatingSceneId,
  references = []
}) {
  const { t } = useI18n()
  const [detailModal, setDetailModal] = useState({ open: false, scene: null })
  const [videoDetailModal, setVideoDetailModal] = useState({ open: false, video: null })
  // tagBatchModal: null | { type: 'character'|'scene'|'style', sceneIndex?: number }
  const [tagBatchModal, setTagBatchModal] = useState(null)

  // 태그 적용 (single / batch 공통)
  const handleTagBatchApply = (field, value, startIdx, endIdx) => {
    for (let i = startIdx; i <= endIdx; i++) {
      if (scenes[i]) {
        onUpdate(scenes[i].id, { [field]: value })
      }
    }
    setTagBatchModal(null)
  }

  // 캐릭터/씬: 개별(single), 스타일: 일괄(batch)
  const openTag = (type, sceneIndex) => {
    if (type === 'style') {
      setTagBatchModal({ type }) // batch 모드 (범위 지정)
    } else {
      setTagBatchModal({ type, sceneIndex }) // single 모드
    }
  }

  // 이미지 상세 모달 열기
  const handleShowDetail = (scene) => {
    setDetailModal({ open: true, scene })
  }

  // 비디오 상세 모달 열기
  const handleShowVideoDetail = (videoData) => {
    setVideoDetailModal({ open: true, video: videoData })
  }

  // 모달에서 업데이트
  const handleUpdateFromModal = (sceneId, data) => {
    onUpdate(sceneId, data)
    // 모달의 scene도 업데이트
    setDetailModal(prev => ({
      ...prev,
      scene: prev.scene ? { ...prev.scene, ...data } : null
    }))
  }

  if (scenes.length === 0) {
    return (
      <div className="scene-list-empty">
        <p>{t('sceneList.empty')}</p>
        <p>{t('sceneList.emptyHint')}</p>
      </div>
    )
  }

  const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0)

  const ratioClass = getRatioClass(aspectRatio)

  // 현재 선택된 씬의 최신 상태 가져오기
  const currentScene = detailModal.scene
    ? scenes.find(s => s.id === detailModal.scene.id) || detailModal.scene
    : null

  const handleClearAll = () => {
    if (window.confirm(t('sceneList.clearConfirm'))) {
      onClearAll?.()
    }
  }

  return (
    <div className="scene-list-container">
      <div className="scene-list-header">
        <span>{t('sceneList.total', { count: scenes.length, duration: formatTime(totalDuration) })}</span>
        <div className="scene-list-actions">
          <button
            className="btn-clear-all"
            onClick={handleClearAll}
            disabled={disabled || scenes.length === 0}
            title={t('sceneList.clearAll')}
          >
            🗑️ {t('sceneList.clearAll')}
          </button>
          <button
            className="btn-add-scene"
            onClick={() => onAdd(null, defaultDuration)}
            disabled={disabled}
          >
            {t('sceneList.addScene')}
          </button>
        </div>
      </div>

      <div className="scene-table-wrapper">
        <table className="scene-table">
          <thead>
            <tr>
              <th className="col-id">#</th>
              <th className="col-time">{t('sceneList.time')}</th>
              <th className="col-subtitle">{t('sceneList.subtitle')}</th>
              <th className="col-tags">
                {t('sceneList.tags')}
                {references.some(r => r.type === 'style') && (
                  <button
                    className="btn-style-tag-batch"
                    onClick={() => setTagBatchModal({ type: 'style' })}
                    title={t('sceneList.batchStyleTag')}
                    disabled={disabled}
                  >🎨</button>
                )}
              </th>
              <th className="col-media">{t('sceneList.media')}</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {scenes.map((scene, index) => (
              <SceneRow
                key={scene.id}
                scene={scene}
                index={index}
                onUpdate={onUpdate}
                onDelete={onDelete}
                disabled={disabled}
                ratioClass={ratioClass}
                t={t}
                onShowDetail={handleShowDetail}
                onShowVideoDetail={handleShowVideoDetail}
                references={references}
                onOpenTag={openTag}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* 태그 매칭 범례 - 레퍼런스가 있을 때만 표시 */}
      {references.length > 0 && (
        <div className="tag-match-legend">
          <span className="legend-label">{t('sceneList.tagLegend')}</span>
          <span className="legend-item">
            <span className="tag-match-indicator matched">✓</span>
            {t('sceneList.tagMatched')}
          </span>
          <span className="legend-item">
            <span className="tag-match-indicator unmatched">✗</span>
            {t('sceneList.tagUnmatched')}
          </span>
        </div>
      )}

      {/* 씬 상세 모달 (이미지) */}
      {detailModal.open && currentScene && (
        <SceneDetailModal
          scene={currentScene}
          onUpdate={handleUpdateFromModal}
          onClose={() => setDetailModal({ open: false, scene: null })}
          onGenerate={onGenerate}
          isGenerating={generatingSceneId === currentScene.id}
          t={t}
          projectName={projectName}
          aspectRatio={aspectRatio}
        />
      )}

      {/* 비디오 상세 모달 */}
      {videoDetailModal.open && videoDetailModal.video && (
        <VideoDetailModal
          video={videoDetailModal.video}
          onClose={() => setVideoDetailModal({ open: false, video: null })}
          t={t}
          projectName={projectName}
        />
      )}

      {/* 태그 선택/일괄 적용 모달 */}
      {tagBatchModal && (
        <TagBatchModal
          tagType={tagBatchModal.type}
          mode={tagBatchModal.sceneIndex != null ? 'single' : 'batch'}
          sceneIndex={tagBatchModal.sceneIndex}
          scenes={scenes}
          references={references}
          onApply={handleTagBatchApply}
          onClose={() => setTagBatchModal(null)}
          t={t}
        />
      )}
    </div>
  )
}
