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

// 유틸: 랜덤 대기
const randomSleep = (min, max) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min))

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export function useVideoAutomation(flowAPI, t = (key) => key, onAuthError = null, generationQueue = null) {
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0, errorCount: 0, startedAt: null })
  const [status, setStatus] = useState('ready')
  const [statusMessage, setStatusMessage] = useState('')

  const stopRequestedRef = useRef(false)
  const pausedRef = useRef(false)

  const { generateVideoT2V, generateVideoI2V, checkVideoStatus, upscaleVideo, fetchMedia, getAccessToken } = flowAPI

  // ─── Phase 1 Helper: 비디오 제출 (DOM 조작) ───
  const submitVideoItem = async (item, mode, options) => {
    const { videoModel, aspectRatio, duration, videoBatchCount = 1 } = options
    const prompt = item.prompt || ''

    switch (mode) {
      case 't2v':
        return await generateVideoT2V(prompt, videoModel, aspectRatio, duration, videoBatchCount)
      case 'i2v': {
        if (!item.startMediaId) {
          return { success: false, error: 'No start image mediaId' }
        }
        return await generateVideoI2V(prompt, item.startMediaId, item.endMediaId || null, videoModel, aspectRatio, duration)
      }
      default:
        return { success: false, error: `Unknown mode: ${mode}` }
    }
  }

  // ─── Phase 3 Helper: 다운로드 + 저장 ───
  // DOM 다운로드 우선 (Flow UI가 upscale/reCAPTCHA 자체 처리)
  // 다운로드 우선순위: DOM (upscale 포함) → videoUrl 직접 → fetchMedia
  const downloadAndSaveVideo = async (mediaId, videoUrl, item, options, setStatusMsg) => {
    const { projectName, saveMode, videoResolution = '1080p' } = options
    let mediaResult

    // ─── 다운로드 ───
    // 방법 1: DOM 다운로드 (Flow UI의 hover→3dot→download→해상도 선택)
    // Flow 페이지가 reCAPTCHA 및 upscale을 자체 처리하므로 가장 안정적
    if (window.electronAPI?.domDownloadVideo) {
      try {
        console.log('[VideoAutomation] [1/3] DOM download — mediaId:', mediaId?.substring(0, 20), 'resolution:', videoResolution)
        setStatusMsg?.(`⬇️ Downloading ${videoResolution} — ${mediaId?.substring(0, 16)}...`)
        mediaResult = await window.electronAPI.domDownloadVideo({
          mediaId, resolution: videoResolution
        })
        if (mediaResult?.success) {
          console.log('[VideoAutomation] ✅ DOM download success')
        } else {
          console.warn('[VideoAutomation] DOM download failed:', mediaResult?.error)
        }
      } catch (e) {
        console.warn('[VideoAutomation] DOM download exception:', e.message)
      }
    }

    // 방법 2: videoUrl 직접 다운로드 (DOM에서 비디오 안 보일 때 — 원본 해상도)
    if (!mediaResult?.success && videoUrl) {
      try {
        console.log('[VideoAutomation] [2/3] Direct URL download:', videoUrl?.substring(0, 80))
        const token = await getAccessToken()
        mediaResult = await window.electronAPI.downloadVideoUrl({ url: videoUrl, token })
        if (mediaResult?.success) {
          console.log('[VideoAutomation] ✅ Direct URL download success')
        } else {
          console.warn('[VideoAutomation] Direct URL download failed:', mediaResult?.error)
        }
      } catch (e) {
        console.warn('[VideoAutomation] Direct URL download exception:', e.message)
        mediaResult = null
      }
    }

    // 방법 3: fetchMedia (getMediaUrlRedirect — 원본 해상도)
    if (!mediaResult?.success) {
      try {
        console.log('[VideoAutomation] [3/3] fetchMedia for mediaId:', mediaId?.substring(0, 20))
        mediaResult = await fetchMedia(mediaId)
        if (mediaResult?.success) {
          console.log('[VideoAutomation] ✅ fetchMedia success')
        }
      } catch (e) {
        console.warn('[VideoAutomation] fetchMedia exception:', e.message)
      }
    }

    if (!mediaResult?.success) {
      return { success: false, error: `Media download failed: ${mediaResult?.error || 'All methods failed'}` }
    }

    // 파일 저장 — videoSaveId 우선 (t2v_N / i2v_N), 없으면 기존 item.id (vscene_N / fp_N)
    let videoPath = null
    if (saveMode === 'folder' && projectName) {
      const videoId = item.videoSaveId || item.id || `video_${Date.now()}`
      const saveResult = await fileSystemAPI.saveVideo(projectName, videoId, mediaResult.base64, 'flow')
      videoPath = saveResult?.path || null
    }

    return {
      success: true,
      base64: mediaResult.base64,
      mediaId,
      videoPath,
      videoSaveId: item.videoSaveId || null,
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
    pausedRef.current = false
    setIsRunning(true)
    setIsPaused(false)
    setStatus('running')

    // 처리할 아이템 목록 구성
    let items = []
    switch (mode) {
      case 't2v':
        items = scenes
          .filter(s => s.prompt)
          .map(s => ({
            id: s.id,
            prompt: s.prompt,
            videoSaveId: `t2v_${s.id.replace('vscene_', '')}`,
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
            videoSaveId: `i2v_${p.id.replace('fp_', '')}`,
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

    const batchStartedAt = Date.now()
    setProgress({ current: 0, total, percent: 0, errorCount: 0, startedAt: batchStartedAt })
    let videoErrorCount = 0

    // ═══════════════════════════════════════════
    // Phase 1: 순차 제출 (7~15초 간격, 완료 안 기다림)
    // ═══════════════════════════════════════════
    const submissions = [] // { itemId, generationId }
    let completedCount = 0

    for (let i = 0; i < items.length; i++) {
      if (stopRequestedRef.current) break
      await waitIfPaused()

      const item = items[i]
      setStatusMessage(`📤 ${t('videoAutomation.submitting') || 'Submitting'} ${i + 1}/${total} — "${(item.prompt || '').substring(0, 30)}..."`)
      onItemUpdate?.(item.id, 'generating')

      const genResult = await submitVideoItem(item, mode, {
        videoModel, aspectRatio, duration, videoBatchCount
      })

      if (genResult.success && genResult.generationId) {
        submissions.push({ itemId: item.id, generationId: genResult.generationId })
        console.log(`[VideoAutomation] ✅ Submitted ${i + 1}/${total}: ${genResult.generationId.substring(0, 16)}...`)
      } else {
        // 401 인증 에러 감지
        if (genResult.error && (genResult.error.includes('401') || genResult.error.includes('auth'))) {
          onAuthError?.()
        }
        onItemUpdate?.(item.id, 'error', { error: genResult.error })
        videoErrorCount++
        console.warn(`[VideoAutomation] ❌ Submit failed ${i + 1}/${total}:`, genResult.error)
      }

      // 다음 제출 전 랜덤 대기 (마지막 아이템 제외)
      if (i < items.length - 1 && !stopRequestedRef.current) {
        const waitMs = Math.floor(Math.random() * (TIMING.VIDEO_SUBMIT_MAX_DELAY - TIMING.VIDEO_SUBMIT_MIN_DELAY + 1)) + TIMING.VIDEO_SUBMIT_MIN_DELAY
        setStatusMessage(`⏱️ ${t('videoAutomation.waitingNext') || 'Waiting'} ${Math.round(waitMs / 1000)}s...`)
        await sleep(waitMs)
      }
    }

    if (submissions.length === 0) {
      // 모든 제출 실패
      setIsRunning(false)
      setStatus('done')
      setStatusMessage(`❌ ${t('videoAutomation.allFailed') || 'All submissions failed'}`)
      return
    }

    console.log(`[VideoAutomation] Phase 1 done: ${submissions.length}/${total} submitted`)

    // ═══════════════════════════════════════════
    // Phase 2: 일괄 폴링 + Phase 3: 완료 즉시 다운로드
    // ═══════════════════════════════════════════
    const pending = new Map(submissions.map(s => [s.itemId, s]))
    let pollCount = 0
    const maxPolls = TIMING.VIDEO_MAX_POLL_COUNT

    while (pending.size > 0 && pollCount < maxPolls) {
      if (stopRequestedRef.current) break
      await waitIfPaused()

      // 진행률 표시
      const doneCount = submissions.length - pending.size
      setStatusMessage(`⏳ ${t('videoAutomation.polling') || 'Polling'} ${submissions.length} videos (${doneCount + completedCount} ${t('videoAutomation.complete') || 'complete'})`)
      setProgress({
        current: doneCount + completedCount,
        total,
        percent: Math.round(((doneCount + completedCount) / total) * 100),
        errorCount: videoErrorCount,
        startedAt: batchStartedAt
      })

      // 배치 상태 체크 — genIds 순서와 statuses 순서가 동일 (인덱스 매칭)
      const pendingEntries = Array.from(pending.entries()) // [[itemId, { generationId }], ...]
      const genIds = pendingEntries.map(([_, s]) => s.generationId)
      const result = await checkVideoStatus(genIds)

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

            const dlResult = await downloadAndSaveVideo(
              statusInfo.mediaId,
              statusInfo.videoUrl,
              items.find(i => i.id === itemId),
              { projectName, saveMode, videoResolution, aspectRatio },
              setStatusMessage
            )

            if (dlResult.success && dlResult.base64) {
              onItemUpdate?.(itemId, 'complete', {
                ...dlResult,
                generationId: submission.generationId
              })
              completedCount++
              console.log(`[VideoAutomation] ✅ Downloaded & saved: ${itemId}`)
            } else {
              const errMsg = !dlResult.success
                ? (dlResult.error || 'Download failed')
                : 'Download succeeded but no video data returned'
              onItemUpdate?.(itemId, 'error', { error: errMsg })
              console.warn(`[VideoAutomation] ❌ Download failed: ${itemId}`, errMsg)
            }
            pending.delete(itemId)

          } else if (statusInfo.status === 'failed') {
            onItemUpdate?.(itemId, 'error', { error: statusInfo.error || 'Video generation failed' })
            pending.delete(itemId)
            console.warn(`[VideoAutomation] ❌ Generation failed: ${submission.generationId.substring(0, 16)}`)
          }
          // else: 'pending' / 'processing' → 계속 폴링
        }
      }

      pollCount++
      if (pending.size > 0) {
        await sleep(TIMING.VIDEO_POLL_INTERVAL)
      }
    }

    // 타임아웃된 항목 처리
    if (pending.size > 0 && !stopRequestedRef.current) {
      for (const [itemId] of pending) {
        onItemUpdate?.(itemId, 'error', { error: 'Polling timeout — video generation took too long' })
      }
    }

    // ═══════════════════════════════════════════
    // 완료
    // ═══════════════════════════════════════════
    setIsRunning(false)
    setIsPaused(false)
    setProgress({ current: total, total, percent: 100, errorCount: videoErrorCount, startedAt: batchStartedAt, endedAt: Date.now() })

    if (stopRequestedRef.current) {
      setStatus('stopped')
      setStatusMessage(t('status.stopped'))
    } else {
      setStatus('done')
      setStatusMessage(`✅ ${t('videoAutomation.done')}`)
    }
  }, [isRunning, generateVideoT2V, generateVideoI2V, checkVideoStatus, upscaleVideo, fetchMedia, getAccessToken, t])

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
