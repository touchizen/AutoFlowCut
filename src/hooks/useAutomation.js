/**
 * Automation Hook - 이미지 생성 자동화
 * 
 * Concurrent Queue 방식 (동시 처리)
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { DEFAULTS, RESOURCE, STYLE_PRESETS } from '../config/defaults'
import { fileSystemAPI } from './useFileSystem'
import { getTimestamp, generateProjectName, getImageSizeFromBase64 } from '../utils/formatters'
import { toast } from '../components/Toast'
import { resetDOMSession, requestStopDOM } from '../utils/flowDOMClient'

export function useAutomation(flowAPI, scenesHook, addToHistory, onOpenSettings = null, addPendingSave = null, t = (key) => key, onAuthError = null) {
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0, errorCount: 0, startedAt: null, endedAt: null })
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
  const errorCountRef = useRef(0)
  const batchStartedAtRef = useRef(null)
  
  const { generateImageDOM, submitGenerationDOM, checkGeneration, collectGeneration, clearGenerations, uploadReference, getAccessToken } = flowAPI
  const { scenes, references, updateScene, getMatchingReferences } = scenesHook

  // 씬이 모두 삭제되거나, 생성된 이미지가 없는 상태로 돌아가면 progress/status 리셋
  useEffect(() => {
    if (isRunning) return
    const hasAnyImage = scenes.some(s => s.image || s.imagePath)
    if (!hasAnyImage && (status === 'done' || status === 'stopped' || status === 'error')) {
      setProgress({ current: 0, total: 0, percent: 0, errorCount: 0, startedAt: null, endedAt: null })
      setStatus('ready')
      setStatusMessage(t('status.ready'))
    }
  }, [scenes, isRunning])

  /**
   * 단일 씬 처리
   */
  const processScene = async (scene, options) => {
    let { projectName, saveMode, imageBatchCount, imageUpscale, selectedStyleRefId = null } = options

    // selectedStyleRefId 없으면 등록된 style 카드 자동 탐색
    if (!selectedStyleRefId) {
      const autoStyle = references.find(r => r.type === 'style' && r.mediaId)
      if (autoStyle) {
        selectedStyleRefId = `ref:${autoStyle.id}`
      }
    }

    // 일시정지 대기
    while (pausedRef.current && !stopRequestedRef.current) {
      await new Promise(r => setTimeout(r, 500))
    }

    if (stopRequestedRef.current) return

    updateScene(scene.id, { status: 'generating', generatingStartedAt: Date.now() })

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

    // 스타일 프롬프트 합치기 (태그 매칭 자동 + selectedStyleRefId 수동)
    let styledPrompt = scene.prompt

    // 1. 태그 매칭으로 스타일 레퍼런스가 있으면 자동 적용
    const matchedStyleRef = allMatched.find(r => r.type === 'style' && r.prompt)
    if (matchedStyleRef) {
      styledPrompt = `${scene.prompt}, ${matchedStyleRef.prompt}`
    }

    // 2. selectedStyleRefId가 명시적으로 있으면 덮어쓰기
    if (selectedStyleRefId) {
      if (selectedStyleRefId.startsWith('ref:')) {
        const refId = selectedStyleRefId.replace('ref:', '')
        const styleRef = references.find(r => r.id == refId && r.type === 'style')
        if (styleRef?.prompt) {
          styledPrompt = `${scene.prompt}, ${styleRef.prompt}`
        }
        if (styleRef?.mediaId && !matchedRefs.some(r => r.mediaId === styleRef.mediaId)) {
          matchedRefs.push({ category: styleRef.category || 'style', mediaId: styleRef.mediaId, caption: styleRef.caption || '' })
        }
      } else if (selectedStyleRefId.startsWith('preset:')) {
        const presetId = selectedStyleRefId.replace('preset:', '')
        const preset = STYLE_PRESETS?.styles?.find(s => s.id === presetId)
        if (preset?.prompt_en) {
          styledPrompt = `${scene.prompt}, ${preset.prompt_en}`
        }
      }
    }

    // 이미지 생성 (재시도 포함) — DOM 모드 + CDP 레퍼런스 주입
    let result
    let retries = 0
    const maxRetries = DEFAULTS.generation.retryCount

    while (retries <= maxRetries) {
      // 생성 시작 전에만 중지 체크 (생성 완료 후에는 이미지를 저장해야 하므로)
      if (stopRequestedRef.current && retries === 0) return
      if (stopRequestedRef.current && retries > 0) break  // 재시도 중이면 루프 탈출 → 이전 결과 처리

      result = await generateImageDOM(styledPrompt, matchedRefs, { batchCount: imageBatchCount })

      if (result.success) break

      retries++
      if (retries <= maxRetries && !stopRequestedRef.current) {
        await new Promise(r => setTimeout(r, 2000))
      }
    }
    
    if (result.success && result.images?.length > 0) {
      // images는 [{ base64, mediaId }] 객체 배열
      const firstImage = result.images[0]
      let imageData = firstImage.base64 || firstImage  // backward compat: string fallback
      const mediaId = firstImage.mediaId || null

      // 이미지 업스케일 (설정에 따라)
      const upscaleRes = imageUpscale || 'off'
      if (upscaleRes !== 'off' && mediaId) {
        try {
          console.log('[Automation] Upscaling image to', upscaleRes, '...')
          const upResult = await flowAPI.upscaleImage(mediaId, upscaleRes)
          if (upResult.success && upResult.data) {
            imageData = upResult.data
            console.log('[Automation] Upscale success')
          } else {
            console.warn('[Automation] Upscale failed, using original:', upResult.error)
          }
        } catch (e) {
          console.warn('[Automation] Upscale error, using original:', e.message)
        }
      }

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
          image: saveResult.success ? null : imageData,  // 파일 저장 성공 시 메모리 해제
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
          const retryResult = await generateImageDOM(scene.prompt, matchedRefs, { batchCount: imageBatchCount })
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
   * 비동기 배치 실행 (fire-and-forget + 폴링 수집)
   */
  const runConcurrentQueue = async (targetScenes, options, total) => {
    let { projectName, saveMode, imageBatchCount, imageUpscale, selectedStyleRefId } = options
    // selectedStyleRefId 없으면 등록된 style 카드 자동 탐색
    if (!selectedStyleRefId) {
      const autoStyle = references.find(r => r.type === 'style' && r.mediaId)
      if (autoStyle) {
        selectedStyleRefId = `ref:${autoStyle.id}`
        console.log('[Automation] Auto-detected style card:', autoStyle.name, autoStyle.id)
      }
    }
    completedCountRef.current = 0
    errorCountRef.current = 0
    const pendingQueue = [] // { generationId, scene, submittedAt }
    let consecutiveErrors = 0

    const updateProgressMsg = (current) => {
      setProgress({ current, total, percent: Math.round((current / total) * 100), errorCount: errorCountRef.current, startedAt: batchStartedAtRef.current, endedAt: null })
    }

    // 비동기 결과 후처리 (업스케일 + 저장)
    const processAsyncResult = async (scene, result) => {
      if (result.success && result.images?.length > 0) {
        const firstImage = result.images[0]
        let imageData = firstImage.base64 || firstImage
        const mediaId = firstImage.mediaId || null

        // 업스케일
        const upscaleRes = imageUpscale || 'off'
        if (upscaleRes !== 'off' && mediaId) {
          try {
            console.log('[Automation] Upscaling image to', upscaleRes, '...')
            const upResult = await flowAPI.upscaleImage(mediaId, upscaleRes)
            if (upResult.success && upResult.data) {
              imageData = upResult.data
              console.log('[Automation] Upscale success')
            } else {
              console.warn('[Automation] Upscale failed, using original:', upResult.error)
            }
          } catch (e) {
            console.warn('[Automation] Upscale error, using original:', e.message)
          }
        }

        // 이미지 크기 추출
        let imageSize = null
        try { imageSize = await getImageSizeFromBase64(imageData) } catch (e) { /* ignore */ }

        // 저장
        if (saveMode === 'folder') {
          const metadata = { prompt: scene.prompt, mediaId, model: 'flow', timestamp: Date.now() }
          const saveResult = await fileSystemAPI.saveImage(projectName, scene.id, imageData, 'flow', metadata)
          updateScene(scene.id, {
            status: 'done',
            image: saveResult.success ? null : imageData,
            imagePath: saveResult.success ? saveResult.path : null,
            mediaId, image_size: imageSize
          })
          await fileSystemAPI.saveExtraToHistory(projectName, RESOURCE.SCENES, scene.id, result.images, scene.prompt, 'Automation')
        } else {
          updateScene(scene.id, { status: 'done', image: imageData, mediaId, image_size: imageSize })
        }
        return true
      } else {
        updateScene(scene.id, { status: 'error', error: result.error || 'No images' })
        return false
      }
    }

    // 완료된 결과 수집
    const ITEM_TIMEOUT = 120000 // 개별 아이템 2분 타임아웃
    const collectCompleted = async () => {
      const stillPending = []
      for (const item of pendingQueue) {
        if (stopRequestedRef.current) { stillPending.push(item); continue }
        // 개별 타임아웃 체크
        const elapsed = Date.now() - item.submittedAt
        if (elapsed > ITEM_TIMEOUT) {
          console.warn('[Automation] Scene', item.scene.id, 'timed out after', Math.round(elapsed / 1000), 's')
          updateScene(item.scene.id, { status: 'error', error: 'Generation timeout' })
          errorCountRef.current++
          completedCountRef.current++
          updateProgressMsg(completedCountRef.current)
          continue
        }
        try {
          const st = await checkGeneration(item.generationId)
          if (st.completed) {
            const result = await collectGeneration(item.generationId)
            console.log('[Automation] Collected scene', item.scene.id, ':', result.success, result.images?.length || 0, 'images')
            await processAsyncResult(item.scene, result)
            if (!result.success || !result.images?.length) {
              errorCountRef.current++
            }
            completedCountRef.current++
            updateProgressMsg(completedCountRef.current)
          } else {
            stillPending.push(item)
          }
        } catch (e) {
          console.error('[Automation] Check/collect error for scene', item.scene.id, ':', e.message)
          // 에러가 연속되면 타임아웃에서 처리되므로 다시 pending에 넣음
          stillPending.push(item)
        }
      }
      pendingQueue.length = 0
      pendingQueue.push(...stillPending)
    }

    // Phase 1: 비동기 제출 + 중간 수집
    for (let i = 0; i < targetScenes.length; i++) {
      while (pausedRef.current && !stopRequestedRef.current) {
        await new Promise(r => setTimeout(r, 500))
      }
      if (stopRequestedRef.current) break

      const scene = targetScenes[i]
      updateScene(scene.id, { status: 'generating', generatingStartedAt: Date.now() })
      setStatusMessage(t('status.generatingScene', { ids: scene.id, current: completedCountRef.current, total }))

      // 매칭 레퍼런스
      const allMatched = getMatchingReferences(scene)
      const matchedRefs = allMatched
        .filter(r => r.mediaId)
        .map(r => ({ category: r.category, mediaId: r.mediaId, caption: r.caption || '' }))
      if (matchedRefs.length > 0) {
        console.log('[Automation] Scene', scene.id, '→ injecting', matchedRefs.length, 'refs')
      }

      // 스타일 프롬프트 합치기 (태그 매칭 자동 + selectedStyleRefId 수동)
      let styledPrompt = scene.prompt
      let appliedStyle = 'none'

      // 1. 태그 매칭으로 스타일 레퍼런스가 있으면 자동 적용
      const matchedStyleRef = allMatched.find(r => r.type === 'style' && r.prompt)
      if (matchedStyleRef) {
        styledPrompt = `${scene.prompt}, ${matchedStyleRef.prompt}`
        appliedStyle = `auto:${matchedStyleRef.name || matchedStyleRef.id}`
      }

      // 2. selectedStyleRefId가 명시적으로 있으면 덮어쓰기
      if (selectedStyleRefId) {
        if (selectedStyleRefId.startsWith('ref:')) {
          const refId = selectedStyleRefId.replace('ref:', '')
          const styleRef = references.find(r => r.id == refId && r.type === 'style')
          if (styleRef?.prompt) {
            styledPrompt = `${scene.prompt}, ${styleRef.prompt}`
            appliedStyle = `ref:${styleRef.name || refId}`
          }
          if (styleRef?.mediaId && !matchedRefs.some(r => r.mediaId === styleRef.mediaId)) {
            matchedRefs.push({ category: styleRef.category || 'style', mediaId: styleRef.mediaId, caption: styleRef.caption || '' })
          }
        } else if (selectedStyleRefId.startsWith('preset:')) {
          const presetId = selectedStyleRefId.replace('preset:', '')
          const preset = STYLE_PRESETS?.styles?.find(s => s.id === presetId)
          if (preset?.prompt_en) {
            styledPrompt = `${scene.prompt}, ${preset.prompt_en}`
            appliedStyle = `preset:${presetId}`
          }
        }
      }

      // 비동기 제출
      console.log('[Automation] Scene', scene.id, '→ prompt:', styledPrompt.substring(0, 80) + '...', '| style:', appliedStyle, '| refs:', matchedRefs.length)
      const submitResult = await submitGenerationDOM(styledPrompt, matchedRefs, { batchCount: imageBatchCount })
      if (submitResult.success && submitResult.generationId) {
        pendingQueue.push({ generationId: submitResult.generationId, scene, submittedAt: Date.now() })
        consecutiveErrors = 0
        console.log('[Automation] Submitted scene', scene.id, '→', submitResult.generationId)
      } else {
        console.error('[Automation] Submit failed for scene', scene.id, ':', submitResult.error)
        updateScene(scene.id, { status: 'error', error: submitResult.error })
        errorCountRef.current++
        completedCountRef.current++
        updateProgressMsg(completedCountRef.current)
        consecutiveErrors++
        if (consecutiveErrors >= 3) {
          console.error('[Automation] 3 consecutive submit failures, stopping')
          break
        }
      }

      // 씬 사이 대기 (7~15초) + 중간 수집
      if (i < targetScenes.length - 1 && !stopRequestedRef.current) {
        const waitMs = 7000 + Math.floor(Math.random() * 8000)
        console.log('[Automation] Waiting', Math.round(waitMs / 1000), 's before next submit...')
        const waitEnd = Date.now() + waitMs
        while (Date.now() < waitEnd && !stopRequestedRef.current) {
          while (pausedRef.current && !stopRequestedRef.current) {
            await new Promise(r => setTimeout(r, 500))
          }
          await new Promise(r => setTimeout(r, 500))
        }
        // 중간 수집
        if (pendingQueue.length > 0 && !stopRequestedRef.current) {
          await collectCompleted()
        }
      }
    }

    // Phase 2: 남은 결과 전부 수집 (3초 간격, 최대 3분)
    const pollStart = Date.now()
    while (pendingQueue.length > 0 && !stopRequestedRef.current && (Date.now() - pollStart < 180000)) {
      setStatusMessage(t('status.collectingResults', { remaining: pendingQueue.length }))
      await collectCompleted()
      if (pendingQueue.length > 0) {
        await new Promise(r => setTimeout(r, 3000))
      }
    }

    // 미수집 처리
    for (const item of pendingQueue) {
      updateScene(item.scene.id, { status: 'error', error: 'Timeout or stopped' })
      errorCountRef.current++
      completedCountRef.current++
    }
    updateProgressMsg(completedCountRef.current)

    // 정리
    try { await clearGenerations() } catch (e) { /* ignore */ }
  }
  
  /**
   * 자동화 시작
   */
  const start = useCallback(async (options = {}) => {
    const {
      projectName = generateProjectName(),
      saveMode = 'folder',
      sceneIndices = null,
      imageBatchCount = 1,
      imageUpscale = 'off',
      selectedStyleRefId = null
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
    
    // 대상 씬 결정: 이미지 없는 씬 + pending/error 상태 씬 (재생성 대상)
    const targetScenes = sceneIndices
      ? sceneIndices.map(i => scenes[i]).filter(Boolean)
      : scenes.filter(s => !s.image && !s.imagePath || s.status === 'pending' || s.status === 'error')
    
    const total = targetScenes.length
    if (total === 0) {
      toast.warning(t('toast.allScenesGenerated'))
      setStatus('done')
      setStatusMessage(`✅ ${t('toast.allScenesGenerated')}`)
      setIsRunning(false)
      return
    }
    setProgress({ current: 0, total, percent: 0, errorCount: 0, startedAt: null, endedAt: null })

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
    
    // 레퍼런스 업로드 (비동기 슬라이딩 윈도우 — 1초 간격 투입, 최대 5개 동시)
    console.log('[Automation] References check:', references.map(r => ({ name: r.name, hasData: !!(r.data || r.filePath || r.imagePath), mediaId: r.mediaId })))
    const refsToUpload = references.filter(r => (r.data || r.filePath || r.imagePath) && !r.mediaId)
    console.log('[Automation] Refs to upload:', refsToUpload.length)
    if (refsToUpload.length > 0) {
      setStatus('uploading')
      let uploadedCount = 0
      setProgress({ current: 0, total: refsToUpload.length, percent: 0, errorCount: 0, startedAt: null, endedAt: null })
      setStatusMessage(t('status.uploadingRefs', { current: 0, total: refsToUpload.length }))

      const MAX_CONCURRENT = 5
      const INTERVAL = 1000
      const MAX_RETRIES = 2

      const uploadOne = async (ref) => {
        let base64Data = ref.data
        const pathToRead = ref.filePath || ref.imagePath
        if (!base64Data && pathToRead) {
          const fileResult = await fileSystemAPI.readFileByPath(pathToRead)
          if (fileResult.success) base64Data = fileResult.data
        }
        if (!base64Data) {
          console.warn('Reference data not available:', ref.name, { data: !!ref.data, filePath: ref.filePath, imagePath: ref.imagePath, pathToRead })
          return
        }
        if (base64Data.startsWith('data:')) {
          base64Data = base64Data.split(',')[1]
        }

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const result = await uploadReference(base64Data, ref.category)
          if (result.success) {
            ref.mediaId = result.mediaId
            ref.caption = result.caption || ref.caption
            return
          }
          if (result.error?.includes('429') && attempt < MAX_RETRIES) {
            const backoff = (attempt + 1) * 2000 + Math.random() * 1000
            console.warn(`[Automation] Rate limited on ${ref.name}, retry in ${Math.round(backoff)}ms`)
            await new Promise(r => setTimeout(r, backoff))
            continue
          }
          console.warn('Reference upload failed:', ref.name, result.error)
          return
        }
      }

      // 슬라이딩 윈도우: 1초마다 1개 투입, 동시 5개 제한
      await new Promise((resolve) => {
        let nextIndex = 0
        let activeCount = 0
        let completedCount = 0

        const tryLaunch = () => {
          while (activeCount < MAX_CONCURRENT && nextIndex < refsToUpload.length && !stopRequestedRef.current) {
            const ref = refsToUpload[nextIndex++]
            activeCount++
            uploadOne(ref).finally(() => {
              activeCount--
              completedCount++
              uploadedCount = completedCount
              const percent = Math.round((uploadedCount / refsToUpload.length) * 100)
              setProgress({ current: uploadedCount, total: refsToUpload.length, percent, errorCount: 0, startedAt: batchStartedAtRef.current, endedAt: null })
              setStatusMessage(t('status.uploadingRefs', { current: uploadedCount, total: refsToUpload.length }))
              if (completedCount >= refsToUpload.length || stopRequestedRef.current) {
                resolve()
              }
            })
          }
        }

        // 1초 간격으로 투입
        tryLaunch() // 첫 번째 즉시
        const timer = setInterval(() => {
          if (nextIndex >= refsToUpload.length || stopRequestedRef.current) {
            clearInterval(timer)
            return
          }
          tryLaunch()
        }, INTERVAL)
      })
    }
    
    // 씬 처리 (DOM 모드 — 반드시 순차)
    batchStartedAtRef.current = Date.now()
    setStatus('running')
    setProgress({ current: 0, total, percent: 0, errorCount: 0, startedAt: batchStartedAtRef.current, endedAt: null })
    await runConcurrentQueue(targetScenes, {
      projectName,
      saveMode,
      imageBatchCount,
      imageUpscale,
      selectedStyleRefId,
    }, total)
    
    // 완료
    setIsRunning(false)
    setIsPaused(false)
    setIsStopping(false)
    setProgress(prev => ({ ...prev, endedAt: Date.now() }))

    const doneCount = completedCountRef.current - errorCountRef.current
    const errCount = errorCountRef.current
    const summary = errCount > 0
      ? `✅ ${doneCount}  ❌ ${errCount}`
      : `✅ ${doneCount}`

    if (stopRequestedRef.current) {
      setStatus('stopped')
      setStatusMessage(`${t('status.stopped')} — ${summary}`)
    } else {
      setStatus('done')
      setStatusMessage(`${t('status.done')} — ${summary}`)
    }

  }, [isRunning, scenes, references, generateImageDOM, submitGenerationDOM, checkGeneration, collectGeneration, clearGenerations, uploadReference, getAccessToken, updateScene, getMatchingReferences, t, onOpenSettings])
  
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
