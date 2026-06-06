/**
 * mentionParser — Google Flow 스타일 `@name` 인라인 레퍼런스 토큰 파서.
 *
 * 사용자가 프롬프트 본문에 `@alice` 처럼 적으면, 이름이 `alice` 인 레퍼런스를
 * 해당 생성 호출에 inline base64 로 함께 첨부한다 (CSV 태그 매칭과 별도/병행).
 * 매칭은 case-insensitive.
 *
 * 왜 클라이언트에서 처리하나: Gemini 이미지 API 는 이름 기반 레퍼런스 문법이
 * 없다 — 레퍼런스는 순수 positional binary parts. Flow 의 `@` UI 도 클라이언트가
 * 이름 → 이미지 매핑을 끝낸 뒤 binary part 로 보내는 것. 우리도 같은 방식.
 */

// @ 가 단어 경계(시작/공백/구두점) 뒤일 때만 매칭 — `user@example.com` 같은 이메일은 제외.
// 이름은 ASCII alnum + 밑줄/하이픈 + 한글 음절 허용.
const MENTION_RE = /(^|[\s.,!?;:()\[\]{}'"`])@([A-Za-z0-9_\-가-힣]+)/g

/**
 * 텍스트에서 `@name` 토큰 추출 (대소문자 기준 dedup, 등장 순서 유지).
 * @param {string} text
 * @returns {string[]} mention 이름들 (원본 case 보존)
 */
export function extractMentionNames(text) {
  if (!text || typeof text !== 'string') return []
  const seen = new Set()
  const names = []
  for (const m of text.matchAll(MENTION_RE)) {
    const name = m[2]
    const key = name.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      names.push(name)
    }
  }
  return names
}

/**
 * mention 이름들을 references[] 에서 찾아 매칭 결과 반환.
 * @param {string} text - `@name` 토큰을 포함할 수 있는 프롬프트
 * @param {Array} references - 전체 레퍼런스 배열
 * @returns {{ matched: Array, missing: string[] }}
 *   - matched: 발견된 ref 객체들 (mention 등장 순서)
 *   - missing: 매칭 안 된 mention 이름들 — caller 가 경고 로깅 등에 사용
 */
export function resolveMentions(text, references = []) {
  const names = extractMentionNames(text)
  if (names.length === 0) return { matched: [], missing: [] }
  const byName = new Map()
  for (const r of references || []) {
    if (r?.name) byName.set(String(r.name).toLowerCase(), r)
  }
  const matched = []
  const missing = []
  for (const name of names) {
    const ref = byName.get(name.toLowerCase())
    if (ref) matched.push(ref)
    else missing.push(name)
  }
  return { matched, missing }
}

/**
 * 알려진 mention 의 `@` 접두사를 제거 — Gemini 가 본문에서 이름을 일반 명사처럼
 * 읽도록. 레퍼런스 이미지는 별도 inline part 로 첨부됨.
 *
 * 미해결 `@xxx` 는 그대로 둔다 — 사용자가 매칭 실패를 시각적으로 알 수 있게.
 * @param {string} text
 * @param {Array} references
 * @returns {string}
 */
export function stripMentionPrefixes(text, references = []) {
  if (!text || typeof text !== 'string') return text || ''
  const known = new Set(
    (references || [])
      .filter((r) => r?.name)
      .map((r) => String(r.name).toLowerCase())
  )
  return text.replace(MENTION_RE, (full, lead, name) => {
    if (!known.has(name.toLowerCase())) return full
    return `${lead}${name}`
  })
}
