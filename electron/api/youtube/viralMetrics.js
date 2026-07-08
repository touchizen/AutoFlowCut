/**
 * electron/api/youtube/viralMetrics.js
 *
 * 영상 상세(구독자·조회·좋아요·게시일)로부터 "바이럴 지수"를 계산하는 순수함수 (2026-07-08).
 * yt-dlp에 viral 필드는 없으므로 이미 받아온 값으로 파생 — 추가 네트워크 없음.
 *
 * 핵심 신호는 조회수 ÷ 구독자수(구독자 대비 조회 배수): 유튜브 아웃라이어의 대표 지표로,
 * 구독자보다 조회수가 훨씬 많으면 추천 알고리즘을 타고 확산된 것으로 본다.
 */

/** 게시일 YYYYMMDD(UTC) → 오늘까지 경과 일수(최소 1, 0나눗셈 방지). 미상이면 null. */
export function daysSinceUpload(uploadDate, now = new Date()) {
  const s = String(uploadDate || '')
  if (!/^\d{8}$/.test(s)) return null
  const up = Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))
  const diff = Math.floor((now.getTime() - up) / 86400000)
  return Math.max(1, diff)
}

/** 조회수/구독자 배수(ratio) → 등급 키. null/비유한이면 'unknown'. */
export function viralTier(ratio) {
  if (ratio == null || !isFinite(ratio)) return 'unknown'
  if (ratio < 1) return 'low'
  if (ratio < 5) return 'ok'
  if (ratio < 20) return 'high'
  return 'explosive'
}

/**
 * 바이럴 지표 계산 (순수).
 * @param {object} input
 * @param {number} input.viewCount
 * @param {number|null} [input.likeCount] - 숨김이면 null
 * @param {number|null} [input.subscribers] - 미상/0이면 ratio null
 * @param {string} [input.uploadDate] - YYYYMMDD
 * @param {Date} [now]
 * @returns {{ ratio:number|null, tier:string, viewsPerDay:number|null, engagement:number|null }}
 */
export function computeViralMetrics({ viewCount, likeCount, subscribers, uploadDate } = {}, now = new Date()) {
  const views = Number(viewCount) || 0
  const subs = Number(subscribers) || 0
  const likes = typeof likeCount === 'number' && isFinite(likeCount) ? likeCount : null
  const ratio = subs > 0 ? views / subs : null
  const days = daysSinceUpload(uploadDate, now)
  const viewsPerDay = days ? Math.round(views / days) : null
  const engagement = views > 0 && likes != null ? likes / views : null
  return { ratio, tier: viralTier(ratio), viewsPerDay, engagement }
}
