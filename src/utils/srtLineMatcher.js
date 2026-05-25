/**
 * srtLineMatcher — SRT 라인 텍스트 유사도 매칭
 *
 * Phase 9 of docs/superpowers/plans/2026-05-25-srt-csv-track-separation.md
 *
 * SRT 재import 시 옛 트랙 ↔ 새 트랙 라인 매핑을 추정해
 * 사용자의 묶기 (scene.srtLineIds) 를 가능한 한 보존한다.
 */

const SIMILARITY_THRESHOLD = 0.85

// C14 review fix: levenshtein 은 O(n*m) 메모리 — 10K x 10K 면 ~800MB OOM.
// 한쪽이 이 길이 초과하면 levenshtein 스킵하고 0 반환 (다른 라인으로 취급).
// 자막 라인은 보통 100자 미만이라 실용상 문제 없음.
const MAX_LEVENSHTEIN_LEN = 2000

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
 * Levenshtein distance (편집 거리). R22 review fix: 2-row rolling 으로 공간
 * 복잡도 O(N*M) → O(min(N, M)). 짧은 쪽을 inner dimension 으로 swap.
 */
function levenshtein(a, b) {
  if (!a.length) return b.length
  if (!b.length) return a.length
  // 메모리 최소화: b 가 짧은 쪽이 되도록 swap
  if (a.length < b.length) { [a, b] = [b, a] }
  let prevRow = new Array(b.length + 1)
  let currRow = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prevRow[j] = j
  for (let i = 1; i <= a.length; i++) {
    currRow[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      currRow[j] = Math.min(
        prevRow[j] + 1,       // deletion
        currRow[j - 1] + 1,   // insertion
        prevRow[j - 1] + cost // substitution
      )
    }
    // row swap
    const tmp = prevRow
    prevRow = currRow
    currRow = tmp
  }
  return prevRow[b.length]
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
  return similarityNorm(na, nb)
}

/**
 * 정규화 완료된 문자열 기준 유사도 — R21 review fix: matchSrtLines 가 inner loop
 * 에서 호출 시 normalizeText 중복 제거 (pre-normalize 후 이 함수 사용).
 *
 * @param {string} na — normalized a
 * @param {string} nb — normalized b
 * @returns {number} 0~1
 */
function similarityNorm(na, nb) {
  if (!na || !nb) return 0
  if (na === nb) return 1
  // C14: 한쪽이 cap 넘으면 levenshtein 안 함 (OOM 방지). 매칭 안 된 것으로 취급.
  if (na.length > MAX_LEVENSHTEIN_LEN || nb.length > MAX_LEVENSHTEIN_LEN) return 0
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

  // R21 review fix: pre-normalize 모든 라인 — inner loop 에서 normalizeText 가
  // O(N*M) 회 호출되는 것 제거. 대용량 SRT 재import 시 CPU 점유 ↓.
  const newNormalized = newArr.map((line, idx) => ({
    idx,
    id: line?.id,
    norm: normalizeText(line?.text),
  }))

  for (const oldLine of oldArr) {
    // C11 review fix: 빈 텍스트는 매칭에서 제외 (whitespace-only 포함).
    const normOld = normalizeText(oldLine?.text)
    if (!normOld) {
      removed.push(oldLine.id)
      continue
    }

    // 정확 일치 우선 (정규화 기준, 빈 문자열 제외)
    let exactIdx = -1
    for (const n of newNormalized) {
      if (usedNew.has(n.idx)) continue
      if (!n.norm) continue
      if (n.norm === normOld) { exactIdx = n.idx; break }
    }
    if (exactIdx >= 0) {
      matched.push({ oldId: oldLine.id, newIdx: exactIdx, score: 1 })
      usedNew.add(exactIdx)
      continue
    }

    // 유사도 best 매치 — pre-normalized 사용
    let bestIdx = -1
    let bestScore = 0
    for (const n of newNormalized) {
      if (usedNew.has(n.idx)) continue
      const s = similarityNorm(normOld, n.norm)
      if (s > bestScore) {
        bestScore = s
        bestIdx = n.idx
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
