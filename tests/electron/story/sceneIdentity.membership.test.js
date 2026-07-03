import { describe, it, expect } from 'vitest'
import { assignStoryIdsByMembership } from '../../../electron/story/sceneIdentity.js'

describe('assignStoryIdsByMembership', () => {
  it('세그먼트 집합 동일 → storyId 승계', () => {
    const prev = [{ storyId: 'old-1', segmentIds: ['a', 'b'] }]
    const next = [{ segmentIds: ['a', 'b'], startMs: 0, endMs: 6000, durationMs: 6000 }]
    let n = 0
    const out = assignStoryIdsByMembership(prev, next, { randomUUID: () => `new-${++n}` })
    expect(out[0].storyId).toBe('old-1')
  })

  it('멤버십 변화(재그룹 경계 이동) → 신규 storyId', () => {
    const prev = [{ storyId: 'old-1', segmentIds: ['a', 'b'] }]
    const next = [
      { segmentIds: ['a'], startMs: 0, endMs: 3000, durationMs: 3000 },
      { segmentIds: ['b'], startMs: 3150, endMs: 6000, durationMs: 2850 },
    ]
    let n = 0
    const out = assignStoryIdsByMembership(prev, next, { randomUUID: () => `new-${++n}` })
    expect(out.map((s) => s.storyId)).toEqual(['new-1', 'new-2'])
  })

  it('결과 storyId 유일성 보장', () => {
    const prev = [
      { storyId: 'dup', segmentIds: ['a'] },
      { storyId: 'dup', segmentIds: ['b'] }, // 비정상 중복 입력
    ]
    const next = [{ segmentIds: ['a'] }, { segmentIds: ['b'] }]
    let n = 0
    const out = assignStoryIdsByMembership(prev, next, { randomUUID: () => `new-${++n}` })
    const ids = out.map((s) => s.storyId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
