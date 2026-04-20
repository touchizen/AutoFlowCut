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
    return { success: false, error: `Media download failed: ${mediaResult?.error || 'All methods failed'}` }
  }

  // 파일 저장
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
              generatingEndedAt: Date.now(),
            })
            recovered++
            console.log(`${logPrefix} Recovered ${fp.id} → ${statusInfo.mediaId.substring(0, 16)}`)
          } else {
            onFramePairUpdate(fp.id, {
              status: 'error',
              error: dlResult.error || 'Download failed after recovery',
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
      }
      // 'pending'/'processing' → 그대로 둠 (auto-restore에서 pending 리셋 안 건드리면 generating 유지)
    }
  }

  console.log(`${logPrefix} 🎬 Recovered ${recovered}/${total} in-flight videos${expired > 0 ? ` (${expired} expired/failed)` : ''}`)
  return { recovered, total, expired }
}
