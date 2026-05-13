/**
 * Automation Hook - 이미지 생성 자동화
 * 
 * Concurrent Queue 방식 (동시 처리)
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { pickAutoStyleFallback, resolveSceneStyle } from '../services/styleService'
import { filterPendingScenes } from '../utils/sceneFilters'
import { processAsyncSceneResult } from '../services/imageFinalize'
import { fileSystemAPI } from './useFileSystem'
import { getTimestamp } from '../utils/formatters'
import { cleanBase64 as stripBase64Prefix } from '../utils/urls'
import { toast } from '../components/Toast'
import { resetDOMSession, requestStopDOM } from '../utils/flowDOMClient'

export function useAutomation(flowAPI, scenesHook, addToHistory, onOpenSettings = null, addPendingSave = null, t = (key) => key, onAuthError = null, generationQueue = null, onComplete = null) {
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
  
  // generateImageDOM 은 dead processScene 제거와 함께 호출 사이트가 사라져서 destructuring 에서도 제외.
  // 단일 씬 동기 호출이 필요해지면 flowAPI.generateImageDOM 으로 직접 접근.
  const { submitGenerationDOM, checkGeneration, collectGeneration, clearGenerations, uploadReference, getAccessToken } = flowAPI
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

  // (NOTE) 단일 씬 동기 처리 헬퍼 (`processScene`) 는 dead code 였어서 제거.
  // 활성 경로는 비동기 batch 인 runAutomation + collectCompleted 만 사용.
  // 미래에 동기 단일 처리가 다시 필요해지면 processAsyncSceneResult() 에 retry 정책을
  // 얹어서 재구현할 것 — finalize 의 success 값이 caller 에 그대로 전달돼야
  // batch errorCount 와 같은 통계가 정확히 집계된다.
  
  /**
   * 비동기 배치 실행 (fire-and-forget + 폴링 수집)
   */
  const runConcurrentQueue = async (targetScenes, options, total) => {
    let { projectName, saveMode, imageBatchCount, imageUpscale, selectedStyleRefId, seed = null } = options
    if (selectedStyleRefId != null && typeof selectedStyleRefId !== 'string') selectedStyleRefId = String(selectedStyleRefId)
    // selectedStyleRefId 없으면 자동 모드. 단, 씬 중 하나라도 style_tag를 가지면
    // fallback 안 함 — 사용자가 씬별 매칭을 의도한 것이므로 첫 스타일 전역 적용으로 덮어쓰면 안 됨.
    if (!selectedStyleRefId) selectedStyleRefId = pickAutoStyleFallback(targetScenes, references)
    completedCountRef.current = 0
    errorCountRef.current = 0
    const pendingQueue = [] // { generationId, scene, submittedAt }
    let consecutiveErrors = 0

    const updateProgressMsg = (current) => {
      setProgress({ current, total, percent: Math.round((current / total) * 100), errorCount: errorCountRef.current, startedAt: batchStartedAtRef.current, endedAt: null })
    }

    // 비동기 결과 후처리 (업스케일 + 저장) — 단위 테스트 가능한 standalone 헬퍼로 위임.
    const processAsyncResult = (scene, result) => processAsyncSceneResult({
      scene, result,
      flowAPI, imageUpscale, saveMode, projectName, seed,
      updateScene,
      logPrefix: '[Automation]',
    })

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
          // errorKind 명시 클리어 — prior image-missing 마커가 새 timeout 메시지를 가리지 않도록.
          updateScene(item.scene.id, { status: 'error', error: 'Generation timeout', errorKind: null })
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
            // processAsyncResult 의 반환값은 finalize success (이미지 받았어도 디스크 저장 실패 시 false).
            // result.success 만 보면 save 실패 씬이 배치 요약에서 성공으로 잘못 집계되는 회귀.
            const finalizeOk = await processAsyncResult(item.scene, result)
            if (!finalizeOk) {
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

      // 스타일 프롬프트 합치기 (태그 매칭 자동 + style_tag 프리셋 fallback + selectedStyleRefId 수동)
      const { styledPrompt, appliedStyle } = resolveSceneStyle(scene.prompt, allMatched, selectedStyleRefId, references, matchedRefs, scene.style_tag)

      // 비동기 제출
      console.log('[Automation] Scene', scene.id, '→ prompt:', styledPrompt.substring(0, 80) + '...', '| style:', appliedStyle, '| refs:', matchedRefs.length)
      const submitResult = await submitGenerationDOM(styledPrompt, matchedRefs, { batchCount: imageBatchCount, seed })
      if (submitResult.success && submitResult.generationId) {
        pendingQueue.push({ generationId: submitResult.generationId, scene, submittedAt: Date.now() })
        consecutiveErrors = 0
        console.log('[Automation] Submitted scene', scene.id, '→', submitResult.generationId)
      } else {
        console.error('[Automation] Submit failed for scene', scene.id, ':', submitResult.error)
        updateScene(scene.id, { status: 'error', error: submitResult.error, errorKind: null })
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
    // 사용자 중단(stop) vs 진짜 타임아웃을 구분한다.
    //   - 중단: pending으로 되돌려 재실행 가능하게 + error 카운트 증가 안 함
    //   - 타임아웃: error로 마킹 + 카운트 증가
    const userStopped = stopRequestedRef.current
    for (const item of pendingQueue) {
      if (userStopped) {
        // 사용자 중단으로 재시도 가능 상태 — 모든 에러 흔적 클리어 (image-missing 마커 포함).
        updateScene(item.scene.id, { status: 'pending', error: null, errorKind: null })
      } else {
        updateScene(item.scene.id, { status: 'error', error: 'Generation timeout', errorKind: null })
        errorCountRef.current++
        completedCountRef.current++
      }
    }
    updateProgressMsg(completedCountRef.current)

    // 정리
    try { await clearGenerations() } catch (e) { /* ignore */ }
  }
  
  /**
   * 자동화 시작
   */
  const start = useCallback(async (options = {}) => {
    // projectName은 호출자(App.jsx의 ensureProjectName)가 항상 넘겨야 한다.
    // 누락 시엔 새 autoflowcut_<ts> 폴더를 만들지 않고 'Untitled'로 폴백해
    // 고아 폴더 생성을 차단한다(호출자 버그는 console.warn으로 드러냄).
    if (!options.projectName) {
      console.warn('[useAutomation] start() called without projectName — falling back to "Untitled"')
    }
    const {
      projectName = 'Untitled',
      saveMode = 'folder',
      sceneIndices = null,
      imageBatchCount = 1,
      imageUpscale = 'off',
      selectedStyleRefId: _selectedStyleRefId = null,
      seed = null
    } = options
    const selectedStyleRefId = (_selectedStyleRefId != null && typeof _selectedStyleRefId !== 'string') ? String(_selectedStyleRefId) : _selectedStyleRefId

    if (isRunning) return

    stopRequestedRef.current = false
    pausedRef.current = false
    completedCountRef.current = 0

    // 새 배치 시작: DOM 세션 리셋
    resetDOMSession()

    setIsRunning(true)
    setIsPaused(false)
    setStatus('running')
    
    // 대상 씬 결정: 이미지 없는 씬 + pending/error 상태 씬 (재생성 대상).
    // App.jsx의 자동 매칭 검증과 동일한 filterPendingScenes 사용 — 검증/실행 대상 일치.
    const targetScenes = sceneIndices
      ? sceneIndices.map(i => scenes[i]).filter(Boolean)
      : filterPendingScenes(scenes)
    
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
        base64Data = stripBase64Prefix(base64Data)

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
      seed,
    }, total)
    
    // 완료 — 즉시 저장 (auto-save debounce 전에 프로젝트 전환/종료 방지)
    if (onComplete) {
      try { await onComplete() } catch (e) { console.warn('[Automation] onComplete error:', e.message) }
    }
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

  }, [isRunning, scenes, references, submitGenerationDOM, checkGeneration, collectGeneration, clearGenerations, uploadReference, getAccessToken, updateScene, getMatchingReferences, t, onOpenSettings])
  
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
    // 큐에 남은 작업 즉시 제거 (불필요한 API 요청 방지)
    if (generationQueue?.clearQueue) {
      generationQueue.clearQueue()
    }
  }, [t, generationQueue])
  
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
   *
   * 호출자가 React SyntheticEvent(onClick={retryErrors})를 그대로 넘기면 options
   * 자리가 이벤트 객체가 되어 projectName 이 누락 → start() 가 'Untitled' 폴백 →
   * 새 이미지 저장이 잘못된 프로젝트로 가는 데이터 손실 회귀가 발생한다.
   * 가드: SyntheticEvent 흔적이 보이면 options 을 비우는 대신 **즉시 return**.
   * (비우기만 하고 start() 로 넘기면 그 안에서 'Untitled' 폴백을 타게 되어
   *  같은 데이터 손실 경로가 살아있게 됨 — 절반-방어가 됨.)
   */
  const retryErrors = useCallback(async (options = {}) => {
    if (options && typeof options.preventDefault === 'function') {
      console.warn('[useAutomation] retryErrors called with SyntheticEvent — caller must pass an options object with projectName. Aborting.')
      return
    }
    const errorIndices = scenes
      .map((s, i) => s.status === 'error' ? i : -1)
      .filter(i => i !== -1)

    if (errorIndices.length === 0) return

    await start({ ...options, sceneIndices: errorIndices })
  }, [scenes, start])
  
  // 큐를 통한 시작
  const startQueued = useCallback(async (options = {}) => {
    if (!generationQueue) {
      return start(options)
    }
    try {
      await generationQueue.enqueue({
        type: 'scene_batch',
        label: 'Batch Scene Generation',
        execute: () => start(options)
      })
    } catch (err) {
      console.warn('[Automation] Queue rejected:', err.message)
    }
  }, [generationQueue, start])

  return {
    isRunning,
    isPaused,
    isStopping,
    progress,
    status,
    statusMessage,
    start: startQueued,
    togglePause,
    stop,
    retryScene,
    retryErrors
  }
}

export default useAutomation
