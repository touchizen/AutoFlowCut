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

export function assertUniqueStoryIds(scenes) {
  const seen = new Set()
  for (const s of scenes) {
    if (seen.has(s.storyId)) throw new Error(`duplicate storyId: ${s.storyId}`)
    seen.add(s.storyId)
  }
}
