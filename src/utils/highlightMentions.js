/**
 * highlightMentions — `@name` 토큰을 시각화 가능한 segment 로 분리한다.
 *
 * 결과: [{text, kind: 'plain'|'known'|'unknown'}, ...]
 *   - 'known'   = references[] 에 매칭되는 ref 가 있는 멘션
 *   - 'unknown' = `@xxx` 형식이지만 매칭 ref 없음 → 사용자 typo 시각화
 *
 * mentionParser 와 동일한 regex 를 쓴다 — 동일 정책(이메일 제외, 단어 경계 필요).
 */

const MENTION_RE = /(^|[\s.,!?;:()\[\]{}'"`])@([A-Za-z0-9_\-가-힣]+)/g

/**
 * @param {string} text
 * @param {Array} references
 * @returns {Array<{text:string, kind:'plain'|'known'|'unknown'}>}
 */
export function tokenizeMentions(text, references = []) {
  if (!text || typeof text !== 'string') return []
  const known = new Set(
    (references || [])
      .filter((r) => r?.name)
      .map((r) => String(r.name).toLowerCase())
  )

  const segments = []
  let lastIdx = 0
  for (const m of text.matchAll(MENTION_RE)) {
    const lead = m[1] || ''
    const name = m[2]
    const mentionStart = m.index + lead.length // `@` 위치
    // 멘션 앞의 plain 구간 (boundary 문자는 plain 쪽으로 포함)
    if (mentionStart > lastIdx) {
      segments.push({ text: text.slice(lastIdx, mentionStart), kind: 'plain' })
    }
    const kind = known.has(name.toLowerCase()) ? 'known' : 'unknown'
    segments.push({ text: `@${name}`, kind })
    lastIdx = mentionStart + 1 + name.length // `@` + name
  }
  if (lastIdx < text.length) {
    segments.push({ text: text.slice(lastIdx), kind: 'plain' })
  }
  return segments
}
