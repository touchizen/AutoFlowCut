/**
 * useImageUpload Hook - 이미지 업로드 공통 로직
 * 
 * 클릭/드래그앤드롭 업로드 + Flow 자동 업로드
 */

import { useState, useRef, useCallback } from 'react'
import { cleanBase64 } from '../utils/urls'

export function useImageUpload(options = {}) {
  const {
    onUploadComplete,  // (data) => void - 업로드 완료 콜백
    onUploadStart,     // #R34: () => void - 업로드 "시작" 콜백(파일 확정 직후). 모달을 즉시 닫아
                       //   Flow UI 진행을 보이게 하는 용도. 닫혀도 onUploadComplete 가 부모에 반영.
    uploadToFlow,     // (base64, meta) => Promise - Flow 업로드 함수
    category = 'MEDIA_CATEGORY_SUBJECT',  // 기본 카테고리
    uploadMeta = {},  // M4 T7: 추가 메타 (name, type, refId 등) — engineApi 정규화로 흘러감
    // #R28-3: 업로드 시작/완료 시점의 "스코프 토큰"(예: `${mode}::${projectName}`)을 반환하는 함수.
    //   업로드 await 동안 mode/project 가 바뀌면 토큰이 달라져, stale Flow 결과(mediaId/entity)를
    //   새 프로젝트/모드의 ref 에 적용하는 것을 막는다. 미지정 시 가드 없음(기존 동작).
    getScopeToken,
  } = options
  
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef(null)
  
  // 파일 처리
  const processFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return null

    setIsUploading(true)
    // #R34: 파일 확정 직후 시작 콜백 — 호출측(모달)이 즉시 닫혀 Flow UI 진행을 볼 수 있게 한다.
    if (typeof onUploadStart === 'function') { try { onUploadStart() } catch (e) { console.warn('[useImageUpload] onUploadStart error:', e?.message) } }
    // #R28-3: 업로드 시작 시점 스코프 캡처 — 완료 시 비교해 stale apply 차단.
    const startScope = typeof getScopeToken === 'function' ? getScopeToken() : null

    try {
      // base64로 변환
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      
      const cleanB64 = cleanBase64(base64)
      
      let result = {
        data: base64,
        mediaId: null,
        caption: null,
        // entity fields — populated when uploadResult carries them (Flow character upload)
        entityId: null,
        workflowId: null,
        registered: null,
        flowNameSyncStatus: null,
      }

      // Flow에 업로드 (함수가 있으면)
      if (uploadToFlow) {
        try {
          const uploadResult = await uploadToFlow(cleanB64, { category, ...uploadMeta })
          if (uploadResult.success) {
            result.mediaId = uploadResult.mediaId
            result.caption = uploadResult.caption || null
            // Propagate entity fields when Flow character upload returns them
            // (API mode returns none → these remain null → no behavior change)
            if (uploadResult.entityId != null) result.entityId = uploadResult.entityId
            if (uploadResult.workflowId != null) result.workflowId = uploadResult.workflowId
            if (uploadResult.registered != null) result.registered = uploadResult.registered
            if (uploadResult.flowNameSyncStatus != null) result.flowNameSyncStatus = uploadResult.flowNameSyncStatus
          }
        } catch (e) {
          console.warn('Flow upload failed:', e)
        }
      }
      
      // 완료 콜백 — #R28-3: 업로드 도중 mode/project 가 바뀌었으면 stale 결과를 적용하지 않는다.
      if (onUploadComplete) {
        const endScope = typeof getScopeToken === 'function' ? getScopeToken() : null
        if (startScope !== endScope) {
          console.warn('[useImageUpload] scope changed during upload — skipping stale onUploadComplete')
        } else {
          onUploadComplete(result)
        }
      }

      return result

    } catch (error) {
      console.error('File processing error:', error)
      return null
    } finally {
      setIsUploading(false)
    }
  }, [uploadToFlow, category, uploadMeta, onUploadComplete, onUploadStart, getScopeToken])
  
  // 파일 선택 핸들러
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file) {
      processFile(file)
      // input 리셋 (같은 파일 다시 선택 가능하게)
      e.target.value = ''
    }
  }, [processFile])
  
  // 드래그 오버 핸들러
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])
  
  // 드래그 떠남 핸들러
  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])
  
  // 드롭 핸들러
  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    
    const file = e.dataTransfer.files?.[0]
    if (file) {
      await processFile(file)
    }
  }, [processFile])
  
  // 파일 선택 다이얼로그 열기
  const openFileDialog = useCallback(() => {
    if (!isUploading) {
      fileInputRef.current?.click()
    }
  }, [isUploading])
  
  // 드롭존에 바인딩할 props
  const getDropZoneProps = useCallback(() => ({
    onClick: openFileDialog,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop
  }), [openFileDialog, handleDragOver, handleDragLeave, handleDrop])
  
  // 파일 input에 바인딩할 props
  const getInputProps = useCallback(() => ({
    type: 'file',
    ref: fileInputRef,
    accept: 'image/*',
    onChange: handleFileSelect,
    style: { display: 'none' }
  }), [handleFileSelect])
  
  return {
    // 상태
    isUploading,
    isDragOver,
    
    // refs
    fileInputRef,
    
    // 핸들러
    processFile,
    openFileDialog,
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    
    // 편의 함수
    getDropZoneProps,
    getInputProps
  }
}

export default useImageUpload
