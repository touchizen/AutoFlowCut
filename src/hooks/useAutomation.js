/**
 * Automation Hook - 이미지 생성 자동화
 * 
 * Concurrent Queue 방식 (동시 처리)
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { resolveSceneStyle } from '../services/styleService'
import { filterPendingScenes } from '../utils/sceneFilters'
import { processAsyncSceneResult } from '../services/imageFinalize'
import { fileSystemAPI } from './useFileSystem'
import { getTimestamp } from '../utils/formatters'
import { cleanBase64 as stripBase64Prefix } from '../utils/urls'
import { toast } from '../components/Toast'
import { isQuotaExhaustedError, emitQuotaStop } from '../utils/quotaStop'
import { clampInt } from '../utils/clampInt'
import { stripMentionPrefixes, resolveMentions } from '../utils/mentionParser'

export function useAutomation(genAPI, scenesHook, addToHistory, onOpenSettings = null, addPendingSave = null, t = (key) => key, onAuthError = null, generationQueue = null, onComplete = null) {
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
  // Set true when batch stops due to authFailed sentinel — prevents the normal
  // stopRequestedRef final-status logic from overwriting 'error' with 'stopped'.
  const authStoppedRef = useRef(false)

  // generateImage 은 dead processScene 제거와 함께 호출 사이트가 사라져서 destructuring 에서도 제외.
  // 단일 씬 동기 호출이 필요해지면 genAPI.generateImage 으로 직접 접근.
  const { submitGeneration, checkGeneration, collectGeneration, clearGenerations, uploadReference, getAccessToken } = genAPI
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
    let { projectName, saveMode, imageBatchCount, imageUpscale, aspectRatio, imageModel, selectedStyleRefId, seed = null, concurrency: rawConcurrency } = options
    if (selectedStyleRefId != null && typeof selectedStyleRefId !== 'string') selectedStyleRefId = String(selectedStyleRefId)
    // 동시 in-flight 상한. 잘못된 값(0/음수/NaN)은 무한대기를 유발하므로 기본 5 로 clamp(1~10).
    const concurrency = clampInt(rawConcurrency, 1, 10, 5)
    const GATE_POLL_MS = 600  // window full 일 때 재확인 간격 (busy-loop/checkGeneration 과호출 방지)
    // selectedStyleRefId 없으면 자동 매칭 모드 — 씬별 style_tag로만 결정.
    // 임의의 "첫 스타일 카드 자동 적용" fallback은 제거됨 — UI 라벨("자동")과 실행이 일치해야 함.
    completedCountRef.current = 0
    let pauseBudgetMs = 0  // 누적 wait — pollStart / submittedAt 보정용
    errorCountRef.current = 0
    const pendingQueue = [] // { generationId, scene, submittedAt }
    let consecutiveErrors = 0

    // 사용자 일시정지 동안 대기하고, 재개 시 그 시간만큼 보정한다 — pause 가
    // in-flight 의 ITEM_TIMEOUT(2분)이나 Phase2 drain 예산(3분)을 갉아먹지 않게.
    const awaitUnpause = async () => {
      if (!pausedRef.current) return
      const pausedAt = Date.now()
      while (pausedRef.current && !stopRequestedRef.current) {
        await new Promise(r => setTimeout(r, 500))
      }
      const waited = Date.now() - pausedAt
      for (const item of pendingQueue) item.submittedAt += waited
      pauseBudgetMs += waited
    }
    // quota stop 은 공통 모듈 — stopRequestedRef 마킹 + listeners (queue, 모달) 자동 발사.
    // queue clear 는 useGenerationQueue 가 자체 subscribe 해서 처리하므로 caller 책임 X.
    // 이미 submit 한 in-flight 는 마저 collect 시도 (운 좋게 결과 오면 살림).
    const triggerQuotaStop = () => emitQuotaStop({ stopRequestedRef, scope: 'Automation' })

    const updateProgressMsg = (current) => {
      setProgress({ current, total, percent: Math.round((current / total) * 100), errorCount: errorCountRef.current, startedAt: batchStartedAtRef.current, endedAt: null })
    }

    // 비동기 결과 후처리 (업스케일 + 저장) — 단위 테스트 가능한 standalone 헬퍼로 위임.
    const processAsyncResult = (scene, result) => processAsyncSceneResult({
      scene, result,
      genAPI, imageUpscale, saveMode, projectName, seed,
      updateScene,
      logPrefix: '[Automation]',
    })

    // 완료된 결과 수집
    const ITEM_TIMEOUT = 120000 // 개별 아이템 2분 타임아웃
    const collectCompleted = async () => {
      const stillPending = []
      for (const item of pendingQueue) {
        if (stopRequestedRef.current) { stillPending.push(item); continue }
        const elapsed = Date.now() - item.submittedAt
        if (elapsed > ITEM_TIMEOUT) {
          console.warn('[Automation] Scene', item.scene.id, 'timed out after', Math.round(elapsed / 1000), 's')
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
            // Auth failed sentinel — token is dead, stop batch immediately.
            // onAuthError was already fired by the withAuthRetry wrapper; don't fire again.
            if (result.authFailed) {
              console.warn('[Automation] collectGeneration authFailed — stopping batch:', result.error)
              updateScene(item.scene.id, { status: 'error', error: result.error || t('status.authErrorStopped'), errorKind: 'auth' })
              errorCountRef.current++
              completedCountRef.current++
              updateProgressMsg(completedCountRef.current)
              stopRequestedRef.current = true
              authStoppedRef.current = true
              setStatus('error')
              setStatusMessage(result.error || t('status.authErrorStopped'))
              continue
            }
            if (!result.success && isQuotaExhaustedError(result.error)) {
              updateScene(item.scene.id, { status: 'error', error: result.error, errorKind: null })
              errorCountRef.current++
              completedCountRef.current++
              updateProgressMsg(completedCountRef.current)
              triggerQuotaStop()
              continue
            }
            console.log('[Automation] Collected scene', item.scene.id, ':', result.success, result.images?.length || 0, 'images')
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
          stillPending.push(item)
        }
      }
      pendingQueue.length = 0
      pendingQueue.push(...stillPending)
    }

    // Phase 1: 비동기 제출 + 중간 수집
    for (let i = 0; i < targetScenes.length; i++) {
      await awaitUnpause()
      if (stopRequestedRef.current) break

      // 동시성 게이트 — in-flight(pendingQueue) 가 concurrency 이상이면 슬롯이 빌 때까지 대기.
      // collect 로 완료분 회수 시도 → 여전히 full 이면 pause/stop 존중하며 GATE_POLL_MS 폴링
      // (busy-loop / checkGeneration 과호출 방지). Flow 시대의 고정 7~15초 대기를 대체.
      while (pendingQueue.length >= concurrency && !stopRequestedRef.current) {
        await collectCompleted()
        if (pendingQueue.length >= concurrency) {
          await awaitUnpause()
          if (stopRequestedRef.current) break
          await new Promise(r => setTimeout(r, GATE_POLL_MS))
        }
      }
      if (stopRequestedRef.current) break

      const scene = targetScenes[i]
      updateScene(scene.id, { status: 'generating', generatingStartedAt: Date.now() })
      setStatusMessage(t('status.generatingScene', { ids: scene.id, current: completedCountRef.current, total }))

      // 매칭 레퍼런스.
      // 공식 API 모드는 mediaId 대신 name 으로 base64 를 해석하므로(useSceneGeneration
      // 단일 씬 경로와 동일 계약) mediaId 또는 name 중 하나만 있어도 선택하고 name 을 보존한다.
      // R37 review fix: data/filePath 도 보존 — memory-only ref 가 referenceResolver 의
      // 디스크 fallback 도 못 타고 조용히 빠지는 회귀 차단. (useSceneGeneration 과 정책 동일.)
      const allMatched = getMatchingReferences(scene)
      const matchedRefs = allMatched
        .filter(r => r.mediaId || r.name || r.data || r.filePath)
        .map(r => ({
          category: r.category,
          mediaId: r.mediaId || null,
          caption: r.caption || '',
          name: r.name,
          data: r.data || null,
          filePath: r.filePath || null,
        }))
      if (matchedRefs.length > 0) {
        console.log('[Automation] Scene', scene.id, '→ injecting', matchedRefs.length, 'refs')
      }

      // `@name` 인라인 멘션 제거 → Gemini 가 본문에서 이름을 일반 명사로 읽도록.
      // 매칭된 ref 는 getMatchingReferences (useScenes) 가 이미 allMatched/matchedRefs 에 포함.
      const cleanPrompt = stripMentionPrefixes(scene.prompt, references)
      const { missing: missingMentions } = resolveMentions(scene.prompt, references)
      if (missingMentions.length > 0) console.warn('[Automation] Scene', scene.id, 'unknown @mentions:', missingMentions.join(', '))
      // 스타일 프롬프트 합치기 (태그 매칭 자동 + style_tag 프리셋 fallback + selectedStyleRefId 수동)
      const { styledPrompt, appliedStyle } = resolveSceneStyle(cleanPrompt, allMatched, selectedStyleRefId, references, matchedRefs, scene.style_tag)

      // 비동기 제출
      console.log('[Automation] Scene', scene.id, '→ prompt:', styledPrompt.substring(0, 80) + '...', '| style:', appliedStyle, '| refs:', matchedRefs.length)
      const submitResult = await submitGeneration(styledPrompt, matchedRefs, { batchCount: imageBatchCount, seed, aspectRatio, imageModel })
      if (submitResult.success && submitResult.generationId) {
        const _now = Date.now()
        pendingQueue.push({ generationId: submitResult.generationId, scene, submittedAt: _now, originalSubmittedAt: _now })
        consecutiveErrors = 0
        console.log('[Automation] Submitted scene', scene.id, '→', submitResult.generationId)
      } else {
        console.error('[Automation] Submit failed for scene', scene.id, ':', submitResult.error)
        if (isQuotaExhaustedError(submitResult.error)) {
          updateScene(scene.id, { status: 'error', error: submitResult.error, errorKind: null })
          errorCountRef.current++
          completedCountRef.current++
          updateProgressMsg(completedCountRef.current)
          triggerQuotaStop()
          break
        }
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

    }

    // Phase 2: 남은 결과 전부 수집 (3초 간격, 최대 3분)
    const pollStart = Date.now()
    while (
      pendingQueue.length > 0 &&
      !stopRequestedRef.current &&
      (Date.now() - pollStart - pauseBudgetMs < 180000)
    ) {
      // paused (사용자 일시정지) 인식 — Phase 2 도 pause 동안 멈추고 시간 보정.
      await awaitUnpause()
      if (stopRequestedRef.current) break
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
      sceneIds = null,  // 선호 — queue 지연 후에도 안정적으로 id 로 resolve (index staleness 회피)
      imageBatchCount = 1,
      imageUpscale = 'off',
      aspectRatio = '16:9',
      imageModel = undefined,
      selectedStyleRefId: _selectedStyleRefId = null,
      seed = null,
      concurrency = undefined,
      force = false
    } = options
    const selectedStyleRefId = (_selectedStyleRefId != null && typeof _selectedStyleRefId !== 'string') ? String(_selectedStyleRefId) : _selectedStyleRefId

    if (isRunning) return

    stopRequestedRef.current = false
    pausedRef.current = false
    authStoppedRef.current = false
    completedCountRef.current = 0

    setIsRunning(true)
    setIsPaused(false)
    setStatus('running')
    
    // 대상 씬 결정:
    //   - sceneIndices 명시: 그 인덱스들 (retry/partial 호출)
    //   - force=true (MCP 전용): prompt 있는 모든 씬 (완료된 씬도 포함, 새 스타일로 재생성)
    //   - 그 외: filterPendingScenes — 이미지 없는 씬 + pending/error 상태 (App.jsx 자동 매칭 검증과 일치)
    const targetScenes = sceneIds
      ? sceneIds.map(id => scenes.find(s => s.id === id)).filter(Boolean)  // 실행 시점 현재 scenes 에서 id 로 resolve
      : sceneIndices
        ? sceneIndices.map(i => scenes[i]).filter(Boolean)
        : force
          ? scenes.filter(s => s.prompt)
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
      // BYOK 키 없음 → 생성 중단 + API 키 모달 안내 (handleStart 와 동일 UX).
      // 'flow-login-expired' → App 의 useFlowEvents → showApiKeyModal.
      console.log('[Automation] No API key — prompting setup.')
      setStatusMessage(`❌ ${t('status.loginRequired')}`)
      setStatus('error')
      setIsRunning(false)
      window.dispatchEvent(new CustomEvent('flow-login-expired'))
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
          // Auth failed sentinel — token is dead, stop batch immediately.
          // onAuthError was already fired by the withAuthRetry wrapper; don't fire again.
          if (result.authFailed) {
            console.warn('[Automation] uploadReference authFailed — stopping batch:', result.error)
            stopRequestedRef.current = true
            authStoppedRef.current = true
            setStatus('error')
            setStatusMessage(result.error || t('status.authErrorStopped'))
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
              // Don't overwrite the auth-error message that uploadOne already set.
              if (!authStoppedRef.current) {
                setStatusMessage(t('status.uploadingRefs', { current: uploadedCount, total: refsToUpload.length }))
              }
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

      // Auth-failed during upload — status/message already set in uploadOne. Clean up and exit.
      if (authStoppedRef.current) {
        setIsRunning(false)
        setIsPaused(false)
        setIsStopping(false)
        return
      }
    }

    // force=true 재생성: done/error 씬을 pending으로 리셋해 UI에 재생성 시작이 보이게 함.
    // 이미지/이미지 경로는 유지 — 새 이미지 도착 전까지 이전 결과를 노출해 사용자가 비교 가능.
    // error/errorKind도 초기화해 stale 메시지 노출 회피.
    // ⚠️ 폴더/토큰 확인·ref 업로드를 모두 통과한 뒤(실제 씬 제출 직전)에 리셋한다. 그리고
    //    그 대기 중 Stop 을 눌렀을 수 있으니 !stopRequestedRef 도 확인 — 안 그러면 제출은
    //    안 됐는데 done 씬이 pending+image 로 남아 "이미지는 있는데 미완료"로 저장된다.
    if (force && !stopRequestedRef.current) {
      for (const s of targetScenes) {
        if (s.status === 'done' || s.status === 'error') {
          updateScene(s.id, { status: 'pending', error: null, errorKind: null })
        }
      }
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
      aspectRatio,
      imageModel,
      selectedStyleRefId,
      seed,
      concurrency,
    }, total)
    
    // 완료 — 즉시 저장 (auto-save debounce 전에 프로젝트 전환/종료 방지)
    // completed=true 는 "진행률 100% 도달" 을 의미한다. 다음은 모두 false 여야 한다:
    //   - 사용자 중단(stop)·쿼터 중단(stopRequestedRef)
    //   - 3회 연속 submit 실패로 인한 조기 break, auth-stop 등 → completedCount < total
    const completedFully = !stopRequestedRef.current && completedCountRef.current >= total
    if (onComplete) {
      try { await onComplete({ completed: completedFully }) } catch (e) { console.warn('[Automation] onComplete error:', e.message) }
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

    if (authStoppedRef.current) {
      // Status + message already set at the auth-fail site — do not overwrite.
    } else if (stopRequestedRef.current) {
      setStatus('stopped')
      setStatusMessage(`${t('status.stopped')} — ${summary}`)
    } else {
      setStatus('done')
      setStatusMessage(`${t('status.done')} — ${summary}`)
    }

  }, [isRunning, scenes, references, submitGeneration, checkGeneration, collectGeneration, clearGenerations, uploadReference, getAccessToken, updateScene, getMatchingReferences, t, onOpenSettings])
  
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
    // 큐에 남은 작업 즉시 제거 (불필요한 API 요청 방지)
    if (generationQueue?.clearQueue) {
      generationQueue.clearQueue()
    }
  }, [t, generationQueue])
  
  // 큐를 통한 시작 — 정상 Start 와 retry 가 모두 이 경로를 타 ref/video 작업과 직렬화한다.
  // (queue 없으면 직접 start — 하위호환.)
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

  /**
   * 특정 씬 재시도 — startQueued 경유(정상 Start 와 동일한 queue 직렬화).
   */
  const retryScene = useCallback(async (sceneId, options = {}) => {
    if (!scenes.some(s => s.id === sceneId)) return
    // id 로 전달 — queue 대기 중 scenes 재정렬/삭제가 있어도 실행 시점에 올바른 씬을 resolve.
    await startQueued({ ...options, sceneIds: [sceneId] })
  }, [scenes, startQueued])

  /**
   * 에러 씬들만 재시도 — startQueued 경유.
   *
   * 호출자가 React SyntheticEvent(onClick={retryErrors})를 그대로 넘기면 options
   * 자리가 이벤트 객체가 되어 projectName 이 누락 → start() 가 'Untitled' 폴백 →
   * 새 이미지 저장이 잘못된 프로젝트로 가는 데이터 손실 회귀가 발생한다.
   * 가드: SyntheticEvent 흔적이 보이면 options 을 비우는 대신 **즉시 return**.
   */
  const retryErrors = useCallback(async (options = {}) => {
    if (options && typeof options.preventDefault === 'function') {
      console.warn('[useAutomation] retryErrors called with SyntheticEvent — caller must pass an options object with projectName. Aborting.')
      return
    }
    // id 로 스냅샷 — queue 대기 중 재정렬돼도 실행 시점에 동일 씬을 resolve(index staleness 회피).
    const errorIds = scenes.filter(s => s.status === 'error').map(s => s.id)

    if (errorIds.length === 0) return

    await startQueued({ ...options, sceneIds: errorIds })
  }, [scenes, startQueued])

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
    retryErrors,
  }
}

export default useAutomation
