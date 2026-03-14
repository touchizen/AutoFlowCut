/**
 * ReferencePanel - 레퍼런스 이미지 관리 패널
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { REFERENCE_TYPES } from '../config/defaults'
import { useI18n } from '../hooks/useI18n'
import { getRatioClass } from '../utils/formatters'
import ReferenceCard from './ReferenceCard'
import ReferenceDetailModal from './ReferenceDetailModal'
import StylePicker from './StylePicker'
import './ReferencePanel.css'

export default function ReferencePanel({
  references,
  onUpdate,
  onUpload,
  onGenerate,
  onGenerateAll,
  onStopGenerateAll,
  onClearAll,
  aspectRatio = '16:9',
  generatingRefs = [],
  stoppingRefs = false,
  selectedStyleRefId,
  onStyleRefChange,
  projectName,
  thumbnails = {},
  thumbnailGenerating = false,
  thumbnailStopping = false,
  thumbnailProgress = { current: 0, total: 0 },
  onGenerateThumbnails,
  onStopThumbnailGeneration,
  onDeleteThumbnail
}) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const [detailIndex, setDetailIndex] = useState(null)
  const [showBatchWizard, setShowBatchWizard] = useState(false)

  // 위저드 열릴 때 Flow 네이티브 뷰 숨기기
  useEffect(() => {
    if (!showBatchWizard) return
    window.electronAPI?.setModalVisible?.({ visible: true })
    return () => window.electronAPI?.setModalVisible?.({ visible: false })
  }, [showBatchWizard])

  // 스타일 레퍼런스 목록 (업로드된 Style 카드)
  const styleRefs = references.filter(r => r.type === 'style' && r.mediaId)
  const isKo = t('common.cancel') === '취소'  // 간단한 언어 감지
  
  const handleAdd = () => {
    const maxId = references.length > 0 
      ? Math.max(...references.map(r => r.id || 0)) 
      : 0
    
    const typeInfo = REFERENCE_TYPES[0]
    
    onUpdate([...references, {
      id: maxId + 1,
      name: '',
      type: typeInfo.value,
      category: typeInfo.category,
      prompt: '',
      data: null,
      mediaId: null,
      caption: ''
    }])
  }
  
  const handleUpdateRef = (index, updatedRef) => {
    const newRefs = [...references]
    newRefs[index] = updatedRef
    onUpdate(newRefs)
  }
  
  const handleRemoveRef = (index) => {
    onUpdate(references.filter((_, i) => i !== index))
  }
  
  const ratioClass = getRatioClass(aspectRatio)
  
  // 생성 가능한 레퍼런스 (프롬프트 있고, 이미지 없음)
  const generatableRefs = references.filter(r => r.prompt && !r.data && !r.filePath)
  const isGenerating = generatingRefs.length > 0

  const handleClearAll = () => {
    if (window.confirm(t('reference.clearConfirm'))) {
      onClearAll?.()
    }
  }
  
  return (
    <div className={`reference-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="ref-panel-header">
        <div className="ref-header-left">
          <button 
            className="btn-collapse"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? t('common.expand') : t('common.collapse')}
          >
            {collapsed ? '▶' : '▼'}
          </button>
          <span>🖼️ {t('reference.title')} ({references.length})</span>
          {collapsed && <span className="ref-hint-collapsed">{t('reference.hintCollapsed')}</span>}
        </div>
        
        {!collapsed && (
          <div className="ref-header-actions">
            {/* Clear All 버튼 */}
            {references.length > 0 && (
              <button
                className="btn-clear-refs"
                onClick={handleClearAll}
                disabled={isGenerating}
                title={t('reference.clearAll')}
              >
                🗑️
              </button>
            )}
            {/* 일괄 생성 / 중단 버튼 */}
            {isGenerating ? (
              <button
                className={`btn-generate-all btn-stop ${stoppingRefs ? 'stopping' : ''}`}
                onClick={onStopGenerateAll}
                disabled={stoppingRefs}
              >
                {stoppingRefs
                  ? `⏳ ${t('reference.stopping')}...`
                  : `⏹ ${t('reference.stop')} (${generatingRefs.length}/${generatableRefs.length + generatingRefs.length})`
                }
              </button>
            ) : generatableRefs.length > 0 && (
              <button
                className="btn-generate-all"
                onClick={() => setShowBatchWizard(true)}
              >
                🎨 {t('reference.generateAll')} ({generatableRefs.length})
              </button>
            )}
          </div>
        )}
      </div>
      
      {!collapsed && (
        <div className={`ref-grid ${ratioClass}`}>
          {references.map((ref, index) => (
            <ReferenceCard 
              key={ref.id || index}
              reference={ref}
              index={index}
              onUpdate={handleUpdateRef}
              onRemove={handleRemoveRef}
              onUpload={onUpload}
              onGenerate={onGenerate}
              aspectRatio={aspectRatio}
              t={t}
              isGenerating={generatingRefs.includes(index)}
              onShowDetail={setDetailIndex}
            />
          ))}
          
          <div className={`reference-add-card ${ratioClass}`} onClick={handleAdd}>
            <span className="add-icon">+</span>
            <span>{t('reference.add')}</span>
          </div>
        </div>
      )}
      
      {/* 일괄 생성 위저드 (Portal → document.body) */}
      {showBatchWizard && createPortal(
        <div className="batch-wizard-overlay" onClick={() => !thumbnailGenerating && setShowBatchWizard(false)}>
          <div className="batch-wizard" onClick={e => e.stopPropagation()}>
            <div className="batch-wizard-header">
              <span>🎨 {t('reference.batchWizardTitle')}</span>
              <button className="btn-close-wizard" onClick={() => !thumbnailGenerating && setShowBatchWizard(false)} disabled={thumbnailGenerating}>✕</button>
            </div>
            <div className="batch-wizard-body">
              <StylePicker
                selectedId={selectedStyleRefId}
                onSelect={(id) => onStyleRefChange?.(id)}
                thumbnails={thumbnails}
                uploadedStyleRefs={styleRefs}
                generating={thumbnailGenerating}
                stopping={thumbnailStopping}
                progress={thumbnailProgress}
                onGenerateThumbnails={onGenerateThumbnails}
                onStopGenerating={onStopThumbnailGeneration}
                onDeleteThumbnail={onDeleteThumbnail}
                t={t}
                isKo={isKo}
              />
              <div className="batch-wizard-summary">
                {t('reference.batchCount', { count: generatableRefs.length })}
              </div>
            </div>
            <div className="batch-wizard-footer">
              <button className="btn-wizard-cancel" onClick={() => setShowBatchWizard(false)} disabled={thumbnailGenerating}>
                {t('common.cancel')}
              </button>
              <button className="btn-wizard-start" onClick={() => { setShowBatchWizard(false); onGenerateAll() }} disabled={thumbnailGenerating}>
                🎨 {t('reference.batchStart')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 상세 모달 */}
      {detailIndex !== null && references[detailIndex] && (
        <ReferenceDetailModal
          reference={references[detailIndex]}
          index={detailIndex}
          onUpdate={handleUpdateRef}
          onUpload={onUpload}
          onGenerate={onGenerate}
          isGenerating={generatingRefs.includes(detailIndex)}
          onClose={() => setDetailIndex(null)}
          t={t}
          isKo={isKo}
          projectName={projectName}
          thumbnails={thumbnails}
        />
      )}
    </div>
  )
}
