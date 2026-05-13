/**
 * ReferencePanel - 레퍼런스 이미지 관리 패널
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { REFERENCE_TYPES } from '../config/defaults'
import { useI18n } from '../hooks/useI18n'
import { useElapsedTimer } from '../hooks/useElapsedTimer'
import { useModalVisibility } from '../hooks/useModalVisibility'
import { getRatioClass, formatElapsedMs } from '../utils/formatters'
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
  preparingRefs = false,
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
  const [batchStartedAt, setBatchStartedAt] = useState(null)

  // 생성 가능한 레퍼런스 (프롬프트 있고, 이미지 없음, 스타일 제외)
  const generatableRefs = references.filter(r => r.prompt && !r.data && !r.filePath && r.type !== 'style')
  const isGenerating = generatingRefs.length > 0

  // 진행률은 누적 기준 — 스타일 제외 · 프롬프트 있는 전체 중 완료된 개수.
  // 배치를 여러 번 나눠 돌려도 "N/total"이 일관되게 표시된다.
  //
  // status가 명시적으로 in-flight면 (pending/generating/error) done에서 제외 — force 재생성 중
  // 이전 이미지/파일이 남아있는 상황에서 progress가 100%로 stuck되는 회귀 차단 (P2 fix).
  // status가 없거나 'done'이면 image fields로 판정 (legacy 호환).
  const eligibleRefs = references.filter(r => r.prompt && r.type !== 'style')
  const totalEligible = eligibleRefs.length
  const doneCount = eligibleRefs.filter(r =>
    (r.data || r.filePath) &&
    r.status !== 'pending' && r.status !== 'generating' && r.status !== 'error'
  ).length
  const errorCount = eligibleRefs.filter(r => r.status === 'error').length

  const batchElapsedSec = useElapsedTimer(batchStartedAt)
  const batchElapsed = batchElapsedSec * 1000 // ms 호환

  // 위저드 열릴 때 Flow 네이티브 뷰 숨기기
  useModalVisibility(showBatchWizard)

  // 일괄생성 시작/종료 감지 — 경과 시간 타이머용
  useEffect(() => {
    if (isGenerating && !batchStartedAt) {
      setBatchStartedAt(Date.now())
    } else if (!isGenerating && batchStartedAt) {
      setBatchStartedAt(null)
    }
  }, [isGenerating])

  // 스타일 레퍼런스 목록 (업로드된 Style 카드)
  const styleRefs = references.filter(r => r.type === 'style')
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
      caption: '',
      status: 'pending',
      errorMessage: null
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
            {/* 진행바 (생성 중일 때) - 삭제/생성 버튼 앞에 표시 */}
            {isGenerating && (
              <div className="ref-batch-progress">
                <div className="ref-batch-bar">
                  <div
                    className="ref-batch-fill"
                    style={{ width: `${totalEligible > 0 ? (doneCount / totalEligible) * 100 : 0}%` }}
                  />
                </div>
                <span className="ref-batch-text">
                  {doneCount}/{totalEligible}
                  {batchElapsed > 0 && ` · ${formatElapsedMs(batchElapsed)}`}
                  {errorCount > 0 && (isKo ? ` · 실패 ${errorCount}` : ` · ${errorCount} failed`)}
                </span>
              </div>
            )}
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
            {/* 일괄 생성 / 준비중 / 중단 버튼 */}
            {preparingRefs ? (
              <button
                className="btn-generate-all btn-preparing"
                disabled
              >
                ⏳ {t('reference.preparing')}
              </button>
            ) : isGenerating ? (
              <button
                className={`btn-generate-all btn-stop ${stoppingRefs ? 'stopping' : ''}`}
                onClick={onStopGenerateAll}
                disabled={stoppingRefs}
              >
                {stoppingRefs ? `⏳ ${t('reference.stopping')}...` : `⏹ ${t('reference.stop')}`}
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
              {/* Reference 위저드는 reference 카드 생성용 — 씬별 매칭과 무관하므로
                  scenes 안 넘김. StylePicker의 첫 카드는 단순 "스타일 없음"으로 동작. */}
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
