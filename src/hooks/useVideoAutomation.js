/**
 * useVideoAutomation — 비디오 생성 자동화 Hook (Async Pipeline)
 *
 * T2V (Text to Video), I2V (Image to Video) 모드 지원.
 *
 * Async Pipeline (슬라이딩 윈도우):
 *   Phase 0: 분류 — download-only / in-flight / fresh
 *   Submit↔Poll: 동시 in-flight Veo job 을 concurrency 개로 제한. 슬롯이 빌 때마다
 *     다음 항목 제출(fillWindow), 배치 폴링으로 완료분은 즉시 다운로드+저장하고 슬롯 반납.
 *   concurrency ≥ 전체 항목수면 한 번에 전부 제출되는 기존 동작과 동일.
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
import { normalizeVideoModel, snapVeoDuration } from '../utils/videoModels'
import { DEFAULT_VIDEO_MODEL_ID, coerceResolution } from '../config/genModels'
import { clampInt } from '../utils/clampInt'

// 실제 제출되는 비디오 길이(초). submitVideo(engine)의 제약과 동일하게 계산해 제출값과
// 완료-메타가 일치하도록 한다(어긋나면 history 길이가 실제와 불일치):
//   - i2v/f2v(reference 이미지) → 8 고정
//   - t2v + referenceImages → 8 고정 (Veo 3.1 reference image 제약)
//   - 1080p/4k → 8 고정 (공식 Veo 제약)
//   - 그 외(t2v + 720p) → 씬 길이(targetDuration)를 {4,6,8} 로 스냅
function effectiveVideoDuration(item, mode, batchDuration, resolution) {
  if (mode === 'i2v') return 8
  if (mode === 't2v' && Array.isArray(item?.referenceImages) && item.referenceImages.length > 0) return 8
  if (resolution === '1080p' || resolution === '4k') return 8
  return snapVeoDuration(item?.targetDuration ?? batchDuration)
}

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
export function useVideoAutomation(genAPI, t = (key) => key, generationQueue = null, onComplete = null) {
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

  const { generateVideoT2V, generateVideoI2V, checkVideoStatus, upscaleVideo, fetchMedia, getAccessToken, downloadVideo } = genAPI

  // ─── Phase 1 Helper: 비디오 제출 ───
  const submitVideoItem = async (item, mode, options) => {
    const { videoModel, aspectRatio, duration, seed = null, videoResolution, projectName = '' } = options
    const prompt = item.prompt || ''

    switch (mode) {
      case 't2v': {
        // 자동 길이: 씬 길이(item.targetDuration, SRT 기반)를 Veo 허용값 {4,6,8} 으로 스냅.
        // 1080p/4k 면 submitVideo 가 8초로 강제(공식 제약).
        const dur = effectiveVideoDuration(item, mode, duration, videoResolution)
        return await generateVideoT2V(prompt, videoModel, aspectRatio, dur, seed, videoResolution, item.referenceImages || [])
      }
      case 'i2v': {
        // 시작 프레임 base64 (필수). 끝 프레임은 있으면 lastFrame 보간.
        // 메모리(_startImage) 우선, 없으면 디스크(gallery→frames/, 씬→scenes/) 폴백 — 재오픈 후에도 동작.
        const startB64 = await resolveFrameImageBase64(item.startSceneId, item.startImage, projectName)
        if (!startB64) {
          return { success: false, error: 'No start image — generate the start scene first' }
        }
        const endB64 = await resolveFrameImageBase64(item.endSceneId, item.endImage, projectName)
        // I2V/F2V 는 reference 이미지 제약으로 8초 강제(submitVideo 에서 enforce) — duration 그대로 전달.
        return await generateVideoI2V(prompt, startB64, endB64, videoModel, aspectRatio, duration, seed, videoResolution)
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
      videoModel = 'veo-3.1-fast-generate-preview',
      aspectRatio = 'VIDEO_ASPECT_RATIO_LANDSCAPE',
      duration = 8,
      videoBatchCount = 1,
      seed = null,
      concurrency: rawConcurrency,
      onItemUpdate
    } = options
    // 손상된 저장값('x'/NaN/0/음수)은 무한대기/no-op 유발 → clampInt 로 기본 4 폴백 (useAutomation 과 동일).
    const concurrency = clampInt(rawConcurrency, 1, 10, 4)
    const effectiveVideoModel = normalizeVideoModel(videoModel) || DEFAULT_VIDEO_MODEL_ID
    const canonicalVideoModel = (modelId) => normalizeVideoModel(modelId) || effectiveVideoModel
    // 모델이 지원하지 않거나(예: Veo Lite + 4K) stale 한 해상도는 여기서 한 번만 강등/정규화.
    // 이후 effectiveVideoDuration 계산·history 메타데이터·생성 호출이 전부 같은 값을 써서
    // 부분 coerce 로 인한 어긋남(기록은 4k, 실제는 1080p)을 방지한다. (리뷰 P2)
    const videoResolution = coerceResolution(effectiveVideoModel, options.videoResolution ?? '720p')

    if (isRunning) return

    // 토큰 확인 — 키 없으면 API 키 모달 안내(handleStart 와 동일 UX, 토스트 대신).
    const token = await getAccessToken()
    if (!token) {
      window.dispatchEvent(new CustomEvent('flow-login-expired'))
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
            model: s.model ? canonicalVideoModel(s.model) : effectiveVideoModel,
            // 자동 길이용 — 씬 길이(SRT 기반). 제출 시 {4,6,8} 로 스냅됨.
            targetDuration: s.targetDuration ?? null,
            referenceImages: Array.isArray(s.referenceImages) ? s.referenceImages : [],
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
            model: p.model ? canonicalVideoModel(p.model) : effectiveVideoModel,
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
          genAPI: { checkVideoStatus, fetchMedia, getAccessToken, downloadVideo },
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
    // Phase 1+2: 슬라이딩 윈도우 (제출 ↔ 폴링 인터리브)
    //   - 동시 in-flight Veo job 을 concurrency 개로 제한.
    //   - inFlight(이미 generationId 보유) 는 윈도우에 pre-seed → 슬롯 차지.
    //   - 슬롯이 빌 때마다 freshGen 다음 항목 제출, 완료/실패 시 슬롯 반납.
    //   - concurrency ≥ (freshGen + inFlight) 면 예전처럼 한 번에 전부 제출되는 것과 동일.
    // ═══════════════════════════════════════════
    // pending: itemId → { generationId, polls }. polls 는 per-item 폴링 예산(스턱 슬롯 방지).
    const pending = new Map(inFlight.map(it => [it.id, { generationId: it.generationId, polls: 0 }]))
    let completedCount = 0
    let nextFreshIdx = 0            // 다음 제출할 freshGen 인덱스
    const maxPollsPerItem = TIMING.VIDEO_MAX_POLL_COUNT

    // 슬롯이 빌 때까지 freshGen 제출. auth → authStopped, quota → stopRequested 설정 후 반환.
    const fillWindow = async () => {
      while (pending.size < concurrency && nextFreshIdx < freshGen.length) {
        if (stopRequestedRef.current || authStopped) return
        await waitIfPaused()
        if (stopRequestedRef.current) return

        const i = nextFreshIdx
        const item = freshGen[i]
        setStatusMessage(`📤 ${t('videoAutomation.submitting') || 'Submitting'} ${i + 1}/${freshGen.length} — "${(item.prompt || '').substring(0, 30)}..."`)
        onItemUpdate?.(item.id, 'generating')

        const genResult = await submitVideoItem(item, mode, {
          videoModel: effectiveVideoModel, aspectRatio, duration, videoBatchCount, seed, projectName, videoResolution
        })

        if (genResult.success && genResult.generationId) {
          pending.set(item.id, { generationId: genResult.generationId, polls: 0 })
          nextFreshIdx++
          // Persist generationId + 메타(seed/model) 를 즉시 state 에 박는다.
          // app-kill → reload → recovery 시 videoRecovery 가 item.model/seed 를 읽어
          // 동일한 모델/seed 로 저장하도록. 누락하면 recovery 가 'flow-video' 로 폴백.
          onItemUpdate?.(item.id, 'generating', {
            generationId: genResult.generationId,
            ...(seed != null ? { seed } : {}),
            model: effectiveVideoModel,
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
        } else if (genResult?.authFailed) {
          // Auth errors handled via withAuthRetry's authFailed sentinel.
          // 토큰 사망 — 이 항목 + 남은 freshGen 전부 auth error. 이미 제출된 pending 은 post-loop 에서 마감.
          const authErr = genResult.error || 'API key was rejected. Check your API key in Settings and try again.'
          for (let j = i; j < freshGen.length; j++) {
            onItemUpdate?.(freshGen[j].id, 'error', { error: authErr, errorKind: 'auth' })
            videoErrorCount++
          }
          nextFreshIdx = freshGen.length
          authStopped = true
          setStatus('error')
          setStatusMessage(`🔐 ${t('toast.authErrorStop') || 'API key was rejected. Check your API key in Settings and try again.'}`)
          console.warn(`[VideoAutomation] ❌ Submit authFailed: token dead, stopping batch`)
          return
        } else {
          // 일반 실패 — 이 항목만 error 처리하고 다음 진행. quota 면 batch stop.
          onItemUpdate?.(item.id, 'error', { error: genResult.error })
          videoErrorCount++
          nextFreshIdx++
          console.warn(`[VideoAutomation] ❌ Submit failed ${i + 1}/${total}:`, genResult.error)
          if (_maybeTriggerQuotaStop(genResult.error)) return
        }
      }
    }

    // 초기 윈도우 채우기
    await fillWindow()

    // in-flight 도 없고 제출도 0건 — auth/quota/일반 실패 구분 후 조기 종료.
    if (pending.size === 0) {
      setIsRunning(false)
      if (authStopped) {
        // Status + message already set at the submit break site — do not overwrite.
      } else if (quotaStoppedRef.current) {
        // local ref — 모달 dismiss 와 무관하게 이번 batch 의 stop 사유를 정확히 판별.
        // 전역 isQuotaBlocked() 보면 사용자가 모달을 1초 안에 닫는 경우 race 로 'done' 표시되는 회귀.
        setStatus('stopped')
        setStatusMessage(`⛔ ${t('videoAutomation.quotaStopped') || 'API generation limit reached — stopped'}`)
      } else if (stopRequestedRef.current) {
        setStatus('stopped')
        setStatusMessage(t('status.stopped'))
      } else {
        setStatus('done')
        setStatusMessage(`❌ ${t('videoAutomation.allFailed') || 'All submissions failed'}`)
      }
      return
    }

    console.log(`[VideoAutomation] Phase 1 window open: ${pending.size} in-flight (${freshGen.length} fresh + ${inFlight.length} pre-seeded)`)

    // ═══════════════════════════════════════════
    // 폴링 루프 — 완료/실패 시 슬롯 반납 → fillWindow 로 다음 freshGen 제출 (슬라이딩)
    // ═══════════════════════════════════════════
    while (pending.size > 0 && !stopRequestedRef.current && !authStopped) {
      await waitIfPaused()
      if (stopRequestedRef.current) break

      // 진행률 표시 — 완료 다운로드 + Phase 0 재다운로드 + 실패 = 종결 항목
      const overallDone = Math.min(total, completedCount + redownloadedCount + videoErrorCount)
      setStatusMessage(`⏳ ${t('videoAutomation.polling') || 'Polling'} ${pending.size} videos (${completedCount + redownloadedCount} ${t('videoAutomation.complete') || 'complete'})`)
      setProgress({
        current: overallDone,
        total,
        percent: Math.round((overallDone / total) * 100),
        errorCount: videoErrorCount,
        startedAt: batchStartedAt
      })

      // 배치 상태 체크 — genIds 순서와 statuses 순서가 동일 (인덱스 매칭)
      const pendingEntries = Array.from(pending.entries()) // [[itemId, { generationId, polls }], ...]
      const genIds = pendingEntries.map(([_, s]) => s.generationId)
      const result = await checkVideoStatus(genIds)

      // Top-level fail handling: auth-failed takes precedence over quota detection.
      // The wrapper already fired onAuthError + cleared cache. Mark all pending items
      // as auth-error and break immediately — no point polling on a dead token.
      if (result?.authFailed) {
        const authErr = result.error || 'API key was rejected. Check your API key in Settings and try again.'
        for (const [itemId] of pending) {
          onItemUpdate?.(itemId, 'error', { error: authErr, errorKind: 'auth' })
          videoErrorCount++  // fillWindow auth 경로·아래 freshGen 루프와 동일하게 집계 (progress.errorCount 일관성)
        }
        // 아직 제출 안 한 freshGen 도 동일 auth error
        for (let j = nextFreshIdx; j < freshGen.length; j++) {
          onItemUpdate?.(freshGen[j].id, 'error', { error: authErr, errorKind: 'auth' })
          videoErrorCount++
        }
        nextFreshIdx = freshGen.length
        pending.clear()
        authStopped = true
        setStatus('error')
        setStatusMessage(`🔐 ${t('toast.authErrorStop') || 'API key was rejected. Check your API key in Settings and try again.'}`)
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
            // ─── 다운로드+저장 (DOM 순차) ───
            console.log(`[VideoAutomation] ✅ Complete: ${statusInfo.mediaId.substring(0, 20)} → downloading...`)
            setStatusMessage(`📥 ${t('videoAutomation.downloading') || 'Downloading'} — ${statusInfo.mediaId.substring(0, 16)}...`)

            // item 을 한 번만 lookup — downloadAndSaveVideo 와 실패 patch 가 공유 (메타 우선순위 일관성).
            const item = items.find(i => i.id === itemId)
            const dlResult = await downloadAndSaveVideo(
              statusInfo.mediaId,
              statusInfo.videoUrl,
              item,
              { projectName, saveMode, videoResolution, aspectRatio, seed, videoModel: effectiveVideoModel },
              setStatusMessage
            )

            if (dlResult.success && dlResult.base64) {
              onItemUpdate?.(itemId, 'complete', {
                ...dlResult,
                generationId: submission.generationId,
                duration: effectiveVideoDuration(item, mode, duration, videoResolution),
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
                ...buildVideoMetaPatch(item, { seed, videoModel: effectiveVideoModel }),
              })
              videoErrorCount++  // 다운로드 실패도 errorCount 에 집계
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
              ...buildVideoMetaPatch(item, { seed, videoModel: effectiveVideoModel }),
            })
            videoErrorCount++  // 서버 generation 실패도 집계
            pending.delete(itemId)
            console.warn(`[VideoAutomation] ❌ Generation failed: ${submission.generationId.substring(0, 16)}`)
            _maybeTriggerQuotaStop(statusInfo.error)

          } else {
            // 'pending' / 'processing' — per-item 폴링 예산 소진. 초과 시 슬롯 영구 점유 방지 위해 timeout.
            submission.polls++
            if (submission.polls >= maxPollsPerItem) {
              onItemUpdate?.(itemId, 'error', { error: 'Polling timeout — video generation took too long' })
              videoErrorCount++
              pending.delete(itemId)
              console.warn(`[VideoAutomation] ⏱️ Poll timeout: ${itemId}`)
            }
          }
        }
      } else {
        // Top-level 폴링 실패(non-quota·non-auth, 예: 일시 500) 또는 statuses 없는 malformed 응답 —
        // 이번 라운드는 전원 폴링 실패로 간주해 각 항목 예산 차감, 초과 시 timeout.
        // (옛 global pollCount 제거 후, quota/auth 가 아닌 영구 실패가 무한 폴링되는 것 방지.)
        console.warn(`[VideoAutomation] ⚠️ Poll failed (non-quota): ${result.error || 'malformed response'}`)
        for (const [itemId, submission] of Array.from(pending.entries())) {
          submission.polls++
          if (submission.polls >= maxPollsPerItem) {
            onItemUpdate?.(itemId, 'error', { error: `Polling failed — ${result.error || 'server error'}` })
            videoErrorCount++
            pending.delete(itemId)
          }
        }
      }

      // 완료/실패로 빈 슬롯을 다음 freshGen 으로 채움 (슬라이딩).
      if (!stopRequestedRef.current && !authStopped) {
        await fillWindow()
      }

      // sleep 전 stop 재확인 — quota 감지(_maybeTriggerQuotaStop) 직후 불필요한
      // 폴링 간격 sleep 을 피해 즉시 루프 빠져나가도록.
      if (pending.size > 0 && !stopRequestedRef.current && !authStopped) {
        await sleep(TIMING.VIDEO_POLL_INTERVAL)
      }
    }

    // ───────────────────────────────────────────
    // 남은 pending 마무리 (정상 완료 경로면 비어있음)
    // ───────────────────────────────────────────
    if (pending.size > 0) {
      if (authStopped) {
        // auth 가 fillWindow 제출 중 터진 경우 — 이미 제출된 in-flight 도 auth error 로 마감.
        // (auth 가 폴링 중 터지면 위에서 pending.clear() 했으므로 여기 안 옴.)
        const authMsg = t('toast.authErrorStop') || 'API key was rejected. Check your API key in Settings and try again.'
        for (const [itemId] of pending) {
          onItemUpdate?.(itemId, 'error', { error: authMsg, errorKind: 'auth' })
          videoErrorCount++
        }
      } else if (stopRequestedRef.current) {
        // 사용자/quota stop — 남은 in-flight 항목 마무리. generationId 보존해
        // (a) 앱 재시작 시 videoRecovery 가 결과 회수, (b) Flow 완료 후 Retry 다운로드.
        // 빠뜨리면 videoT2VStatus 가 'generating' 으로 영원히 남고 generatingEndedAt 이 null 이라
        // ResultsTable 의 useElapsedTimer 가 무한 증가 (사용자가 보기엔 "여전히 작업 중" 처럼).
        const stoppedMsg = t('videoAutomation.stoppedByUser') || 'Stopped by user — submitted Veo operations may still be running. Use Retry later or restart for auto-recovery.'
        for (const [itemId, submission] of pending) {
          const item = items.find(i => i.id === itemId)
          onItemUpdate?.(itemId, 'error', {
            error: stoppedMsg,
            errorKind: 'stopped',
            generationId: submission.generationId,
            ...buildVideoMetaPatch(item, { seed, videoModel: effectiveVideoModel }),
          })
        }
      } else {
        // 정상 루프 종료인데 pending 잔여 (이론상 per-item timeout 으로 안 와야 함) — 안전 timeout.
        for (const [itemId] of pending) {
          onItemUpdate?.(itemId, 'error', { error: 'Polling timeout — video generation took too long' })
          videoErrorCount++
        }
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
        setStatusMessage(`⛔ ${t('videoAutomation.quotaStopped') || 'API generation limit reached — stopped'}`)
      } else {
        setStatusMessage(t('status.stopped'))
      }
    } else {
      setStatus('done')
      const parts = []
      if (completedCount > 0) parts.push(`${completedCount} regenerated`)
      if (redownloadedCount > 0) parts.push(`${redownloadedCount} re-downloaded`)
      if (videoErrorCount > 0) parts.push(`${videoErrorCount} failed`)  // Phase 2 실패도 완료 요약에 노출
      const tail = parts.length > 0 ? ` — ${parts.join(', ')}` : ''
      // 실패가 있으면 성공처럼 보이지 않도록 아이콘 구분.
      const icon = videoErrorCount > 0 ? '⚠️' : '✅'
      setStatusMessage(`${icon} ${t('videoAutomation.done')}${tail}`)
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
