/**
 * SceneDetailModal - 씬 상세 모달 (레퍼런스 상세와 유사한 구조)
 */

import { useState, useEffect } from 'react'
import { fileSystemAPI } from '../hooks/useFileSystem'
import { formatTime, getRatioClass, resolveImageSrc, hasImageData } from '../utils/formatters'
import { STYLE_PRESETS, UI, RESOURCE } from '../config/defaults'
import { toast } from './Toast'
import { useI18n } from '../hooks/useI18n'
import Modal from './Modal'
import ErrorSection from './ErrorSection'
import MediaMetaBar from './MediaMetaBar'
import { fetchLatestHistoryMeta } from '../utils/mediaMeta'
import TagInputAutocomplete from './TagInputAutocomplete'
import './SceneDetailModal.css'

export default function SceneDetailModal({
  scene,
  onUpdate,
  onClose,
  onGenerate,
  isGenerating,
  t,
  projectName,
  aspectRatio = '9:16',
  references = [],
  styleThumbnails = {}
}) {
  const [editData, setEditData] = useState({ ...scene })
  const [histories, setHistories] = useState([])
  const [shouldReloadHistory, setShouldReloadHistory] = useState(0)
  const [imageSize, setImageSize] = useState(null)
  // 신규 생성은 scene.seed/generatedAt 으로 들어오지만, 구버전은 비어있음 → history 메타에서 backfill
  const [backfilledMeta, setBackfilledMeta] = useState({ seed: null, generatedAt: null, model: null })
  // 사용자가 history 를 복원했을 때의 메타 (null = 복원 안 함, 객체 = 복원함 + 그 항목의 메타).
  // 복원했지만 메타가 비어 있으면 명시적 null 을 그대로 노출 — backfilledMeta 로 fallback 하면
  // 이전 history 의 stale 메타가 다시 보이고 저장값(null)과 어긋난다.
  const [restoredMeta, setRestoredMeta] = useState(null)
  const { lang } = useI18n()
  const isKo = lang === 'ko'

  // scene prop이 변경되면 editData 업데이트 (재생성 완료 시).
  // image/imagePath/status 외에 메타 필드(seed, generatedAt, model, image_size, mediaId)도
  // 같이 동기화 — 빠뜨리면 부모는 새 메타로 갱신됐는데 모달은 이전 seed/model 표시,
  // 사용자가 저장 시 stale editData 가 새 메타를 덮어쓰는 회귀 발생.
  useEffect(() => {
    setEditData(prev => ({
      ...prev,
      image: scene.image,
      imagePath: scene.imagePath,
      status: scene.status,
      seed: scene.seed,
      generatedAt: scene.generatedAt,
      model: scene.model,
      image_size: scene.image_size,
      mediaId: scene.mediaId,
    }))
    // 부모 prop 갱신 = scene 권위 — 로컬 복원 메타 리셋
    setRestoredMeta(null)
    // 히스토리 재로드 트리거
    setShouldReloadHistory(n => n + 1)
  }, [scene.image, scene.imagePath, scene.status, scene.seed, scene.generatedAt, scene.model, scene.image_size, scene.mediaId])
  
  // 히스토리 로드 — metadata(seed/timestamp/model)도 함께 보존하여 복원 시 활용.
  const loadHistory = async () => {
    if (!projectName || !scene.id) return

    const result = await fileSystemAPI.getHistory(projectName, RESOURCE.SCENES, scene.id)
    if (result.success && result.histories?.length > 0) {
      const historiesWithData = await Promise.all(
        result.histories.map(async (hist) => {
          const fileResult = await fileSystemAPI.readHistoryFile(projectName, RESOURCE.SCENES, hist.filename)
          return {
            ...hist,
            data: fileResult.success ? fileResult.data : null,
            metadata: fileResult.metadata || null,
          }
        })
      )
      setHistories(historiesWithData.filter(h => h.data))
    } else {
      setHistories([])
    }
  }
  
  useEffect(() => {
    loadHistory()
  }, [projectName, scene.id, shouldReloadHistory])

  // scene state 에 seed/generatedAt 가 없으면 history metadata 에서 backfill (구버전 호환)
  useEffect(() => {
    let cancelled = false
    const need = (scene.seed == null) || (scene.generatedAt == null) || (scene.model == null)
    if (!need || !projectName || !scene.id) {
      setBackfilledMeta({ seed: null, generatedAt: null, model: null })
      return
    }
    fetchLatestHistoryMeta(projectName, RESOURCE.SCENES, scene.id).then(meta => {
      if (cancelled) return
      setBackfilledMeta({
        seed: meta.seed ?? null,
        generatedAt: meta.generatedAt ?? null,
        model: meta.model ?? null
      })
    })
    return () => { cancelled = true }
  }, [projectName, scene.id, scene.seed, scene.generatedAt, scene.model])

  // 히스토리 이미지 선택 — 디스크의 씬 파일을 히스토리 파일로 덮어쓰고 imagePath를 세팅.
  // imagePath를 null로 두면 export 시 base64 fallback 브랜치를 타서 CapCut에
  // "media/image_scene_N.jpg" placeholder 경로가 박히고 → Media Not Found 발생.
  const handleRestoreHistory = async (historyItem) => {
    if (!projectName || !scene.id) {
      toast.error(t('imageHistory.restoreFailed') || 'Restore failed')
      return
    }
    try {
      const histExt = historyItem.filename?.match(/\.(png|jpg|jpeg|webp|gif)$/i)?.[1]?.toLowerCase() || 'png'
      const currentFilename = `${scene.id}.${histExt}`

      const result = await fileSystemAPI.restoreFromHistory(
        projectName,
        RESOURCE.SCENES,
        currentFilename,
        historyItem.filename
      )

      if (!result.success) {
        toast.error(t('imageHistory.restoreFailed') || result.error || 'Restore failed')
        return
      }

      // 복원한 history 항목의 메타(seed/timestamp/model)도 editData 에 반영.
      // 빠뜨리면 모달 표시 + 저장 시 project.json 에 직전 생성의 stale 메타가 남는다.
      const meta = historyItem.metadata || {}
      const restoredSeed = meta.seed ?? null
      const restoredAt = typeof meta.timestamp === 'number' ? meta.timestamp : null
      const restoredModel = meta.model ?? null
      setEditData(prev => ({
        ...prev,
        image: historyItem.data,
        imagePath: result.path || prev.imagePath,
        status: 'done',
        seed: restoredSeed,
        generatedAt: restoredAt,
        model: restoredModel,
        ...(meta.mediaId ? { mediaId: meta.mediaId } : {}),
      }))
      // restoredMeta 가 set 됐다는 건 "사용자가 history 복원했음" — 렌더 시 backfill 폴백 차단.
      // null 도 명시적 의도 (해당 history 에 메타 없음) → MediaMetaBar 에 그대로 노출.
      setRestoredMeta({
        seed: restoredSeed,
        generatedAt: restoredAt,
        model: restoredModel,
      })
    } catch (err) {
      console.error('[SceneDetail] Restore history failed:', err)
      toast.error(err.message)
    }
  }
  
  // 저장
  const handleSave = () => {
    onUpdate(scene.id, editData)
    onClose()
  }
  
  // 재생성
  const handleRegenerate = () => {
    console.log('[SceneDetail] Regenerate clicked')
    if (onGenerate) {
      onGenerate(scene.id)
    }
  }
  
  const ratioClass = getRatioClass(aspectRatio)

  // 클립보드에 복사
  const handleCopy = async (text, fieldName) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${fieldName} ${t('common.copied')}`)
    } catch (err) {
      console.error('Copy failed:', err)
      toast.error(t('common.copyFailed'))
    }
  }
  
  const footer = (
    <>
      <button className="btn-secondary" onClick={onClose}>{t('sceneDetail.cancel')}</button>
      {onGenerate && (
        <button
          className="btn-warning"
          onClick={handleRegenerate}
          disabled={isGenerating || !editData.prompt}
        >
          {isGenerating ? t('sceneDetail.generating') : t('sceneDetail.regenerate')}
        </button>
      )}
      <button className="btn-primary" onClick={handleSave}>{t('sceneDetail.save')}</button>
    </>
  )
  
  return (
    <Modal 
      title={`🎬 Scene ${scene.id}`}
      onClose={onClose}
      footer={footer}
      className={`ref-detail-modal scene-detail-modal ${histories.length > 0 ? 'has-history' : ''}`}
    >
      <div className="ref-detail-layout">
        {/* 왼쪽: 이미지 + 폼 */}
        <div className="ref-detail-main">
          {/* 이미지 미리보기 */}
          <div className={`ref-detail-preview ${ratioClass} ${!hasImageData(editData) ? 'empty' : ''}`}>
            {isGenerating ? (
              <div className="ref-uploading">
                <span className="spinner">⏳</span>
                <span>{t('sceneDetail.generatingStatus')}</span>
              </div>
            ) : hasImageData(editData) ? (
              <>
                <img
                  src={resolveImageSrc(editData)}
                  alt={`Scene ${scene.id}`}
                  onLoad={(e) => setImageSize({ width: e.target.naturalWidth, height: e.target.naturalHeight })}
                />
                <button
                  className="btn-clear-image"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditData(prev => ({ ...prev, image: null, imagePath: null }))
                    setImageSize(null)
                  }}
                  title={t('reference.clearImage') || '이미지 제거'}
                >✕</button>
              </>
            ) : (
              <div className="ref-placeholder">
                <span className="icon">🖼️</span>
                <span>{t('sceneDetail.noImage')}</span>
              </div>
            )}
          </div>

          {/* 1줄 메타: 사이즈 · seed · 생성일시 + ▼ 토글로 모델.
              restoredMeta 가 set 됐다는 건 사용자가 history 복원했다는 뜻 — 그 항목 메타가
              비어 있어도(null) 명시적 의도이므로 backfilled 로 fallthrough 금지.
              저장값(editData.seed=null)과 UI 표시가 일치. */}
          <MediaMetaBar
            width={imageSize?.width || editData.image_size?.width}
            height={imageSize?.height || editData.image_size?.height}
            seed={restoredMeta ? restoredMeta.seed : (editData.seed ?? backfilledMeta.seed)}
            generatedAt={
              restoredMeta
                ? restoredMeta.generatedAt
                : (editData.generatedAt ?? backfilledMeta.generatedAt)
            }
            model={restoredMeta ? restoredMeta.model : (editData.model ?? backfilledMeta.model)}
            t={t}
          />
          
          {/* 프롬프트 */}
          <div className="form-group">
            <label className="label-with-copy">
              {t('sceneDetail.prompt')}
              {editData.prompt && (
                <button
                  type="button"
                  className="btn-copy"
                  onClick={() => handleCopy(editData.prompt, t('sceneDetail.prompt'))}
                  title={t('common.copy')}
                >⧉</button>
              )}
            </label>
            <textarea
              value={editData.prompt || ''}
              onChange={(e) => setEditData({ ...editData, prompt: e.target.value })}
              placeholder={t('sceneDetail.promptPlaceholder')}
              rows={3}
            />
          </div>
          
          {/* 자막 */}
          <div className="form-group">
            <label className="label-with-copy">
              {t('sceneDetail.subtitle')}
              {editData.subtitle && (
                <button
                  type="button"
                  className="btn-copy"
                  onClick={() => handleCopy(editData.subtitle, t('sceneDetail.subtitle'))}
                  title={t('common.copy')}
                >⧉</button>
              )}
            </label>
            <textarea
              value={editData.subtitle || ''}
              onChange={(e) => setEditData({ ...editData, subtitle: e.target.value })}
              placeholder={t('sceneDetail.subtitlePlaceholder')}
              rows={2}
              className="subtitle-input"
            />
          </div>
          
          {/* 시간 정보 */}
          <div className="form-row">
            <div className="form-group half">
              <label>{t('sceneDetail.startTime')}</label>
              <div className="time-display">{formatTime(editData.startTime || 0)}</div>
            </div>
            <div className="form-group half">
              <label>{t('sceneDetail.duration')}</label>
              <input
                type="number"
                value={editData.duration || 3}
                style={{ textAlign: 'right' }}
                onChange={(e) => {
                  const duration = parseFloat(e.target.value) || 3
                  setEditData({ 
                    ...editData, 
                    duration,
                    endTime: (editData.startTime || 0) + duration
                  })
                }}
                min={UI.DURATION_MIN}
                max={UI.DURATION_MAX}
                step={UI.DURATION_STEP}
              />
            </div>
          </div>
          
          {/* 캐릭터 */}
          <div className="form-group">
            <label className="label-with-copy">
              {t('sceneDetail.character')}
              {editData.characters && (
                <button
                  type="button"
                  className="btn-copy"
                  onClick={() => handleCopy(editData.characters, t('sceneDetail.character'))}
                  title={t('common.copy')}
                >⧉</button>
              )}
            </label>
            <TagInputAutocomplete
              type="character"
              value={editData.characters || ''}
              onChange={(v) => setEditData({ ...editData, characters: v })}
              references={references}
              placeholder={t('sceneDetail.characterPlaceholder')}
              isKo={isKo}
              t={t}
            />
          </div>
          
          {/* 배경 */}
          <div className="form-group">
            <label className="label-with-copy">
              {t('sceneDetail.background')}
              {editData.scene_tag && (
                <button
                  type="button"
                  className="btn-copy"
                  onClick={() => handleCopy(editData.scene_tag, t('sceneDetail.background'))}
                  title={t('common.copy')}
                >⧉</button>
              )}
            </label>
            <TagInputAutocomplete
              type="scene"
              value={editData.scene_tag || ''}
              onChange={(v) => setEditData({ ...editData, scene_tag: v })}
              references={references}
              placeholder={t('sceneDetail.backgroundPlaceholder')}
              isKo={isKo}
              t={t}
            />
          </div>
          
          {/* 스타일 */}
          <div className="form-group">
            <label className="label-with-copy">
              {t('sceneDetail.style')}
              {editData.style_tag && (
                <button
                  type="button"
                  className="btn-copy"
                  onClick={() => handleCopy(editData.style_tag, t('sceneDetail.style'))}
                  title={t('common.copy')}
                >⧉</button>
              )}
            </label>
            <TagInputAutocomplete
              type="style"
              value={editData.style_tag || ''}
              onChange={(v) => setEditData({ ...editData, style_tag: v })}
              references={references}
              presets={STYLE_PRESETS?.styles || []}
              thumbnails={styleThumbnails}
              placeholder={t('sceneDetail.styleSelect')}
              isKo={isKo}
              t={t}
            />
          </div>

          {/* 에러 정보 (생성 실패 시에만 노출) */}
          <ErrorSection error={scene.error} errorKind={scene.errorKind} />
        </div>

        {/* 오른쪽: 히스토리 */}
        {histories.length > 0 && (
          <div className="ref-detail-history">
            <div className="history-header">{t('sceneDetail.history')}</div>
            <div className="history-list">
              {histories.map((hist, idx) => (
                <div 
                  key={hist.filename}
                  className={`history-item ${(editData.image && editData.image === hist.data) || (editData.imagePath && hist.filePath && editData.imagePath === hist.filePath) ? 'selected' : ''}`}
                  onClick={() => handleRestoreHistory(hist)}
                  title={new Date(hist.lastModified).toLocaleString()}
                >
                  <img src={hist.data} alt={`History ${idx + 1}`} />
                  <div className="history-info">
                    <span className="history-engine">{hist.engine}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
