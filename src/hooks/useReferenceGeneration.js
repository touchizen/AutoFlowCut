/**
 * useReferenceGeneration - 레퍼런스 이미지 생성 (개별 + 일괄)
 */

import { useState, useRef, useCallback } from 'react'
import { RESOURCE, STYLE_PRESETS } from '../config/defaults'
import { fileSystemAPI } from './useFileSystem'
import { generateProjectName } from '../utils/formatters'
import { checkFolderPermission, checkAuthToken } from '../utils/guards'
import { toast } from '../components/Toast'

// 1~3초 랜덤 딜레이
const randomDelay = () => new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))

export function useReferenceGeneration({ settings, references, setReferences, flowAPI, addPendingSave, openSettings, pendingSavesCount = 0, t, selectedStyleRefId, styleThumbnails, generationQueue }) {
  const [generatingRefs, setGeneratingRefs] = useState([])
  const [stoppingRefs, setStoppingRefs] = useState(false)
  const [preparingRefs, setPreparingRefs] = useState(false)  // 배치 준비 중 (권한/토큰/썸네일 업로드)
  const [saveFailedOnce, setSaveFailedOnce] = useState(false)  // 배치 중 저장 실패 알림 1회만
  const stopRequestedRef = useRef(false)
  const presetMediaCache = useRef({})  // 프리셋 썸네일 → Flow mediaId 캐시

  const stopGenerateAllRefs = useCallback(() => {
    stopRequestedRef.current = true
    setStoppingRefs(true)
  }, [])

  // 핵심 생성 로직 (개별)
  // @param {number} index - 레퍼런스 인덱스
  // @param {boolean} skipPermissionCheck - 배치 모드에서 권한 체크 스킵
  // @returns {{ success: boolean, authError?: boolean }} 생성 결과
  const _executeGenerateRef = async (index, skipPermissionCheck = false, overrideStyleId = null) => {
    const ref = references[index]
    if (!ref?.prompt) {
      toast.warning(t('toast.noPrompt'))
      return { success: false }
    }

    // 폴더 설정 + 토큰 확인 (배치 모드에서는 권한 체크 스킵 - 저장 실패 시 메모리 보관)
    if (!skipPermissionCheck) {
      const folderCheck = await checkFolderPermission(settings, openSettings, t)
      if (!folderCheck.ok) return { success: false, permissionError: folderCheck.permissionError }
    }
    if (!(await checkAuthToken(flowAPI, t))) return { success: false, authError: true }

    setGeneratingRefs(prev => [...prev, index])

    try {
      // 스타일 주입 (style 카드 자체 생성 시에는 제외)
      const styleRefImages = []
      let styledPrompt = ref.prompt
      // MCP에서 styleId가 전달된 경우 우선 적용
      // selectedStyleRefId 없으면 등록된 style 카드 자동 탐색
      let effectiveStyleId = overrideStyleId || selectedStyleRefId
      if (!effectiveStyleId && ref.type !== 'style') {
        const autoStyle = references.find(r => r.type === 'style' && r.mediaId)
        if (autoStyle) {
          effectiveStyleId = `ref:${autoStyle.id}`
          console.log('[StyleRef] Auto-detected style card:', autoStyle.name, autoStyle.id)
        }
      }
      if (ref.type !== 'style' && effectiveStyleId) {
        if (effectiveStyleId.startsWith('ref:')) {
          // 업로드된 스타일 레퍼런스
          const refId = effectiveStyleId.replace('ref:', '')
          const styleRef = references.find(r => r.id == refId && r.type === 'style')
          if (styleRef) {
            // mediaId가 있으면 이미지 레퍼런스로 전달
            if (styleRef.mediaId) {
              styleRefImages.push({ category: styleRef.category, mediaId: styleRef.mediaId, caption: styleRef.caption || '' })
            }
            // 스타일 프롬프트를 생성 프롬프트에 합침
            if (styleRef.prompt) {
              styledPrompt = `${ref.prompt}, ${styleRef.prompt}`
            }
          }
        } else if (effectiveStyleId.startsWith('preset:')) {
          const presetId = effectiveStyleId.replace('preset:', '')
          const preset = STYLE_PRESETS?.styles?.find(s => s.id === presetId)

          // 썸네일이 있으면 이미지 스타일 레퍼런스로 업로드 (캐시 활용)
          if (styleThumbnails?.[presetId]) {
            let mediaId = presetMediaCache.current[presetId]
            if (!mediaId) {
              const thumbData = styleThumbnails[presetId]
              let cleanBase64 = null
              // filePath인 경우 파일에서 읽기 (메모리 최적화)
              if (thumbData.startsWith('/') || /^[A-Z]:\\/i.test(thumbData)) {
                try {
                  const fileResult = await fileSystemAPI.readFileByPath(thumbData)
                  if (fileResult.success) {
                    cleanBase64 = fileResult.data?.split(',')[1] || fileResult.data
                  }
                } catch (e) {
                  console.warn('[StyleRef] Failed to read thumbnail file:', e)
                }
              } else {
                // data URL 또는 blob URL fallback
                cleanBase64 = thumbData.split(',')[1] || thumbData
              }
              if (cleanBase64) {
                try {
                  const uploadResult = await flowAPI.uploadReference(cleanBase64, 'style')
                  if (uploadResult.success) {
                    mediaId = uploadResult.mediaId
                    presetMediaCache.current[presetId] = mediaId
                    console.log('[StyleRef] Preset thumbnail uploaded, mediaId:', mediaId)
                  }
                } catch (e) {
                  console.warn('[StyleRef] Preset thumbnail upload failed:', e)
                }
              }
            }
            if (mediaId) {
              styleRefImages.push({ category: 'style', mediaId, caption: preset?.prompt_en || '' })
            }
          }

          // 프롬프트에도 스타일 텍스트 추가 (이미지 + 텍스트 이중 보강)
          if (preset?.prompt_en) {
            styledPrompt = `${ref.prompt}, ${preset.prompt_en}`
          }
        }
      }

      const result = await flowAPI.generateImageDOM(styledPrompt, styleRefImages, { batchCount: settings.imageBatchCount })

      if (result.success && result.images?.length > 0) {
        // images는 [{ base64, mediaId }] 객체 배열
        const firstImage = result.images[0]
        let imageData = firstImage.base64 || firstImage  // backward compat

        // 이미지 업스케일 (설정에 따라, style 카드 제외)
        const upscaleRes = settings.imageUpscale || 'off'
        const origMediaId = firstImage.mediaId || null
        if (upscaleRes !== 'off' && origMediaId && ref.type !== 'style') {
          try {
            console.log('[Reference] Upscaling image to', upscaleRes, '...')
            const upResult = await flowAPI.upscaleImage(origMediaId, upscaleRes)
            if (upResult.success && upResult.data) {
              imageData = upResult.data
              console.log('[Reference] Upscale success')
            } else {
              console.warn('[Reference] Upscale failed, using original:', upResult.error)
            }
          } catch (e) {
            console.warn('[Reference] Upscale error, using original:', e.message)
          }
        }

        // data URL prefix 보장 (img src 표시용)
        const displayUrl = imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`

        // 먼저 Flow에 업로드하여 mediaId + caption 받기
        const cleanBase64 = imageData.split(',')[1] || imageData
        let mediaId = null
        let caption = null
        console.log('[Reference] Uploading to Flow for mediaId...', { category: ref.category, base64Len: cleanBase64.length })
        try {
          const uploadResult = await flowAPI.uploadReference(cleanBase64, ref.category)
          console.log('[Reference] Upload result:', uploadResult)
          if (uploadResult.success) {
            mediaId = uploadResult.mediaId
            caption = uploadResult.caption
          }
        } catch (uploadErr) {
          console.error('[Reference] Upload failed:', uploadErr)
        }

        // 파일 시스템에 저장 (폴더 모드일 때) - metadata 포함
        let filePath = null
        let savedDataUrl = displayUrl  // 화면 표시용 data URL
        if (settings.saveMode === 'folder') {
          const projectName = settings.projectName || generateProjectName()
          const refName = ref.name || `ref_${index + 1}`
          const metadata = { mediaId, caption, category: ref.category }

          // 저장 전 권한 확인 (씬과 동일하게)
          const permission = await fileSystemAPI.ensurePermission()

          let saveResult = { success: false }
          if (permission.hasPermission) {
            saveResult = await fileSystemAPI.saveReference(projectName, refName, imageData, 'flow', metadata)
              .catch(e => ({ success: false, error: e.message }))
          }

          if (saveResult.success) {
            filePath = saveResult.path
            savedDataUrl = saveResult.dataUrl || displayUrl
            console.log('[Reference] Saved to:', filePath)
          } else {
            // 저장 실패 - 메모리에 보관하고 pending에 추가 후 계속 진행
            console.warn('[Reference] Save failed:', saveResult.error, '- keeping in memory and continuing...')

            // 첫 실패 시에만 토스트 표시
            if (!saveFailedOnce) {
              setSaveFailedOnce(true)
              toast.warning(t('toast.permissionReleasedMemory'))
            }

            // pendingSaves에 추가 (나중에 일괄 저장)
            addPendingSave(async () => {
              const pendingSave = await fileSystemAPI.saveReference(projectName, refName, imageData, 'flow', metadata)
              if (pendingSave.success) {
                console.log('[Reference] Pending save succeeded:', pendingSave.path)
                // 저장 성공 시 레퍼런스 업데이트
                setReferences(prev => prev.map((r, i) =>
                  i === index
                    ? { ...r, filePath: pendingSave.path, dataStorage: 'file' }
                    : r
                ))
              }
              return pendingSave
            })

            // filePath는 null로 유지 (메모리 저장)
            filePath = null
          }

          // 여분 이미지(2장 이상 생성된 경우) → History에만 저장 (mediaId 포함)
          await fileSystemAPI.saveExtraToHistory(projectName, RESOURCE.REFERENCES, refName, result.images, ref.prompt, 'Reference')
        }

        // 레퍼런스 업데이트 (함수형 업데이트로 최신 상태 사용)
        setReferences(prev => prev.map((r, i) =>
          i === index
            ? {
                ...r,
                data: savedDataUrl,
                filePath: filePath,
                dataStorage: filePath ? 'file' : 'base64',
                mediaId,
                caption
              }
            : r
        ))
        setGeneratingRefs(prev => prev.filter(i => i !== index))
        return { success: true, savedToMemory: filePath === null && settings.saveMode === 'folder' }
      } else if (!result.success) {
        // 에러 유형 체크
        const errorMsg = result.error || ''
        const isAuthError = errorMsg.includes('401') || errorMsg.includes('auth') || errorMsg.includes('token') || errorMsg.includes('login')
        const isServerError = errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503') || errorMsg.includes('server')
        toast.error(t('toast.generateFailed', { error: result.error || 'Unknown error' }))
        setGeneratingRefs(prev => prev.filter(i => i !== index))
        return { success: false, authError: isAuthError, serverError: isServerError }
      }
    } catch (error) {
      console.error('Reference generation error:', error)
      const errorMsg = error.message || ''
      const isAuthError = errorMsg.includes('401') || errorMsg.includes('auth') || errorMsg.includes('token') || errorMsg.includes('login')
      const isServerError = errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503') || errorMsg.includes('server')
      toast.error(t('toast.generateError', { error: error.message }))
      setGeneratingRefs(prev => prev.filter(i => i !== index))
      return { success: false, authError: isAuthError, serverError: isServerError }
    }

    setGeneratingRefs(prev => prev.filter(i => i !== index))
    return { success: false }
  }

  // ─── 비동기 결과 수집 + 후처리 (업스케일, 업로드, 저장) ───
  const processAsyncResult = async (generationId, index, ref) => {
    const result = await flowAPI.collectGeneration(generationId)

    if (!result.success || !result.images?.length) {
      const errorMsg = result.error || ''
      const isAuthError = errorMsg.includes('401') || errorMsg.includes('auth') || errorMsg.includes('token')
      const isServerError = errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503')
      toast.error(t('toast.generateFailed', { error: result.error || 'Unknown error' }))
      setGeneratingRefs(prev => prev.filter(i => i !== index))
      return { success: false, authError: isAuthError, serverError: isServerError }
    }

    // 이미지 후처리 (handleGenerateRef과 동일)
    const firstImage = result.images[0]
    let imageData = firstImage.base64 || firstImage

    // 업스케일 (style 카드 제외)
    const upscaleRes = settings.imageUpscale || 'off'
    const origMediaId = firstImage.mediaId || null
    if (upscaleRes !== 'off' && origMediaId && ref.type !== 'style') {
      try {
        console.log('[AsyncRef] Upscaling image to', upscaleRes, '...')
        const upResult = await flowAPI.upscaleImage(origMediaId, upscaleRes)
        if (upResult.success && upResult.data) {
          imageData = upResult.data
          console.log('[AsyncRef] Upscale success')
        } else {
          console.warn('[AsyncRef] Upscale failed, using original:', upResult.error)
        }
      } catch (e) {
        console.warn('[AsyncRef] Upscale error, using original:', e.message)
      }
    }

    const displayUrl = imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`

    // Flow에 업로드 → mediaId + caption
    const cleanBase64 = imageData.split(',')[1] || imageData
    let mediaId = null
    let caption = null
    try {
      const uploadResult = await flowAPI.uploadReference(cleanBase64, ref.category)
      if (uploadResult.success) {
        mediaId = uploadResult.mediaId
        caption = uploadResult.caption
      }
    } catch (uploadErr) {
      console.error('[AsyncRef] Upload failed:', uploadErr)
    }

    // 파일 저장 (폴더 모드)
    let filePath = null
    let savedDataUrl = displayUrl
    if (settings.saveMode === 'folder') {
      const projectName = settings.projectName || generateProjectName()
      const refName = ref.name || `ref_${index + 1}`
      const metadata = { mediaId, caption, category: ref.category }
      const permission = await fileSystemAPI.ensurePermission()

      let saveResult = { success: false }
      if (permission.hasPermission) {
        saveResult = await fileSystemAPI.saveReference(projectName, refName, imageData, 'flow', metadata)
          .catch(e => ({ success: false, error: e.message }))
      }

      if (saveResult.success) {
        filePath = saveResult.path
        savedDataUrl = saveResult.dataUrl || displayUrl
      } else {
        if (!saveFailedOnce) {
          setSaveFailedOnce(true)
          toast.warning(t('toast.permissionReleasedMemory'))
        }
        addPendingSave(async () => {
          const pendingSave = await fileSystemAPI.saveReference(projectName, refName, imageData, 'flow', metadata)
          if (pendingSave.success) {
            setReferences(prev => prev.map((r, i) =>
              i === index ? { ...r, filePath: pendingSave.path, dataStorage: 'file' } : r
            ))
          }
          return pendingSave
        })
      }

      await fileSystemAPI.saveExtraToHistory(projectName, RESOURCE.REFERENCES, refName, result.images, ref.prompt, 'Reference')
    }

    // 레퍼런스 업데이트
    setReferences(prev => prev.map((r, i) =>
      i === index
        ? { ...r, data: savedDataUrl, filePath, dataStorage: filePath ? 'file' : 'base64', mediaId, caption }
        : r
    ))
    setGeneratingRefs(prev => prev.filter(i => i !== index))
    return { success: true, savedToMemory: filePath === null && settings.saveMode === 'folder' }
  }

  // Handle reference image generation (일괄 — 비동기 fire-and-forget 방식)
  // AutoFlow 패턴: 제출 → 7~15초 대기 → 다음 제출, 결과는 별도 수집
  const _executeBatchRefs = async (overrideStyleId = null) => {
    const generatableIndices = references
      .map((ref, index) => (ref.prompt && !ref.data && !ref.filePath && ref.type !== 'style') ? index : -1)
      .filter(i => i !== -1)

    if (generatableIndices.length === 0) {
      toast.info(t('toast.allRefsGenerated'))
      return
    }

    // 배치 시작 - 플래그 리셋
    stopRequestedRef.current = false
    setStoppingRefs(false)
    setPreparingRefs(true)  // 즉시 "준비중" 표시
    let hasPendingSaves = false
    setSaveFailedOnce(false)

    // 폴더 모드 권한 확인
    if (settings.saveMode === 'folder') {
      const permission = await fileSystemAPI.ensurePermission()
      if (permission.error === 'not_set') { setPreparingRefs(false); openSettings('storage'); return }
      if (permission.error === 'folder_deleted') {
        toast.error(t('toast.folderDeleted'))
        setPreparingRefs(false); openSettings('storage')
        return
      }
      if (!permission.hasPermission) {
        toast.warning(t('toast.folderPermissionNeeded'))
        setPreparingRefs(false); openSettings('storage')
        return
      }
      console.log('[GenerateAllRefs] Permission granted:', permission.name)
    }

    // 토큰 확인
    if (!(await checkAuthToken(flowAPI, t))) { setPreparingRefs(false); return }

    // 비동기 대기열
    const pendingQueue = []  // [{ generationId, index, ref }]

    // 완료된 결과 수집 + 후처리
    const collectCompleted = async () => {
      for (let i = pendingQueue.length - 1; i >= 0; i--) {
        const pending = pendingQueue[i]
        try {
          const status = await flowAPI.checkGeneration(pending.generationId)
          if (status?.success && status.completed) {
            console.log('[GenerateAllRefs] Collecting completed gen:', pending.generationId, 'index:', pending.index)
            const result = await processAsyncResult(pending.generationId, pending.index, pending.ref)
            if (result?.savedToMemory) hasPendingSaves = true
            pendingQueue.splice(i, 1)
          }
        } catch (e) {
          console.warn('[GenerateAllRefs] Check failed for gen:', pending.generationId, e.message)
        }
      }
    }

    // 스타일 레퍼런스 준비 (공통)
    // MCP에서 styleId가 전달된 경우 우선 적용 (React state 비동기 반영 대응)
    // selectedStyleRefId 없으면 등록된 style 카드 자동 탐색
    let batchEffectiveStyleId = overrideStyleId || selectedStyleRefId
    if (!batchEffectiveStyleId) {
      const autoStyle = references.find(r => r.type === 'style' && r.mediaId)
      if (autoStyle) {
        batchEffectiveStyleId = `ref:${autoStyle.id}`
        console.log('[StyleRef] Batch auto-detected style card:', autoStyle.name, autoStyle.id)
      }
    }
    const prepareStyleRefs = (ref) => {
      const styleRefImages = []
      let styledPrompt = ref.prompt
      if (ref.type !== 'style' && batchEffectiveStyleId) {
        if (batchEffectiveStyleId.startsWith('ref:')) {
          const refId = batchEffectiveStyleId.replace('ref:', '')
          const styleRef = references.find(r => r.id == refId && r.type === 'style')
          if (styleRef) {
            if (styleRef.mediaId) {
              styleRefImages.push({ category: styleRef.category, mediaId: styleRef.mediaId, caption: styleRef.caption || '' })
            }
            if (styleRef.prompt) {
              styledPrompt = `${ref.prompt}, ${styleRef.prompt}`
            }
          }
        } else if (batchEffectiveStyleId.startsWith('preset:')) {
          const presetId = batchEffectiveStyleId.replace('preset:', '')
          const preset = STYLE_PRESETS?.styles?.find(s => s.id === presetId)
          if (styleThumbnails?.[presetId] && presetMediaCache.current[presetId]) {
            styleRefImages.push({ category: 'style', mediaId: presetMediaCache.current[presetId], caption: preset?.prompt_en || '' })
          }
          if (preset?.prompt_en) {
            styledPrompt = `${ref.prompt}, ${preset.prompt_en}`
          }
        }
      }
      return { styledPrompt, styleRefImages }
    }

    // 프리셋 썸네일 사전 업로드 (배치 전에 한 번만)
    if (batchEffectiveStyleId?.startsWith('preset:')) {
      const presetId = batchEffectiveStyleId.replace('preset:', '')
      if (styleThumbnails?.[presetId] && !presetMediaCache.current[presetId]) {
        const thumbData = styleThumbnails[presetId]
        let cleanBase64 = null
        // filePath인 경우 파일에서 읽기
        if (thumbData.startsWith('/') || /^[A-Z]:\\/i.test(thumbData)) {
          try {
            const fileResult = await fileSystemAPI.readFileByPath(thumbData)
            if (fileResult.success) {
              cleanBase64 = fileResult.data?.split(',')[1] || fileResult.data
            }
          } catch (e) {
            console.warn('[GenerateAllRefs] Failed to read thumbnail file:', e)
          }
        } else {
          cleanBase64 = thumbData.split(',')[1] || thumbData
        }
        if (cleanBase64) {
          try {
            const uploadResult = await flowAPI.uploadReference(cleanBase64, 'style')
            if (uploadResult.success) {
              presetMediaCache.current[presetId] = uploadResult.mediaId
              console.log('[GenerateAllRefs] Preset thumbnail pre-uploaded, mediaId:', uploadResult.mediaId)
            }
          } catch (e) {
            console.warn('[GenerateAllRefs] Preset thumbnail upload failed:', e)
          }
        }
      }
    }

    // ─── Phase 1: 비동기 제출 (fire-and-forget) ───
    setPreparingRefs(false)  // 준비 완료 → 생성 중으로 전환
    console.log('[GenerateAllRefs] Starting async batch for', generatableIndices.length, 'refs')
    let submitFailCount = 0

    for (const index of generatableIndices) {
      if (stopRequestedRef.current) {
        console.log('[GenerateAllRefs] Stop requested by user')
        toast.info(t('toast.batchStopped'))
        break
      }

      // 이전 결과 수집 (완료된 것만)
      await collectCompleted()

      const ref = references[index]
      const { styledPrompt, styleRefImages } = prepareStyleRefs(ref)

      // 생성 중 표시
      setGeneratingRefs(prev => [...prev, index])

      // 비동기 제출
      const submitResult = await flowAPI.submitGenerationDOM(styledPrompt, styleRefImages, { batchCount: settings.imageBatchCount })

      if (submitResult?.success && submitResult.generationId) {
        pendingQueue.push({ generationId: submitResult.generationId, index, ref })
        console.log('[GenerateAllRefs] Submitted index:', index, 'gen:', submitResult.generationId)
        submitFailCount = 0
      } else {
        console.warn('[GenerateAllRefs] Submit failed for index:', index, submitResult?.error)
        setGeneratingRefs(prev => prev.filter(i => i !== index))
        submitFailCount++

        // 연속 3회 실패 시 중단
        if (submitFailCount >= 3) {
          toast.error(t('toast.serverErrorPersist'))
          break
        }
      }

      // AutoFlow 스타일 대기 (7~15초) — 마지막이 아닐 때만
      if (index !== generatableIndices[generatableIndices.length - 1]) {
        const delay = 7000 + Math.random() * 8000
        console.log('[GenerateAllRefs] Waiting', Math.round(delay / 1000), 's before next submit...')
        await new Promise(r => setTimeout(r, delay))
      }
    }

    // ─── Phase 2: 남은 결과 전부 수집 (폴링) ───
    console.log('[GenerateAllRefs] All submitted. Waiting for', pendingQueue.length, 'remaining results...')
    const maxWait = 180000  // 최대 3분 대기
    const pollStart = Date.now()

    while (pendingQueue.length > 0 && Date.now() - pollStart < maxWait) {
      if (stopRequestedRef.current) {
        console.log('[GenerateAllRefs] Stop requested during collection')
        toast.info(t('toast.batchStopped'))
        break
      }
      await new Promise(r => setTimeout(r, 3000))  // 3초 간격 폴링
      await collectCompleted()
    }

    // 미수집 항목 정리
    if (pendingQueue.length > 0) {
      console.warn('[GenerateAllRefs] Timed out waiting for', pendingQueue.length, 'generations')
      for (const pending of pendingQueue) {
        setGeneratingRefs(prev => prev.filter(i => i !== pending.index))
      }
    }

    // 일괄 정리
    await flowAPI.clearGenerations()

    console.log('[GenerateAllRefs] Batch completed, hasPendingSaves:', hasPendingSaves)
    setStoppingRefs(false)

    if (hasPendingSaves) {
      toast.info(t('toast.batchCompleteNeedPermission'))
      openSettings('storage')
    }
  }

  // 큐를 통한 개별 생성
  const handleGenerateRef = async (index, skipPermissionCheck = false, overrideStyleId = null) => {
    // 배치 내부 호출(skipPermissionCheck=true)이면 직접 실행
    if (skipPermissionCheck || !generationQueue) {
      return _executeGenerateRef(index, skipPermissionCheck, overrideStyleId)
    }
    // 개별 호출이면 큐에 enqueue
    try {
      return await generationQueue.enqueue({
        type: 'reference',
        label: `Ref #${index + 1}`,
        execute: () => _executeGenerateRef(index, false, overrideStyleId)
      })
    } catch (err) {
      console.warn('[RefGen] Queue rejected:', err.message)
      return { success: false }
    }
  }

  // 큐를 통한 배치 생성
  const handleGenerateAllRefs = async (overrideStyleId = null) => {
    if (!generationQueue) {
      return _executeBatchRefs(overrideStyleId)
    }
    try {
      await generationQueue.enqueue({
        type: 'reference_batch',
        label: 'Batch References',
        execute: () => _executeBatchRefs(overrideStyleId)
      })
    } catch (err) {
      console.warn('[RefGen] Batch queue rejected:', err.message)
    }
  }

  return {
    generatingRefs,
    stoppingRefs,
    preparingRefs,
    handleGenerateRef,
    handleGenerateAllRefs,
    stopGenerateAllRefs
  }
}
