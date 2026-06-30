/**
 * ReferenceCard - 레퍼런스 카드 컴포넌트
 */

import { useState, useRef, useEffect } from 'react'
import { REFERENCE_TYPES } from '../config/defaults'
import { getRatioClass, resolveImageSrc, hasImageData, formatElapsed } from '../utils/formatters'
import { useElapsedTimer } from '../hooks/useElapsedTimer'
import { fileSystemAPI } from '../hooks/useFileSystem'
import { applyEntityRegistrationPatch } from '../utils/refEntityRegistration'
import HoverImageBalloon from './HoverImageBalloon'
import LazyImage from './LazyImage'

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
  onShowDetail,
  projectName,
}) {
  const cardRef = useRef(null)
  const fileInputRef = useRef(null)
  // 빈 카드 단/더블 클릭 구분용 타이머 — 단일=상세(지연), 더블=업로드(타이머 취소).
  const clickTimerRef = useRef(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [hoverPreview, setHoverPreview] = useState(null) // { x, y }
  const [showRemoveMenu, setShowRemoveMenu] = useState(false)

  // 언마운트 시 대기 중인 단일클릭 타이머 정리
  useEffect(() => () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current) }, [])

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

      // 즉시 표시
      onUpdate(index, {
        ...reference,
        data: base64,
        mimeType: file.type,
      })

      // R30 review fix: 디스크에도 저장해서 filePath 확보 — autosave 가 data 를
      // strip 해도 reload 시 references/{name} 파일에서 복구 가능. projectName
      // 이 없거나 권한이 없으면 기존 동작 (메모리만) 유지.
      // R33 review fix: name 비어 있으면 imported_{id} fallback 으로 저장 — 사용자가
      // 이름 입력 전 업로드해도 디스크에 영속화되어 reload 시 복구 가능. ref.id 는
      // ReferencePanel.handleAdd 가 항상 발급. 이름은 patch 에도 반영해 후속 autosave
      // 가 같은 saveName 으로 일관 유지.
      // M4 T7: effectiveName 을 업로드 *전*에 확정 — uploadReference 메타에도 포함.
      // #R34: 이름이 비어 있으면 업로드한 파일명(확장자 제외)을 이름으로 쓴다. 안 그러면
      //   imported_<id> 같은 엉뚱한 이름으로 Flow 에 등록된다. 파일명도 없을 때만 imported fallback.
      const fileBaseName = file?.name ? file.name.replace(/\.[^/.]+$/, '').trim() : ''
      const effectiveName = (reference.name && String(reference.name).trim())
        ? reference.name
        : (fileBaseName || (reference.id != null ? `imported_${reference.id}` : null))

      let uploadedMediaId = null
      let uploadedCaption = null
      let entityPatch = null
      if (onUpload) {
        const cleanBase64 = base64.split(',')[1]
        const result = await onUpload(cleanBase64, { category: reference.category, name: effectiveName, type: reference.type, refId: reference.id })
        if (result.success) {
          uploadedMediaId = result.mediaId
          uploadedCaption = result.caption
          // Propagate Flow entity fields (entityId, workflowId, registered, flowNameSyncStatus)
          // when the upload returned them (Flow character upload). API mode returns no entity
          // fields → applyEntityRegistrationPatch produces only mediaId-ish / no entityId.
          const hasEntityFields = result.entityId != null || result.workflowId != null
          if (hasEntityFields) {
            entityPatch = applyEntityRegistrationPatch(reference, result, true)
          }
        }
      }
      let savedFilePath = null
      let saveAttempted = false
      let saveErrorMessage = null
      if (projectName && effectiveName) {
        saveAttempted = true
        try {
          const permission = await fileSystemAPI.checkPermission()
          if (permission?.hasPermission) {
            const metadata = {
              mediaId: uploadedMediaId,
              caption: uploadedCaption,
              category: reference.category,
            }
            const saveResult = await fileSystemAPI.saveReference(
              projectName, effectiveName, base64, 'imported', metadata
            )
            if (saveResult?.success) {
              savedFilePath = saveResult.path
            } else {
              saveErrorMessage = saveResult?.error || 'reference.saveFailed'
            }
          } else {
            saveErrorMessage = 'reference.noPermission'
          }
        } catch (e) {
          console.warn('[ReferenceCard] saveReference failed:', e?.message || e)
          saveErrorMessage = e?.message || 'reference.saveFailed'
        }
      }

      // R35 review fix: save 가 시도되었는데 실패하면 'error' — autosave 가 data 를
      // strip 한 뒤 reload 하면 'done인데 파일 없음' orphan 상태가 됨. save 가
      // 스킵된 경우 (projectName 없거나 name 못 만들 때) 는 memory-only 로 'done'
      // 유지 (기존 폴백 동작).
      const saveFailedAfterAttempt = saveAttempted && !savedFilePath
      const finalStatus = saveFailedAfterAttempt ? 'error' : 'done'
      const finalErrorMessage = saveFailedAfterAttempt ? saveErrorMessage : null

      onUpdate(index, {
        ...reference,
        name: effectiveName || reference.name,
        // R36 fix: 디스크 저장 성공 시 base64 메모리 해제. useAutomation.js 는
        // ref.data 없으면 ref.filePath 에서 readFileByPath fallback 이 있음.
        data: savedFilePath ? null : base64,
        mediaId: uploadedMediaId,
        caption: uploadedCaption,
        filePath: savedFilePath,
        dataStorage: savedFilePath ? 'file' : 'base64',
        // Codex #3: propagate Flow entity fields so manual upload yields mention-eligible ref.
        // #R31-3: fresh entity 가 없으면(API 모드/엔티티 미반환 업로드) 옛 entityId/flowNameSyncStatus 를
        //   비운다 — 안 그러면 ...reference 로 살아남아 새 이미지 ref 가 옛 캐릭터로 @mention 된다
        //   (ReferenceDetailModal R16-3 정책과 동일).
        ...(entityPatch || { entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null }),
        // R27 review fix 와 일관: 캐시 무효화용 timestamp
        generatedAt: Date.now(),
        // R34 + R35 review fix: 성공/스킵 시 'done', 실패 시 'error'.
        status: finalStatus,
        errorMessage: finalErrorMessage,
      })

      // #R33: 캐릭터 entity 등록(entityId 수신) 직후 Flow SPA 새로고침 — 'Untitled Character' stale
      //   캐시/멘션 피커 옛 이름 방지(비차단).
      if (entityPatch?.entityId) { try { window.electronAPI?.refreshFlowComposer?.() } catch (_e) {} }

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
              <button onClick={() => { setShowRemoveMenu(false); onUpdate(index, { ...reference, data: null, filePath: null, mediaId: null, caption: null, dataStorage: null, entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null }) }}>
                {/* #R29-1: 이미지 제거 시 Flow 캐릭터 엔티티 필드도 비운다 — 안 그러면 sceneMentions 가
                    여전히 mention-eligible 로 보고 @name 이 옛 캐릭터를 주입한다(ReferenceDetailModal 과 동일 정책). */}
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
            onShowDetail(index) // 이미지 있으면 1클릭=상세카드
            return
          }
          // 빈 카드: 1클릭=상세(지연 — 더블클릭이면 취소), 더블클릭=업로드.
          if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
          clickTimerRef.current = setTimeout(() => {
            clickTimerRef.current = null
            onShowDetail(index)
          }, 250)
        }}
        onDoubleClick={() => {
          if (isBusy || hasRefImage) return
          if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null }
          fileInputRef.current?.click() // 빈 카드 더블클릭=파일 선택
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
          <LazyImage
            src={refImgSrc}
            alt={reference.name || 'Reference'}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              setHoverPreview({
                rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
              })
            }}
            onMouseLeave={() => setHoverPreview(null)}
          />
        ) : (
          <div className="ref-placeholder">
            <span className="icon">{typeInfo.label.split(' ')[0]}</span>
            <span>{t('reference.uploadHint') || t('reference.upload')}</span>
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
      {hoverPreview && hasRefImage && (
        <HoverImageBalloon
          anchorRect={hoverPreview.rect}
          src={refImgSrc}
          className="ref-hover-balloon"
        />
      )}
    </div>
  )
}
