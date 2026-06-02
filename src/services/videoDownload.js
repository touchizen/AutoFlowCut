/**
 * videoDownload — cloud(Veo) 비디오 다운로드 공통 헬퍼.
 *
 * Flow 시절 useVideoAutomation 과 videoRecovery 가 각각 DOM→Flow-URL→fetchMedia
 * 3단계 폴백을 복제했다. 공식 API 전환 후에는 완료된 operation 의 videoUri 를
 * downloadVideo(videoUri) 로 직접 받으면 되므로 한 곳으로 통일한다.
 *
 * @param {Function} downloadVideo - useGenAPI.downloadVideo(videoUri) → {success, base64, mimeType, error}
 * @param {string} videoUrl - 완료된 Veo operation 의 video.uri
 * @returns {Promise<{success:boolean, base64?:string, mimeType?:string, error?:string}>}
 */
export async function downloadVideoBase64(downloadVideo, videoUrl) {
  if (!videoUrl) return { success: false, error: 'No video URL' }
  if (typeof downloadVideo !== 'function') return { success: false, error: 'downloadVideo unavailable' }
  try {
    return await downloadVideo(videoUrl)
  } catch (e) {
    return { success: false, error: e?.message || String(e) }
  }
}
