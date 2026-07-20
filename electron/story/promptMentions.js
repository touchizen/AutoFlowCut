import {
  MENTION_LEAD_CHAR_RE,
  formatMentionToken,
  resolveMentions,
  stripMentionsForNames,
} from '../../src/utils/mentionParser.js'

// 스펙 §4.3: 실제 파서가 추출하지 못한 `@{` 잔재는 sigil만 떼어 평문으로 낮춘다 — literal `@{`
// 가 scenes.json을 거쳐 Gemini/Veo 프롬프트 텍스트로 새지 않게. 경계(lead) 뒤의 후보만 대상.
const LEAD = MENTION_LEAD_CHAR_RE.source
const EMPTY_BRACE_RE = new RegExp(`(^|(?<=${LEAD}))@\\{[\\t ]*\\}`, 'gm')
const UNCLOSED_BRACE_RE = new RegExp(`(^|(?<=${LEAD}))@\\{(?=[^}\\n]*$)`, 'gm')

function stripMalformedBraceSigils(text) {
  return text.replace(EMPTY_BRACE_RE, '').replace(UNCLOSED_BRACE_RE, '')
}

function normalizeNames(names) {
  if (!Array.isArray(names)) return []
  const seen = new Set()
  const normalized = []
  for (const value of names) {
    if (typeof value !== 'string' || !value.trim()) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(value)
  }
  return normalized
}

/**
 * LLM prompt의 mention을 실제 renderer/engine 공용 parser로 검증한다.
 * unknown token은 Flow를 막지 않도록 이름 문자열만 남기고, required 누락은 push의
 * withMentions 호환 safety net이 보완할 수 있게 보고만 한다.
 */
export function validatePromptMentions(text, rosterNames = [], requiredNames = rosterNames) {
  const prompt = typeof text === 'string' ? text : ''
  try {
    const roster = normalizeNames(rosterNames)
    const required = normalizeNames(requiredNames)
    const references = roster.map((name) => ({ name }))

    // acceptance gate는 설명용 regex가 아니라 실제 소비자와 같은 함수(resolveMentions)를 사용한다.
    const resolved = resolveMentions(prompt, references)
    const unknown = resolved.missing || []
    let sanitized = unknown.length ? stripMentionsForNames(prompt, unknown) : prompt
    sanitized = stripMalformedBraceSigils(sanitized)
    const matched = new Set((resolved.matched || []).map((ref) => String(ref.name).toLowerCase()))
    const missing = required.filter((name) => formatMentionToken(name) && !matched.has(name.toLowerCase()))

    return { text: sanitized, unknown, missing }
  } catch {
    // LLM의 mention formatting miss는 prompts step 자체를 실패시키지 않는다.
    return { text: prompt, unknown: [], missing: [] }
  }
}
