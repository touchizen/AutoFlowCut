/**
 * ReferencePanel - 레퍼런스 이미지 관리 패널
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { REFERENCE_TYPES } from '../config/defaults'
import { useI18n } from '../hooks/useI18n'
import { useElapsedTimer } from '../hooks/useElapsedTimer'
import { useModalVisibility } from '../hooks/useModalVisibility'
import { getRatioClass, formatElapsedMs } from '../utils/formatters'
import { isReferenceImageDone } from '../services/generationStatus'
import ReferenceCard from './ReferenceCard'
import ReferenceDetailModal from './ReferenceDetailModal'
import StylePicker from './StylePicker'
import { toast } from './Toast'
import { selectUnsyncedRefs, syncRefToFlow, needsComposerRefresh, resolveSyncTarget } from '../utils/flowCharacterSync'
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
  refBatchActive = false,
  hasPendingBatch = false,
  selectedStyleRefId,
  onStyleRefChange,
  projectName,
  thumbnails = {},
  // 모달의 rename 이 bound projectId 를 main 에 넘겨야 한다 — 안 넘기면 projectIdFromUrl() 폴백으로
  //   드리프트한 Flow 프로젝트를 건드린다.
  flowProjectId = null,
  thumbnailGenerating = false,
  thumbnailStopping = false,
  thumbnailProgress = { current: 0, total: 0 },
  onGenerateThumbnails,
  onStopThumbnailGeneration,
  onDeleteThumbnail,
  appMode,  // #R28-3: 모달 업로드 stale-apply 가드용 스코프(mode) — getScopeToken 에 사용
}) {
  const { t } = useI18n()
  // #R34-fix: 살아있는 패널에서 갱신되는 ref 기반 스코프 토큰. 모달은 업로드 시작 시 닫혀(unmount)
  //   props 가 stale 로 굳으므로, 모달 props 기반 가드는 무력하다. 안정적 identity(빈 deps)지만
  //   scopeRef.current 는 매 렌더 최신값으로 갱신 → 백그라운드 완료가 프로젝트/모드 전환을 감지한다.
  const scopeRef = useRef('')
  scopeRef.current = `${appMode ?? ''}::${projectName ?? ''}`
  const getScopeToken = useCallback(() => scopeRef.current, [])
  const [collapsed, setCollapsed] = useState(false)
  const [detailIndex, setDetailIndex] = useState(null)
  const [showBatchWizard, setShowBatchWizard] = useState(false)
  const [batchStartedAt, setBatchStartedAt] = useState(null)

  // 생성 가능한 레퍼런스 (프롬프트 있고, 이미지 없음). 스타일 카드도 배치 대상.
  const generatableRefs = references.filter(r => r.prompt && !r.data && !r.filePath)
  // 아이템별 auth 토큰을 기다리는 동안 generatingRefs/preparingRefs 가 모두 비어도
  // 배치 수명은 계속된다. Stop·타이머·진입점 잠금은 batch-global 신호까지 따라간다.
  const isGenerating = refBatchActive || generatingRefs.length > 0

  // 진행률은 누적 기준 — 프롬프트 있는 전체(스타일 카드 포함) 중 완료된 개수.
  // 배치를 여러 번 나눠 돌려도 "N/total"이 일관되게 표시된다.
  // done 판정은 services/generationStatus의 공통 helper로 MCP와 정책 일치 (P2/P3 review v2/v3).
  const eligibleRefs = references.filter(r => r.prompt)
  const totalEligible = eligibleRefs.length
  const doneCount = eligibleRefs.filter(isReferenceImageDone).length
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

  // #R34: Flow 미동기화 character/scene 레퍼런스 — 일괄 동기화 버튼 노출/대상.
  const unsyncedRefs = selectUnsyncedRefs(references)
  const [syncingAll, setSyncingAll] = useState(false)

  // #R34: 미동기화 ref 를 Flow 에 일괄(직렬) 동기화. 공유 flowView DOM 자동화라 반드시 1건씩 순차
  //   실행(동시 실행 시 navigation 이 ERR_ABORTED 로 충돌). 끝나면 Flow SPA 1회 새로고침(이름 반영).
  // #R37: 동기화 루프는 최대 ~120s 직렬 DOM 자동화다. props 의 references 는 그 사이 갱신돼도
  //   클로저에 갇혀 stale 이므로, 매 렌더 갱신되는 ref 로 live 상태를 읽는다.
  const referencesRef = useRef(references)
  referencesRef.current = references

  const handleSyncAll = async () => {
    if (syncingAll) return
    const targets = selectUnsyncedRefs(references).map(ref => ({ ref, index: references.indexOf(ref) }))
    if (targets.length === 0) return
    setSyncingAll(true)
    let ok = 0, fail = 0
    // nameApplied 는 마지막 목록 캐시 반영까지 보장하지 못하므로, 실제 캐릭터 entity 작업을 누적한다.
    let needsRefresh = false
    // #R34-fix: 직렬 동기화 도중 프로젝트/모드가 바뀌면 이후 결과를 현재(새) 프로젝트 refs 에 반영하지 않는다.
    const startScope = getScopeToken()
    try {
      for (const item of targets) {
        const { ref, index: refIndex } = item
        if (getScopeToken() !== startScope) { console.warn('[ReferencePanel] scope changed during sync-all — aborting remaining'); break }
        // #R37: targets 는 클릭 시점 스냅샷이다. 루프가 도는 동안 모달 Sync 가 같은 ref 를 끝냈을 수
        //   있으므로 매 회차 live 로 다시 판단한다 — 스냅샷을 넘기면 그 사이 생긴 entityId 를 못 보고
        //   재업로드로 빠져 Flow 에 중복 entity 가 생긴다.
        const live = ref.id != null
          ? referencesRef.current.find(r => r.id === ref.id)
          : referencesRef.current[refIndex]
        const decision = resolveSyncTarget(live)
        if (decision.action === 'skip') {
          if (decision.reason === 'already-synced') ok++
          else console.warn('[ReferencePanel] sync-all skip:', ref?.name, decision.reason)
          continue
        }
        const target = decision.ref
        const patchTarget = (prev, patch) => prev.map((r, i) => (
          ref.id != null ? r.id === ref.id : i === refIndex
        ) ? { ...r, ...patch } : r)
        // #R34: 처리 중인 카드에 업로드 스피너(⏳) 표시(직렬이라 1개씩).
        onUpdate(prev => patchTarget(prev, { syncing: true }))
        let published = false
        const res = await syncRefToFlow(target, onUpload, {
          projectId: flowProjectId,
          scopeToken: startScope,
          refIndex,
          // result publish 를 flight 안으로 이동 — setter 전에 key 가 풀려 stale ref 로 재업로드되는 창 제거.
          publishResult: async (syncResult) => {
            published = true
            if (getScopeToken() !== startScope) return
            onUpdate(prev => patchTarget(prev, { ...(syncResult.patch || {}), syncing: false }))
          },
        })
        if (getScopeToken() !== startScope) {
          // scope 변경 = 다른 프로젝트. 여기서 쓰면 새 프로젝트의 같은 id 카드를 오염시킨다.
          //   (syncing 은 런타임 플래그라 프로젝트를 다시 열면 사라진다.)
          console.warn('[ReferencePanel] scope changed mid-sync — skipping stale apply')
          break
        }
        // #R37: patch 는 성공 여부와 무관하게 항상 반영한다(App sync 게이트와 동일 규칙).
        //   실패해도 entityId/workflowId 를 보존해야 다음 시도가 재업로드 없이 등록만 복구한다.
        //   버리면 다음 Sync 가 다시 업로드하고 Flow 에 중복 entity 가 쌓인다.
        // busy/timeout 처럼 task 자체가 시작되지 않으면 publish callback 이 안 불린다 — spinner 만 해제.
        if (!published) onUpdate(prev => patchTarget(prev, { syncing: false }))
        // 등록 자체가 실패했어도 uploadImage 로 entity 가 생겨 이름 반영을 시도했다면 마지막에 한 번
        // 재진입한다. scene/작업 미시작/대상 0건은 needsComposerRefresh 가 false 라 비용이 없다.
        if (needsComposerRefresh(target, res.result)) needsRefresh = true
        if (res.ok) {
          ok++
        } else {
          fail++
          console.warn('[ReferencePanel] sync-all failed for', ref?.name, res.error)
        }
      }
      // 캐릭터 entity 동기화가 실제로 한 건이라도 있었을 때만 마지막에 1회 새로고침한다.
      if (needsRefresh) { try { await window.electronAPI?.refreshFlowComposer?.() } catch (_e) {} }
      if (fail === 0) toast.success(t('reference.flowSyncAllSuccess', { ok }))
      else toast.error(t('reference.flowSyncAllFailed', { ok, fail }))
    } finally {
      setSyncingAll(false)
    }
  }

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
    // #R27-3: 업로드 등 async 작업 뒤 호출될 때 stale 'references' closure 로 전체 배열을
    //   재구성해 onUpdate 하면(특히 프로젝트 전환 중) 현재 프로젝트 refs 가 옛 배열로 통째로
    //   덮어써진다. 함수형 업데이트로 현재 state(prev)에 안정적 id 로 patch — 전환돼서 그 id 가
    //   현재 배열에 없으면 no-op 으로 통째-clobber 를 막는다. (id 없는 레거시 ref 는 길이가
    //   동일할 때만 index 폴백 — 전환되면 길이가 달라 clobber 안 됨.)
    const targetId = references[index]?.id
    onUpdate(prev => {
      if (!Array.isArray(prev)) return prev
      if (targetId != null) {
        return prev.some(r => r.id === targetId)
          ? prev.map(r => (r.id === targetId ? updatedRef : r))
          : prev
      }
      if (prev.length !== references.length) return prev
      const copy = [...prev]
      copy[index] = updatedRef
      return copy
    })
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
            {/* #R34: Flow 일괄 동기화 — 미동기화 character/scene 이 있을 때만(Flow 모드). 직렬 동기화. */}
            {appMode === 'flow' && unsyncedRefs.length > 0 && (
              <button
                className="btn-sync-all"
                onClick={handleSyncAll}
                disabled={syncingAll || isGenerating || hasPendingBatch}
                title={isKo ? '동기화 안 된 캐릭터/씬을 Flow 에 일괄 등록(@멘션 복구)' : 'Sync all unsynced refs to Flow'}
              >
                {syncingAll
                  ? `⏳ ${isKo ? '동기화 중' : 'Syncing'}…`
                  : `🔄 ${isKo ? '동기화' : 'Sync'} (${unsyncedRefs.length})`}
              </button>
            )}
            {/* Clear All 버튼 */}
            {references.length > 0 && (
              <button
                className="btn-clear-refs"
                onClick={handleClearAll}
                disabled={isGenerating || hasPendingBatch}
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
                disabled={hasPendingBatch}
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
              key={ref.id != null ? ref.id : `idx-${index}`}
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
              projectName={projectName}
              getScopeToken={getScopeToken}
              appMode={appMode}
              flowProjectId={flowProjectId}
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
          // #R9: 다른 ref 나 프로젝트로 바뀌면 remount → editData 가 stale(이전 ref 의 name/prompt 등)로
          //   남지 않게 한다(editData 는 mount 시 1회 초기화되므로).
          key={`${projectName}:${references[detailIndex].id ?? detailIndex}`}
          reference={references[detailIndex]}
          references={references}
          index={detailIndex}
          onUpdate={handleUpdateRef}
          onUpload={onUpload}
          onGenerate={onGenerate}
          isGenerating={generatingRefs.includes(detailIndex)}
          onClose={() => setDetailIndex(null)}
          t={t}
          isKo={isKo}
          projectName={projectName}
          appMode={appMode}
          getScopeToken={getScopeToken}
          thumbnails={thumbnails}
          selectedStyleRefId={selectedStyleRefId}
          flowProjectId={flowProjectId}
        />
      )}
    </div>
  )
}
