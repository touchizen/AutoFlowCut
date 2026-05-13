/**
 * ReferenceDetailModal - 레퍼런스 상세 모달
 */

import { useState, useEffect } from 'react'
import { REFERENCE_TYPES, STYLE_PRESETS, RESOURCE } from '../config/defaults'
import { resolveImageSrc, hasImageData, formatElapsed } from '../utils/formatters'
import { useImageUpload } from '../hooks/useImageUpload'
import { useElapsedTimer } from '../hooks/useElapsedTimer'
import { fileSystemAPI } from '../hooks/useFileSystem'
import { toast } from './Toast'
import Modal from './Modal'
import StylePicker from './StylePicker'
import ErrorSection from './ErrorSection'

// 초시계 아이콘 — ResultsTable / ReferenceCard 와 동일 스타일
function StopwatchIcon({ size = 16 }) {
  const r = size / 2
  const cx = r, cy = r
  const handLen = r * 0.6
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="stopwatch-icon">
      <circle cx={cx} cy={cy} r={r - 1.5} fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1={cx} y1={cy - r + 1.5} x2={cx} y2={cy - r + 3.5} stroke="currentColor" strokeWidth="1.2" />
      <rect x={cx - 1} y={0} width={2} height={2} rx={0.5} fill="currentColor" />
      <line className="stopwatch-hand" x1={cx} y1={cy} x2={cx} y2={cy - handLen}
        stroke="var(--accent, #3b82f6)" strokeWidth="1.5" strokeLinecap="round"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      <circle cx={cx} cy={cy} r={1.2} fill="var(--accent, #3b82f6)" />
    </svg>
  )
}

function ElapsedTime({ startedAt, endedAt }) {
  const elapsed = useElapsedTimer(startedAt, endedAt)
  return <span>{formatElapsed(elapsed)}</span>
}

export default function ReferenceDetailModal({ reference, index, onUpdate, onUpload, onClose, onGenerate, isGenerating, t, isKo, projectName, thumbnails = {} }) {
  const [editData, setEditData] = useState({ ...reference })
  const [showStyleDropdown, setShowStyleDropdown] = useState(false)
  const [histories, setHistories] = useState([])
  const [shouldReloadHistory, setShouldReloadHistory] = useState(0)
  const [imageSize, setImageSize] = useState(null)
  
  // reference prop이 변경되면 editData 업데이트 (재생성 완료 시)
  useEffect(() => {
    setEditData(prev => ({
      ...prev,
      data: reference.data,
      filePath: reference.filePath,
      mediaId: reference.mediaId,
      caption: reference.caption
    }))
    // 히스토리 재로드 트리거
    setShouldReloadHistory(n => n + 1)
  }, [reference.data, reference.filePath, reference.mediaId])
  
  const imageUpload = useImageUpload({
    uploadToFlow: onUpload,
    category: editData.category,
    onUploadComplete: (result) => {
      setEditData(prev => ({
        ...prev,
        data: result.data,
        mediaId: result.mediaId || prev.mediaId,
        caption: result.caption || prev.caption
      }))
    }
  })
  
  const loadHistory = async () => {
    const result = await fileSystemAPI.getHistory(projectName, RESOURCE.REFERENCES, reference.name)
    if (result.success && result.histories?.length > 0) {
      const historiesWithData = await Promise.all(
        result.histories.map(async (hist) => {
          const fileResult = await fileSystemAPI.readHistoryFile(projectName, RESOURCE.REFERENCES, hist.filename)
          return {
            ...hist,
            data: fileResult.success ? fileResult.data : null,
            metadata: fileResult.metadata || null  // caption, mediaId 등
          }
        })
      )
      setHistories(historiesWithData.filter(h => h.data))
    }
  }
  
  // 히스토리 로드
  useEffect(() => {
    if (projectName && reference.name) {
      loadHistory()
    }
  }, [projectName, reference.name, shouldReloadHistory])
  
  // 히스토리 이미지 선택
  const handleRestoreHistory = (historyItem) => {
    setEditData(prev => ({
      ...prev,
      data: historyItem.data,
      mediaId: historyItem.metadata?.mediaId || null,
      caption: historyItem.metadata?.caption || null,
      filePath: null,  // 저장 시 새로 저장되도록
      dataStorage: null
    }))
  }
  
  const handleSave = async () => {
    // 이미지가 있고 파일로 저장 안 된 경우 (업로드된 이미지) 파일 저장
    if (editData.data && !editData.filePath && projectName) {
      try {
        const permission = await fileSystemAPI.checkPermission()
        if (permission.hasPermission && editData.name) {
          const metadata = { 
            mediaId: editData.mediaId, 
            caption: editData.caption, 
            category: editData.category 
          }
          const saveResult = await fileSystemAPI.saveReference(
            projectName, 
            editData.name, 
            editData.data, 
            'imported', 
            metadata
          )
          if (saveResult.success) {
            editData.filePath = saveResult.path
            editData.dataStorage = 'file'
            console.log('[ReferenceDetail] Saved uploaded image:', saveResult.path)
          }
        }
      } catch (err) {
        console.error('[ReferenceDetail] Save error:', err)
      }
    }
    
    onUpdate(index, editData)
    onClose()
  }
  
  // 스타일 선택 핸들러 (StylePicker에서 preset:ID 형식으로 옴)
  const handleStylePickerSelect = (id) => {
    if (!id || !id.startsWith('preset:')) {
      // 선택 해제 — 모든 ref 필드를 함께 클리어해 stale mediaId/filePath/caption이
      // findAutoStyle()에 잡히지 않도록 한다 (이름 빈 ref인데 mediaId 살아있는 상태 방지).
      setEditData(prev => ({
        ...prev,
        name: '', prompt: '', description: '',
        data: null, filePath: null, mediaId: null, caption: null, dataStorage: null,
      }))
      return
    }
    const presetId = id.replace('preset:', '')
    const style = STYLE_PRESETS?.styles?.find(s => s.id === presetId)
    if (!style) return
    // 프리셋으로 채울 때는 카드를 "프리셋 정의 그대로" 새로 만든다 — 이전에 사용자가
    // 업로드한 커스텀 이미지의 메타데이터(filePath/mediaId/caption/dataStorage)는 클리어.
    // 안 그러면 새 프리셋 prompt + 예전 image의 mediaId가 섞여 일관성 깨짐.
    setEditData(prev => ({
      ...prev,
      name: style.name_ko,
      prompt: style.prompt_en,
      description: style.name_en,
      data: thumbnails[presetId] || null,
      filePath: null,
      mediaId: null,
      caption: null,
      dataStorage: null,
    }))
  }

  // 현재 editData.name에 해당하는 preset ID 찾기
  const currentPresetId = STYLE_PRESETS?.styles?.find(s => s.name_ko === editData.name)?.id
  const selectedStylePickerId = currentPresetId ? `preset:${currentPresetId}` : null
  
  const typeInfo = REFERENCE_TYPES.find(t => t.value === editData.type) || REFERENCE_TYPES[0]
  const isStyle = editData.type === 'style'

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
  
  // 재생성 핸들러
  const handleRegenerate = () => {
    console.log('[ReferenceDetail] Regenerate clicked', { index, editData, onGenerate: !!onGenerate })
    try {
      // 부모 state에 편집 내용 반영 (다음 render에 commit)
      onUpdate(index, editData)
      // editData를 4번째 인자로 직접 넘겨서 React state commit race를 우회.
      // (그렇지 않으면 useReferenceGeneration이 옛 references[index]를 읽어
      // noPrompt 경로 또는 옛 prompt로 생성하는 race 발생)
      if (onGenerate) {
        onGenerate(index, false, null, editData)
      } else {
        console.error('[ReferenceDetail] onGenerate is not defined!')
      }
    } catch (err) {
      console.error('[ReferenceDetail] Regenerate error:', err)
    }
  }
  
  const footer = (
    <>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      {onGenerate && (
        <button
          className="btn-warning"
          onClick={handleRegenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <>
              <StopwatchIcon size={14} />{' '}
              <ElapsedTime startedAt={reference.generatingStartedAt} endedAt={reference.generatingEndedAt} />
            </>
          ) : (
            '🔄 ' + t('reference.regenerate')
          )}
        </button>
      )}
      <button className="btn-primary" onClick={handleSave}>{t('common.save')}</button>
    </>
  )
  
  return (
    <Modal
      onClose={onClose}
      title={`${typeInfo.label} ${t('reference.detail')}`}
      className={`ref-detail-modal ${histories.length > 0 ? 'has-history' : ''}`}
      footer={footer}
    >
      <div className="ref-detail-layout">
        <div className="ref-detail-main">
          <>
            {/* Status indicator (에러 메시지는 모달 하단 ErrorSection에서 노출) */}
            {editData.status && (
              <div className={`ref-status-line status-${editData.status}`} style={{ fontSize: '0.8rem', marginBottom: '8px', color: editData.status === 'error' ? '#e5484d' : 'var(--text-secondary)' }}>
                <strong>{t('reference.status.label') || 'Status'}:</strong>{' '}
                {t(`reference.status.${editData.status}`) || editData.status}
                {editData.status === 'error' && onGenerate && (
                  <button
                    type="button"
                    className="btn-warning"
                    style={{ marginLeft: '8px', padding: '2px 8px', fontSize: '0.75rem' }}
                    onClick={handleRegenerate}
                    disabled={isGenerating}
                  >
                    🔄 {t('reference.retry') || (isKo ? '다시 시도' : 'Retry')}
                  </button>
                )}
              </div>
            )}
            <input {...imageUpload.getInputProps()} />

            <div
              className={`ref-detail-preview ${imageUpload.isDragOver ? 'drag-over' : ''} ${!hasImageData(editData) ? 'empty' : ''}`}
              {...(isGenerating ? {} : imageUpload.getDropZoneProps())}
            >
              {(imageUpload.isUploading || isGenerating) ? (
                <div className="ref-uploading">
                  {isGenerating ? (
                    <>
                      <StopwatchIcon size={16} />
                      <span><ElapsedTime startedAt={reference.generatingStartedAt} endedAt={reference.generatingEndedAt} /></span>
                    </>
                  ) : (
                    <>
                      <span className="spinner">⏳</span>
                      <span>{t('reference.uploading')}</span>
                    </>
                  )}
                </div>
              ) : hasImageData(editData) ? (
                <>
                  <img
                    src={resolveImageSrc(editData)}
                    alt={editData.name || 'Reference'}
                    onLoad={(e) => setImageSize({ width: e.target.naturalWidth, height: e.target.naturalHeight })}
                  />
                  <button
                    className="btn-clear-image"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditData(prev => ({ ...prev, data: null, filePath: null, mediaId: null, caption: null, dataStorage: null }))
                      setImageSize(null)
                    }}
                    title={t('reference.clearImage') || '이미지 제거'}
                  >✕</button>
                  <div className="preview-overlay">
                    <span>📷 {t('reference.clickToChange')}</span>
                  </div>
                </>
              ) : (
                <div className="ref-placeholder">
                  <span className="icon">{typeInfo.label.split(' ')[0]}</span>
                  <span>{t('reference.upload')}</span>
                </div>
              )}
            </div>
          </>

          {/* 이름 — 항상 자유 입력. isStyle일 때만 보조 버튼으로 프리셋 채우기 가능. */}
          <div className="form-group">
            <label className="label-with-copy">
              {t('reference.name')}
              {editData.name && (
                <button
                  type="button"
                  className="btn-copy"
                  onClick={() => handleCopy(editData.name, t('reference.name'))}
                  title={t('common.copy')}
                >⧉</button>
              )}
            </label>
            <div className="name-input-row">
              <input
                type="text"
                value={editData.name || ''}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                placeholder={t('reference.namePlaceholder')}
              />
              {isStyle && (
                <button
                  type="button"
                  className="btn-fill-preset"
                  onClick={() => setShowStyleDropdown(true)}
                  title={t('reference.fillFromPreset')}
                >
                  {t('reference.fillFromPreset')} ▼
                </button>
              )}
            </div>
          </div>

          {/* 타입 */}
          <div className="form-group">
            <label>{t('reference.type')}</label>
            <select
              value={editData.type}
              onChange={(e) => {
                const typeInfo = REFERENCE_TYPES.find(t => t.value === e.target.value)
                setEditData({
                  ...editData,
                  type: e.target.value,
                  category: typeInfo?.category || 'MEDIA_CATEGORY_SUBJECT'
                })
              }}
            >
              {REFERENCE_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* 프롬프트 */}
          <div className="form-group">
            <label className="label-with-copy">
              {t('reference.prompt')}
              {editData.prompt && (
                <button
                  type="button"
                  className="btn-copy"
                  onClick={() => handleCopy(editData.prompt, t('reference.prompt'))}
                  title={t('common.copy')}
                >⧉</button>
              )}
            </label>
            <textarea
              value={editData.prompt || ''}
              onChange={(e) => setEditData({ ...editData, prompt: e.target.value })}
              placeholder={t('reference.promptPlaceholder')}
              rows={4}
            />
          </div>

          {/* 상태 정보 */}
          <div className="ref-detail-status">
            {(editData.mediaId || imageSize) && (
              <span className="status-badge success">
                {editData.mediaId && `✅ ${t('reference.uploadedToFlow')}`}
                {editData.mediaId && imageSize && ' · '}
                {imageSize && `${imageSize.width} × ${imageSize.height}`}
              </span>
            )}
            {editData.caption && (
              <div className="caption-section">
                <label className="label-with-copy">
                  💬 {t('reference.caption')}
                  <span className="help-icon" data-tooltip={t('reference.captionHelp')}>?</span>
                  <button
                    type="button"
                    className="btn-copy"
                    onClick={() => handleCopy(editData.caption, t('reference.caption'))}
                    title={t('common.copy')}
                  >⧉</button>
                </label>
                <textarea
                  className="caption-text"
                  value={editData.caption}
                  readOnly
                />
              </div>
            )}
          </div>

          {/* 에러 정보 (생성 실패 시에만 노출) */}
          <ErrorSection error={editData.errorMessage || editData.error} errorKind={editData.errorKind} />
        </div>

        {/* 오른쪽: 히스토리 */}
        {histories.length > 0 && (
          <div className="ref-detail-history">
            <div className="history-header">📜 {t('reference.history')}</div>
            <div className="history-list">
              {histories.map((hist, idx) => (
                <div
                  key={hist.filename}
                  className={`history-thumb ${(editData.data && editData.data === hist.data) || (editData.filePath && hist.filePath && editData.filePath === hist.filePath) ? 'selected' : ''}`}
                  onClick={() => handleRestoreHistory(hist)}
                  title={`${new Date(hist.timestamp).toLocaleString()} - ${t('common.clickToRestore')}`}
                >
                  <img src={hist.data} alt={`History ${idx + 1}`} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* StylePicker 팝업 */}
      {showStyleDropdown && (
        <div className="style-picker-overlay" onClick={() => setShowStyleDropdown(false)}>
          <div className="style-picker-popup" onClick={e => e.stopPropagation()}>
            <div className="style-picker-popup-header">
              <span>🎨 {t('reference.selectStyle')}</span>
              <button onClick={() => setShowStyleDropdown(false)}>✕</button>
            </div>
            <StylePicker
              selectedId={selectedStylePickerId}
              onSelect={(id) => {
                handleStylePickerSelect(id)
                setShowStyleDropdown(false)
              }}
              thumbnails={thumbnails}
              t={t}
              isKo={isKo}
            />
          </div>
        </div>
      )}
    </Modal>
  )
}
