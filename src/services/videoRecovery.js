/**
 * videoRecovery — 중단된 비디오 생성 복구 서비스
 *
 * 시나리오: Phase 1(제출)은 성공했지만 앱이 종료되어 Phase 2(폴링)/Phase 3(다운로드)에
 * 도달하지 못한 framePairs를 프로젝트 재로딩 시점에 복구한다.
 *
 * `generationId`는 제출 직후 persistent state(project.json)에 저장되므로,
 * 재로딩 후 Flow 서버에 상태를 물어보고 완료된 것은 다운로드+저장,
 * 아직 진행 중인 것은 'generating' 유지, 만료된 것은 'error' 처리한다.
 */

import { fileSystemAPI } from '../hooks/useFileSystem'

/**
 * 다운로드 + 저장 (useVideoAutomation의 Phase 3 로직과 동일)
 * DOM 다운로드 우선 → videoUrl 직접 → fetchMedia fallback
 */
export async function downloadAndSaveVideo({
  mediaId,
  videoUrl,
  item,                  // { id, videoSaveId? }
  projectName,
  saveMode = 'folder',
  videoResolution = '1080p',
  fetchMedia,            // from flowAPI
  getAccessToken,        // from flowAPI
}) {
  let mediaResult

  // ─── 1. DOM 다운로드 ───
  if (window.electronAPI?.domDownloadVideo) {
    try {
      console.log('[VideoRecovery] [1/3] DOM download — mediaId:', mediaId?.substring(0, 20), 'resolution:', videoResolution)
      mediaResult = await window.electronAPI.domDownloadVideo({
        mediaId, resolution: videoResolution
      })
      if (mediaResult?.success) {
        const actualRes = mediaResult.resolution || 'unknown'
        console.log('[VideoRecovery] DOM download success (resolution:', actualRes, ')')
      } else {
        console.warn('[VideoRecovery] DOM download failed:', mediaResult?.error)
      }
    } catch (e) {
      console.warn('[VideoRecovery] DOM download exception:', e.message)
    }
  }

  // ─── 2. videoUrl 직접 다운로드 ───
  if (!mediaResult?.success && videoUrl && getAccessToken) {
    try {
      console.log('[VideoRecovery] [2/3] Direct URL download:', videoUrl?.substring(0, 80))
      const token = await getAccessToken()
      mediaResult = await window.electronAPI.downloadVideoUrl({ url: videoUrl, token })
      if (mediaResult?.success) {
        console.log('[VideoRecovery] Direct URL download success')
      }
    } catch (e) {
      console.warn('[VideoRecovery] Direct URL download exception:', e.message)
      mediaResult = null
    }
  }

  // ─── 3. fetchMedia fallback ───
  if (!mediaResult?.success && fetchMedia) {
    try {
      console.log('[VideoRecovery] [3/3] fetchMedia for mediaId:', mediaId?.substring(0, 20))
      mediaResult = await fetchMedia(mediaId)
    } catch (e) {
      console.warn('[VideoRecovery] fetchMedia exception:', e.message)
    }
  }

  if (!mediaResult?.success) {
    return { success: false, error: `Media download failed: ${mediaResult?.error || 'All methods failed'}`, mediaId }
  }

  // 파일 저장 — useVideoAutomation 와 동일한 metadata 규칙(seed/timestamp/model) +
  // 저장 실패 surfacing. 미적용 시 saveCurrentProject 가 base64 를 strip 한 뒤 path 가 비어
  // 다음 로드에서 데이터 유실 가능.
  let videoPath = null
  let saveError = null
  const generatedAt = Date.now()
  // 모델 ID 우선순위:
  //   1. item.model — 이전 complete 시 저장된 실제 모델 식별자 (project.json 에서 복원됨)
  //   2. item.videoModel — 호출자가 직접 plumb 해준 경우
  //   3. 'flow-video' — 둘 다 없으면 generic 폴백
  // seed 도 item.seed 우선 (이전 생성 시 저장된 값 보존).
  const modelId = item?.model || item?.videoModel || 'flow-video'
  const seedValue = item?.seed ?? null
  if (saveMode === 'folder' && projectName) {
    const videoId = item.videoSaveId || item.id || `video_${Date.now()}`
    const metadata = {
      prompt: item?.prompt || null,
      mediaId,
      model: modelId,
      timestamp: generatedAt,
      seed: seedValue,
    }
    const saveResult = await fileSystemAPI.saveVideo(projectName, videoId, mediaResult.base64, modelId, metadata)
    if (saveResult?.success) {
      videoPath = saveResult.path || null
    } else {
      saveError = saveResult?.error || 'Video save failed'
      console.error('[VideoRecovery] saveVideo failed:', saveError)
    }
  }

  // folder 모드 + save 실패 → success: false 로 surface (mediaId 보존해서 다음 retry 가능)
  if (saveMode === 'folder' && saveError) {
    return {
      success: false,
      error: `Save failed: ${saveError}`,
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

/**
 * 중단된 in-flight 비디오 복구 (프로젝트 로드 직후 호출)
 *
 * `generationId`가 있지만 `videoPath`가 없는 framePair들을 Flow 서버에 일괄 쿼리해서:
 *   - complete → 다운로드+저장 → 'complete' 전이
 *   - pending/processing → 'generating' 유지 (사용자 재시작 또는 다음 start()에서 픽업)
 *   - failed/expired (404) → 'error' 전이
 *
 * @returns { recovered, total, expired } 복구 결과 요약
 */
export async function recoverInFlightVideos({
  framePairs,
  projectName,
  saveMode = 'folder',
  videoResolution = '1080p',
  checkVideoStatus,      // flowAPI.checkVideoStatus(genIds[]) → { success, statuses[] }
  fetchMedia,            // flowAPI.fetchMedia
  getAccessToken,        // flowAPI.getAccessToken
  onFramePairUpdate,     // (id, patch) => void
  logPrefix = '[VideoRecovery]',
}) {
  // 복구 대상: generationId 있음 + videoPath 없음 + status가 generating/pending
  const candidates = framePairs.filter(fp =>
    fp.generationId &&
    !fp.videoPath &&
    (fp.status === 'generating' || fp.status === 'pending')
  )

  if (candidates.length === 0) return { recovered: 0, total: 0, expired: 0 }

  console.log(`${logPrefix} Found ${candidates.length} in-flight videos — checking Flow status...`)

  const CHUNK = 50  // same concurrency as mediaId recovery (commit d70a61c)
  let recovered = 0
  let expired = 0
  const total = candidates.length

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK)
    const genIds = chunk.map(fp => fp.generationId)

    let result
    try {
      result = await checkVideoStatus(genIds)
    } catch (e) {
      console.warn(`${logPrefix} checkVideoStatus exception:`, e.message)
      continue
    }

    if (!result?.success || !Array.isArray(result.statuses)) {
      // 전체 배치 실패 — 404/expired 가능성. 배치 에러 메시지로 판단
      const err = String(result?.error || '')
      const isExpired = err.includes('404') || err.includes('NOT_FOUND') || err.toLowerCase().includes('expired')
      if (isExpired) {
        for (const fp of chunk) {
          onFramePairUpdate(fp.id, {
            status: 'error',
            error: 'Generation expired — please regenerate',
            generatingEndedAt: Date.now(),
          })
          expired++
        }
      }
      // 일시적 오류면 그대로 둠 ('generating' 유지)
      continue
    }

    // statuses는 genIds 순서와 동일 — 인덱스 매칭
    for (let si = 0; si < result.statuses.length && si < chunk.length; si++) {
      const statusInfo = result.statuses[si]
      const fp = chunk[si]

      if (statusInfo.status === 'complete' && statusInfo.mediaId) {
        // Phase 3: 다운로드+저장
        try {
          const dlResult = await downloadAndSaveVideo({
            mediaId: statusInfo.mediaId,
            videoUrl: statusInfo.videoUrl,
            item: fp,
            projectName,
            saveMode,
            videoResolution,
            fetchMedia,
            getAccessToken,
          })

          if (dlResult.success && dlResult.base64) {
            onFramePairUpdate(fp.id, {
              status: 'complete',
              base64: dlResult.base64,
              video: dlResult.base64,
              mediaId: statusInfo.mediaId,
              videoPath: dlResult.videoPath || null,
              videoSaveId: dlResult.videoSaveId || fp.videoSaveId || null,
              ...(fp.duration ? { duration: fp.duration } : {}),
              ...(dlResult.seed != null ? { seed: dlResult.seed } : {}),
              ...(dlResult.generatedAt ? { generatedAt: dlResult.generatedAt } : {}),
              ...(dlResult.model ? { model: dlResult.model } : {}),
              generatingEndedAt: Date.now(),
            })
            recovered++
            console.log(`${logPrefix} Recovered ${fp.id} → ${statusInfo.mediaId.substring(0, 16)}`)
          } else {
            // 저장 실패 시에도 retry 식별자 + 메타 보존 (download-only retry 경로 유효 +
            // 다음 성공 시점에 동일 모델/seed 로 저장되도록).
            onFramePairUpdate(fp.id, {
              status: 'error',
              error: dlResult.error || 'Download failed after recovery',
              ...(dlResult.mediaId ? { mediaId: dlResult.mediaId } : { mediaId: statusInfo.mediaId }),
              ...(dlResult.videoSaveId ? { videoSaveId: dlResult.videoSaveId } : {}),
              ...(dlResult.seed != null ? { seed: dlResult.seed } : {}),
              ...(dlResult.model ? { model: dlResult.model } : {}),
              generatingEndedAt: Date.now(),
            })
          }
        } catch (e) {
          console.warn(`${logPrefix} Recovery download exception for ${fp.id}:`, e.message)
        }
      } else if (statusInfo.status === 'failed') {
        onFramePairUpdate(fp.id, {
          status: 'error',
          error: statusInfo.error || 'Video generation failed',
          generatingEndedAt: Date.now(),
        })
        expired++
      } else {
        // 'pending' / 'processing' — 서버에 살아있음. auto-restore 에서 'generating' 이
        // 'pending' 으로 떨어졌으니, 'generating' 으로 되돌려 다음 start() 가 재제출(quota 낭비) 안 함.
        // 다음 폴링/사용자 액션에서 status 다시 체크.
        onFramePairUpdate(fp.id, {
          status: 'generating',
        })
      }
    }
  }

  console.log(`${logPrefix} 🎬 Recovered ${recovered}/${total} in-flight videos${expired > 0 ? ` (${expired} expired/failed)` : ''}`)
  return { recovered, total, expired }
}

/**
 * 단일 아이템 다운로드 재시도 — 이미 서버엔 영상이 있지만 로컬 다운로드만 실패한 경우.
 *
 * Flow:
 *   1. checkVideoStatus([item.generationId]) 로 서버 상태 확인
 *      → complete + videoUrl 얻음
 *      → 404 / expired 면 onUpdate(id, 'error', { error: 'Generation expired …' })
 *   2. downloadAndSaveVideo() 3-tier fallback
 *      → success → onUpdate(id, 'complete', { base64, videoPath, videoSaveId, mediaId, generationId })
 *      → fail    → onUpdate(id, 'error', { error })
 *
 * 호출측은 quota 소비 없이 재다운로드만 수행한다.
 *
 * @param {object}   args
 * @param {object}   args.item       — { id, generationId, mediaId, videoSaveId? }
 * @param {object}   args.flowAPI    — { checkVideoStatus, fetchMedia, getAccessToken }
 * @param {function} args.onUpdate   — (id, status, patch) => void
 * @param {string}   [args.projectName]
 * @param {string}   [args.saveMode]       ('folder' | 'memory')
 * @param {string}   [args.videoResolution] ('1080p' | '720p' | ...)
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function retryVideoDownload({
  item,
  flowAPI,
  onUpdate,
  projectName = '',
  saveMode = 'folder',
  videoResolution = '1080p',
}) {
  if (!item?.generationId) {
    const error = 'Cannot retry: missing generationId'
    onUpdate?.(item.id, 'error', { error })
    return { success: false, error }
  }
  if (!flowAPI?.checkVideoStatus) {
    const error = 'Cannot retry: flowAPI.checkVideoStatus unavailable'
    onUpdate?.(item.id, 'error', { error })
    return { success: false, error }
  }

  onUpdate?.(item.id, 'generating', { generatingStartedAt: Date.now() })

  // ─── 1. 서버 상태 확인 ───
  let statusResult
  try {
    statusResult = await flowAPI.checkVideoStatus([item.generationId])
  } catch (e) {
    const err = String(e?.message || e)
    const isExpired = err.includes('404') || err.includes('NOT_FOUND') || err.toLowerCase().includes('expired')
    const msg = isExpired
      ? 'Generation expired — please regenerate'
      : `Status check failed: ${err}`
    onUpdate?.(item.id, 'error', { error: msg, generatingEndedAt: Date.now() })
    return { success: false, error: msg }
  }

  if (!statusResult?.success || !Array.isArray(statusResult.statuses)) {
    const err = String(statusResult?.error || 'Unknown status error')
    const isExpired = err.includes('404') || err.includes('NOT_FOUND') || err.toLowerCase().includes('expired')
    const msg = isExpired
      ? 'Generation expired — please regenerate'
      : `Status check failed: ${err}`
    onUpdate?.(item.id, 'error', { error: msg, generatingEndedAt: Date.now() })
    return { success: false, error: msg }
  }

  const statusInfo = statusResult.statuses[0]
  if (!statusInfo) {
    const msg = 'Generation expired — please regenerate'
    onUpdate?.(item.id, 'error', { error: msg, generatingEndedAt: Date.now() })
    return { success: false, error: msg }
  }

  if (statusInfo.status === 'failed') {
    const msg = statusInfo.error || 'Video generation failed'
    onUpdate?.(item.id, 'error', { error: msg, generatingEndedAt: Date.now() })
    return { success: false, error: msg }
  }

  if (statusInfo.status !== 'complete' || !statusInfo.mediaId) {
    // still processing — leave as generating
    const msg = `Video still ${statusInfo.status || 'processing'} on server — try again later`
    onUpdate?.(item.id, 'error', { error: msg, generatingEndedAt: Date.now() })
    return { success: false, error: msg }
  }

  // ─── 2. 다운로드 + 저장 ───
  const mediaId = statusInfo.mediaId || item.mediaId
  const dl = await downloadAndSaveVideo({
    mediaId,
    videoUrl: statusInfo.videoUrl,
    item,
    projectName,
    saveMode,
    videoResolution,
    fetchMedia: flowAPI.fetchMedia,
    getAccessToken: flowAPI.getAccessToken,
  })

  if (dl.success && dl.base64) {
    onUpdate?.(item.id, 'complete', {
      base64: dl.base64,
      video: dl.base64,
      mediaId,
      videoPath: dl.videoPath || null,
      videoSaveId: dl.videoSaveId || item.videoSaveId || null,
      generationId: item.generationId,
      ...(item.duration ? { duration: item.duration } : {}),
      ...(dl.seed != null ? { seed: dl.seed } : {}),
      ...(dl.generatedAt ? { generatedAt: dl.generatedAt } : {}),
      ...(dl.model ? { model: dl.model } : {}),
      generatingEndedAt: Date.now(),
    })
    return { success: true }
  }

  // 실패 시에도 retry 식별자 + 메타 보존 — 다음 retry 가 download-only 경로 탈 수 있게 +
  // 다음 성공 시점에 동일 모델/seed 로 저장되도록.
  const msg = dl.error || 'Download failed'
  onUpdate?.(item.id, 'error', {
    error: msg,
    mediaId: dl.mediaId || mediaId,
    videoSaveId: dl.videoSaveId || item.videoSaveId || null,
    generationId: item.generationId,
    ...(item?.seed != null ? { seed: item.seed } : {}),
    ...(item?.model ? { model: item.model } : {}),
    generatingEndedAt: Date.now(),
  })
  return { success: false, error: msg }
}
