/**
 * §v2.4 / §v2.8 M4: generateSynopsis 산출물 파싱 공용 헬퍼.
 * - LLM 출력 = 줄거리 줄글 + `CHARACTERS_JSON` 마커 + 등장인물 JSON 배열 (buildSynopsisPrompt 계약).
 * - 마커 없음/JSON 깨짐은 throw하지 않고 characters=[] 폴백(synopsisMd는 원문 유지).
 * - createSynopsisDeltaGate: 마커 이후(JSON 파편)를 onDelta로 흘리지 않는 스트리밍 게이트(M4).
 */
import { normalizeStoryCharacter } from '../../../src/services/storyCharacter.js'

export const CHARACTERS_MARKER = 'CHARACTERS_JSON'

// 텍스트에서 JSON 배열을 관대하게 추출·파싱해 storyCharacter로 정규화. 실패 시 [] (throw 금지).
export function parseCharactersJson(text) {
  let t = String(text || '').trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fence) t = fence[1].trim()
  const s = t.indexOf('[')
  const e = t.lastIndexOf(']')
  if (s < 0 || e <= s) return []
  try {
    const arr = JSON.parse(t.slice(s, e + 1))
    if (!Array.isArray(arr)) return []
    return arr.map(normalizeStoryCharacter).filter((c) => c.name.trim())
  } catch {
    return []
  }
}

// 전체 텍스트를 마커 기준으로 { synopsisMd, characters }로 분리.
export function splitSynopsisOutput(fullText) {
  const text = String(fullText || '')
  const idx = text.indexOf(CHARACTERS_MARKER)
  if (idx < 0) return { synopsisMd: text, characters: [] }
  return {
    synopsisMd: text.slice(0, idx).trimEnd(),
    characters: parseCharactersJson(text.slice(idx + CHARACTERS_MARKER.length)),
  }
}

// 델타 꼬리가 마커의 접두어와 겹치는 길이(부분 마커 유출 방지용 hold-back).
function partialMarkerSuffixLen(s) {
  const max = Math.min(CHARACTERS_MARKER.length - 1, s.length)
  for (let k = max; k > 0; k -= 1) {
    if (s.endsWith(CHARACTERS_MARKER.slice(0, k))) return k
  }
  return 0
}

/**
 * M4 스트리밍 계약: synopsisMd만 델타로 노출한다. 마커가 나타나면 그 앞까지만
 * 방출하고 이후 델타는 무시(누락분은 완료 시 최종 synopsisMd가 보정).
 * onDelta가 없으면 undefined 반환(호출부는 그대로 전달).
 */
export function createSynopsisDeltaGate(onDelta) {
  if (!onDelta) return undefined
  let buf = ''
  let stopped = false
  return (delta) => {
    if (stopped) return
    buf += delta
    const idx = buf.indexOf(CHARACTERS_MARKER)
    if (idx >= 0) {
      stopped = true
      if (idx > 0) onDelta(buf.slice(0, idx))
      return
    }
    const keep = partialMarkerSuffixLen(buf)
    const emit = buf.slice(0, buf.length - keep)
    if (emit) onDelta(emit)
    buf = buf.slice(buf.length - keep)
  }
}
