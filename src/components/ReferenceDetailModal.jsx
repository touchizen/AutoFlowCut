/**
 * ReferenceDetailModal - 레퍼런스 상세 모달
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { REFERENCE_TYPES, STYLE_PRESETS, RESOURCE } from '../config/defaults'
import { resolveImageSrc, hasImageData } from '../utils/formatters'
import { useImageUpload } from '../hooks/useImageUpload'
import { fileSystemAPI } from '../hooks/useFileSystem'
import { applyEntityRegistrationPatch } from '../utils/refEntityRegistration'
import { syncRefToFlow, needsComposerRefresh, refBadgeState } from '../utils/flowCharacterSync'
import PromptInput from './PromptInput'
import { toast } from './Toast'
import Modal from './Modal'
import StylePicker from './StylePicker'
import { createStyleResolver } from '../services/styleResolver'
import { isStyleReference } from '../services/styleService'
import ErrorSection from './ErrorSection'
import { StopwatchIcon, ElapsedTime } from './StopwatchIcon'

export default function ReferenceDetailModal({ reference, index, onUpdate, onUpload, onClose, onGenerate, isGenerating, t, isKo, projectName, appMode, getScopeToken: getScopeTokenProp, thumbnails = {}, references = [], selectedStyleRefId = null, flowProjectId = null }) {
  const [editData, setEditData] = useState({ ...reference })
  // 스타일 팝업은 두 뜻으로 쓰인다: 스타일 카드의 '프리셋에서 채우기' vs 그 외 카드의 '적용할 스타일'.
  //   같은 위젯이 다른 뜻으로 동시에 뜨면 헷갈리므로 타입에 따라 하나만 연다.
  const [showStyleDropdown, setShowStyleDropdown] = useState(false)
  const [styleDropdownMode, setStyleDropdownMode] = useState('preset')
  const [histories, setHistories] = useState([])
  const [shouldReloadHistory, setShouldReloadHistory] = useState(0)
  const [imageSize, setImageSize] = useState(null)
  // #R9-5: 사용자가 모달에서 이미지를 로컬로 바꿨는지(미저장). dirty 면 prop→local 미디어 동기화를
  //   건너뛰어, 배경 자동화(on-demand 등록 등)가 reference.mediaId 를 바꿔도 미저장 편집을 덮지 않는다.
  const mediaDirtyRef = useRef(false)
  // #R34: 업로드 시작 시 모달을 즉시 닫아 Flow UI 진행을 보이게 한다. 닫히면 onUploadComplete 가
  //   setEditData(언마운트됨) 대신 onUpdate(부모)로 결과를 반영하도록, 닫힘 여부 + 스냅샷을 ref 로 보관.
  const uploadClosingRef = useRef(false)
  const uploadSnapshotRef = useRef(null)

  // 미디어 필드 동기화 (재생성/이미지 교체 완료 시) + 히스토리 재로드 트리거.
  useEffect(() => {
    // #R9-5: 미저장 로컬 이미지 편집이 있으면 prop 으로 덮어쓰지 않는다.
    if (mediaDirtyRef.current) return
    setEditData(prev => ({
      ...prev,
      data: reference.data,
      filePath: reference.filePath,
      mediaId: reference.mediaId,
      caption: reference.caption,
      // 생성이 카드에 찍는 스타일 기억. 모달이 열린 채 배치가 돌면 prev 에는 없어서, 저장/재생성이
      //   editData 로 ref 를 통째로 교체할 때 기억이 지워진다(그럼 재생성이 전역 스타일로 샌다).
      styleId: reference.styleId,
    }))
    // 히스토리 재로드 트리거
    setShouldReloadHistory(n => n + 1)
  // #R14-7: caption 도 dep — caption-only prop 갱신이 저장 시 stale 로 덮이지 않게.
  }, [reference.data, reference.filePath, reference.mediaId, reference.caption, reference.styleId])

  // #R6-17/#R8-9: entity 필드는 별도 effect 로 동기화. on-demand 등록(useAutomation)이 prop 의
  //   entityId/registered/flowNameSyncStatus 만 갱신해도 모달 저장 시 fresh 등록이 유지되게 하되,
  //   미디어 필드(미저장 이미지 편집)는 건드리지 않도록 분리한다(entity-only 갱신이 미디어를 덮지 않음).
  useEffect(() => {
    // #R17-1: 사용자가 미저장 미디어 편집(교체/제거/스타일 적용)을 한 상태(mediaDirtyRef)면
    //   로컬에서 비운 entity 필드를 prop 의 옛 값으로 되돌리지 않는다(잘못된 캐릭터 멘션 방지).
    if (mediaDirtyRef.current) return
    setEditData(prev => ({
      ...prev,
      entityId: reference.entityId,
      workflowId: reference.workflowId,
      registered: reference.registered,
      flowNameSyncStatus: reference.flowNameSyncStatus,
    }))
  }, [reference.entityId, reference.workflowId, reference.registered, reference.flowNameSyncStatus])
  
  // #R28-3: 업로드 await 동안 mode/project 가 바뀌면 stale Flow 결과(mediaId/entity)를
  //   현재 모달 상태에 적용하지 않도록 스코프 토큰을 제공한다.
  // #R34-fix: 부모(ReferencePanel)가 ref 기반 live 토큰을 넘기면 그걸 쓴다 — 모달은 업로드 시작 시
  //   닫혀(unmount) props 가 stale 로 굳으므로, props 기반 토큰만으론 프로젝트 전환을 감지 못한다.
  const localScopeToken = useCallback(() => `${appMode ?? ''}::${projectName ?? ''}`, [appMode, projectName])
  const getScopeToken = getScopeTokenProp || localScopeToken
  const imageUpload = useImageUpload({
    uploadToFlow: onUpload,
    getScopeToken,
    category: editData.category,
    // Codex #3: pass type/name/refId so Flow character upload can route to
    // flowUploadCharacterEntity and return entityId/workflowId/registered.
    uploadMeta: { type: editData.type, name: editData.name, refId: editData.id },
    // #R38: 상세 모달 직접 업로드도 sync/생성과 같은 project-scoped 공유 flowView 조정기를 쓴다.
    // onUploadComplete 의 부모 state publish 까지 lock 안에서 끝나므로 stale ref 재진입도 막힌다.
    flowOperation: {
      enabled: appMode === 'flow' && editData.type === 'character',
      ref: editData,
      projectId: flowProjectId,
      refIndex: index,
    },
    onUploadComplete: (result) => {
      // R31 review fix: 새 이미지로 교체 시 filePath/dataStorage 도 클리어 해야
      // handleSave 의 `!editData.filePath` 가드가 saveReference 를 새로 호출 →
      // 디스크에도 새 이미지가 기록되고 resolveImageSrc 도 새 이미지 표시.
      // handleRestoreHistory (line 104) 가 이미 같은 정책 사용.
      // R32 review fix: mediaId/caption 도 클리어. Flow upload 실패 (result.mediaId
      // null) 시 옛 mediaId 유지하면 자동화 (useAutomation.js:428) 가 새 이미지를
      // 안 올리고 옛 mediaId 를 그대로 주입 → 새 이미지 무시. 새 result 가 있을
      // 때만 그 값으로 채움.
      // Codex #3: propagate entity fields (entityId, workflowId, flowNameSyncStatus,
      // registered) so a manually-replaced Flow character image becomes mention-eligible.
      // #R16-3: entity 필드를 함께 처리한다. fresh 등록이 있으면 그 값으로, 없으면(새 이미지로
      //   교체했는데 entity 미등록) 옛 entityId/workflowId/registered 를 비운다 — 안 그러면 새 이미지
      //   ref 가 옛 캐릭터의 entityId 로 멘션돼 잘못된 캐릭터를 가리킨다(needsEntityRegistration 이
      //   재등록하도록 entityId 를 null 로).
      // #R17-2: 미디어 교체이므로 patch 의 base 를 "비운 ref"로 준다 — result 가 entityId 를 생략하면
      //   옛 editData.entityId 가 보존(R12-9)되어 새 이미지가 옛 캐릭터를 가리키는 것을 막는다.
      // #R34: 업로드 시작 시 모달을 닫았으면(uploadClosingRef) base 는 닫기 시점 스냅샷.
      const closing = uploadClosingRef.current
      const base = closing && uploadSnapshotRef.current ? uploadSnapshotRef.current : editData
      const hasEntityFields = result.entityId != null || result.workflowId != null
      const clearedBase = { ...base, entityId: null, workflowId: null, mediaId: null }
      const entityPatch = hasEntityFields
        ? applyEntityRegistrationPatch(clearedBase, result, true)
        : { entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null }
      // #R34: 이름이 비어 있으면 업로드 파일명(result.name)으로 채운다(카드 업로드와 동일).
      const baseNameTrim = base.name && String(base.name).trim()
      const merged = {
        ...base,
        ...(baseNameTrim ? {} : (result.name ? { name: result.name } : {})),
        data: result.data,
        mediaId: result.mediaId || null,
        caption: result.caption || null,
        filePath: null,
        dataStorage: null,
        // entity fields from Flow character upload
        ...entityPatch,
        syncing: false,  // #R34: 업로드 완료 → 카드 스피너 해제
        // cache bust (R27)
        generatedAt: Date.now(),
      }
      if (closing) {
        // 모달이 이미 닫힘 → setEditData(언마운트)는 무효이므로 부모 ref 에 직접 반영.
        onUpdate(index, merged)
        uploadClosingRef.current = false
        uploadSnapshotRef.current = null
      } else {
        // #R9-5: 로컬 이미지 교체 = 미저장 편집 → prop 동기화가 덮지 않도록 dirty 표시.
        mediaDirtyRef.current = true
        setEditData(prev => ({ ...prev, ...merged }))
      }
      // #R33: 캐릭터 entity 등록(entityId 수신) 직후 Flow SPA 새로고침 — 새 이름이 'Untitled' 로
      //   stale 하게 보이거나 멘션 피커가 옛 이름으로 뜨는 것을 방지(비차단).
      if (result.entityId) { try { window.electronAPI?.refreshFlowComposer?.() } catch (_e) {} }
    },
    // #R34: 업로드 시작 → 즉시 모달 닫기(Flow UI 진행 가시화). 결과는 위 onUploadComplete 가
    //   onUpdate 로 부모 ref 에 반영하므로 닫혀도 안전. 스냅샷으로 merge base 보존.
    onUploadStart: () => {
      uploadSnapshotRef.current = { ...editData }
      uploadClosingRef.current = true
      // #R34: 카드에 업로드 스피너(⏳)를 즉시 표시 — 카드 자체 업로드와 동일 반응. 완료 시 해제.
      onUpdate(index, { ...editData, syncing: true })
      onClose()
    },
    // #R34-fix: 파일 처리 실패(FileReader 등) 시 syncing 스피너가 영구 고착되지 않게 부모에서 해제.
    onUploadError: () => {
      const snap = uploadSnapshotRef.current || editData
      onUpdate(index, { ...snap, syncing: false })
      uploadClosingRef.current = false
      uploadSnapshotRef.current = null
    },
  })
  
  // #R12-15: isActive 가드로 stale 결과 적용 방지 + 예외 catch(unhandled rejection 방지).
  const loadHistory = async (isActive = () => true) => {
    try {
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
        if (isActive()) setHistories(historiesWithData.filter(h => h.data))
      } else if (isActive()) {
        // #R13-16: 빈/실패 결과면 이전 ref 의 stale 썸네일이 남지 않게 비운다.
        setHistories([])
      }
    } catch (e) {
      console.warn('[ReferenceDetail] loadHistory failed:', e?.message)
      if (isActive()) setHistories([])
    }
  }

  // 히스토리 로드
  useEffect(() => {
    let cancelled = false
    if (projectName && reference.name) {
      loadHistory(() => !cancelled)
    }
    return () => { cancelled = true }
  }, [projectName, reference.name, shouldReloadHistory])
  
  // 히스토리 이미지 선택
  const handleRestoreHistory = (historyItem) => {
    // #R9-5: 히스토리 복원도 미저장 로컬 미디어 변경 → dirty.
    mediaDirtyRef.current = true
    setEditData(prev => ({
      ...prev,
      data: historyItem.data,
      mediaId: historyItem.metadata?.mediaId || null,
      caption: historyItem.metadata?.caption || null,
      filePath: null,  // 저장 시 새로 저장되도록
      dataStorage: null,
      // #R16-3: 다른 이미지로 복원 → 옛 entity 등록은 무효(새 미디어). 멘션이 옛 캐릭터를 가리키지
      //   않게 entity 필드 클리어(재등록 대상이 되도록).
      entityId: historyItem.metadata?.entityId ?? null,
      workflowId: historyItem.metadata?.workflowId ?? null,
      registered: null,
      flowNameSyncStatus: null,
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
    
    // #R9-5: 저장 완료 → 더 이상 미저장 편집 아님(이후 prop 동기화 허용).
    mediaDirtyRef.current = false

    // #R34: 이미 Flow 에 등록된(entityId) character 의 이름을 바꿔 저장하면 Flow entity 의
    //   displayName 도 재동기화한다(PATCH /flow/entities). 안 하면 앱 이름만 바뀌고 Flow/멘션
    //   피커는 옛 이름으로 남는다. 이름이 실제로 바뀐 경우에만, 백그라운드로 진행(저장은 즉시 닫힘).
    const needsFlowRename = appMode === 'flow'
      && editData.type === 'character'
      && editData.entityId
      && editData.name?.trim()
      && editData.name !== reference.name
    const renameSnapshot = needsFlowRename ? { entityId: editData.entityId, name: editData.name } : null
    const renameIdx = index
    const renameBase = { ...editData }
    // #R34-fix: rename 백그라운드 await 동안 프로젝트/모드가 바뀌면 stale index 에 적용 금지.
    const renameStartScope = getScopeToken()

    onUpdate(index, editData)
    onClose()

    if (renameSnapshot) {
      ;(async () => {
        // #R34-fix: rename 실패 시 로컬 ref 를 'failed'/registered:false 로 되돌린다. 안 그러면 앱은
        //   synced 로 오인하는데 Flow picker 엔 옛 이름이 남아 다음 `@새이름` 생성이 무조건 실패한다.
        //   (failed 로 두면 needsEntityRegistration/동기화 버튼이 재시도 후보로 잡는다.)
        const markFailed = () => {
          if (getScopeToken() !== renameStartScope) { console.warn('[ReferenceDetail] scope changed during rename — skipping stale failed-mark'); return }
          onUpdate(renameIdx, { ...renameBase, flowNameSyncStatus: 'failed', registered: false })
        }
        try {
          // bound projectId 를 넘긴다 — 안 넘기면 main 이 projectIdFromUrl() 로 폴백해, Flow 웹뷰가
          //   다른 프로젝트로 드리프트했을 때 엉뚱한 프로젝트 컨텍스트로 PATCH/navigate 한다.
          const res = await window.electronAPI?.renameFlowCharacter?.({ entityId: renameSnapshot.entityId, displayName: renameSnapshot.name, projectId: flowProjectId })
          if (res?.success) {
            // main 이 상세페이지 이름칸에 타이핑했으면(nameApplied) 재진입 왕복이 불필요하다.
            if (!res.nameApplied) { try { await window.electronAPI?.refreshFlowComposer?.() } catch (_e) {} }
            toast.success(isKo ? `Flow 이름 동기화: ${renameSnapshot.name}` : `Renamed in Flow: ${renameSnapshot.name}`)
          } else {
            markFailed()
            toast.error((isKo ? 'Flow 이름 동기화 실패: ' : 'Flow rename failed: ') + (res?.error || 'unknown'))
          }
        } catch (e) {
          markFailed()
          toast.error((isKo ? 'Flow 이름 동기화 오류: ' : 'Flow rename error: ') + (e?.message || String(e)))
        }
      })()
    }
  }

  // 스타일 선택 핸들러 (StylePicker에서 preset:ID 형식으로 옴)
  const handleStylePickerSelect = (id) => {
    // #R10-8: 스타일 선택/해제도 media(data/mediaId/filePath) 를 바꾸는 로컬 편집 → dirty 표시
    //   (배경 prop 동기화가 이 변경을 되돌리지 않게).
    mediaDirtyRef.current = true
    if (!id || !id.startsWith('preset:')) {
      // 선택 해제 — 모든 ref 필드를 함께 클리어해 stale mediaId/filePath/caption이
      // findAutoStyle()에 잡히지 않도록 한다 (이름 빈 ref인데 mediaId 살아있는 상태 방지).
      setEditData(prev => ({
        ...prev,
        name: '', prompt: '', description: '',
        data: null, filePath: null, mediaId: null, caption: null, dataStorage: null,
        // #R16-3: 미디어/이름 클리어 시 옛 entity 등록도 무효화.
        entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null,
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
      // #R16-3: 프리셋 적용 시 옛 entity 등록도 무효화.
      entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null,
    }))
  }

  // 현재 editData.name에 해당하는 preset ID 찾기
  const currentPresetId = STYLE_PRESETS?.styles?.find(s => s.name_ko === editData.name)?.id
  const selectedStylePickerId = currentPresetId ? `preset:${currentPresetId}` : null
  
  const typeInfo = REFERENCE_TYPES.find(t => t.value === editData.type) || REFERENCE_TYPES[0]
  const isStyle = editData.type === 'style'

  // 이 카드가 어떤 스타일로 생성될지. styleId 키가 있으면 그게 카드의 기억이고(null = 무스타일),
  //   없으면(새 카드) 전역 스타일 → 다른 카드들의 기억 → 자동 탐색 순으로 결정된다.
  //   기억이 없을 땐 '자동: X' 로 표시해 지금 무엇이 적용될지 보이게 한다.
  const styleRefs = references.filter(isStyleReference)
  // 키 존재가 아니라 값으로 판정한다 — prop 동기화 effect 가 styleId:undefined 로 키를 만든다.
  //   (undefined = 기억 없음, null = '무스타일로 생성됨'이라는 정당한 기억)
  const hasStyleMemory = editData.styleId !== undefined
  const resolvedStyleId = hasStyleMemory
    ? editData.styleId
    : createStyleResolver({ activeTab: 'list', scenes: [], references, selectedStyleRefId, t, isKo })
      .resolveEffectiveStyleIdForRef(null)
  const styleLabelFor = (id) => {
    if (!id || id === 'none') return t('reference.styleNone')
    if (String(id).startsWith('preset:')) {
      const preset = STYLE_PRESETS?.styles?.find((x) => x.id === String(id).slice(7))
      return preset ? (isKo ? preset.name_ko : preset.name_en) : String(id)
    }
    const refId = String(id).slice(4)
    return styleRefs.find((r) => String(r.id) === refId)?.name || String(id)
  }
  const applyStyleLabel = hasStyleMemory
    ? styleLabelFor(resolvedStyleId)
    : `${t('reference.styleAuto')}: ${styleLabelFor(resolvedStyleId)}`

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
  
  // #R34: Flow 동기화 — 모달을 즉시 닫고 백그라운드로 진행(재생성 버튼과 동일 UX). 결과는 onUpdate
  //   로 부모 state 에 반영되므로 모달이 닫혀도 안전하다.
  //   - character: entity 재등록(entityId/이름) → Flow UI 삭제(stale)·등록 실패('failed')로 @멘션이
  //     안 될 때 복구. - scene 등: 일반 ref 업로드 → mediaId 재발급. (둘 다 이미지는 그대로 유지.)
  const handleSync = () => {
    if (!onUpload) return
    if (!hasImageData(editData)) { toast.error(isKo ? '이미지가 없습니다' : 'No image to sync'); return }
    if (!editData.name?.trim()) { toast.error(isKo ? '이름을 먼저 입력하세요' : 'Name required'); return }
    const refSnapshot = { ...editData }
    const idx = index
    // #R34-fix: 동기화는 백그라운드(모달 닫힘)로 진행되며 최대 ~120초 걸릴 수 있다. 그 사이 프로젝트/
    //   모드가 바뀌면 완료 콜백이 새 프로젝트의 같은 index 에 stale 결과를 덮어쓸 수 있어, 시작 스코프를
    //   캡처해 완료 시 현재 스코프와 다르면 onUpdate 를 건너뛴다.
    const startScope = getScopeToken()
    // #R34: 카드에 업로드 스피너(⏳) 표시 후 모달 즉시 닫기 — 동기화는 백그라운드로.
    onUpdate(idx, { ...editData, syncing: true })
    onClose()
    ;(async () => {
      let published = false
      const res = await syncRefToFlow(refSnapshot, onUpload, {
        projectId: flowProjectId,
        scopeToken: startScope,
        refIndex: idx,
        // 부모 state publish 까지 single-flight 안에서 끝낸다. setter 뒤 stale snapshot 재진입도 합류한다.
        publishResult: async (syncResult) => {
          published = true
          if (getScopeToken() !== startScope) return
          onUpdate(idx, { ...refSnapshot, ...(syncResult.patch || {}), syncing: false })
        },
      })
      if (getScopeToken() !== startScope) {
        // scope 변경 = 다른 프로젝트. 여기서 옛 snapshot 을 onUpdate 하면 ref id 가 프로젝트별로
        //   재사용되므로 새 프로젝트의 같은 id 카드를 옛 값으로 덮어쓴다. 아무것도 쓰지 않는다.
        //   (syncing 은 런타임 플래그라 프로젝트를 다시 열면 사라진다.)
        console.warn('[ReferenceDetail] scope changed during sync — skipping stale apply')
        return
      }
      // busy/timeout 은 task/publish callback 이 실행되지 않는다 — 런타임 spinner 만 해제한다.
      if (!published) onUpdate(idx, { ...refSnapshot, syncing: false })
      if (res.ok) {
        // 이름을 SPA 에 못 넣었을 때만 새로고침(나갔다 재진입)한다.
        if (needsComposerRefresh(refSnapshot, res.result)) {
          try { await window.electronAPI?.refreshFlowComposer?.() } catch (_e) {}
        }
        toast.success(isKo ? `Flow 동기화 완료: ${refSnapshot.name}` : `Synced to Flow: ${refSnapshot.name}`)
      } else {
        toast.error((isKo ? '동기화 실패: ' : 'Sync failed: ') + (res.error || 'unknown'))
      }
    })()
  }

  // 재생성 핸들러 — 생성은 백그라운드로 계속되고 모달은 즉시 닫힘 (§3.8)
  const handleRegenerate = () => {
    console.log('[ReferenceDetail] Regenerate clicked', { index, editData, onGenerate: !!onGenerate })
    if (!onGenerate) {
      console.error('[ReferenceDetail] onGenerate is not defined!')
      return
    }
    try {
      // 부모 state에 편집 내용 반영 (다음 render에 commit)
      onUpdate(index, editData)
      // editData를 4번째 인자로 직접 넘겨서 React state commit race를 우회.
      // (그렇지 않으면 useReferenceGeneration이 옛 references[index]를 읽어
      // noPrompt 경로 또는 옛 prompt로 생성하는 race 발생)
      // 주의: onUpdate → onGenerate 순서 유지 필수 (editData race-condition 우회)
      onGenerate(index, false, null, editData)
      onClose()
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
                      // #R10-8: 이미지 제거도 미저장 로컬 미디어 변경 → dirty(배경 prop 동기화가 되돌리지 않게).
                      mediaDirtyRef.current = true
                      // #R16-3: 이미지 제거 시 옛 entity 등록도 무효화(멘션이 옛 캐릭터를 가리키지 않게).
                      setEditData(prev => ({ ...prev, data: null, filePath: null, mediaId: null, caption: null, dataStorage: null, entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null }))
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
                  onClick={() => { setStyleDropdownMode('preset'); setShowStyleDropdown(true) }}
                  title={t('reference.fillFromPreset')}
                >
                  {t('reference.fillFromPreset')} ▼
                </button>
              )}
            </div>
          </div>

          {/* 적용할 스타일 — 스타일 카드에는 없다(자기 자신에 스타일을 적용하지 않는다). */}
          {!isStyle && (
            <div className="detail-field">
              <label>{t('reference.applyStyle')}</label>
              <button
                type="button"
                className="btn-fill-preset"
                data-testid="apply-style"
                onClick={() => { setStyleDropdownMode('apply'); setShowStyleDropdown(true) }}
              >
                {applyStyleLabel} ▼
              </button>
            </div>
          )}

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
            <PromptInput
              value={editData.prompt || ''}
              onChange={(text) => setEditData({ ...editData, prompt: text })}
              placeholder={t('reference.promptPlaceholder')}
              // 장면(scene) 레퍼런스만 @로 캐릭터 지정 가능. 그 외 타입은 picking 없음(기존 chip 은 렌더).
              references={editData.type === 'scene' ? (references || []).filter(r => r?.type === 'character') : []}
              hideFooter
            />
          </div>

          {/* 상태 정보 */}
          <div className="ref-detail-status">
            {(editData.mediaId || imageSize) && (
              <span className={`status-badge ${refBadgeState(editData, appMode) === 'needs-sync' ? 'warning' : 'success'}`}>
                {refBadgeState(editData, appMode) === 'ok' && `✅ ${t('reference.uploadedToFlow')}`}
                {refBadgeState(editData, appMode) === 'needs-sync' && `⚠️ ${t('reference.needsFlowSync')}`}
                {editData.mediaId && imageSize && ' · '}
                {imageSize && `${imageSize.width} × ${imageSize.height}`}
              </span>
            )}
            {/* #R33: Character/Scene + Flow 모드 — Flow 동기화 상태 + 수동 동기화 버튼.
                character 는 entity(@멘션) 동기화, scene 등은 mediaId 업로드 상태로 판정. */}
            {(editData.type === 'character' || editData.type === 'scene') && appMode === 'flow' && (() => {
              const isSynced = editData.type === 'character'
                ? !!(editData.entityId && editData.flowNameSyncStatus === 'synced')
                : !!editData.mediaId
              return (
                <div className="ref-sync-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', fontSize: '0.8rem' }}>
                  <span style={{ color: isSynced ? 'var(--text-secondary)' : '#e5a23d' }}>
                    {isSynced
                      ? `✅ ${isKo ? 'Flow 동기화됨' : 'Synced to Flow'}`
                      : `⚠️ ${isKo ? 'Flow 미동기화' : 'Not synced to Flow'}`}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                    onClick={handleSync}
                    // #R37: 이미 동기화가 진행 중이면 막는다 — 모달은 닫고 백그라운드로 돌기 때문에
                    //   다시 눌리면 같은 ref 를 두 번 업로드하고 Flow 가 새 entity 를 또 만든다.
                    disabled={!hasImageData(editData) || !!reference.syncing}
                    title={isKo ? '동기화 후 모달이 닫히고 백그라운드로 진행(@멘션/레퍼런스 복구)' : 'Closes modal and syncs in background'}
                  >
                    🔄 {isKo ? '동기화' : 'Sync'}
                  </button>
                </div>
              )
            })()}
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
              selectedId={styleDropdownMode === 'apply' ? (resolvedStyleId || null) : selectedStylePickerId}
              onSelect={(id) => {
                if (styleDropdownMode === 'apply') {
                  // 카드의 스타일 기억을 바꾼다. 재생성은 ref.styleId 를 전역 선택보다 우선하므로
                  //   저장만 하면 그대로 따라온다(override 를 따로 넘길 필요 없다).
                  setEditData((prev) => ({ ...prev, styleId: id ?? null }))
                } else {
                  handleStylePickerSelect(id)
                }
                setShowStyleDropdown(false)
              }}
              uploadedStyleRefs={styleDropdownMode === 'apply' ? styleRefs : []}
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
