/**
 * useVideoAutomation — 비디오 생성 자동화 Hook (Async Pipeline)
 *
 * T2V (Text to Video), I2V (Image to Video) 모드 지원.
 *
 * 3-Phase Async Pipeline (AutoFlow 패턴):
 *   Phase 1: 순차 제출 (7~15초 간격, 완료 안 기다림)
 *   Phase 2: 일괄 폴링 (모든 generationId 배치 체크)
 *   Phase 3: 완료된 것부터 순차 다운로드+저장
 */

import { useState, useCallback, useRef } from 'react'
import { TIMING } from '../config/defaults'
import { fileSystemAPI } from './useFileSystem'
import { toast } from '../components/Toast'
import { retryVideoDownload } from '../services/videoRecovery'
import { downloadVideoBase64 } from '../services/videoDownload'
import { resolveFrameImageBase64 } from '../utils/framePairImages'
import { pickVideoMetadata, buildVideoMetaPatch } from '../utils/videoMetadata'
import { isQuotaExhaustedError, emitQuotaStop } from '../utils/quotaStop'

// 유틸: 랜덤 대기
const randomSleep = (min, max) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min))

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Auth failures are handled centrally by useFlowAPI's withAuthRetry wrapper
// (see useFlowAPI.js — wrapper shim calls clearTokenCache + the App-level
// handleAuthError on 2nd 401). This hook only consumes the `authFailed` sentinel
// returned by wrapped API calls and translates it into batch-level break/error.
// Previously took an `onAuthError` param that was never invoked after the inline
// 401 string-match was removed — dropped to keep the responsibility boundary clean.
export function useVideoAutomation(flowAPI, t = (key) => key, generationQueue = null, onComplete = null) {
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0, errorCount: 0, startedAt: null })
  const [status, setStatus] = useState('ready')
  const [statusMessage, setStatusMessage] = useState('')

  const stopRequestedRef = useRef(false)
  const pausedRef = useRef(false)
  // 이번 batch 가 quota 로 멈췄는지 — start() 마다 reset. isQuotaBlocked() race 회피
  // (사용자가 모달을 빨리 dismiss 하면 전역 block flag 가 false 로 돌아가도 이 ref 는 유지).
  const quotaStoppedRef = useRef(false)

  // quota stop 공통 모듈 위임 — queue clear 는 useGenerationQueue 가 직접 subscribe 함.
  const _maybeTriggerQuotaStop = (err) => {
    if (!isQuotaExhaustedError(err)) return false
    quotaStoppedRef.current = true
    emitQuotaStop({ stopRequestedRef, scope: 'VideoAutomation' })
    return true
  }

  const { generateVideoT2V, generateVideoI2V, checkVideoStatus, upscaleVideo, fetchMedia, getAccessToken, downloadVideo } = flowAPI

  // ─── Phase 1 Helper: 비디오 제출 ───
  const submitVideoItem = async (item, mode, options) => {
    const { videoModel, aspectRatio, duration, videoBatchCount = 1, seed = null, projectName = '' } = options
    const prompt = item.prompt || ''

    switch (mode) {
      case 't2v':
        return await generateVideoT2V(prompt, videoModel, aspectRatio, duration, videoBatchCount, seed)
      case 'i2v': {
        // 시작 프레임 base64 (필수). 끝 프레임은 있으면 lastFrame 보간.
        // 메모리(_startImage) 우선, 없으면 디스크(gallery→frames/, 씬→scenes/) 폴백 — 재오픈 후에도 동작.
        const startB64 = await resolveFrameImageBase64(item.startSceneId, item.startImage, projectName)
        if (!startB64) {
          return { success: false, error: 'No start image — generate the start scene first' }
        }
        const endB64 = await resolveFrameImageBase64(item.endSceneId, item.endImage, projectName)
        return await generateVideoI2V(prompt, startB64, endB64, videoModel, aspectRatio, duration, seed)
      }
      default:
        return { success: false, error: `Unknown mode: ${mode}` }
    }
  }

  // ─── Phase 3 Helper: 다운로드 + 저장 ───
  // DOM 다운로드 우선 (Flow UI가 해상도 선택 시 upscale/reCAPTCHA 자체 처리)
  // 다운로드 우선순위: DOM (해상도 선택 포함) → videoUrl 직접 → fetchMedia
  //
  // Note: upscaleVideo API 직접 호출 경로는 시도했다가 제거 — Flow가
  //   reCAPTCHA evaluation을 거부(403 PERMISSION_DENIED)해 실용적이지 않다.
  //   DOM 경로가 Flow UI의 자체 reCAPTCHA + upscale을 태우므로 충분하다.
  //   DOM 반환값의 resolution 필드(720p/1080p/4K/default)로 실제 다운로드
  //   해상도를 확인할 수 있다.
  const downloadAndSaveVideo = async (mediaId, videoUrl, item, options, setStatusMsg) => {
    const { projectName, saveMode } = options
    // cloud(Veo): 완료된 operation 의 videoUri 를 직접 base64 로 다운로드.
    // (구 Flow 의 DOM→URL→fetchMedia 3단계 폴백은 제거 — videoDownload 공통 헬퍼로 통일)
    setStatusMsg?.(`⬇️ Downloading — ${String(videoUrl || mediaId || '').substring(0, 24)}...`)
    const mediaResult = await downloadVideoBase64(downloadVideo, videoUrl)

    if (!mediaResult?.success) {
      return { success: false, error: `Video download failed: ${mediaResult?.error || 'no video URL'}` }
    }

    // 파일 저장 — videoSaveId 우선 (t2v_N / i2v_N), 없으면 기존 item.id (vscene_N / fp_N)
    let videoPath = null
    let saveError = null
    const generatedAt = Date.now()
    // 모델/seed 우선순위 결정 — 자세한 동작은 utils/videoMetadata 참고.
    // 핵심: in-flight resume 시 item 의 메타가 현재 options 보다 우선해야 history/모달 메타가 실제와 일치.
    const { model: modelId, seed: seedValue } = pickVideoMetadata(item, options)
    if (saveMode === 'folder' && projectName) {
      const videoId = item.videoSaveId || item.id || `video_${Date.now()}`
      // 상세 모달이 표시할 seed/timestamp/model 을 history 메타에 같이 기록
      const metadata = {
        prompt: item.prompt || null,
        mediaId,
        model: modelId,
        timestamp: generatedAt,
        seed: seedValue,
      }
      const saveResult = await fileSystemAPI.saveVideo(projectName, videoId, mediaResult.base64, modelId, metadata)
      if (saveResult?.success) {
        videoPath = saveResult.path || null
      } else {
        // 저장 실패 — saveCurrentProject 가 base64 를 strip 하므로 path 없이 두면 다음 로드 시 유실.
        // 호출자에게 명시적 에러 전달 → UI 가 재시도/재다운로드 결정 가능.
        saveError = saveResult?.error || 'Video save failed'
        console.error('[VideoAutomation] saveVideo failed:', saveError)
      }
    }

    // folder 모드 + 저장 실패 → success: false 로 surface (다운로드는 됐지만 영속화 실패).
    if (saveMode === 'folder' && saveError) {
      return {
        success: false,
        error: `Save failed: ${saveError}`,
        // 호출자가 재시도 가능하도록 mediaId 는 노출 (downloadAndSaveVideo 만 다시 시도 가능)
        mediaId,
        videoSaveId: item.videoSaveId || null,
      }
    }

    return {
      success: true,
      base64: mediaResult.base64,
      mediaId,
      videoPath,
      videoSaveId: item.videoSaveId || null,
      seed: seedValue,
      generatedAt,
      model: modelId,
    }
  }

  // 일시정지 대기 헬퍼
  const waitIfPaused = async () => {
    while (pausedRef.current && !stopRequestedRef.current) {
      await sleep(500)
    }
  }

  /**
   * 비디오 자동화 시작 — 3-Phase Async Pipeline
   */
  const start = useCallback(async (options = {}) => {
    const {
      mode = 't2v',
      scenes = [],
      framePairs = [],
      projectName = '',
      saveMode = 'folder',
      videoModel = 'veo_3_1_t2v_fast_ultra_relaxed',
      aspectRatio = 'VIDEO_ASPECT_RATIO_LANDSCAPE',
      duration = 8,
      videoResolution = '1080p',
      videoBatchCount = 1,
      seed = null,
      onItemUpdate
    } = options

    if (isRunning) return

    // 토큰 확인
    const token = await getAccessToken()
    if (!token) {
      toast.error(t('status.loginRequired'))
      return
    }

    stopRequestedRef.current = false
    quotaStoppedRef.current = false
    pausedRef.current = false
    let authStopped = false   // set true on authFailed break — prevents fall-through 'done' status
    setIsRunning(true)
    setIsPaused(false)
    setStatus('running')

    // 처리할 아이템 목록 구성 — status/generationId/mediaId/videoPath 보존
    // (download-only fast path 분류에 필요).
    // seed/model 도 보존 — error 상태에서 retry 가 retryVideoDownload → downloadAndSaveVideo
    // 로 흘러갈 때 item.model/seed 가 비면 'flow-video' 폴백되어 메타 일관성이 깨진다.
    // 호출자가 새 seed/videoModel 을 plumb 하는 일반 경로는 그대로 그 값이 우선.
    // in-flight 항목 분류용: status='generating' + generationId set + 미완료 (no mediaId/videoPath).
    // recovery 가 서버 상태 확인 후 'generating' 으로 표시한 항목 — 재제출(quota 중복) 안 함.
    // 대신 Phase 2 polling 에 직접 합류시켜 서버가 complete 되면 다운로드만 수행.
    const isInFlightItem = (it) =>
      it.status === 'generating' && it.generationId && !it.mediaId && !it.videoPath

    let items = []
    switch (mode) {
      case 't2v':
        items = scenes
          .filter(s => s.prompt)
          .map(s => ({
            id: s.id,
            prompt: s.prompt,
            videoSaveId: `t2v_${s.id.replace('vscene_', '')}`,
            status: s.status,
            generationId: s.generationId,
            mediaId: s.mediaId,
            videoPath: s.videoPath,
            seed: s.seed ?? seed ?? null,
            model: s.model || videoModel || null,
          }))
        break
      case 'i2v':
        items = framePairs
          .filter(p => p.startSceneId && p.status !== 'complete')
          .map(p => ({
            id: p.id,
            prompt: p.prompt,
            startMediaId: p._startMediaId,
            endMediaId: p._endMediaId || null,
            startSceneId: p.startSceneId,
            endSceneId: p.endSceneId,
            startImage: p._startImage || null,
            endImage: p._endImage || null,
            videoSaveId: `i2v_${p.id.replace('fp_', '')}`,
            status: p.status,
            generationId: p.generationId,
            mediaId: p.mediaId,
            videoPath: p.videoPath,
            seed: p.seed ?? seed ?? null,
            model: p.model || videoModel || null,
          }))
        break
    }

    const total = items.length
    if (total === 0) {
      toast.warning(t('videoAutomation.noItems'))
      setIsRunning(false)
      setStatus('ready')
      return
    }

    // ═══════════════════════════════════════════
    // Phase 0: 분류 — download-only / in-flight / fresh
    // ═══════════════════════════════════════════
    // 1. downloadOnly: error + generationId + mediaId + !videoPath
    //    → 서버엔 비디오가 있으나 로컬 저장만 실패. quota 소비 없이 재다운로드만 시도.
    // 2. inFlight: 'generating' + generationId + !mediaId + !videoPath
    //    → 이전 세션에서 제출만 됐고 결과 못 받음 (recovery 가 status 확인 후 'generating' 유지).
    //      재제출 없이 Phase 2 polling 에 합류 → 서버가 complete 되면 다운로드만.
    // 3. freshGen: 그 외 — 새 generation 제출 필요.
    const downloadOnly = items.filter(it =>
      it.status === 'error' && it.generationId && it.mediaId && !it.videoPath
    )
    const downloadOnlyIds = new Set(downloadOnly.map(it => it.id))
    const inFlight = items.filter(it => !downloadOnlyIds.has(it.id) && isInFlightItem(it))
    const inFlightIds = new Set(inFlight.map(it => it.id))
    const freshGen = items.filter(it => !downloadOnlyIds.has(it.id) && !inFlightIds.has(it.id))

    const batchStartedAt = Date.now()
    setProgress({ current: 0, total, percent: 0, errorCount: 0, startedAt: batchStartedAt })
    let videoErrorCount = 0
    let redownloadedCount = 0

    // ═══════════════════════════════════════════
    // Phase 0 실행: download-only (parallel, capped at 5 concurrent)
    // ═══════════════════════════════════════════
    if (downloadOnly.length > 0) {
      setStatusMessage(`⚡ Re-downloading ${downloadOnly.length} server-succeeded videos...`)
      console.log(`[VideoAutomation] Phase 0: download-only for ${downloadOnly.length} items`)

      const CONCURRENCY = 5
      for (let i = 0; i < downloadOnly.length; i += CONCURRENCY) {
        if (stopRequestedRef.current) break
        await waitIfPaused()
        const chunk = downloadOnly.slice(i, i + CONCURRENCY)
        const results = await Promise.all(chunk.map(it => retryVideoDownload({
          item: it,
          flowAPI: { checkVideoStatus, fetchMedia, getAccessToken, downloadVideo },
          onUpdate: (id, newStatus, patch) => onItemUpdate?.(id, newStatus, patch),
          projectName,
          saveMode,
          videoResolution,
        }).catch(err => ({ success: false, error: String(err?.message || err) }))))

        for (const r of results) {
          if (r?.success) redownloadedCount++
          else videoErrorCount++
        }
      }

      console.log(`[VideoAutomation] Phase 0 done: ${redownloadedCount}/${downloadOnly.length} re-downloaded`)
    }

    // freshGen 도 없고 inFlight 도 없으면 종료 (downloadOnly 는 Phase 0 에서 끝남)
    if (freshGen.length === 0 && inFlight.length === 0) {
      setIsRunning(false)
      setIsPaused(false)
      setProgress({ current: total, total, percent: 100, errorCount: videoErrorCount, startedAt: batchStartedAt, endedAt: Date.now() })
      if (stopRequestedRef.current) {
        setStatus('stopped')
        setStatusMessage(t('status.stopped'))
      } else {
        setStatus('done')
        setStatusMessage(`✅ ${t('videoAutomation.done')} — ${redownloadedCount} re-downloaded`)
        // 진행률 100% 도달(사용자 중단 없음) — 평점 카운터 반영
        try { onComplete?.({ completed: true }) } catch (e) { console.warn('[VideoAutomation] onComplete error:', e.message) }
      }
      return
    }

    // items 는 재할당하지 않음 — Phase 2 의 items.find(...) 가 inFlight + freshGen 모두 lookup 가능해야 함.

    // ═══════════════════════════════════════════
    // Phase 1: 순차 제출 (7~15초 간격, 완료 안 기다림)
    //   - freshGen 만 제출 (inFlight 는 이미 generationId 가 있어 제출 X)
    //   - submissions 에는 inFlight 도 함께 pre-seed → Phase 2 에서 같이 polling
    // ═══════════════════════════════════════════
    const submissions = inFlight.map(it => ({ itemId: it.id, generationId: it.generationId }))
    let completedCount = 0

    for (let i = 0; i < freshGen.length; i++) {
      if (stopRequestedRef.current) break
      await waitIfPaused()

      const item = freshGen[i]
      setStatusMessage(`📤 ${t('videoAutomation.submitting') || 'Submitting'} ${i + 1}/${freshGen.length} — "${(item.prompt || '').substring(0, 30)}..."`)
      onItemUpdate?.(item.id, 'generating')

      const genResult = await submitVideoItem(item, mode, {
        videoModel, aspectRatio, duration, videoBatchCount, seed, projectName
      })

      if (genResult.success && genResult.generationId) {
        submissions.push({ itemId: item.id, generationId: genResult.generationId })
        // Persist generationId + 메타(seed/model) 를 즉시 state 에 박는다.
        // app-kill → reload → recovery 시 videoRecovery 가 item.model/seed 를 읽어
        // 동일한 모델/seed 로 저장하도록. 누락하면 recovery 가 'flow-video' 로 폴백.
        onItemUpdate?.(item.id, 'generating', {
          generationId: genResult.generationId,
          ...(seed != null ? { seed } : {}),
          ...(videoModel ? { model: videoModel } : {}),
          // canonical 식별자 — recovery/retry 가 file 위치 매칭에 사용 (videoSaveId 없으면 vscene_/fp_ 폴백되어 파일명 갈라짐)
          ...(item.videoSaveId ? { videoSaveId: item.videoSaveId } : {}),
          // 새 generation 제출 — 이전 complete 의 path/mediaId/video 명시적 제거.
          // 빠뜨리면 (1) recovery 후보 필터(!fp.videoPath)에 안 걸리고, (2) UI 가 옛 비디오 표시,
          // (3) 새 비디오 다운로드 실패 시 옛 path 가 그대로 남아 export 까지 옛 파일 사용.
          videoPath: null,
          mediaId: null,
          video: null,
          base64: null,
          generatedAt: null,
        })
        console.log(`[VideoAutomation] ✅ Submitted ${i + 1}/${total}: ${genResult.generationId.substring(0, 16)}...`)
      } else {
        // Auth errors now handled via withAuthRetry's authFailed sentinel (see below).
        // Inline 401 string-match removed to avoid duplicate onAuthError firing.
        if (genResult?.authFailed) {
          const authErr = genResult.error || 'Auth expired — please re-login to Flow'
          onItemUpdate?.(item.id, 'error', {
            error: authErr,
            errorKind: 'auth',
          })
          videoErrorCount++
          // Mark all remaining un-submitted items with the same auth error
          for (let j = i + 1; j < freshGen.length; j++) {
            onItemUpdate?.(freshGen[j].id, 'error', {
              error: authErr,
              errorKind: 'auth',
            })
            videoErrorCount++
          }
          console.warn(`[VideoAutomation] ❌ Submit authFailed: token dead, stopping batch`)
          authStopped = true
          setStatus('error')
          setStatusMessage(`🔐 ${t('toast.authErrorStop') || 'Auth expired — please re-login to Flow'}`)
          break
        }
        onItemUpdate?.(item.id, 'error', { error: genResult.error })
        videoErrorCount++
        console.warn(`[VideoAutomation] ❌ Submit failed ${i + 1}/${total}:`, genResult.error)
        if (_maybeTriggerQuotaStop(genResult.error)) break
      }

      // 다음 제출 전 랜덤 대기 (마지막 아이템 제외)
      if (i < freshGen.length - 1 && !stopRequestedRef.current) {
        const waitMs = Math.floor(Math.random() * (TIMING.VIDEO_SUBMIT_MAX_DELAY - TIMING.VIDEO_SUBMIT_MIN_DELAY + 1)) + TIMING.VIDEO_SUBMIT_MIN_DELAY
        setStatusMessage(`⏱️ ${t('videoAutomation.waitingNext') || 'Waiting'} ${Math.round(waitMs / 1000)}s...`)
        await sleep(waitMs)
      }
    }

    if (submissions.length === 0) {
      // 모든 제출 실패 + in-flight 도 없음 — auth/quota/일반 실패 구분.
      // auth 면 status 와 메시지가 이미 break 시점에 설정돼 있으므로 덮어쓰지 않는다.
      setIsRunning(false)
      if (authStopped) {
        // Status + message already set at the break site — do not overwrite.
      } else if (quotaStoppedRef.current) {
        // local ref — 모달 dismiss 와 무관하게 이번 batch 의 stop 사유를 정확히 판별.
        // 전역 isQuotaBlocked() 보면 사용자가 모달을 1초 안에 닫는 경우 race 로 'done' 표시되는 회귀.
        setStatus('stopped')
        setStatusMessage(`⛔ ${t('videoAutomation.quotaStopped') || 'Flow generation limit reached — stopped'}`)
      } else {
        setStatus('done')
        setStatusMessage(`❌ ${t('videoAutomation.allFailed') || 'All submissions failed'}`)
      }
      return
    }

    // Auth died mid-submit AND some items had already been submitted before the break.
    // The token is dead — polling those generationIds would just hit 401 every iteration
    // until the poll loop itself broke on authFailed (relying on it is fragile and the test
    // had to mock checkVideoStatus authFailed too to exit cleanly). Abandon the batch now,
    // marking the already-submitted items with the same auth error so the user sees a
    // consistent end state across all items.
    if (authStopped) {
      const authMsg = t('toast.authErrorStop') || 'Auth expired — please re-login to Flow'
      for (const sub of submissions) {
        onItemUpdate?.(sub.itemId, 'error', { error: authMsg, errorKind: 'auth' })
        videoErrorCount++
      }
      setIsRunning(false)
      // status/statusMessage already set at the submit break site — do not overwrite.
      return
    }

    console.log(`[VideoAutomation] Phase 1 done: ${submissions.length} pending poll (${freshGen.length} fresh + ${inFlight.length} in-flight)`)

    // ═══════════════════════════════════════════
    // Phase 2: 일괄 폴링 + Phase 3: 완료 즉시 다운로드
    // ═══════════════════════════════════════════
    const pending = new Map(submissions.map(s => [s.itemId, s]))
    let pollCount = 0
    const maxPolls = TIMING.VIDEO_MAX_POLL_COUNT

    while (pending.size > 0 && pollCount < maxPolls) {
      if (stopRequestedRef.current) break
      await waitIfPaused()

      // 진행률 표시 (redownloadedCount 를 함께 반영)
      const doneCount = submissions.length - pending.size
      const overallDone = doneCount + completedCount + redownloadedCount
      setStatusMessage(`⏳ ${t('videoAutomation.polling') || 'Polling'} ${submissions.length} videos (${overallDone} ${t('videoAutomation.complete') || 'complete'})`)
      setProgress({
        current: overallDone,
        total,
        percent: Math.round((overallDone / total) * 100),
        errorCount: videoErrorCount,
        startedAt: batchStartedAt
      })

      // 배치 상태 체크 — genIds 순서와 statuses 순서가 동일 (인덱스 매칭)
      const pendingEntries = Array.from(pending.entries()) // [[itemId, { generationId }], ...]
      const genIds = pendingEntries.map(([_, s]) => s.generationId)
      const result = await checkVideoStatus(genIds)

      // Top-level fail handling: auth-failed takes precedence over quota detection.
      // The wrapper already fired onAuthError + cleared cache. Mark all pending items
      // as auth-error and break immediately — no point polling on a dead token.
      if (result?.authFailed) {
        const authErr = result.error || 'Auth expired — please re-login to Flow'
        for (const [itemId] of pending) {
          onItemUpdate?.(itemId, 'error', {
            error: authErr,
            errorKind: 'auth',
          })
        }
        pending.clear()
        authStopped = true
        setStatus('error')
        setStatusMessage(`🔐 ${t('toast.authErrorStop') || 'Auth expired — please re-login to Flow'}`)
        break
      }
      // Top-level fail (예: { success: false, error: "RESOURCE_EXHAUSTED..." }) — quota 검사 후 break.
      // statuses[] 내부 'failed' 만 보는 기존 코드는 batch 전체가 server-side 에러로 떨어진
      // 경우를 못 잡아 max polls 까지 무한정 polling 후 timeout 처리.
      if (!result.success && _maybeTriggerQuotaStop(result.error)) break

      if (result.success && result.statuses) {
        // statuses 배열은 genIds 순서와 동일 → 인덱스로 매칭
        for (let si = 0; si < result.statuses.length; si++) {
          const statusInfo = result.statuses[si]
          if (si >= pendingEntries.length) break
          const [itemId, submission] = pendingEntries[si]

          if (statusInfo.status === 'complete' && statusInfo.mediaId) {
            // ─── Phase 3: 다운로드+저장 (DOM 순차) ───
            console.log(`[VideoAutomation] ✅ Complete: ${statusInfo.mediaId.substring(0, 20)} → downloading...`)
            setStatusMessage(`📥 ${t('videoAutomation.downloading') || 'Downloading'} — ${statusInfo.mediaId.substring(0, 16)}...`)

            // item 을 한 번만 lookup — downloadAndSaveVideo 와 실패 patch 가 공유 (메타 우선순위 일관성).
            const item = items.find(i => i.id === itemId)
            const dlResult = await downloadAndSaveVideo(
              statusInfo.mediaId,
              statusInfo.videoUrl,
              item,
              { projectName, saveMode, videoResolution, aspectRatio, seed, videoModel },
              setStatusMessage
            )

            if (dlResult.success && dlResult.base64) {
              onItemUpdate?.(itemId, 'complete', {
                ...dlResult,
                generationId: submission.generationId,
                duration,
                mode,
                // 이전 실패에서 남은 error 메시지 clear (success 이후 stale 표시 방지)
                error: null,
                errorKind: null,
              })
              completedCount++
              console.log(`[VideoAutomation] ✅ Downloaded & saved: ${itemId}`)
            } else {
              const errMsg = !dlResult.success
                ? (dlResult.error || 'Download failed')
                : 'Download succeeded but no video data returned'
              // download/save 실패 시에도 retry 경로(download-only)에 필요한 generationId+mediaId 를 박는다.
              // download 자체가 실패하면 dlResult.mediaId 가 비어있을 수 있으므로 statusInfo.mediaId 폴백.
              // (서버는 이미 생성 완료를 알렸으니 mediaId 는 이 시점에 항상 알려져 있음 — 새 생성 회피)
              const retryMediaId = dlResult.mediaId || statusInfo.mediaId
              // 메타 보존 — buildVideoMetaPatch 가 item 의 원래 model/seed 를 우선 stamp.
              // 이전 구현은 항상 현재 옵션(seed, videoModel)을 stamp 해서, in-flight resume 항목의
              // 원래 메타가 한 번의 실패로 덮였다 (history metadata 어긋남).
              onItemUpdate?.(itemId, 'error', {
                error: errMsg,
                ...(retryMediaId ? { mediaId: retryMediaId } : {}),
                ...(dlResult.videoSaveId ? { videoSaveId: dlResult.videoSaveId } : {}),
                generationId: submission.generationId,
                ...buildVideoMetaPatch(item, { seed, videoModel }),
              })
              console.warn(`[VideoAutomation] ❌ Download failed: ${itemId}`, errMsg)
            }
            pending.delete(itemId)

          } else if (statusInfo.status === 'failed') {
            // 서버 generation 자체 실패 — download-only retry 는 의미 없지만, 사용자가
            // 같은 model/seed 로 수동 재시도할 수 있게 메타 보존.
            // (download 실패 경로와 동일한 우선순위 — item 의 원래 메타 우선.)
            const item = items.find(i => i.id === itemId)
            onItemUpdate?.(itemId, 'error', {
              error: statusInfo.error || 'Video generation failed',
              ...buildVideoMetaPatch(item, { seed, videoModel }),
            })
            pending.delete(itemId)
            console.warn(`[VideoAutomation] ❌ Generation failed: ${submission.generationId.substring(0, 16)}`)
            _maybeTriggerQuotaStop(statusInfo.error)
          }
          // else: 'pending' / 'processing' → 계속 폴링
        }
      }

      pollCount++
      // sleep 전 stop 재확인 — quota 감지(_maybeTriggerQuotaStop) 직후 불필요한
      // 10초 sleep 을 피해 즉시 루프 빠져나가도록.
      if (pending.size > 0 && !stopRequestedRef.current) {
        await sleep(TIMING.VIDEO_POLL_INTERVAL)
      }
    }

    // 타임아웃된 항목 처리
    if (pending.size > 0 && !stopRequestedRef.current) {
      for (const [itemId] of pending) {
        onItemUpdate?.(itemId, 'error', { error: 'Polling timeout — video generation took too long' })
      }
    }

    // 사용자 stop — 남은 in-flight 항목 마무리.
    // 빠뜨리면 videoT2VStatus 가 'generating' 으로 영원히 남고 generatingEndedAt 이 null 이라
    // ResultsTable 의 useElapsedTimer 가 무한 증가 (사용자가 보기엔 "여전히 작업 중" 처럼).
    // Flow API 는 cancel 이 없어 서버 생성 자체는 막을 수 없으므로, generationId 는 보존해
    // (a) 앱 재시작 시 videoRecovery 가 결과 회수, (b) Flow 완료 후 Retry 다운로드 가능.
    if (pending.size > 0 && stopRequestedRef.current) {
      const stoppedMsg = t('videoAutomation.stoppedByUser') || 'Stopped by user — Flow may still be generating; use Retry later or restart for auto-recovery'
      for (const [itemId, submission] of pending) {
        const item = items.find(i => i.id === itemId)
        onItemUpdate?.(itemId, 'error', {
          error: stoppedMsg,
          errorKind: 'stopped',
          generationId: submission.generationId,
          ...buildVideoMetaPatch(item, { seed, videoModel }),
        })
      }
    }

    // ═══════════════════════════════════════════
    // 완료
    // ═══════════════════════════════════════════
    setIsRunning(false)
    setIsPaused(false)
    setProgress({ current: total, total, percent: 100, errorCount: videoErrorCount, startedAt: batchStartedAt, endedAt: Date.now() })

    if (authStopped) {
      // Status + message already set at the break site — do not overwrite.
    } else if (stopRequestedRef.current) {
      setStatus('stopped')
      // poll 단계에서 quota 로 멈춘 경우에도 첫 submit path 와 동일한 quotaStopped 메시지.
      // quotaStoppedRef 는 batch 동안만 유지되어 사용자 수동 stop 과 안전하게 구분된다.
      if (quotaStoppedRef.current) {
        setStatusMessage(`⛔ ${t('videoAutomation.quotaStopped') || 'Flow generation limit reached — stopped'}`)
      } else {
        setStatusMessage(t('status.stopped'))
      }
    } else {
      setStatus('done')
      const parts = []
      if (completedCount > 0) parts.push(`${completedCount} regenerated`)
      if (redownloadedCount > 0) parts.push(`${redownloadedCount} re-downloaded`)
      const tail = parts.length > 0 ? ` — ${parts.join(', ')}` : ''
      setStatusMessage(`✅ ${t('videoAutomation.done')}${tail}`)
      // 진행률 100% 도달(사용자/auth 중단 없음) — 평점 카운터 반영
      try { onComplete?.({ completed: true }) } catch (e) { console.warn('[VideoAutomation] onComplete error:', e.message) }
    }
  }, [isRunning, generateVideoT2V, generateVideoI2V, checkVideoStatus, upscaleVideo, fetchMedia, getAccessToken, t, onComplete])

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
    setStatusMessage(t('status.stopping'))
  }, [t])

  // 큐를 통한 시작
  const startQueued = useCallback(async (options = {}) => {
    if (!generationQueue) {
      return start(options)
    }
    try {
      await generationQueue.enqueue({
        type: 'video_batch',
        label: 'Video Automation',
        execute: () => start(options)
      })
    } catch (err) {
      console.warn('[VideoGen] Queue rejected:', err.message)
    }
  }, [generationQueue, start])

  return {
    isRunning,
    isPaused,
    progress,
    status,
    statusMessage,
    start: startQueued,
    togglePause,
    stop
  }
}

export default useVideoAutomation
