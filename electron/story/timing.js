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

/** 세그먼트 순서대로 gap 포함 누적 startMs 부여 (원본 불변). 스펙 §5-3. */
export function buildSegmentTimeline(segments, { gapMs = 150 } = {}) {
  let cursor = 0
  return segments.map((s) => {
    const startMs = cursor
    cursor = startMs + (s.durationMs || 0) + gapMs
    return { ...s, startMs }
  })
}

/** 세그먼트 id → SRT 라인 id (결정론적, 스펙 §7 흐름 A). */
export function srtLineId(segmentId) {
  return `sub_${segmentId}`
}

function fmtSrtTime(ms) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const x = ms % 1000
  const p2 = (n) => String(n).padStart(2, '0')
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(x).padStart(3, '0')}`
}

/** narration 세그먼트만 SRT 라인화 (sfx 제외). startMs 필요(buildSegmentTimeline 선행). 스펙 §5-4. */
export function buildSrt(segments) {
  let out = ''
  let idx = 1
  for (const s of segments) {
    if (s.type && s.type !== 'narration') continue
    const text = (s.text || '').trim()
    if (!text) continue
    const start = s.startMs || 0
    const end = start + (s.durationMs || 0)
    out += `${idx}\n${fmtSrtTime(start)} --> ${fmtSrtTime(end)}\n${text}\n\n`
    idx++
  }
  return out.trim()
}
