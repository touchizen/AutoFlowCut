/**
 * SceneList Component - 목록 탭 (시간 + 자막 + 미디어 선택 + 히스토리)
 */

import { useState, useRef, useEffect } from 'react'
import { useI18n } from '../hooks/useI18n'
import { formatTime, getRatioClass, resolveImageSrc, hasImageData } from '../utils/formatters'
import { checkTagMatch } from '../utils/tagMatch'
import { resolveExportVideos, hasExportableMedia, buildVideoRestorePatch, buildFramePairVideoPatch } from '../utils/sceneMedia'
import { resolveVideoSrc } from '../utils/videoSrc'
import { getSceneSubtitle, getSceneDuration } from '../utils/srtTrack'
import { UI, STYLE_PRESETS } from '../config/defaults'
import SceneDetailModal from './SceneDetailModal'
import VideoDetailModal from './VideoDetailModal'
import TagBatchModal from './TagBatchModal'
import LazyImage from './LazyImage'
import TagInputAutocomplete from './TagInputAutocomplete'
import InfinityLoader from './InfinityLoader'
import HoverImageBalloon from './HoverImageBalloon'
import './SceneList.css'

function SceneRow({ scene, index, onUpdate, onDelete, disabled, ratioClass, t, onShowDetail, onShowVideoDetail, references, onOpenTag, styleThumbnails = {}, framePairs = [], srtTrack = [], onUpdateSrtLine = null }) {
  const rowRef = useRef(null)
  const [hoverPreview, setHoverPreview] = useState(null)
  // R26 review fix: 비디오 mount 를 hover 시점으로 미룸. duration 캐시 유무와 무관
  // 하게 첫 로드 VRAM burst 차단 ('t2v' | 'i2v' | null).
  const [hoveredVideo, setHoveredVideo] = useState(null)

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

  const hasImage = hasImageData(scene)
  const imgSrc = resolveImageSrc(scene)
  const mediaCount = [hasImage, scene.videoT2V || scene.videoT2VPath, scene.videoI2V || scene.videoI2VPath].filter(Boolean).length // 라벨 표시 여부

  // B1: export 는 "있는 영상 다" 내보냄(어느 take 쓸지는 CapCut 에서 큐레이션).
  // 이미지는 항상 베이스 트랙으로 나감. → Media 컬럼은 "export 에 포함됨"을 ✓/selected 로
  // 보여주는 표시 전용이고, 클릭은 미리보기만(아래 onClick) — export 선택을 바꾸지 않는다.
  // ⚠️ exporter contract: 이미지 없는 씬은 hasExportableMedia=false → useExport 가 통째로
  // drop. 그러므로 export 불가 씬은 영상이 있어도 ✓ 표시 안 함(거짓 ✓ 방지).
  const sceneExportable = hasExportableMedia(scene)
  const exportedSources = new Set(resolveExportVideos(scene).map(v => v.source))
  const imageOnly = exportedSources.size === 0 // 영상 없이 이미지만 (duration 핸들러용)
  const isIncluded = (type) => sceneExportable && (type === 'image' ? hasImage : exportedSources.has(type))
  const isSelected = (type) => isIncluded(type) ? 'selected' : ''
  const exportMark = (type) => isIncluded(type) ? ' ✓' : ''

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

  // 비디오 src 생성 헬퍼 — 공용 utils/videoSrc 로 통합 (cache busting/Windows 경로/data URL 일관 처리)
  const toVideoSrc = (data, filePath, version) => resolveVideoSrc(data, filePath, { version }) || ''

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

    // 비디오 duration은 캐시만 하고, 씬 duration은 CSV 기준 유지
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
          value={Math.round(scene.duration * 100) / 100}
          onChange={(e) => {
            const duration = parseFloat(e.target.value) || 3
            const updates = {
              duration,
              endTime: scene.startTime + duration
            }
            // 이미지 모드(영상 export 없음)에서 수동 변경 → imageDuration도 업데이트
            if (imageOnly) {
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

      {/* 자막 컬럼 — srtLineIds 있으면 srtTrack 에서 묶음 자막 표시 (Phase 6).
          R3 review fix: 단일 srtLine 은 그 라인 inline 편집, 묶음은 read-only.
          legacy (srtLineIds 없음) 는 기존대로 scene.subtitle 편집. */}
      <td className="col-subtitle">
        {(() => {
          const lineIds = scene.srtLineIds || []
          const hasLineIds = lineIds.length > 0 && srtTrack.length > 0
          const isBundled = lineIds.length > 1
          const value = hasLineIds
            ? getSceneSubtitle(scene, srtTrack)
            : (scene.subtitle || '')
          return (
            <textarea
              value={value}
              onChange={(e) => {
                if (isBundled) return // read-only for bundled scenes
                if (hasLineIds && onUpdateSrtLine) {
                  onUpdateSrtLine(lineIds[0], e.target.value)
                } else {
                  onUpdate(scene.id, { subtitle: e.target.value })
                }
              }}
              readOnly={isBundled}
              title={isBundled ? t('sceneList.bundledSubtitleReadonly') : undefined}
              disabled={disabled}
              rows={2}
              placeholder={t('sceneList.subtitlePlaceholder')}
            />
          )
        })()}
      </td>

      <td className="col-tags">
        <div className="tag-input-wrapper">
          <TagInputAutocomplete
            type="character"
            value={scene.characters || ''}
            onChange={(v) => onUpdate(scene.id, { characters: v })}
            references={references}
            placeholder={t('sceneList.character')}
            disabled={disabled}
            title={t('sceneList.characterTitle')}
            className={charMatch ? (charMatch.allMatched ? 'matched' : 'unmatched') : ''}
            isKo={t('common.cancel') === '취소'}
            t={t}
          />
          <MatchIndicator match={charMatch} tagType="character" />
        </div>
        <div className="tag-input-wrapper">
          <TagInputAutocomplete
            type="scene"
            value={scene.scene_tag || ''}
            onChange={(v) => onUpdate(scene.id, { scene_tag: v })}
            references={references}
            placeholder={t('sceneList.background')}
            disabled={disabled}
            title={t('sceneList.backgroundTitle')}
            className={sceneMatch ? (sceneMatch.allMatched ? 'matched' : 'unmatched') : ''}
            isKo={t('common.cancel') === '취소'}
            t={t}
          />
          <MatchIndicator match={sceneMatch} tagType="scene" />
        </div>
        <div className="tag-input-wrapper">
          <TagInputAutocomplete
            type="style"
            value={scene.style_tag || ''}
            onChange={(v) => onUpdate(scene.id, { style_tag: v })}
            references={references}
            presets={STYLE_PRESETS?.styles || []}
            thumbnails={styleThumbnails}
            placeholder={t('sceneList.style')}
            disabled={disabled}
            title={t('sceneList.styleTitle')}
            className={styleMatch ? (styleMatch.allMatched ? 'matched' : 'unmatched') : ''}
            isKo={t('common.cancel') === '취소'}
            t={t}
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
                onShowDetail(scene)
              }}
              onDoubleClick={() => onShowDetail(scene)}
              title={`IMG${exportMark('image')}`}
            >
              {/* R37 fix: LazyImage — 뷰포트 이탈 시 img 언마운트해 VRAM 회수 */}
              <LazyImage
                src={imgSrc}
                alt={`Scene ${index + 1}`}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHoverPreview({
                    src: imgSrc,
                    rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
                  })
                }}
                onMouseLeave={() => setHoverPreview(null)}
              />
              {mediaCount > 1 && <span className="media-label">IMG</span>}
            </div>
          )}
          {/* T2V 비디오 */}
          {(scene.videoT2V || scene.videoT2VPath) && (
            <div
              className={`media-thumb ${isSelected('t2v')} clickable`}
              onMouseEnter={() => setHoveredVideo('t2v')}
              onMouseLeave={() => setHoveredVideo(null)}
              onClick={(e) => {
                e.stopPropagation()
                onShowVideoDetail({
                  id: `t2v_${scene.id.replace('scene_', '')}`,
                  prompt: scene.videoT2VPrompt || '', // 이미지 프롬프트 아님 — T2V 전용 프롬프트로 seed
                  video: scene.videoT2V,
                  videoPath: scene.videoT2VPath,
                  status: 'complete',
                  sceneId: scene.id, source: 't2v', // 저장(history 복원) 시 disabled 리셋용
                })
              }}
              onDoubleClick={() => onShowVideoDetail({
                id: `t2v_${scene.id.replace('scene_', '')}`,
                prompt: scene.videoT2VPrompt || '',
                video: scene.videoT2V,
                videoPath: scene.videoT2VPath,
                status: 'complete',
                sceneId: scene.id, source: 't2v',
              })}
              title={`T2V${exportMark('t2v')} — ${t('sceneList.dblClickToView') || 'Double-click to view'}`}
            >
              {/* R26 review fix: hover 시점에만 <video> mount. duration 추출도 hover
                  순간 onLoadedMetadata 로. 첫 로드 VRAM burst 없음. */}
              {hoveredVideo === 't2v' ? (
                <video src={toVideoSrc(scene.videoT2V, scene.videoT2VPath, scene.videoT2VGeneratedAt)} muted preload="metadata" onLoadedMetadata={(e) => handleVideoMetadata(e, 't2v')} />
              ) : (
                imgSrc ? <LazyImage src={imgSrc} alt="T2V poster" /> : <div className="video-placeholder" />
              )}
              <div className="play-button-overlay mini">▶</div>
              {mediaCount > 1 && <span className="media-label">T2V</span>}
            </div>
          )}
          {/* I2V 비디오 */}
          {(scene.videoI2V || scene.videoI2VPath) && (() => {
            // ownerSceneId 로 owning framePair 를 해석한다.
            // 과거 `i2v_${scene.id.replace('scene_', '')}` (= i2v_3) 패턴은 fp.id 가 scene
            // 번호와 1:1 매칭일 때만 우연히 동작 — stable ID + 삭제 갭이 생기면 깨진다.
            // owning fp 가 있으면 그 fp.id 로 i2v_N 을 만들고, 없으면 scene.id 폴백.
            const ownerFp = framePairs.find(fp => fp.ownerSceneId === scene.id)
            const i2vId = ownerFp?.id
              ? `i2v_${ownerFp.id.replace('fp_', '')}`
              : `i2v_${scene.id.replace('scene_', '')}`
            return (
            <div
              className={`media-thumb ${isSelected('i2v')} clickable`}
              onMouseEnter={() => setHoveredVideo('i2v')}
              onMouseLeave={() => setHoveredVideo(null)}
              onClick={(e) => {
                e.stopPropagation()
                onShowVideoDetail({
                  id: i2vId,
                  prompt: scene.videoI2VPrompt ?? ownerFp?.prompt ?? '', // 이미지 프롬프트 아님 — I2V 전용 → owning framePair 순으로 seed
                  video: scene.videoI2V,
                  videoPath: scene.videoI2VPath,
                  status: 'complete',
                  sceneId: scene.id, source: 'i2v', fpId: ownerFp?.id, // 저장(복원) 시 disabled 리셋 + framePair 메타 갱신용
                })
              }}
              onDoubleClick={() => onShowVideoDetail({
                id: i2vId,
                prompt: scene.videoI2VPrompt ?? ownerFp?.prompt ?? '',
                video: scene.videoI2V,
                videoPath: scene.videoI2VPath,
                status: 'complete',
                sceneId: scene.id, source: 'i2v', fpId: ownerFp?.id,
              })}
              title={`I2V${exportMark('i2v')} — ${t('sceneList.dblClickToView') || 'Double-click to view'}`}
            >
              {/* R26 review fix: hover 시점에만 <video> mount (T2V 와 동일) */}
              {hoveredVideo === 'i2v' ? (
                <video src={toVideoSrc(scene.videoI2V, scene.videoI2VPath, scene.videoI2VGeneratedAt)} muted preload="metadata" onLoadedMetadata={(e) => handleVideoMetadata(e, 'i2v')} />
              ) : (
                imgSrc ? <LazyImage src={imgSrc} alt="I2V poster" /> : <div className="video-placeholder" />
              )}
              <div className="play-button-overlay mini">▶</div>
              {mediaCount > 1 && <span className="media-label">I2V</span>}
            </div>
            )
          })()}
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
          onClick={() => onDelete(scene.id, index)}
          disabled={disabled || scene.status === 'generating'}
          title={t('common.delete')}
        >
          ✕
        </button>
      </td>

      {/* 호버 풍선 프리뷰 */}
      {hoverPreview && (
        <HoverImageBalloon
          anchorRect={hoverPreview.rect}
          src={hoverPreview.src}
          className="ref-hover-balloon"
        />
      )}
    </tr>
  )
}

export default function SceneList({
  scenes,
  srtTrack = [],
  framePairs = [],
  onUpdate,
  onUpdateFramePair = null,
  onUpdateSrtLine = null,
  onDelete,
  onAdd,
  onClearAll,
  defaultDuration,
  disabled,
  aspectRatio = '16:9',
  projectName,
  onGenerate,
  generatingSceneId,
  references = [],
  styleThumbnails = {}
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

  const totalDuration = scenes.reduce((sum, s) => sum + (parseFloat(s.duration) || 0), 0)

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
                {references.some(r => r.type === 'character') && (
                  <button
                    className="btn-tag-batch"
                    onClick={() => setTagBatchModal({ type: 'character' })}
                    title={t('sceneList.batchCharacterTag')}
                    aria-label={t('sceneList.batchCharacterTag')}
                    disabled={disabled}
                  >👤</button>
                )}
                {references.some(r => r.type === 'scene') && (
                  <button
                    className="btn-tag-batch"
                    onClick={() => setTagBatchModal({ type: 'scene' })}
                    title={t('sceneList.batchSceneTag')}
                    aria-label={t('sceneList.batchSceneTag')}
                    disabled={disabled}
                  >🏞️</button>
                )}
                {references.some(r => r.type === 'style') && (
                  <button
                    className="btn-tag-batch"
                    onClick={() => setTagBatchModal({ type: 'style' })}
                    title={t('sceneList.batchStyleTag')}
                    aria-label={t('sceneList.batchStyleTag')}
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
                onUpdateSrtLine={onUpdateSrtLine}
                onDelete={onDelete}
                disabled={disabled}
                ratioClass={ratioClass}
                framePairs={framePairs}
                t={t}
                onShowDetail={handleShowDetail}
                onShowVideoDetail={handleShowVideoDetail}
                references={references}
                onOpenTag={openTag}
                styleThumbnails={styleThumbnails}
                srtTrack={srtTrack}
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
          references={references}
          styleThumbnails={styleThumbnails}
        />
      )}

      {/* 비디오 상세 모달 */}
      {videoDetailModal.open && videoDetailModal.video && (
        <VideoDetailModal
          video={videoDetailModal.video}
          onClose={() => setVideoDetailModal({ open: false, video: null })}
          t={t}
          projectName={projectName}
          references={references}
          onPromptSave={(_videoId, prompt) => {
            // 프롬프트 편집 저장 — 모달에 실어둔 sceneId/source 로 canonical prompt 필드 갱신.
            const v = videoDetailModal.video
            if (!v?.sceneId || typeof onUpdate !== 'function') return
            const field = v.source === 'i2v' ? 'videoI2VPrompt' : 'videoT2VPrompt'
            onUpdate(v.sceneId, { [field]: prompt })
            if (v.source === 'i2v' && v.fpId && typeof onUpdateFramePair === 'function') {
              onUpdateFramePair(v.fpId, { prompt })
            }
          }}
          onUpdate={(_videoId, patch) => {
            // history 복원 저장 → 해당 씬의 video* 갱신 + per-clip disabled 리셋(새 영상=enabled).
            // 모달 open 시 실어둔 sceneId/source 로 바로 타겟(App id 라우팅 중복 회피).
            // 메타는 buildVideoRestorePatch 가 source-specific(videoT2V*/videoI2V*)로 매핑 →
            // scene 의 이미지 메타(seed/generatedAt/model) 오염 방지 + 캐시버스터 갱신.
            const v = videoDetailModal.video
            if (!v?.sceneId || typeof onUpdate !== 'function') return
            onUpdate(v.sceneId, buildVideoRestorePatch(v.source, patch))
            // I2V 의 권위 source 는 framePair. (1) reload 시 mediaSync 가 framePair.generatedAt 으로
            // scene.videoI2VGeneratedAt 을 다시 덮으므로 영속을 위해, (2) F→V 결과표/fp 상세는 framePair
            // base64 를 우선 렌더하므로 현재 세션 일관성을 위해 — video/base64/videoPath + 메타까지 갱신.
            // (App fp_ 복원 경로와 동일 shape)
            if (v.source === 'i2v' && v.fpId && typeof onUpdateFramePair === 'function') {
              onUpdateFramePair(v.fpId, buildFramePairVideoPatch(patch))
            }
          }}
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
          styleThumbnails={styleThumbnails}
          t={t}
        />
      )}
    </div>
  )
}
