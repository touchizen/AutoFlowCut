/**
 * Story 씬 identity — 스펙 §4-④. identity는 storyId(uuid) 단 하나.
 * ② 재실행 시 이전 scenes.json과 보수적 1:1 매칭으로 승계:
 * 정규화 텍스트 완전/포함 일치 && 상호 유일 매칭일 때만 자동 승계.
 * 분할(1 prev → N next) / 병합(N prev → 1 next)처럼 다중 매칭이면 승계하지 않고 새 uuid 발급.
 */
import { randomUUID } from 'node:crypto'

export function normalizeSceneText(scene) {
  return (scene.segments || [])
    .map((s) => s.text || '')
    .join('')
    .toLowerCase()
    .replace(/[\s.,!?'"…—–\-()[\]{}:;]/g, '')
}

function textsMatch(a, b) {
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
}

export function inheritStoryIds(prevScenes, nextScenes) {
  const prevNorm = prevScenes.map((s) => ({ id: s.storyId, text: normalizeSceneText(s) }))
  const nextNorm = nextScenes.map((s) => normalizeSceneText(s))

  // next[i]가 승계 가능한 prev id 후보 목록
  const candidatesByNext = nextNorm.map((nt) => prevNorm.filter((p) => textsMatch(p.text, nt)).map((p) => p.id))
  // prev id를 후보로 원하는 next 개수 (1:1 상호 유일성 검증용)
  const nextCountByPrev = new Map(prevNorm.map((p) => [p.id, 0]))
  for (const cands of candidatesByNext) {
    for (const id of cands) nextCountByPrev.set(id, nextCountByPrev.get(id) + 1)
  }

  const usedPrev = new Set()
  const unmatchedNext = []
  const scenes = nextScenes.map((s, i) => {
    const cands = candidatesByNext[i]
    const canInherit = cands.length === 1 && nextCountByPrev.get(cands[0]) === 1
    if (canInherit) {
      usedPrev.add(cands[0])
      return { ...s, storyId: cands[0] }
    }
    unmatchedNext.push(i)
    return { ...s, storyId: randomUUID() }
  })

  const unmatchedPrev = prevNorm.map((p) => p.id).filter((id) => !usedPrev.has(id))

  return { scenes, unmatched: { prev: unmatchedPrev, next: unmatchedNext } }
}

/** 단일 세그먼트 텍스트 정규화 (inheritSegmentIds용). normalizeSceneText의 세그먼트 버전. */
export function normalizeSegmentText(seg) {
  return (seg?.text || '')
    .toLowerCase()
    .replace(/[\s.,!?'"…—–\-()[\]{}:;]/g, '')
}

/**
 * IP4(M2a-2b) — 세그먼트 id 승계. 스펙 §4: ② 재실행 시 splitScenes는 id 없이 반환하므로,
 * 이전 scenes.json 세그먼트와 정규화 텍스트 완전/포함 일치 + 1:1 상호 유일 매칭일 때만 id 승계.
 * 씬 경계를 넘어 전역 매칭(재그룹으로 씬이 재구성돼도 세그먼트 identity 보존). 미매칭은 id 미부여
 * (assignSegmentIds가 위치기반으로 채움). 이로써 storyId 멤버십(세그먼트 id 집합)이 재실행에 안정.
 */
export function inheritSegmentIds(prevScenes, nextScenes) {
  const prevSegs = (prevScenes || [])
    .flatMap((s) => s.segments || [])
    .filter((g) => g.id)
    .map((g) => ({ id: g.id, text: normalizeSegmentText(g) }))
  // next 세그먼트를 씬 순서·세그먼트 순서로 평탄화한 정규화 텍스트 (전역 인덱스)
  const nextNorm = (nextScenes || []).flatMap((s) => (s.segments || []).map((g) => normalizeSegmentText(g)))

  const candidatesByNext = nextNorm.map((nt) => prevSegs.filter((p) => textsMatch(p.text, nt)).map((p) => p.id))
  const nextCountByPrev = new Map(prevSegs.map((p) => [p.id, 0]))
  for (const cands of candidatesByNext) {
    for (const id of cands) nextCountByPrev.set(id, nextCountByPrev.get(id) + 1)
  }

  const usedPrev = new Set()
  let idx = 0
  const scenes = (nextScenes || []).map((s) => ({
    ...s,
    segments: (s.segments || []).map((g) => {
      const cands = candidatesByNext[idx]
      idx++
      const canInherit = cands.length === 1 && nextCountByPrev.get(cands[0]) === 1 && !usedPrev.has(cands[0])
      if (canInherit) {
        usedPrev.add(cands[0])
        return { ...g, id: cands[0] }
      }
      return g  // 미매칭 — id 미부여
    }),
  }))
  return { scenes }
}

export function assertUniqueStoryIds(scenes) {
  const seen = new Set()
  for (const s of scenes) {
    if (seen.has(s.storyId)) throw new Error(`duplicate storyId: ${s.storyId}`)
    seen.add(s.storyId)
  }
}

/**
 * 멤버십(세그먼트 id 집합) 기반 storyId 발급 — 스펙 §4.
 * 이전 씬과 집합 완전 동일 → 승계, 아니면 신규 uuid. 결과 유일성 보장.
 */
export function assignStoryIdsByMembership(prevScenes, nextGroups, { randomUUID: uuid = randomUUID } = {}) {
  const keyOf = (ids) => [...ids].sort().join('|')
  const prevByKey = new Map((prevScenes || []).map((s) => [keyOf(s.segmentIds || []), s.storyId]))
  const used = new Set()
  return nextGroups.map((g) => {
    let storyId = prevByKey.get(keyOf(g.segmentIds || []))
    if (!storyId || used.has(storyId)) storyId = uuid()
    while (used.has(storyId)) storyId = uuid() // 유일성 보장
    used.add(storyId)
    return { ...g, storyId }
  })
}
