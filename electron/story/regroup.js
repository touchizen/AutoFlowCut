/**
 * 세그먼트 시퀀스 → 목표 6~10초 씬 그룹. 스펙 §4.
 * 순서 보존, 세그먼트 안 쪼갬. 누적 minMs 도달 시 마감. 다음 추가가 maxMs 초과면 먼저 마감.
 * 단일 세그먼트가 maxMs 초과면 단독 씬.
 *
 * MED7: 두 가지를 span(gap 포함 실제 wall-clock 구간) 기준으로 고친다 —
 * (1) durationMs 합(gap 150ms 제외)이 아니라 startMs 기반 실제 span으로 min/max 판정.
 * (2) 화자 변경 경계 존중 — 현재 씬이 이미 minMs에 도달했고 다음 세그먼트 화자가 다르면
 *     추가 전에 마감한다. minMs 미만이면 화자가 바뀌어도 마감하지 않는다(짧은 씬 난사 방지).
 */
export function regroupScenes(segments, { minMs = 6000, maxMs = 10000 } = {}) {
  const scenes = []
  let cur = []

  // cur의 실제 span(첫 세그먼트 startMs ~ 마지막 세그먼트 endMs, gap 포함).
  // upTo가 주어지면 cur에 아직 없는 그 세그먼트까지 포함했다고 가정한 예상 span.
  const span = (list, upTo) => {
    const first = list[0]
    const last = upTo || list[list.length - 1]
    return (last.startMs || 0) + (last.durationMs || 0) - (first.startMs || 0)
  }

  const flush = () => {
    if (!cur.length) return
    const first = cur[0]
    const last = cur[cur.length - 1]
    const startMs = first.startMs || 0
    const endMs = (last.startMs || 0) + (last.durationMs || 0)
    scenes.push({ segmentIds: cur.map((s) => s.id), startMs, endMs, durationMs: endMs - startMs })
    cur = []
  }

  for (const s of segments) {
    if (cur.length) {
      const last = cur[cur.length - 1]
      const speakerChanged = s.speaker !== last.speaker
      if (speakerChanged && span(cur) >= minMs) {
        // 화자 변경 경계 존중: 이미 목표 하한 도달 → 다음(다른 화자) 세그먼트 추가 전 마감
        flush()
      } else if (span(cur, s) > maxMs) {
        // 다음 세그먼트를 추가하면 실제 span(gap 포함)이 maxMs 초과 예상 → 먼저 마감
        flush()
      }
    }
    cur.push(s)
    if (span(cur) >= minMs) flush()
  }
  flush()
  return scenes
}
