/**
 * electron/api/youtube/getVideoDetails.js
 *
 * 영상 카드 더블클릭 시 상세 모달용 단일 영상 상세 조회 (2026-07-08).
 * yt-dlp `--dump-single-json`으로 구독자수·게시일·조회수·좋아요·재생시간·채널을 취득하고,
 * viralMetrics로 바이럴 지수를 파생한다. 검색(flat)과 달리 페이지 1회 조회라 느려서
 * 모달 열 때 온디맨드로만 호출한다(리서치 파이프라인 상태 불변 — mutex 미사용).
 */
import { runYtDlp as defaultRunYtDlp } from './ytDlp.js'
import { computeViralMetrics } from './viralMetrics.js'

// searchVideos와 동일한 videoId 안전성 검증(URL 템플레이팅 전 인젝션 방지).
const SAFE_VIDEO_ID = /^[A-Za-z0-9_-]+$/

/** 숫자/숫자문자열이면 Number, 아니면(null/'NA'/숨김) null. */
function numOrNull(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
  return null
}

/** yt-dlp --dump-single-json stdout → 정규화된 상세 메타. 파싱 불가 시 null. */
export function parseVideoDetails(stdout) {
  if (!stdout || typeof stdout !== 'string') return null
  let d
  try {
    d = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null
  const id = d.id || ''
  const rawThumb = d.thumbnail && d.thumbnail !== 'NA' ? d.thumbnail : ''
  return {
    videoId: id,
    title: d.title || '',
    channelTitle: (d.channel === 'NA' ? '' : d.channel) || (d.uploader === 'NA' ? '' : d.uploader) || '',
    subscribers: numOrNull(d.channel_follower_count),
    uploadDate: /^\d{8}$/.test(String(d.upload_date || '')) ? String(d.upload_date) : '',
    viewCount: numOrNull(d.view_count) ?? 0,
    likeCount: numOrNull(d.like_count),
    durationSec: numOrNull(d.duration) ?? 0,
    durationString: d.duration_string || '',
    thumbnailUrl: rawThumb || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''),
  }
}

/**
 * 단일 영상 상세 조회.
 * @param {object} params
 * @param {string} params.videoId
 * @param {object} [deps] - { runYtDlp } 테스트 주입
 * @returns {Promise<{details?, error?}>}
 */
export async function getVideoDetails({ videoId } = {}, deps = {}) {
  const { runYtDlp = defaultRunYtDlp } = deps
  const id = String(videoId || '').trim()
  if (!id) return { error: 'empty-video-id' }
  if (!SAFE_VIDEO_ID.test(id)) return { error: 'invalid-video-id' }
  const args = [
    `https://www.youtube.com/watch?v=${id}`,
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
  ]
  try {
    const { stdout } = await runYtDlp(args, { timeoutMs: 30000 })
    const details = parseVideoDetails(stdout)
    if (!details || !details.videoId) return { error: 'parse-failed' }
    const viral = computeViralMetrics({
      viewCount: details.viewCount,
      likeCount: details.likeCount,
      subscribers: details.subscribers,
      uploadDate: details.uploadDate,
    })
    return { details: { ...details, viral } }
  } catch (e) {
    return { error: String((e && e.message) || e) }
  }
}
