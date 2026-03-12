/**
 * useReferenceGeneration - 레퍼런스 이미지 생성 (개별 + 일괄)
 */

import { useState } from 'react'
import { RESOURCE } from '../config/defaults'
import { fileSystemAPI } from './useFileSystem'
import { generateProjectName } from '../utils/formatters'
import { checkFolderPermission, checkAuthToken } from '../utils/guards'
import { toast } from '../components/Toast'

// 1~3초 랜덤 딜레이
const randomDelay = () => new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))

export function useReferenceGeneration({ settings, references, setReferences, flowAPI, addPendingSave, openSettings, pendingSavesCount = 0, t }) {
  const [generatingRefs, setGeneratingRefs] = useState([])
  const [saveFailedOnce, setSaveFailedOnce] = useState(false)  // 배치 중 저장 실패 알림 1회만

  // Handle reference image generation (개별)
  // @param {number} index - 레퍼런스 인덱스
  // @param {boolean} skipPermissionCheck - 배치 모드에서 권한 체크 스킵
  // @returns {{ success: boolean, authError?: boolean }} 생성 결과
  const handleGenerateRef = async (index, skipPermissionCheck = false) => {
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
      const result = await flowAPI.generateImageDOM(ref.prompt)

      if (result.success && result.images?.length > 0) {
        // images는 [{ base64, mediaId }] 객체 배열
        const firstImage = result.images[0]
        const imageData = firstImage.base64 || firstImage  // backward compat
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

  // Handle reference image generation (일괄)
  const handleGenerateAllRefs = async () => {
    const generatableIndices = references
      .map((ref, index) => (ref.prompt && !ref.data) ? index : -1)
      .filter(i => i !== -1)

    if (generatableIndices.length === 0) {
      toast.info(t('toast.allRefsGenerated'))
      return
    }

    // 배치 시작 - 저장 실패 플래그 리셋
    let hasPendingSaves = false  // 로컬 변수로 추적 (React state는 비동기라 즉시 반영 안됨)
    setSaveFailedOnce(false)

    // 폴더 모드일 때 권한 먼저 요청 (사용자 제스처 컨텍스트)
    if (settings.saveMode === 'folder') {
      const permission = await fileSystemAPI.ensurePermission()
      if (permission.error === 'not_set') {
        openSettings('storage')
        return
      }
      if (permission.error === 'folder_deleted') {
        toast.error(t('toast.folderDeleted'))
        openSettings('storage')
        return
      }
      if (!permission.hasPermission) {
        toast.warning(t('toast.folderPermissionNeeded'))
        openSettings('storage')
        return
      }
      console.log('[GenerateAllRefs] Permission granted:', permission.name)
    }

    // 순차 처리 (API 안정성) - 배치 모드에서는 권한 체크 스킵
    for (const index of generatableIndices) {
      let result = await handleGenerateRef(index, true)  // skipPermissionCheck = true

      // 메모리 저장 여부 체크
      if (result?.savedToMemory) {
        hasPendingSaves = true
      }

      // 서버 에러 (500 등) 시 최대 3회 재시도
      if (result?.serverError) {
        for (let retry = 1; retry <= 3; retry++) {
          console.log(`[GenerateAllRefs] Server error, retry ${retry}/3 after random delay...`)
          toast.info(t('toast.serverErrorRetry', { retry }))
          await randomDelay()
          result = await handleGenerateRef(index, true)
          if (result?.savedToMemory) hasPendingSaves = true
          if (result?.success || !result?.serverError) break
        }
        // 3회 재시도 후에도 서버 에러면 중단
        if (result?.serverError) {
          console.log('[GenerateAllRefs] Server error persists after 3 retries, stopping batch')
          toast.error(t('toast.serverErrorPersist'))
          break
        }
      }

      // 인증 에러 시 토큰 갱신 시도 후 재시도
      if (result?.authError) {
        console.log('[GenerateAllRefs] Auth error detected, trying to refresh token...')
        toast.info(t('toast.tokenRefreshing'))

        // 토큰 갱신 시도
        const newToken = await flowAPI.getAccessToken(true)
        if (newToken) {
          console.log('[GenerateAllRefs] Token refreshed, retrying index:', index)
          // 같은 인덱스 재시도
          const retryResult = await handleGenerateRef(index, true)
          if (retryResult?.savedToMemory) hasPendingSaves = true
          if (!retryResult?.authError) {
            // 재시도 성공 - 다음으로 진행
            continue
          }
        }
        // 토큰 갱신 실패 또는 재시도 실패 - 중단
        console.log('[GenerateAllRefs] Auth error persists, stopping batch')
        toast.error(t('toast.authErrorStop'))
        break
      }

      // 랜덤 딜레이 (1~3초)
      if (index !== generatableIndices[generatableIndices.length - 1]) {
        await randomDelay()
      }
    }

    // 완료 - pending saves가 있으면 권한 요청 안내
    console.log('[GenerateAllRefs] Batch completed, hasPendingSaves:', hasPendingSaves)

    // pending saves가 있으면 설정창 열어서 권한 요청 유도
    if (hasPendingSaves) {
      toast.info(t('toast.batchCompleteNeedPermission'))
      openSettings('storage')
    }
  }

  return {
    generatingRefs,
    handleGenerateRef,
    handleGenerateAllRefs
  }
}
