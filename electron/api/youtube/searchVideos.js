/**
 * electron/api/youtube/searchVideos.js
 *
 * yt-dlp `ytsearchN:키워드`로 YouTube 영상 검색 (spec §3.3, 방향 확정 2026-07-07).
 *
 * YouTube Data API v3 / API key / quota 전면 폐기 — 검색도 yt-dlp 바이너리로 처리한다.
 * `--flat-playlist --print`로 각 영상 상세 조회 없이 빠르게 id/title/view_count/channel/
 * duration/thumbnail 취득. ytsearch는 관련성순이라 넉넉히 받아(fetchCount) view_count desc
 * 정렬 후 상위 maxResults(§Q4=10)를 카드로 반환.
 */
import { runYtDlp as defaultRunYtDlp } from './ytDlp.js'

// --print 필드 구분자 (제목에 안 나올 유니크 문자 — U+001F Unit Separator)
const SEP = String.fromCharCode(0x1f)
const PRINT_TEMPLATE = ['%(view_count)s', '%(title)s', '%(channel)s', '%(id)s', '%(duration)s', '%(thumbnail)s'].join(SEP)

/** yt-dlp --print 출력(줄당 1영상) → 영상 메타 배열. */
export function parseSearchLines(stdout) {
  if (!stdout || typeof stdout !== 'string') return []
  const videos = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const parts = line.split(SEP)
    if (parts.length < 6) continue // 필드 부족 라인 스킵
    const [view, title, channel, id, duration, thumbnail] = parts
    if (!id || id === 'NA') continue
    const viewCount = /^\d+$/.test(view) ? Number(view) : 0
    const durationSec = /^\d+$/.test(duration) ? Number(duration) : 0
    videos.push({
      videoId: id,
      title: title || '',
      channelTitle: channel === 'NA' ? '' : channel || '',
      viewCount,
      durationSec,
      thumbnailUrl: thumbnail === 'NA' ? '' : thumbnail || '',
    })
  }
  return videos
}

/** 조회수 desc 정렬 후 상위 maxResults (§Q4, 순수 — 원본 불변). */
export function sortByViewCount(videos, maxResults = 10) {
  return [...videos].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0)).slice(0, maxResults)
}

/**
 * 영상 검색.
 * @param {object} params
 * @param {string} params.query
 * @param {number} [params.maxResults=10] - §Q4
 * @param {number} [params.fetchCount] - ytsearch 개수(기본 maxResults*3, 조회수 정렬 여유)
 * @param {object} [deps] - { runYtDlp } 테스트 주입
 * @returns {Promise<{videos?, error?}>}
 */
export async function searchVideos({ query, maxResults = 10, fetchCount } = {}, deps = {}) {
  const { runYtDlp = defaultRunYtDlp } = deps
  const q = (query || '').trim()
  if (!q) return { error: 'empty-query' }
  const n = fetchCount || Math.max(maxResults * 3, maxResults)
  const args = [
    `ytsearch${n}:${q}`,
    '--flat-playlist',
    '--skip-download',
    '--no-warnings',
    '--print',
    PRINT_TEMPLATE,
  ]
  try {
    const { stdout } = await runYtDlp(args, { timeoutMs: 60000 })
    const videos = sortByViewCount(parseSearchLines(stdout), maxResults)
    return { videos }
  } catch (e) {
    return { error: String((e && e.message) || e) }
  }
}
