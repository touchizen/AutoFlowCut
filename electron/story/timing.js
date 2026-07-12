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

/** 세그먼트 순서대로 누적 startMs 부여 (원본 불변). gapMs를 주면 클립 사이에 명시적 빈 구간을 둔다. */
export function buildSegmentTimeline(segments, { gapMs = 0 } = {}) {
  let cursor = 0
  return segments.map((s) => {
    const startMs = cursor
    cursor = startMs + (s.durationMs || 0) + gapMs
    return { ...s, startMs }
  })
}

/**
 * image-first fixed slot clock. Slot identity/order/membership은 그대로 두고 각 slot 시작에서
 * segment cursor를 다시 앵커한다. 반환한 flat segments가 SRT/manifest의 단일 timing source다.
 */
export function buildFixedSlotTimeline(scenes, { variant } = {}) {
  let sceneStartMs = 0
  const segments = []
  const timedScenes = (scenes || []).map((scene) => {
    const sourceSegments = Array.isArray(scene?.segments) ? scene.segments : []
    const audioSpanMs = sourceSegments.reduce((sum, segment) => sum + (segment.durationMs || 0), 0)
    const visualOnly = !sourceSegments.some((segment) => (segment.type || 'narration') === 'narration')
    const effectiveMs = visualOnly
      ? scene.plannedMs
      : variant === 'image-only'
        ? audioSpanMs + 300
        : scene.plannedMs == null
          ? audioSpanMs + 300
          : Math.max(scene.plannedMs, audioSpanMs + 300)

    let segmentOffsetMs = 0
    const timedSegments = sourceSegments.map((segment) => {
      const timed = { ...segment, startMs: sceneStartMs + segmentOffsetMs }
      segmentOffsetMs += segment.durationMs || 0
      segments.push(timed)
      return timed
    })
    const timedScene = {
      ...scene,
      startSec: sceneStartMs / 1000,
      endSec: (sceneStartMs + effectiveMs) / 1000,
      segments: timedSegments,
    }
    sceneStartMs += effectiveMs
    return timedScene
  })
  return { scenes: timedScenes, segments }
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
