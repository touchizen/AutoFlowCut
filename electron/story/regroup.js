/**
 * 세그먼트 시퀀스 → 목표 6~10초 씬 그룹. 스펙 §4.
 * 순서 보존, 세그먼트 안 쪼갬. 누적 minMs 도달 시 마감. 다음 추가가 maxMs 초과면 먼저 마감.
 * 단일 세그먼트가 maxMs 초과면 단독 씬.
 */
export function regroupScenes(segments, { minMs = 6000, maxMs = 10000 } = {}) {
  const scenes = []
  let cur = []
  let curMs = 0

  const flush = () => {
    if (!cur.length) return
    const first = cur[0]
    const last = cur[cur.length - 1]
    const startMs = first.startMs || 0
    const endMs = (last.startMs || 0) + (last.durationMs || 0)
    scenes.push({ segmentIds: cur.map((s) => s.id), startMs, endMs, durationMs: endMs - startMs })
    cur = []
    curMs = 0
  }

  for (const s of segments) {
    const dur = s.durationMs || 0
    // 현재 씬에 이미 세그먼트가 있고, 추가 시 maxMs 초과 예상이면 먼저 마감
    if (cur.length && curMs + dur > maxMs) flush()
    cur.push(s)
    curMs += dur
    // 목표 하한 도달 → 마감
    if (curMs >= minMs) flush()
  }
  flush()
  return scenes
}
