/**
 * useVideoAutomation — 비디오 생성 자동화 Hook
 *
 * T2V (Text to Video), I2V (Image to Video), R2V (Refs to Video) 모드 지원.
 * 비동기 비디오 생성 워크플로:
 *   1. 요청 → generationId 반환
 *   2. 10초 간격 폴링 (VIDEO_POLL_INTERVAL)
 *   3. 완료 시 mediaId → fetchMedia → base64/mp4 다운로드
 *   4. 파일 저장 (fileSystemAPI.saveVideo)
 */

import { useState, useCallback, useRef } from 'react'
import { TIMING } from '../config/defaults'
import { fileSystemAPI } from './useFileSystem'
import { toast } from '../components/Toast'

export function useVideoAutomation(flowAPI, t = (key) => key) {
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 })
  const [status, setStatus] = useState('ready')
  const [statusMessage, setStatusMessage] = useState('')

  const stopRequestedRef = useRef(false)
  const pausedRef = useRef(false)

  const { generateVideoT2V, generateVideoI2V, checkVideoStatus, fetchMedia, getAccessToken } = flowAPI

  /**
   * 비디오 상태 폴링 (완료될 때까지 대기)
   * @param {string} generationId
   * @returns {{ success, mediaId?, error? }}
   */
  const pollUntilDone = async (generationId) => {
    const maxPolls = 60  // 최대 10분 (10초 × 60)

    for (let i = 0; i < maxPolls; i++) {
      if (stopRequestedRef.current) {
        return { success: false, error: 'Stopped by user' }
      }

      // 일시정지 대기
      while (pausedRef.current && !stopRequestedRef.current) {
        await new Promise(r => setTimeout(r, 500))
      }

      const result = await checkVideoStatus([generationId])

      if (!result.success) {
        console.warn('[VideoAutomation] Poll error:', result.error)
        // 네트워크 에러는 재시도
        await new Promise(r => setTimeout(r, TIMING.VIDEO_POLL_INTERVAL))
        continue
      }

      const statusInfo = result.statuses?.[0]
      if (!statusInfo) {
        await new Promise(r => setTimeout(r, TIMING.VIDEO_POLL_INTERVAL))
        continue
      }

      if (statusInfo.status === 'complete' && statusInfo.mediaId) {
        return { success: true, mediaId: statusInfo.mediaId, videoUrl: statusInfo.videoUrl }
      }

      if (statusInfo.status === 'failed') {
        return { success: false, error: statusInfo.error || 'Video generation failed' }
      }

      // 진행 중 — 폴링 계속
      if (statusInfo.progress) {
        setStatusMessage(`🎬 ${t('videoAutomation.generating')} (${Math.round(statusInfo.progress * 100)}%)`)
      }

      await new Promise(r => setTimeout(r, TIMING.VIDEO_POLL_INTERVAL))
    }

    return { success: false, error: 'Polling timeout — video generation took too long' }
  }

  /**
   * 단일 비디오 아이템 처리
   */
  const processVideoItem = async (item, mode, options) => {
    const { projectName, saveMode, videoModel, aspectRatio, duration } = options

    if (stopRequestedRef.current) return

    // 일시정지 대기
    while (pausedRef.current && !stopRequestedRef.current) {
      await new Promise(r => setTimeout(r, 500))
    }

    // 1. 비디오 생성 요청
    let genResult
    const prompt = item.prompt || ''

    switch (mode) {
      case 't2v': {
        setStatusMessage(`🎬 ${t('videoAutomation.requesting')} — "${prompt.substring(0, 40)}..."`)
        genResult = await generateVideoT2V(prompt, videoModel, aspectRatio, duration)
        break
      }
      case 'i2v': {
        const startMediaId = item.startMediaId
        if (!startMediaId) {
          return { success: false, error: 'No start image mediaId' }
        }
        setStatusMessage(`🎞️ ${t('videoAutomation.requesting')} — Frame→Video`)
        genResult = await generateVideoI2V(prompt, startMediaId, videoModel, aspectRatio, duration)
        break
      }
      case 'r2v': {
        // R2V는 현재 T2V API 사용 (레퍼런스 주입은 추후 확장)
        setStatusMessage(`🔗 ${t('videoAutomation.requesting')} — Refs→Video`)
        genResult = await generateVideoT2V(prompt, videoModel, aspectRatio, duration)
        break
      }
      default:
        return { success: false, error: `Unknown mode: ${mode}` }
    }

    if (!genResult.success) {
      return { success: false, error: genResult.error }
    }

    // 2. 폴링
    const generationId = genResult.generationId
    setStatusMessage(`⏳ ${t('videoAutomation.polling')} (${generationId.substring(0, 12)}...)`)

    const pollResult = await pollUntilDone(generationId)

    if (!pollResult.success) {
      return { success: false, error: pollResult.error }
    }

    // 3. 미디어 다운로드 — DOM 기반 다운로드 (AutoFlow 방식) 최우선
    //    hover → three-dot → download → 해상도 선택 → Electron will-download 캡처
    setStatusMessage(`📥 ${t('videoAutomation.downloading')}`)
    let mediaResult

    // 방법 1: DOM 기반 다운로드 (1080p 해상도)
    if (window.electronAPI?.domDownloadVideo) {
      try {
        console.log('[VideoAutomation] Trying DOM download for mediaId:', pollResult.mediaId?.substring(0, 20))
        mediaResult = await window.electronAPI.domDownloadVideo({
          mediaId: pollResult.mediaId,
          resolution: '1080p'
        })
        if (mediaResult?.success) {
          console.log('[VideoAutomation] ✅ DOM download success')
        } else {
          console.warn('[VideoAutomation] DOM download failed:', mediaResult?.error)
        }
      } catch (e) {
        console.warn('[VideoAutomation] DOM download exception:', e.message)
        mediaResult = null
      }
    }

    // 방법 2: status 응답에서 추출한 videoUrl로 직접 다운로드 (폴백 1)
    if (!mediaResult?.success && pollResult.videoUrl) {
      try {
        console.log('[VideoAutomation] Trying direct URL download:', pollResult.videoUrl?.substring(0, 60))
        const token = await getAccessToken()
        mediaResult = await window.electronAPI.downloadVideoUrl({
          url: pollResult.videoUrl, token
        })
      } catch (e) {
        mediaResult = { success: false, error: e.message }
      }
    }

    // 방법 3: fetchMedia (이미지용 getMediaUrlRedirect — 비디오에선 잘 안됨, 최후 폴백)
    if (!mediaResult?.success) {
      console.log('[VideoAutomation] Trying fetchMedia fallback for mediaId:', pollResult.mediaId?.substring(0, 20))
      mediaResult = await fetchMedia(pollResult.mediaId)
    }

    if (!mediaResult?.success) {
      return { success: false, error: `Media download failed: ${mediaResult?.error || 'All methods failed'}` }
    }

    // 4. 파일 저장
    let videoPath = null
    if (saveMode === 'folder' && projectName) {
      const videoId = item.id || `video_${Date.now()}`
      const saveResult = await fileSystemAPI.saveVideo(projectName, videoId, mediaResult.base64, 'flow')
      videoPath = saveResult?.path || null
    }

    return {
      success: true,
      base64: mediaResult.base64,
      mediaId: pollResult.mediaId,
      generationId,
      videoPath
    }
  }

  /**
   * 비디오 자동화 시작
   * @param {{ mode, scenes?, framePairs?, refPairs?, projectName, saveMode, videoModel, aspectRatio, duration }} options
   */
  const start = useCallback(async (options = {}) => {
    const {
      mode = 't2v',
      scenes = [],
      framePairs = [],
      refPairs = [],
      projectName = '',
      saveMode = 'folder',
      videoModel = 'veo_3_1_t2v_fast_ultra_relaxed',
      aspectRatio = 'VIDEO_ASPECT_RATIO_LANDSCAPE',
      duration = 8,
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
          .map(s => ({ id: s.id, prompt: s.prompt }))
        break

      case 'i2v':
        items = framePairs
          .filter(p => p.startSceneId && p.status !== 'complete')
          .map(p => ({
            id: p.id,
            prompt: p.prompt,
            startMediaId: p._startMediaId,  // App.jsx에서 resolve해서 넘겨줌
            endMediaId: p._endMediaId || null,
          }))
        break

      case 'r2v':
        items = refPairs
          .filter(p => (p.refIds?.length > 0) && p.status !== 'complete')
          .map(p => ({
            id: p.id,
            prompt: p.prompt,
            refMediaIds: p._refMediaIds || [],  // App.jsx에서 resolve
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

    setProgress({ current: 0, total, percent: 0 })

    // 순차 처리 (비디오는 서버 부하 고려)
    for (let i = 0; i < items.length; i++) {
      if (stopRequestedRef.current) break

      const item = items[i]
      onItemUpdate?.(item.id, 'generating')

      const result = await processVideoItem(item, mode, {
        projectName, saveMode, videoModel, aspectRatio, duration
      })

      if (result.success) {
        onItemUpdate?.(item.id, 'complete', result)
      } else {
        onItemUpdate?.(item.id, 'error', { error: result.error })
      }

      setProgress({
        current: i + 1,
        total,
        percent: Math.round(((i + 1) / total) * 100)
      })
    }

    // 완료
    setIsRunning(false)
    setIsPaused(false)

    if (stopRequestedRef.current) {
      setStatus('stopped')
      setStatusMessage(t('status.stopped'))
    } else {
      setStatus('done')
      setStatusMessage(`✅ ${t('videoAutomation.done')}`)
    }
  }, [isRunning, generateVideoT2V, generateVideoI2V, checkVideoStatus, fetchMedia, getAccessToken, t])

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

  return {
    isRunning,
    isPaused,
    progress,
    status,
    statusMessage,
    start,
    togglePause,
    stop
  }
}

export default useVideoAutomation
