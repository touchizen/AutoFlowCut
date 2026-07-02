/**
 * Story 파이프라인 — 낭독 시간 추정 + 오디오 이전 폴백 타이밍 (스펙 §4-②, §4-④ M1 폴백).
 * 상수는 스펙 §4-② 휴리스틱: ko ≈ 5.5자/초, en ≈ 15자/초.
 */
const CHARS_PER_SEC = { ko: 5.5, en: 15 }

export function estimateReadingSec(text, language) {
  const cps = CHARS_PER_SEC[language] || CHARS_PER_SEC.en
  const sec = (text || '').length / cps
  return Math.max(1, sec)
}

export function buildFallbackTimeline(scenes, language) {
  let cursor = 0
  return scenes.map((scene) => {
    const text = (scene.segments || []).map((s) => s.text || '').join('')
    const duration = estimateReadingSec(text, language)
    const entry = { storyId: scene.storyId, startTime: cursor, endTime: cursor + duration, duration }
    cursor += duration
    return entry
  })
}
