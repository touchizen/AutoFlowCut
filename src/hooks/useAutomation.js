/**
 * Automation Hook - 이미지 생성 자동화
 * 
 * Concurrent Queue 방식 (동시 처리)
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { DEFAULTS, RESOURCE } from '../config/defaults'
import { fileSystemAPI } from './useFileSystem'
import { getTimestamp, generateProjectName, getImageSizeFromBase64 } from '../utils/formatters'
import { toast } from '../components/Toast'
import { resetDOMSession, requestStopDOM } from '../utils/flowDOMClient'

export function useAutomation(flowAPI, scenesHook, addToHistory, onOpenSettings = null, addPendingSave = null, t = (key) => key, onAuthError = null) {
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 })
  const [status, setStatus] = useState('ready')
  const [statusMessage, setStatusMessage] = useState('')

  // t 함수가 변경되면 초기 상태 메시지 업데이트
  useEffect(() => {
    if (status === 'ready' && !isRunning) {
      setStatusMessage(t('status.ready'))
    }
  }, [t, status, isRunning])
  
  const stopRequestedRef = useRef(false)
  const pausedRef = useRef(false)
  const completedCountRef = useRef(0)
  
  const { generateImageDOM, uploadReference, getAccessToken } = flowAPI
  const { scenes, references, updateScene, getMatchingReferences } = scenesHook

  // 씬이 모두 삭제되거나, 생성된 이미지가 없는 상태로 돌아가면 progress/status 리셋
  useEffect(() => {
    if (isRunning) return
    const hasAnyImage = scenes.some(s => s.image || s.imagePath)
    if (!hasAnyImage && (status === 'done' || status === 'stopped' || status === 'error')) {
      setProgress({ current: 0, total: 0, percent: 0 })
      setStatus('ready')
      setStatusMessage(t('status.ready'))
    }
  }, [scenes, isRunning])

  /**
   * 단일 씬 처리
   */
  const processScene = async (scene, options) => {
    const { projectName, saveMode } = options

    // 일시정지 대기
    while (pausedRef.current && !stopRequestedRef.current) {
      await new Promise(r => setTimeout(r, 500))
    }

    if (stopRequestedRef.current) return

    updateScene(scene.id, { status: 'generating' })

    // 매칭되는 레퍼런스 찾기 (태그 기반)
    const allMatched = getMatchingReferences(scene)
    const matchedRefs = allMatched
      .filter(r => r.mediaId)
      .map(r => ({
        category: r.category,
        mediaId: r.mediaId,
        caption: r.caption || ''
      }))
    // 디버그: 매칭 결과 상세 로깅
    if (allMatched.length > 0) {
      console.log('[Automation] Scene', scene.id, '→', allMatched.length, 'tag-matched,',
        matchedRefs.length, 'with mediaId.',
        'Missing mediaId:', allMatched.filter(r => !r.mediaId).map(r => r.name).join(', ') || 'none')
    }
    if (matchedRefs.length > 0) {
      console.log('[Automation] Scene', scene.id, '→ injecting', matchedRefs.length, 'refs:',
        matchedRefs.map(r => r.mediaId?.substring(0, 12)).join(', '))
    }

    // 이미지 생성 (재시도 포함) — DOM 모드 + CDP 레퍼런스 주입
    let result
    let retries = 0
    const maxRetries = DEFAULTS.generation.retryCount

    while (retries <= maxRetries) {
      // 생성 시작 전에만 중지 체크 (생성 완료 후에는 이미지를 저장해야 하므로)
      if (stopRequestedRef.current && retries === 0) return
      if (stopRequestedRef.current && retries > 0) break  // 재시도 중이면 루프 탈출 → 이전 결과 처리

      result = await generateImageDOM(scene.prompt, matchedRefs)

      if (result.success) break

      retries++
      if (retries <= maxRetries && !stopRequestedRef.current) {
        await new Promise(r => setTimeout(r, 2000))
      }
    }
    
    if (result.success && result.images?.length > 0) {
      // images는 [{ base64, mediaId }] 객체 배열
      const firstImage = result.images[0]
      const imageData = firstImage.base64 || firstImage  // backward compat: string fallback
      const mediaId = firstImage.mediaId || null

      // 이미지 크기 추출
      let imageSize = null
      try {
        imageSize = await getImageSizeFromBase64(imageData)
      } catch (e) {
        console.warn('[Automation] Failed to get image size:', e)
      }

      // 저장 모드에 따라 처리
      if (saveMode === 'folder') {
        // metadata: prompt + mediaId → history/*.json에 저장
        const metadata = {
          prompt: scene.prompt,
          mediaId,
          model: 'flow',
          timestamp: Date.now()
        }
        const saveResult = await fileSystemAPI.saveImage(projectName, scene.id, imageData, 'flow', metadata)

        updateScene(scene.id, {
          status: 'done',
          image: imageData,
          imagePath: saveResult.success ? saveResult.path : null,
          mediaId,
          image_size: imageSize
        })

        // 여분 이미지(2장 이상 생성된 경우) → History에만 저장 (mediaId 포함)
        await fileSystemAPI.saveExtraToHistory(projectName, RESOURCE.SCENES, scene.id, result.images, scene.prompt, 'Automation')
      } else {
        updateScene(scene.id, {
          status: 'done',
          image: imageData,
          mediaId,
          image_size: imageSize
        })
      }
    } else {
      updateScene(scene.id, {
        status: 'error',
        error: result.error
      })

      // 인증 관련 에러 체크 - 토큰 갱신 시도 후 재시도
      const errorMsg = result.error || ''
      const isAuthError = errorMsg.includes('401') || errorMsg.includes('auth') || errorMsg.includes('token') || errorMsg.includes('login') || errorMsg.includes('Unauthorized')
      if (isAuthError) {
        console.log('[Automation] Auth error detected, trying to refresh token...')
        setStatusMessage(`🔄 ${t('toast.tokenRefreshing')}`)

        // 토큰 갱신 시도 (forceRefresh)
        const newToken = await getAccessToken(true)
        if (newToken) {
          console.log('[Automation] Token refreshed, retrying scene:', scene.id)
          // 재시도 (DOM 모드 + 레퍼런스)
          const retryResult = await generateImageDOM(scene.prompt, matchedRefs)
          if (retryResult.success && retryResult.images?.length > 0) {
            // 성공 시 다시 저장 로직으로 (images는 [{ base64, mediaId }])
            const retryImg = retryResult.images[0]
            updateScene(scene.id, {
              status: 'done',
              image: retryImg.base64 || retryImg,
              mediaId: retryImg.mediaId || null
            })
            return retryResult
          }
        }

        // 재시도도 실패 - 중단
        console.log('[Automation] Auth retry failed, stopping. Calling onAuthError.')
        stopRequestedRef.current = true
        setStatusMessage(`❌ ${t('status.authErrorStopped')}`)
        setStatus('error')
        onAuthError?.()
        return { ...result, authError: true }
      }
    }

    return result
  }
  
  /**
   * Concurrent Queue 실행
   */
  const runConcurrentQueue = async (targetScenes, options, total) => {
    const queue = [...targetScenes]
    const activePromises = new Map()
    completedCountRef.current = 0
    
    const updateProgress = () => {
      const current = completedCountRef.current
      setProgress({
        current,
        total,
        percent: Math.round((current / total) * 100)
      })
      
      // 진행중인 씬들 표시
      const runningIds = Array.from(activePromises.keys()).join(', ')
      if (runningIds) {
        setStatusMessage(t('status.generatingScene', { ids: runningIds, current, total }))
      }
    }
    
    const processNext = async () => {
      while (queue.length > 0 && !stopRequestedRef.current) {
        // 일시정지 대기
        while (pausedRef.current && !stopRequestedRef.current) {
          await new Promise(r => setTimeout(r, 500))
        }
        
        if (stopRequestedRef.current) break
        
        const scene = queue.shift()
        if (!scene) break
        
        activePromises.set(scene.id, true)
        updateProgress()
        
        try {
          await processScene(scene, options)
        } catch (e) {
          console.error('Scene processing error:', e)
          updateScene(scene.id, { status: 'error', error: e.message })
        }
        
        activePromises.delete(scene.id)
        completedCountRef.current++
        updateProgress()
        
        // 씬 사이 랜덤 딜레이
        if (queue.length > 0) {
          const delay = DEFAULTS.generation.delayMin +
            Math.floor(Math.random() * (DEFAULTS.generation.delayMax - DEFAULTS.generation.delayMin + 1))
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }
    
    // FlowView가 하나이므로 반드시 순차(1) — 동시 처리하면 CDP 응답이 꼬임
    const concurrency = 1
    const workers = []
    for (let i = 0; i < Math.min(concurrency, targetScenes.length); i++) {
      workers.push(processNext())
    }
    
    await Promise.all(workers)
  }
  
  /**
   * 자동화 시작
   */
  const start = useCallback(async (options = {}) => {
    const {
      projectName = generateProjectName(),
      saveMode = 'folder',
      sceneIndices = null
    } = options

    if (isRunning) return

    stopRequestedRef.current = false
    pausedRef.current = false
    completedCountRef.current = 0

    // 새 배치 시작: DOM 세션 리셋
    resetDOMSession()

    setIsRunning(true)
    setIsPaused(false)
    setStatus('running')
    
    // 대상 씬 결정 (이미지가 없는 씬만)
    // status가 done이어도 실제 이미지(image 또는 imagePath)가 없으면 생성 대상
    const targetScenes = sceneIndices
      ? sceneIndices.map(i => scenes[i]).filter(Boolean)
      : scenes.filter(s => !s.image && !s.imagePath)
    
    const total = targetScenes.length
    if (total === 0) {
      toast.warning(t('toast.allScenesGenerated'))
      setStatus('done')
      setStatusMessage(`✅ ${t('toast.allScenesGenerated')}`)
      setIsRunning(false)
      return
    }
    setProgress({ current: 0, total, percent: 0 })
    
    // 폴더 저장 모드일 때 폴더 존재 확인
    if (saveMode === 'folder') {
      setStatusMessage(t('status.checkingFolder'))
      const folderResult = await fileSystemAPI.checkPermission()

      if (!folderResult.success) {
        setStatusMessage(`⚠️ ${t('status.folderNotSet')}`)
        if (onOpenSettings) {
          onOpenSettings()
        }
        setStatus('error')
        setIsRunning(false)
        return
      }
    }
    
    // 토큰 확인
    setStatusMessage(t('status.checkingAuth'))
    const token = await getAccessToken()
    if (!token) {
      console.log('[Automation] No token found. Calling onAuthError.')
      setStatusMessage(`❌ ${t('status.loginRequired')}`)
      setStatus('error')
      setIsRunning(false)
      onAuthError?.()
      return
    }
    
    // 레퍼런스 업로드 (순차 - API 안정성)
    console.log('[Automation] References check:', references.map(r => ({ name: r.name, hasData: !!r.data, mediaId: r.mediaId })))
    const refsToUpload = references.filter(r => r.data && !r.mediaId)
    console.log('[Automation] Refs to upload:', refsToUpload.length)
    if (refsToUpload.length > 0) {
      setStatus('uploading')
      setProgress({ current: 0, total: refsToUpload.length, percent: 0 })
      setStatusMessage(t('status.uploadingRefs', { current: 0, total: refsToUpload.length }))

      for (let i = 0; i < refsToUpload.length; i++) {
        if (stopRequestedRef.current) break

        const ref = refsToUpload[i]
        const percent = Math.round(((i + 1) / refsToUpload.length) * 100)
        setProgress({ current: i + 1, total: refsToUpload.length, percent })
        setStatusMessage(t('status.uploadingRefs', { current: i + 1, total: refsToUpload.length }))
        
        let base64Data = ref.data
        if (base64Data.startsWith('data:')) {
          base64Data = base64Data.split(',')[1]
        }
        
        const result = await uploadReference(base64Data, ref.category)
        if (result.success) {
          ref.mediaId = result.mediaId
          ref.caption = result.caption || ref.caption
        } else {
          console.warn('Reference upload failed:', ref.name, result.error)
        }
      }
    }
    
    // 씬 처리 (DOM 모드 — 반드시 순차)
    setStatus('running')
    setProgress({ current: 0, total, percent: 0 })
    await runConcurrentQueue(targetScenes, {
      projectName,
      saveMode,
    }, total)
    
    // 완료
    setIsRunning(false)
    setIsPaused(false)
    setIsStopping(false)

    if (stopRequestedRef.current) {
      setStatus('stopped')
      setStatusMessage(t('status.stopped'))
    } else {
      setStatus('done')
      setStatusMessage(t('status.done'))
    }

  }, [isRunning, scenes, references, generateImageDOM, uploadReference, getAccessToken, updateScene, getMatchingReferences, t, onOpenSettings])
  
  /**
   * 일시정지/재개
   */
  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current
    setIsPaused(pausedRef.current)
    setStatusMessage(pausedRef.current ? t('status.paused') : t('status.resuming'))
  }, [t])
  
  /**
   * 중지
   */
  const stop = useCallback(() => {
    stopRequestedRef.current = true
    pausedRef.current = false
    setIsPaused(false)
    setIsStopping(true)
    setStatusMessage(t('status.stopping'))
    // DOM 모드 폴링 루프도 즉시 중단
    requestStopDOM()
  }, [t])
  
  /**
   * 특정 씬 재시도
   */
  const retryScene = useCallback(async (sceneId, options = {}) => {
    const sceneIdx = scenes.findIndex(s => s.id === sceneId)
    if (sceneIdx === -1) return
    
    await start({ ...options, sceneIndices: [sceneIdx] })
  }, [scenes, start])
  
  /**
   * 에러 씬들만 재시도
   */
  const retryErrors = useCallback(async (options = {}) => {
    const errorIndices = scenes
      .map((s, i) => s.status === 'error' ? i : -1)
      .filter(i => i !== -1)
    
    if (errorIndices.length === 0) return
    
    await start({ ...options, sceneIndices: errorIndices })
  }, [scenes, start])
  
  return {
    isRunning,
    isPaused,
    isStopping,
    progress,
    status,
    statusMessage,
    start,
    togglePause,
    stop,
    retryScene,
    retryErrors
  }
}

export default useAutomation
