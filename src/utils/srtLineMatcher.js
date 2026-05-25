/**
 * srtLineMatcher — SRT 라인 텍스트 유사도 매칭
 *
 * Phase 9 of docs/superpowers/plans/2026-05-25-srt-csv-track-separation.md
 *
 * SRT 재import 시 옛 트랙 ↔ 새 트랙 라인 매핑을 추정해
 * 사용자의 묶기 (scene.srtLineIds) 를 가능한 한 보존한다.
 */

const SIMILARITY_THRESHOLD = 0.85

/**
 * 텍스트 정규화 — trim + 소문자 + 공백 단일화.
 *
 * @param {string|null|undefined} s
 * @returns {string}
 */
export function normalizeText(s) {
  if (s == null) return ''
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Levenshtein distance (편집 거리)
 */
function levenshtein(a, b) {
  if (!a.length) return b.length
  if (!b.length) return a.length
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }
  return dp[a.length][b.length]
}

/**
 * 0~1 유사도. 1=완전 일치, 0=완전 불일치.
 * normalizeText 후 비교.
 *
 * 둘 중 하나라도 빈 문자열이면 0.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function similarity(a, b) {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const dist = levenshtein(na, nb)
  const maxLen = Math.max(na.length, nb.length)
  if (maxLen === 0) return 1
  return Math.max(0, 1 - dist / maxLen)
}

/**
 * 옛 srtTrack ↔ 새 srtTrack 매칭.
 *
 * Greedy 알고리즘:
 *   1. 옛 라인마다 best 매치 후보 산출 (정확 → 유사도 순)
 *   2. similarity >= threshold 면 매칭
 *   3. 각 새 라인은 1번만 사용 (1:1)
 *   4. 매칭 안 된 옛 라인 → removed, 매칭 안 된 새 라인 → added
 *
 * @param {Array} oldTrack — [{ id, text, ... }]
 * @param {Array} newTrack — [{ id, text, ... }]
 * @returns {{ matched: Array<{oldId, newIdx, score}>, removed: string[], added: number[] }}
 */
export function matchSrtLines(oldTrack, newTrack) {
  const oldArr = Array.isArray(oldTrack) ? oldTrack : []
  const newArr = Array.isArray(newTrack) ? newTrack : []
  const matched = []
  const removed = []
  const usedNew = new Set()

  for (const oldLine of oldArr) {
    const oldText = oldLine?.text || ''

    // 정확 일치 우선 (정규화 기준)
    const exactIdx = newArr.findIndex(
      (n, i) => !usedNew.has(i) && normalizeText(n.text) === normalizeText(oldText)
    )
    if (exactIdx >= 0) {
      matched.push({ oldId: oldLine.id, newIdx: exactIdx, score: 1 })
      usedNew.add(exactIdx)
      continue
    }

    // 유사도 best 매치
    let bestIdx = -1
    let bestScore = 0
    for (let i = 0; i < newArr.length; i++) {
      if (usedNew.has(i)) continue
      const s = similarity(oldText, newArr[i].text || '')
      if (s > bestScore) {
        bestScore = s
        bestIdx = i
      }
    }
    if (bestIdx >= 0 && bestScore >= SIMILARITY_THRESHOLD) {
      matched.push({ oldId: oldLine.id, newIdx: bestIdx, score: bestScore })
      usedNew.add(bestIdx)
    } else {
      removed.push(oldLine.id)
    }
  }

  const added = []
  for (let i = 0; i < newArr.length; i++) {
    if (!usedNew.has(i)) added.push(i)
  }

  return { matched, removed, added }
}
