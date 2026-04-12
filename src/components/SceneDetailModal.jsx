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
import './SceneDetailModal.css'

export default function SceneDetailModal({ 
  scene, 
  onUpdate, 
  onClose, 
  onGenerate, 
  isGenerating, 
  t, 
  projectName,
  aspectRatio = '9:16'
}) {
  const [editData, setEditData] = useState({ ...scene })
  const [histories, setHistories] = useState([])
  const [shouldReloadHistory, setShouldReloadHistory] = useState(0)
  const [imageSize, setImageSize] = useState(null)
  const [showStyleDropdown, setShowStyleDropdown] = useState(false)
  const { lang } = useI18n()
  const isKo = lang === 'ko'

  // scene prop이 변경되면 editData 업데이트 (재생성 완료 시)
  useEffect(() => {
    setEditData(prev => ({
      ...prev,
      image: scene.image,
      imagePath: scene.imagePath,
      status: scene.status,
    }))
    // 히스토리 재로드 트리거
    setShouldReloadHistory(n => n + 1)
  }, [scene.image, scene.imagePath, scene.status])
  
  // 히스토리 로드
  const loadHistory = async () => {
    if (!projectName || !scene.id) return
    
    const result = await fileSystemAPI.getHistory(projectName, RESOURCE.SCENES, scene.id)
    if (result.success && result.histories?.length > 0) {
      const historiesWithData = await Promise.all(
        result.histories.map(async (hist) => {
          const fileResult = await fileSystemAPI.readHistoryFile(projectName, RESOURCE.SCENES, hist.filename)
          return {
            ...hist,
            data: fileResult.success ? fileResult.data : null
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
  
  // 히스토리 이미지 선택
  const handleRestoreHistory = (historyItem) => {
    setEditData(prev => ({
      ...prev,
      image: historyItem.data,
      imagePath: null  // 히스토리에서 복원 시 새 파일로 간주
    }))
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

          {/* 이미지 크기 */}
          {imageSize && (
            <div className="ref-detail-status">
              <span className="status-badge success">
                {imageSize.width} × {imageSize.height}
              </span>
            </div>
          )}
          
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
            <input
              type="text"
              value={editData.characters || ''}
              onChange={(e) => setEditData({ ...editData, characters: e.target.value })}
              placeholder={t('sceneDetail.characterPlaceholder')}
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
            <input
              type="text"
              value={editData.scene_tag || ''}
              onChange={(e) => setEditData({ ...editData, scene_tag: e.target.value })}
              placeholder={t('sceneDetail.backgroundPlaceholder')}
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
            <div className="style-dropdown-wrapper">
              <button 
                type="button"
                className="style-dropdown-btn"
                onClick={() => setShowStyleDropdown(!showStyleDropdown)}
              >
                <span>{(() => {
                  if (!editData.style_tag) return t('sceneDetail.styleSelect')
                  const tag = editData.style_tag
                  const preset = STYLE_PRESETS.styles.find(s => s.id === tag || s.name_ko === tag || s.name_en === tag)
                  if (preset) return isKo ? preset.name_ko : preset.name_en
                  return editData.style_tag
                })()}</span>
                <span className="dropdown-arrow">{showStyleDropdown ? '▲' : '▼'}</span>
              </button>
              
              {showStyleDropdown && (
                <div className="style-dropdown-menu">
                  {/* 없음 옵션 */}
                  <div 
                    className={`style-option ${!editData.style_tag ? 'selected' : ''}`}
                    onClick={() => {
                      setEditData({ ...editData, style_tag: '' })
                      setShowStyleDropdown(false)
                    }}
                  >
                    {t('sceneDetail.styleNone')}
                  </div>
                  
                  {STYLE_PRESETS.categories.map(cat => (
                    <div key={cat.id} className="style-category">
                      <div className="style-category-header">
                        {cat.icon} {isKo ? cat.name_ko : cat.name_en}
                      </div>
                      <div className="style-category-items">
                        {STYLE_PRESETS.styles
                          .filter(s => s.category === cat.id)
                          .map(style => (
                            <div
                              key={style.id}
                              className={`style-option ${editData.style_tag === style.id ? 'selected' : ''}`}
                              onClick={() => {
                                setEditData({ ...editData, style_tag: style.id })
                                setShowStyleDropdown(false)
                              }}
                            >
                              {isKo ? style.name_ko : style.name_en}
                              <span className="style-option-en">{isKo ? style.name_en : style.name_ko}</span>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
