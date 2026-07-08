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
// 개선2: 일자 필터용 상세조회 print — flat-playlist는 upload_date를 안 준다(NA 확인됨).
const DATE_PRINT_TEMPLATE = ['%(id)s', '%(upload_date)s'].join(SEP)

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
    // 썸네일 폴백(2026-07-08 실앱 확인): flat-playlist가 thumbnail을 NA/빈값으로 주는 경우가
    // 많다 — videoId만 있으면 유효한 표준 hqdefault URL로 채워 카드에서 항상 보이게 한다.
    const realThumb = thumbnail === 'NA' ? '' : thumbnail || ''
    videos.push({
      videoId: id,
      title: title || '',
      channelTitle: channel === 'NA' ? '' : channel || '',
      viewCount,
      durationSec,
      thumbnailUrl: realThumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    })
  }
  return videos
}

/** 조회수 desc 정렬 후 상위 maxResults (§Q4, 순수 — 원본 불변). */
export function sortByViewCount(videos, maxResults = 10) {
  return [...videos].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0)).slice(0, maxResults)
}

// ---------- 개선2: 일자 필터 (전체/최근 1주일/최근 30일) ----------
// upload_date(YYYYMMDD, UTC)는 flat 검색에 없어 상세조회가 필요하다. 컷오프/파싱/필터는
// 순수함수로 분리해 단위 테스트한다(§3.3 개정 2026-07-08).

/** dateFilter(none|week|month) → 컷오프 YYYYMMDD(UTC). 필터 없으면 null. */
export function dateFilterCutoff(dateFilter, now = new Date()) {
  const days = dateFilter === 'week' ? 7 : dateFilter === 'month' ? 30 : 0
  if (!days) return null
  const d = new Date(now.getTime() - days * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
}

/** 상세조회 --print 출력(`id␟upload_date` 줄당 1영상) → { [videoId]: 'YYYYMMDD' }. */
export function parseUploadDateLines(stdout) {
  const map = {}
  if (!stdout || typeof stdout !== 'string') return map
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const [id, date] = line.split(SEP)
    if (!id || id === 'NA') continue
    if (/^\d{8}$/.test(date || '')) map[id] = date
  }
  return map
}

/** uploadDate >= cutoff(YYYYMMDD, 경계 포함)만 유지. 날짜 미상은 제외. cutoff null이면 전체(순수). */
export function filterByUploadDate(videos, cutoff) {
  if (!cutoff) return [...videos]
  return videos.filter((v) => /^\d{8}$/.test(v?.uploadDate || '') && v.uploadDate >= cutoff)
}

/**
 * 영상 검색.
 * @param {object} params
 * @param {string} params.query
 * @param {number} [params.maxResults=10] - §Q4 (개선1: UI에서 지정 가능)
 * @param {number} [params.fetchCount] - ytsearch 개수(기본 maxResults*3, 조회수 정렬 여유)
 * @param {'none'|'week'|'month'} [params.dateFilter='none'] - 개선2: 일자 필터.
 *   week/month면 조회수 상위 후보(maxResults*2)만 개별 상세조회로 upload_date를 취득해
 *   컷오프 이후만 남긴다(상세조회는 느리므로 필터 선택 시에만).
 * @param {object} [deps] - { runYtDlp } 테스트 주입
 * @returns {Promise<{videos?, error?}>}
 */
// m6(R1): URL 템플레이팅 전 videoId 안전성 검증 — fetchTranscript 경로(SAFE_SEGMENT_ID)와 일관.
const SAFE_VIDEO_ID = /^[A-Za-z0-9_-]+$/
// M3(R1): 상세조회 후보 상한(폭주 방지) + 후보당 타임아웃(초).
const DETAIL_CANDIDATE_CAP = 30
const DETAIL_TIMEOUT_PER_CANDIDATE_MS = 5000

export async function searchVideos({ query, maxResults = 10, fetchCount, dateFilter = 'none' } = {}, deps = {}) {
  const { runYtDlp = defaultRunYtDlp } = deps
  const q = (query || '').trim()
  if (!q) return { error: 'empty-query' }
  const n = fetchCount || Math.max(maxResults * 3, maxResults)
  const cutoff = dateFilterCutoff(dateFilter)
  // m1(R1): dateFilter 활성이면 pool을 ytsearchdate(업로드일순)로 받아 최신성 편향 제거 —
  // 조회수 상위 옛영상이 후보를 독점해 최근 영상이 컷오프 전에 잘리는 것 방지.
  const searchPrefix = cutoff ? 'ytsearchdate' : 'ytsearch'
  const args = [
    `${searchPrefix}${n}:${q}`,
    '--flat-playlist',
    '--skip-download',
    '--no-warnings',
    '--print',
    PRINT_TEMPLATE,
  ]
  try {
    const { stdout } = await runYtDlp(args, { timeoutMs: 60000 })
    const pool = parseSearchLines(stdout)
    if (!cutoff) return { videos: sortByViewCount(pool, maxResults) }

    // 일자 필터: 조회수 상위 후보만 상세조회(단일 yt-dlp 프로세스에 URL 나열 — 후보당 페이지
    // 1회 조회라 flat보다 느리다). m6: 안전한 videoId만 URL 템플레이팅.
    const candidates = sortByViewCount(pool, Math.min(maxResults * 2, DETAIL_CANDIDATE_CAP))
      .filter((v) => SAFE_VIDEO_ID.test(String(v.videoId || '')))
    if (!candidates.length) return { videos: [] }
    const detailArgs = [
      ...candidates.map((v) => `https://www.youtube.com/watch?v=${v.videoId}`),
      '--skip-download',
      '--no-warnings',
      '--print',
      DATE_PRINT_TEMPLATE,
    ]
    // M3(R1): 타임아웃을 후보 수에 스케일(고정 180s는 후보 60개엔 부족).
    let detailOut
    try {
      ({ stdout: detailOut } = await runYtDlp(detailArgs, { timeoutMs: candidates.length * DETAIL_TIMEOUT_PER_CANDIDATE_MS }))
    } catch {
      // M3: 상세조회 실패/타임아웃 시 검색 전멸 방지 — flat 조회수 상위로 폴백(일자 필터 미적용).
      // R2 MINOR: 폴백 시 dateFilter가 조용히 무시되므로 신호 플래그를 실어 UI가 안내하게 한다.
      return { videos: sortByViewCount(pool, maxResults), dateFilterFallback: true }
    }
    const dates = parseUploadDateLines(detailOut)
    const dated = candidates.map((v) => ({ ...v, uploadDate: dates[v.videoId] || '' }))
    return { videos: sortByViewCount(filterByUploadDate(dated, cutoff), maxResults) }
  } catch (e) {
    return { error: String((e && e.message) || e) }
  }
}
