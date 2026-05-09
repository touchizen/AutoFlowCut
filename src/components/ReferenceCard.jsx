/**
 * ReferenceCard - 레퍼런스 카드 컴포넌트
 */

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { REFERENCE_TYPES } from '../config/defaults'
import { getRatioClass, resolveImageSrc, hasImageData, formatElapsed } from '../utils/formatters'
import { useElapsedTimer } from '../hooks/useElapsedTimer'

// 초시계 아이콘 — ResultsTable / FrameToVideoPanel 과 동일 스타일
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

// 경과 시간 — generatingStartedAt 가 있으면 1초마다 업데이트, generatingEndedAt 있으면 멈춤
function ElapsedTime({ startedAt, endedAt }) {
  const elapsed = useElapsedTimer(startedAt, endedAt)
  return <span>{formatElapsed(elapsed)}</span>
}

export default function ReferenceCard({
  reference,
  index,
  onUpdate,
  onRemove,
  onUpload,
  onGenerate,
  aspectRatio,
  t,
  isGenerating,
  onShowDetail
}) {
  const cardRef = useRef(null)
  const fileInputRef = useRef(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [hoverPreview, setHoverPreview] = useState(null) // { x, y }
  const [showRemoveMenu, setShowRemoveMenu] = useState(false)

  // 생성 시작되면 카드가 보이도록 자동 스크롤
  useEffect(() => {
    if (isGenerating && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [isGenerating])
  
  const ratioClass = getRatioClass(aspectRatio)
  
  // 파일 처리 공통 함수
  const processFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    
    setIsUploading(true)
    
    const reader = new FileReader()
    reader.onloadend = async () => {
      const base64 = reader.result
      
      onUpdate(index, { 
        ...reference, 
        data: base64,
        mimeType: file.type
      })
      
      // API 업로드
      if (onUpload) {
        const cleanBase64 = base64.split(',')[1]
        const result = await onUpload(cleanBase64, reference.category)
        if (result.success) {
          onUpdate(index, {
            ...reference,
            data: base64,
            mediaId: result.mediaId,
            caption: result.caption
          })
        }
      }
      
      setIsUploading(false)
    }
    reader.readAsDataURL(file)
  }
  
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (file) await processFile(file)
    e.target.value = ''
  }
  
  // Drag & Drop 핸들러
  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }
  
  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }
  
  const handleDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    
    const file = e.dataTransfer.files?.[0]
    if (file) await processFile(file)
  }
  
  const typeInfo = REFERENCE_TYPES.find(t => t.value === reference.type) || REFERENCE_TYPES[0]
  const hasPrompt = reference.prompt && reference.prompt.trim().length > 0
  const isBusy = isUploading || isGenerating
  const hasRefImage = hasImageData(reference)
  const refImgSrc = resolveImageSrc(reference)

  return (
    <div ref={cardRef} className={`reference-card status-${reference.status || 'pending'} ${hasRefImage ? 'has-image' : ''} ${isBusy ? 'uploading' : ''} ${isDragOver ? 'drag-over' : ''} ${ratioClass}`}>
      <input 
        type="file"
        ref={fileInputRef}
        accept="image/*"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      
      <div className="ref-header">
        <select 
          value={reference.type}
          onChange={(e) => {
            const typeInfo = REFERENCE_TYPES.find(t => t.value === e.target.value)
            onUpdate(index, { 
              ...reference, 
              type: e.target.value,
              category: typeInfo?.category || 'MEDIA_CATEGORY_SUBJECT'
            })
          }}
        >
          {REFERENCE_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        
        <div className="btn-remove-wrap">
          <button className="btn-remove" onClick={() => {
            if (hasRefImage) {
              setShowRemoveMenu(prev => !prev)
            } else {
              onRemove(index)
            }
          }} title={t('common.delete')}>
            ✕
          </button>
          {showRemoveMenu && (
            <div className="remove-menu" onMouseLeave={() => setShowRemoveMenu(false)}>
              <button onClick={() => { setShowRemoveMenu(false); onUpdate(index, { ...reference, data: null, filePath: null, mediaId: null, caption: null, dataStorage: null }) }}>
                {t('reference.clearImage') || '이미지만 제거'}
              </button>
              <button onClick={() => { setShowRemoveMenu(false); onRemove(index) }}>
                {t('reference.removeCard') || '카드 제거'}
              </button>
            </div>
          )}
        </div>
      </div>
      
      <div 
        className="ref-image-area"
        onClick={() => {
          if (isBusy) return
          if (hasRefImage) {
            onShowDetail(index) // 이미지 있으면 상세카드
          } else {
            fileInputRef.current?.click() // 없으면 파일 선택
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isBusy ? (
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
        ) : hasRefImage ? (
          <img
            src={refImgSrc}
            alt={reference.name || 'Reference'}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              setHoverPreview({ x: rect.right + 8, y: rect.top })
            }}
            onMouseLeave={() => setHoverPreview(null)}
          />
        ) : (
          <div className="ref-placeholder">
            <span className="icon">{typeInfo.label.split(' ')[0]}</span>
            <span>{t('reference.upload')}</span>
          </div>
        )}
        
        {reference.mediaId && (
          <span className="uploaded-badge" title={t('reference.uploadedToFlow')}>✅</span>
        )}
      </div>
      
      {/* 이름 클릭 시 상세 모달 */}
      <button 
        className="ref-name-btn"
        onClick={() => onShowDetail(index)}
        title={reference.prompt ? `${t('reference.prompt')}: ${reference.prompt}` : t('reference.clickToEdit')}
      >
        {reference.name || t('reference.namePlaceholder')}
        {reference.prompt && <span className="has-prompt-indicator">📝</span>}
      </button>
      
      {/* 프롬프트가 있으면 생성 버튼 표시 */}
      {hasPrompt && !hasRefImage && (
        <button 
          className="btn-generate-ref"
          onClick={(e) => {
            e.stopPropagation()
            onGenerate && onGenerate(index)
          }}
          disabled={isBusy}
          title={reference.prompt}
        >
          🎨 {t('reference.generate')}
        </button>
      )}
      
      {reference.caption && (
        <div className="ref-caption" title={reference.caption}>
          {reference.caption.substring(0, 50)}...
        </div>
      )}

      {/* 호버 풍선 프리뷰 */}
      {hoverPreview && hasRefImage && createPortal(
        <div
          className="ref-hover-balloon"
          style={{
            left: Math.min(hoverPreview.x, window.innerWidth - 420),
            top: Math.max(0, Math.min(hoverPreview.y, window.innerHeight - 400))
          }}
        >
          <img src={refImgSrc} alt="preview" />
        </div>,
        document.body
      )}
    </div>
  )
}
