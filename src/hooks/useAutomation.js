/**
 * Automation Hook - 이미지 생성 자동화
 * 
 * Concurrent Queue 방식 (동시 처리)
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { resolveSceneStyle, presetTagForStyleId } from '../services/styleService'
import { filterPendingScenes } from '../utils/sceneFilters'
import { processAsyncSceneResult } from '../services/imageFinalize'
import { fileSystemAPI } from './useFileSystem'
import { getTimestamp } from '../utils/formatters'
import { cleanBase64 as stripBase64Prefix } from '../utils/urls'
import { toast } from '../components/Toast'
import { isQuotaExhaustedError, emitQuotaStop } from '../utils/quotaStop'
import { clampInt } from '../utils/clampInt'
import { resolveMentions } from '../utils/mentionParser'
import { needsEntityRegistration, applyEntityRegistrationPatch, selectRefsToRegister } from '../utils/refEntityRegistration'
import { makeBatchConsumeGate } from './batchConsumeGate'
import { resolveProjectBatchId } from '../utils/batchId'
import { consumeBatchDownload } from '../firebase/functions'
import { batchStartGate } from './batchStartGate'
import { getAuthErrorMessage, getAuthRequiredMessage } from '../utils/authMessages'
import { getFlowSubmitPacingDelayMs } from '../utils/flowSubmitPacing'
import {
  applyM1MentionExclusions,
  flowImageInjectable,
} from '../utils/refImageGuard'
import { resolveSceneImageProvider } from '../utils/sceneProviderResolution'
import { imageGenerationItemTimeoutMs } from '../config/imageGenerationTimeouts'

export function useAutomation(genAPI, scenesHook, addToHistory, onOpenSettings = null, addPendingSave = null, t = (key) => key, onAuthError = null, generationQueue = null, onComplete = null, mode = 'api', flowProjectReady = true, flowAgentOn = false, subscriptionBatch = null, onPaywall = null, isAuthenticated = false, onLoginRequired = null, subscriptionStatus = undefined, refreshSubscription = null) {
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0, errorCount: 0, startedAt: null, endedAt: null })
  const [status, setStatus] = useState('ready')
  const [statusMessage, setStatusMessage] = useState('')
  const authErrorMessage = () => getAuthErrorMessage(mode, t)
  const authRequiredMessage = () => getAuthRequiredMessage(mode, t)

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
  // 논리적 배치 동안 유지되는 batchId. full start = 새 배치(새 id), retry/partial = 직전 배치 재사용
  // → 저장 실패 후 재시도가 서버 멱등으로 재과금되지 않게 한다(이중과금 방지).
  // 프로젝트별 batchId — projectName -> batchId. 같은 프로젝트의 retry 는 재사용(서버 멱등=무료),
  // 다른 프로젝트는 분리돼 무임승차 불가. (resolveProjectBatchId 참고)
  const batchIdByProjectRef = useRef(new Map())
  // Set true when batch stops due to authFailed sentinel — prevents the normal
  // stopRequestedRef final-status logic from overwriting 'error' with 'stopped'.
  const authStoppedRef = useRef(false)

  // generateImage 은 dead processScene 제거와 함께 호출 사이트가 사라져서 destructuring 에서도 제외.
  // 단일 씬 동기 호출이 필요해지면 genAPI.generateImage 으로 직접 접근.
  const { submitGeneration, checkGeneration, collectGeneration, clearGenerations, uploadReference, getAccessToken } = genAPI
  const { scenes, references, updateScene, getMatchingReferences, updateReferences } = scenesHook

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
    let {
      projectName,
      saveMode,
      imageBatchCount,
      imageUpscale,
      aspectRatio,
      imageModel,
      imageProvider = 'google',
      generationSettings,
      selectedStyleRefId,
      seed = null,
      concurrency: rawConcurrency,
      flowPacingMinMs,
      flowPacingMaxMs,
      currentRefs,
      consumeGate,
      m1ExcludedMentionNamesBySceneId = {},
    } = options
    if (selectedStyleRefId != null && typeof selectedStyleRefId !== 'string') selectedStyleRefId = String(selectedStyleRefId)
    // #R6-15: entity 패치가 반영된 refs (없으면 closure references 폴백 — 멘션 해석 일관성).
    const effectiveRefs = currentRefs || references
    // 동시 in-flight 상한. 잘못된 값(0/음수/NaN)은 무한대기를 유발하므로 기본 5 로 clamp(1~10).
    const concurrency = clampInt(rawConcurrency, 1, 15, 5)
    const GATE_POLL_MS = 600  // window full 일 때 재확인 간격 (busy-loop/checkGeneration 과호출 방지)
    // selectedStyleRefId 없으면 자동 매칭 모드 — 씬별 style_tag로만 결정.
    // 임의의 "첫 스타일 카드 자동 적용" fallback은 제거됨 — UI 라벨("자동")과 실행이 일치해야 함.
    completedCountRef.current = 0
    let pauseBudgetMs = 0  // 누적 wait — pollStart / submittedAt 보정용
    errorCountRef.current = 0
    const pendingQueue = [] // { generationId, scene, submittedAt }
    let consecutiveErrors = 0

    // 사용자 일시정지 동안 대기하고, 재개 시 그 시간만큼 보정한다 — pause 가
    // in-flight 의 provider별 item timeout이나 Phase2 drain 예산을 갉아먹지 않게.
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

    // #7: consume 이 denied 되면 새 씬 제출을 중단하고 paywall 을 띄운다.
    // consumeGate.ensure() 는 결과를 캐시하므로 denied 후 모든 호출은 즉시 {ok:false} 반환.
    // 이 ref 는 collectCompleted 가 denied 를 감지한 시점에 true 로 설정되고,
    // Phase 1 루프가 stopRequestedRef 와 동일하게 취급해 새 제출을 차단한다.
    let consumeDenied = false
    const handleConsumeDenied = () => {
      if (!consumeDenied) {
        consumeDenied = true
        stopRequestedRef.current = true
        console.warn('[Automation] Consume denied mid-batch — stopping new submissions, triggering paywall')
        onPaywall?.()
      }
    }

    // 비동기 결과 후처리 (업스케일 + 저장) — 단위 테스트 가능한 standalone 헬퍼로 위임.
    const processAsyncResult = async (scene, result, resolvedModel = imageModel) => {
      const ok = await processAsyncSceneResult({
        scene, result,
        genAPI, imageUpscale, saveMode, projectName, seed, model: resolvedModel,
        updateScene,
        gate: consumeGate,  // 배치당 1회 consume 보장 (undefined 면 processAsyncSceneResult 가 no-op 사용)
        logPrefix: '[Automation]',
      })
      // processAsyncSceneResult 가 denied 로 false 반환하면 → 새 제출 중단 + paywall.
      // gate 가 denied 됐는지 확인 (ensure 결과 캐시를 재활용 — 추가 서버 호출 없음).
      if (!ok) {
        const gateCheck = await consumeGate.ensure()
        if (!gateCheck.ok) handleConsumeDenied()
      }
      return ok
    }

    // 완료된 결과 수집
    const collectCompleted = async () => {
      const stillPending = []
      for (const item of pendingQueue) {
        if (stopRequestedRef.current) { stillPending.push(item); continue }
        const elapsed = Date.now() - item.submittedAt
        const itemTimeoutMs = imageGenerationItemTimeoutMs(item.provider)
        if (elapsed > itemTimeoutMs) {
          console.warn('[Automation] Scene', item.scene.id, 'timed out after', Math.round(elapsed / 1000), 's')
          updateScene(item.scene.id, { status: 'error', error: 'Generation timeout', errorKind: null })
          errorCountRef.current++
          completedCountRef.current++
          updateProgressMsg(completedCountRef.current)
          continue
        }
        try {
          const st = await checkGeneration(item.generationId)
          // #R23-4: checkGeneration 자체가 401/403 → authFailed 를 표면화할 수 있다(완료 안 돼도).
          //   이걸 무시하면 죽은 인증으로 provider별 item timeout까지 pending 으로 매달린다 → 즉시 중단.
          //   onAuthError 는 withAuthRetry wrapper 가 이미 발화 — 여기서 또 발화하지 않는다.
          if (st.authFailed) {
            console.warn('[Automation] checkGeneration authFailed — stopping batch:', st.error)
            updateScene(item.scene.id, { status: 'error', error: st.error || authErrorMessage(), errorKind: 'auth' })
            errorCountRef.current++
            completedCountRef.current++
            updateProgressMsg(completedCountRef.current)
            stopRequestedRef.current = true
            authStoppedRef.current = true
            setStatus('error')
            setStatusMessage(st.error || authErrorMessage())
            continue
          }
          if (st.completed) {
            const result = await collectGeneration(item.generationId)
            // Auth failed sentinel — token is dead, stop batch immediately.
            // onAuthError was already fired by the withAuthRetry wrapper; don't fire again.
            if (result.authFailed) {
              console.warn('[Automation] collectGeneration authFailed — stopping batch:', result.error)
              updateScene(item.scene.id, { status: 'error', error: result.error || authErrorMessage(), errorKind: 'auth' })
              errorCountRef.current++
              completedCountRef.current++
              updateProgressMsg(completedCountRef.current)
              stopRequestedRef.current = true
              authStoppedRef.current = true
              setStatus('error')
              setStatusMessage(result.error || authErrorMessage())
              continue
            }
            if (!result.success && isQuotaExhaustedError(result)) {
              updateScene(item.scene.id, { status: 'error', error: result.error, errorKind: result.errorKind ?? null })
              errorCountRef.current++
              completedCountRef.current++
              updateProgressMsg(completedCountRef.current)
              triggerQuotaStop()
              continue
            }
            console.log('[Automation] Collected scene', item.scene.id, ':', result.success, result.images?.length || 0, 'images')
            // #R12-7: finalize/save 를 check/collect 와 분리한다. 결과는 이미 수집(consume)됐으므로
            //   finalize 가 throw 해도 item 을 requeue 하면 안 된다(이미 없는 generation 재폴링).
            //   finalize 예외는 씬을 error 로 표시하고 완료로 카운트한다.
            let finalizeOk = false
            try {
              finalizeOk = await processAsyncResult(item.scene, result, item.model)
            } catch (finErr) {
              console.error('[Automation] Finalize/save error for scene', item.scene.id, ':', finErr.message)
              updateScene(item.scene.id, { status: 'error', error: finErr.message, errorKind: null })
              finalizeOk = false
            }
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
      // (busy-loop / checkGeneration 과호출 방지). API 모드 전용 — Flow 는 아래 20~40초 페이싱으로
      // throttle 하므로 게이트를 무시한다(원본 Flow 동작).
      while (mode !== 'flow' && pendingQueue.length >= concurrency && !stopRequestedRef.current) {
        await collectCompleted()
        if (pendingQueue.length >= concurrency) {
          await awaitUnpause()
          if (stopRequestedRef.current) break
          await new Promise(r => setTimeout(r, GATE_POLL_MS))
        }
      }
      if (stopRequestedRef.current) break

      const scene = applyM1MentionExclusions(
        targetScenes[i],
        m1ExcludedMentionNamesBySceneId
      )
      updateScene(scene.id, { status: 'generating', generatingStartedAt: Date.now() })
      setStatusMessage(t('status.generatingScene', { ids: scene.id, current: completedCountRef.current, total }))

      // 매칭 레퍼런스.
      // 공식 API 모드는 mediaId 대신 name 으로 base64 를 해석하므로(useSceneGeneration
      // 단일 씬 경로와 동일 계약) mediaId 또는 name 중 하나만 있어도 선택하고 name 을 보존한다.
      // R37 review fix: data/filePath 도 보존 — memory-only ref 가 referenceResolver 의
      // 디스크 fallback 도 못 타고 조용히 빠지는 회귀 차단. (useSceneGeneration 과 정책 동일.)
      const allMatched = getMatchingReferences(scene)
      const matchedRefs = allMatched
        .filter(r => mode === 'flow'
          ? flowImageInjectable(r)
          : !!(r?.mediaId || r?.name || r?.data || r?.filePath)
        )
        .map(r => ({
          category: r.category,
          mediaId: r.mediaId || null,
          caption: r.caption || '',
          name: r.name,
          data: r.data || null,
          filePath: r.filePath || r.imagePath || null,
        }))
      if (matchedRefs.length > 0) {
        console.log('[Automation] Scene', scene.id, '→ injecting', matchedRefs.length, 'refs')
      }

      // `@name` 인라인 멘션은 engineApi 내부에서 제거됨 (M4 T7). 여기선 로깅 전용.
      const { missing: missingMentions } = resolveMentions(scene.prompt, effectiveRefs)
      if (missingMentions.length > 0) console.warn('[Automation] Scene', scene.id, 'unknown @mentions:', missingMentions.join(', '))
      // 스타일 프롬프트 합치기 (태그 매칭 자동 + style_tag 프리셋 fallback + selectedStyleRefId 수동)
      // scene.prompt 그대로 전달 — strip은 engineApi.submitGeneration 내부에서 수행.
      const { styledPrompt, appliedStyle } = resolveSceneStyle(scene.prompt, allMatched, selectedStyleRefId, effectiveRefs, matchedRefs, scene.style_tag)

      // Issue #3: 전역 프리셋 스타일이 적용됐으면 씬 style_tag 에 반영 — 상세 모달이 적용된
      //   스타일을 보여주고, 모달 재생성(전역 override 없이 style_tag fallback)이 동일 스타일을
      //   재현하도록. ref: 스타일/미선택은 null → 무동작.
      // 한계(리뷰 M5): style_tag 는 프리셋만 표현 가능(문자열). 따라서 (a) 프리셋 배치는 씬의 기존
      //   per-scene style_tag 를 실제 적용된 프리셋으로 덮고, (b) ref: 스타일/none 배치는 stamp 를
      //   하지 않아 이전 프리셋 태그가 남을 수 있다. 둘 다 "적용된 스타일 반영"이라는 취지의 트레이드오프.
      const stampTag = presetTagForStyleId(selectedStyleRefId)
      if (stampTag && scene.style_tag !== stampTag) {
        updateScene(scene.id, { style_tag: stampTag })
      }

      // 비동기 제출
      console.log('[Automation] Scene', scene.id, '→ prompt:', styledPrompt.substring(0, 80) + '...', '| style:', appliedStyle, '| refs:', matchedRefs.length)
      const resolvedGeneration = resolveSceneImageProvider(scene, generationSettings)
      if (resolvedGeneration.warning) console.warn('[Automation]', resolvedGeneration.warning)
      const submitResult = await submitGeneration(styledPrompt, matchedRefs, { batchCount: imageBatchCount, seed, aspectRatio, model: resolvedGeneration.model, provider: resolvedGeneration.provider, references: effectiveRefs })
      if (submitResult.success && submitResult.generationId) {
        const _now = Date.now()
        pendingQueue.push({ generationId: submitResult.generationId, scene, model: resolvedGeneration.model, provider: resolvedGeneration.provider, submittedAt: _now, originalSubmittedAt: _now })
        consecutiveErrors = 0
        console.log('[Automation] Submitted scene', scene.id, '→', submitResult.generationId)
      } else if (submitResult.success && Array.isArray(submitResult.images) && submitResult.images.length > 0) {
        // 동기 결과: Flow @멘션 씬(flow:generate-scene)은 generationId 없이 images 를 바로 반환한다.
        //   이 분기가 없으면 generationId 없음 → 아래 else 의 '제출 실패'로 잘못 처리돼 생성된
        //   이미지가 버려지고, 에러 씬으로 남아 다음 배치/재생성에서 또 생성된다(중복 생성).
        consecutiveErrors = 0
        let finalizeOk = false
        try { finalizeOk = await processAsyncResult(scene, submitResult, resolvedGeneration.model) }
        catch (finErr) {
          console.error('[Automation] Finalize error (sync) for scene', scene.id, ':', finErr.message)
          updateScene(scene.id, { status: 'error', error: finErr.message, errorKind: null })
        }
        if (!finalizeOk) errorCountRef.current++
        completedCountRef.current++
        updateProgressMsg(completedCountRef.current)
        console.log('[Automation] Scene', scene.id, 'finalized synchronously (', submitResult.images.length, 'image)')
      } else {
        console.error('[Automation] Submit failed for scene', scene.id, ':', submitResult.error)
        // #R33 self-heal: 멘션 피커에 캐릭터가 없으면(Flow UI 에서 삭제 등) staleMention 이 실려 온다.
        //   해당 ref 를 'failed' 로 마킹 → 다음 실행 선등록(needsEntityRegistration)에서 자동 재등록.
        if (submitResult.staleMention) {
          const staleName = String(submitResult.staleMention).toLowerCase()
          const staleRef = (effectiveRefs || []).find(r => r?.name && String(r.name).toLowerCase() === staleName)
          if (staleRef && staleRef.id != null) {
            console.warn('[Automation] stale mention — marking ref for re-register (self-heal):', staleRef.name)
            updateReferences(prev => prev.map(r => r.id === staleRef.id ? { ...r, flowNameSyncStatus: 'failed' } : r))
          }
        }
        // #R10-6: 인증 실패 센티넬 — 토큰이 죽었으니 즉시 배치 중단(collect/upload 경로와 동일 처리).
        if (submitResult.authFailed) {
          console.warn('[Automation] submitGeneration authFailed — stopping batch:', submitResult.error)
          updateScene(scene.id, { status: 'error', error: submitResult.error || authErrorMessage(), errorKind: 'auth' })
          errorCountRef.current++
          completedCountRef.current++
          updateProgressMsg(completedCountRef.current)
          stopRequestedRef.current = true
          authStoppedRef.current = true
          setStatus('error')
          setStatusMessage(submitResult.error || authErrorMessage())
          break
        }
        if (isQuotaExhaustedError(submitResult)) {
          updateScene(scene.id, { status: 'error', error: submitResult.error, errorKind: submitResult.errorKind ?? null })
          errorCountRef.current++
          completedCountRef.current++
          updateProgressMsg(completedCountRef.current)
          triggerQuotaStop()
          break
        }
        updateScene(scene.id, { status: 'error', error: submitResult.error, errorKind: submitResult.errorKind ?? null })
        errorCountRef.current++
        completedCountRef.current++
        updateProgressMsg(completedCountRef.current)
        consecutiveErrors++
        if (consecutiveErrors >= 3) {
          console.error('[Automation] 3 consecutive submit failures, stopping')
          break
        }
      }

      // Flow 반봇 페이싱 — 씬 사이 랜덤 대기(기본 7~15초, 설정에서 조정) + 중간 수집.
      // Flow(Agent OFF)는 단일 웹 패널 DOM 자동화라 빠른 연속 제출이 봇 감지/레이트리밋을
      // 유발한다. API 모드는 동시성 윈도우(위 게이트)로 충분하므로 대기 없음.
      if (mode === 'flow' && i < targetScenes.length - 1 && !stopRequestedRef.current) {
        const waitMs = getFlowSubmitPacingDelayMs(flowPacingMinMs, flowPacingMaxMs)
        console.log('[Automation] (Flow) Waiting', Math.round(waitMs / 1000), 's before next submit...')
        const waitEnd = Date.now() + waitMs
        while (Date.now() < waitEnd && !stopRequestedRef.current) {
          await awaitUnpause()
          if (stopRequestedRef.current) break
          await new Promise(r => setTimeout(r, 500))
        }
        if (flowAgentOn) {
          // Flow Agent ON: 다음 씬 제출 전에 직전 비동기 씬(generate-image)을 끝까지 수집한다.
          //   에이전트는 한 번에 하나만 처리(idle-gate)하고, 비동기 이미지와 동기 @멘션 씬이 같은
          //   DOM 결과 풀을 "동시에" 긁으면 서로 가로채는 race 가 난다(첫 씬 타임아웃 / 둘째 씬이
          //   옛 이미지). Agent ON 은 직렬 수집으로 그 동시성을 없앤다(최대 ~2분). Agent OFF 는
          //   빠른 intercept 라 기존 파이프라인(단발 수집) 유지.
          const drainStart = Date.now()
          while (pendingQueue.length > 0 && !stopRequestedRef.current && (Date.now() - drainStart < 120000)) {
            await awaitUnpause()
            if (stopRequestedRef.current) break
            await collectCompleted()
            if (pendingQueue.length > 0) await new Promise(r => setTimeout(r, 3000))
          }
        } else if (pendingQueue.length > 0 && !stopRequestedRef.current) {
          await collectCompleted()
        }
      }

    }

    // Phase 2: 남은 결과 전부 수집 (3초 간격, 기본 최대 3분).
    // fal 동기 adapter는 자체 wall-clock cap이 더 길어서 그 cap+IPC 여유까지 drain한다.
    const pollStart = Date.now()
    const phase2TimeoutMs = pendingQueue.reduce(
      (maxMs, item) => Math.max(maxMs, imageGenerationItemTimeoutMs(item.provider, 180000)),
      180000,
    )
    while (
      pendingQueue.length > 0 &&
      !stopRequestedRef.current &&
      (Date.now() - pollStart - pauseBudgetMs < phase2TimeoutMs)
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
      batchIntent = null,
      imageBatchCount = 1,
      imageUpscale = 'off',
      aspectRatio = '16:9',
      imageModel = undefined,
      imageProvider = 'google', // 전역 image provider(§5.8) — 미지정→google
      generationSettings: suppliedGenerationSettings = null,
      selectedStyleRefId: _selectedStyleRefId = null,
      seed = null,
      concurrency = undefined,
      flowPacingMinMs = undefined,  // Flow 페이싱 하한(ms) — 미지정 시 util 기본(7000)
      flowPacingMaxMs = undefined,  // Flow 페이싱 상한(ms) — 미지정 시 util 기본(15000)
      force = false,
      // #R34-fix: 호출자(App sync 게이트)가 방금 동기화한 entity 패치가 반영된 refs 를 넘기면
      //   closure 의 stale `references` 대신 이걸로 시작한다 — 첫 배치부터 @멘션이 해석된다.
      currentRefs: currentRefsOverride = null,
      m1ExcludedMentionNamesBySceneId = {},
    } = options
    const generationSettings = {
      ...(suppliedGenerationSettings || {}),
      generation: {
        ...(suppliedGenerationSettings?.generation || {}),
        image: {
          provider: suppliedGenerationSettings?.generation?.image?.provider ?? imageProvider,
          ...(suppliedGenerationSettings?.generation?.image || {}),
        },
      },
      modelsByProvider: {
        ...(imageModel != null ? { [imageProvider]: imageModel } : {}),
        ...(suppliedGenerationSettings?.modelsByProvider || {}),
      },
    }
    const selectedStyleRefId = (_selectedStyleRefId != null && typeof _selectedStyleRefId !== 'string') ? String(_selectedStyleRefId) : _selectedStyleRefId
    // #M2: sceneIds 는 membership 고정용이지 partial retry 의미가 아니다. 호출자가 batchIntent 로
    //   명시하면 그 의미가 우선하고, 미전달이면 기존 sceneIds/sceneIndices 추론을 보존한다.
    const inferredPartialRetry = !!(sceneIds || sceneIndices)
    const isPartialRetry =
      batchIntent === 'retry' ||
      (batchIntent == null && inferredPartialRetry)

    if (isRunning) return

    if (mode === 'flow' && !flowProjectReady) {
      toast.warning(t('toast.flowProjectNotReady'))
      return
    }

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

    // 배치 다운로드 구독 게이트 — 토큰/폴더/ref 업로드보다 먼저(요구사항: 로그아웃이면 로그인 모달 우선,
    // 쿼터 소진이면 paywall). subscriptionBatch 가 null 이면 미게이트(개발/테스트/구독 미로드) → 통과.
    // loading/error: 인증됐지만 Firestore doc 미확인 → 진행 금지 (서버 consume 거부 회피).
    {
      // #5: 부분 retry(sceneIds/sceneIndices)로 이 프로젝트의 기존 batchId 를 재사용하면 paywall 스킵
      //   (서버 멱등 no-op/거부에 위임). 이 프로젝트에 기존 id 가 없으면(첫 실행/재로드) 새 배치 → paywall 적용.
      //   프로젝트별 키라 다른 프로젝트의 과금된 id 에는 무임승차 불가.
      const isReusingBatch = !!(isPartialRetry && batchIdByProjectRef.current.get(projectName))
      const gate = batchStartGate({ subscriptionBatch, isAuthenticated, subscriptionStatus, isReusingBatch })
      if (gate.action === 'login') {
        onLoginRequired?.()
        setIsRunning(false); setIsPaused(false); setIsStopping(false)
        setStatus('ready'); setStatusMessage(t('status.ready'))
        return
      }
      if (gate.action === 'paywall') {
        onPaywall?.()
        setIsRunning(false); setIsPaused(false); setIsStopping(false)
        setStatus('ready'); setStatusMessage(t('status.ready'))
        return
      }
      if (gate.action === 'loading') {
        // subscription 아직 로드 중 / 에러 — 과금 안 함, paywall 모달 없음, 짧은 안내만.
        toast.warning(t('toast.subscriptionLoading'))
        setIsRunning(false); setIsPaused(false); setIsStopping(false)
        setStatus('ready'); setStatusMessage(t('status.ready'))
        return
      }
    }

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
    
    // 토큰 확인 — 선택된 image provider 의 키로 게이트(§5.7). google 키 없이 openai 만 있어도 시작 가능.
    setStatusMessage(t('status.checkingAuth'))
    const requiredImageProviders = [...new Set(targetScenes.map(scene => {
      const resolved = resolveSceneImageProvider(scene, generationSettings)
      if (resolved.warning) console.warn('[Automation]', resolved.warning)
      return resolved.provider
    }))]
    let hasRequiredToken = true
    for (const provider of requiredImageProviders) {
      if (!(await getAccessToken(false, false, provider))) {
        hasRequiredToken = false
        break
      }
    }
    if (!hasRequiredToken) {
      // BYOK 키 없음 → 생성 중단 + API 키 모달 안내 (handleStart 와 동일 UX).
      // 'flow-login-expired' → App 의 useFlowEvents → showApiKeyModal.
      console.log('[Automation] No auth token — prompting setup.')
      setStatusMessage(`❌ ${authRequiredMessage()}`)
      setStatus('error')
      setIsRunning(false)
      window.dispatchEvent(new CustomEvent('flow-login-expired'))
      return
    }
    
    // #R6-15: on-demand entity 등록 패치를 같은 run 의 씬 제출에도 반영하기 위한 로컬 refs.
    // updateReferences 는 React state 만 갱신할 뿐 이 실행 closure 의 `references` 는 stale 로
    // 남는다 → 같은 배치의 씬이 entityId 없는 refs 로 제출돼 멘션이 다음 run 에서야 동작.
    // 패치를 이 로컬 배열에 누적해 runConcurrentQueue 의 멘션/제출에 넘긴다(여러 ref 등록도 누적).
    // #R34-fix: 호출자가 동기화 직후 패치된 refs(currentRefsOverride)를 넘기면 그걸 우선 사용한다.
    //   (sync 게이트가 updateReferences 한 React state 는 같은 tick 엔 stale 이므로 직접 전달받는다.)
    let currentRefs = currentRefsOverride || references
    // 레퍼런스 업로드 (비동기 슬라이딩 윈도우 — 1초 간격 투입, 최대 5개 동시)
    console.log('[Automation] References check:', references.map(r => ({ name: r.name, hasData: !!(r.data || r.filePath || r.imagePath), mediaId: r.mediaId })))
    // 이번 run 의 타깃 씬들이 실제 쓰는 ref(캐릭터/씬/스타일 태그 + @멘션, getMatchingReferences
    //   합집합)만 등록 대상으로 스코프 — 어떤 씬도 안 쓰는 character 를 매번 Flow 에 업로드하던
    //   버그(멘션·태그 없는데 등록) 방지. 그중 미등록(!mediaId || needsEntityRegistration)만 올린다.
    const usedRefIds = new Set()
    for (const s of targetScenes) {
      for (const r of getMatchingReferences(s)) {
        if (r && r.id != null) usedRefIds.add(r.id)
      }
    }
    let refsToUpload = selectRefsToRegister(references, usedRefIds, mode)
    // #R34: 캐릭터 entity 동기화는 생성 배치에서 분리한다. 공유 flowView 에서 DOM 자동화가 동시
    //   실행되면 navigation 이 ERR_ABORTED 로 충돌하고, uploadImage 가 항상 새 entity 를 만들어
    //   중복 등록된다. 캐릭터는 Ref 탭의 '동기화'(개별/일괄) 버튼으로만 등록한다. 생성 배치는
    //   비-character ref(스타일/씬 이미지)만 업로드한다. (미동기화 @멘션은 engineFlow 이미지 폴백/에러.)
    if (mode === 'flow') refsToUpload = refsToUpload.filter(r => r?.type !== 'character')
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
          const result = await uploadReference(base64Data, { category: ref.category, name: ref.name, type: ref.type, refId: ref.id })
          if (result.success) {
            // #R13-9: 변이 전 원본 ref 스냅샷 — applyEntityRegistrationPatch 가 result 에서 생략된
            //   id 를 보존(R12-9)할 때 이미 덮어쓴 ref 가 아니라 원본 id 를 보게 한다.
            const originalRef = { ...ref }
            // result.mediaId 가 없으면(부분 응답) 기존 mediaId 를 보존(undefined 로 클로버 금지).
            ref.mediaId = result.mediaId ?? ref.mediaId
            ref.caption = result.caption || ref.caption
            // on-demand entity registration: character ref uploaded in flow mode → patch entityId
            // so sceneMentions.js can include this ref as a mention candidate (F9 precondition).
            if (needsEntityRegistration(ref, mode)) {
              const entityPatch = applyEntityRegistrationPatch(originalRef, result, true)
              // #R6-15: 패치를 로컬 currentRefs 에 누적(여러 ref 등록도 보존) → 같은 run 의 씬 제출
              //   (runConcurrentQueue)에서 멘션 해석에 쓰여 entityId 가 이번 배치부터 즉시 후보가 된다.
              currentRefs = currentRefs.map(r => r.id === ref.id ? { ...r, ...entityPatch } : r)
              // #R10-7: React state 는 enqueue 시점 스냅샷(currentRefs) 통째 쓰기 대신, 해당 ref 만
              //   최신 state 에 functional merge — 배치 도중 추가/편집된 다른 ref 를 덮어쓰지 않는다.
              const patchId = ref.id
              updateReferences(prev => prev.map(r => r.id === patchId ? { ...r, ...entityPatch } : r))
              console.log('[Automation] on-demand entity registered for ref:', ref.name, entityPatch)
            }
            return
          }
          // Auth failed sentinel — token is dead, stop batch immediately.
          // onAuthError was already fired by the withAuthRetry wrapper; don't fire again.
          if (result.authFailed) {
            console.warn('[Automation] uploadReference authFailed — stopping batch:', result.error)
            stopRequestedRef.current = true
            authStoppedRef.current = true
            setStatus('error')
            setStatusMessage(result.error || authErrorMessage())
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
            // #R12-8: read/upload 예외가 unhandled rejection 으로 새지 않게 catch 후 finally.
            uploadOne(ref).catch((e) => { console.warn('[Automation] uploadOne threw:', e?.message) }).finally(() => {
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
        // #R11-6: 공통 완료 콜백(즉시 저장)을 호출해 업로드 단계에서 멈춘 경우에도 저장/정리가 돈다.
        if (onComplete) {
          try { await onComplete({ completed: false }) } catch (e) { console.warn('[Automation] onComplete error:', e.message) }
        }
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

    // (배치 구독 게이트는 위 preflight 이전으로 이동 — 로그인/paywall 우선)
    // batchId: full start 면 이 프로젝트에 새 배치(새 id), retry/partial(sceneIds/sceneIndices) 이면
    // 이 프로젝트의 직전 배치 재사용. 재사용 시 서버 consume 가 멱등 no-op → 재시도가 이중과금되지 않는다.
    const { batchId } = resolveProjectBatchId(batchIdByProjectRef.current, projectName, isPartialRetry)
    // #6: charged 성공 시 refreshSubscription 1회 호출 — Firestore mirror stale 방지.
    const consumeGate = makeBatchConsumeGate(batchId, 'image', (a) => consumeBatchDownload(a), () => {
      refreshSubscription?.().catch(e => console.warn('[Automation] refreshSubscription failed:', e?.message))
    })

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
      imageProvider,
      generationSettings,
      selectedStyleRefId,
      seed,
      concurrency,
      flowPacingMinMs,
      flowPacingMaxMs,
      currentRefs, // #R6-15: entity 패치가 반영된 로컬 refs (멘션 해석에 사용)
      consumeGate,  // 배치당 1회 consume 보장 게이트
      m1ExcludedMentionNamesBySceneId,
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

  // #R8-10: onComplete 도 dep — 누락 시 완료 시점에 stale save 콜백을 호출할 수 있다.
  // subscriptionBatch/onPaywall/isAuthenticated/onLoginRequired: 배치 게이트 — 구독/인증 상태 변경 시 최신값 반영.
  }, [isRunning, scenes, references, submitGeneration, checkGeneration, collectGeneration, clearGenerations, uploadReference, getAccessToken, updateScene, getMatchingReferences, updateReferences, t, onOpenSettings, mode, flowProjectReady, onComplete, subscriptionBatch, onPaywall, isAuthenticated, onLoginRequired, subscriptionStatus, refreshSubscription])
  
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
    // #R12-6: start() 가 예기치 못하게 throw 해도 running/stopping UI 가 고착되지 않도록 가드.
    const guardedStart = async () => {
      try {
        return await start(options)
      } catch (e) {
        console.error('[Automation] start threw — resetting run state:', e?.message)
        setStatus('error')
        setStatusMessage(e?.message || t('status.error', { defaultValue: '오류' }))
        setIsRunning(false)
        setIsPaused(false)
        setIsStopping(false)
      }
    }
    if (!generationQueue) {
      return guardedStart()
    }
    try {
      await generationQueue.enqueue({
        type: 'scene_batch',
        label: 'Batch Scene Generation',
        execute: guardedStart
      })
    } catch (err) {
      console.warn('[Automation] Queue rejected:', err.message)
    }
  }, [generationQueue, start, t])

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
    if (mode === 'flow' && !flowProjectReady) {
      toast.warning(t('toast.flowProjectNotReady'))
      return
    }
    if (options && typeof options.preventDefault === 'function') {
      console.warn('[useAutomation] retryErrors called with SyntheticEvent — caller must pass an options object with projectName. Aborting.')
      return
    }
    // id 로 스냅샷 — queue 대기 중 재정렬돼도 실행 시점에 동일 씬을 resolve(index staleness 회피).
    const errorIds = scenes.filter(s => s.status === 'error').map(s => s.id)

    if (errorIds.length === 0) return

    await startQueued({ ...options, sceneIds: errorIds })
  }, [scenes, startQueued, mode, flowProjectReady, t])

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
