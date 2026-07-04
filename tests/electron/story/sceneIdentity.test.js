import { describe, it, expect } from 'vitest'
import { normalizeSceneText, inheritStoryIds, assertUniqueStoryIds, inheritSegmentIds } from '../../../electron/story/sceneIdentity.js'

const scene = (storyId, ...texts) => ({ storyId, segments: texts.map((t) => ({ text: t })) })

describe('normalizeSceneText', () => {
  it('공백/문장부호 제거 + 소문자', () => {
    expect(normalizeSceneText(scene(null, 'Hello, World!', ' 안녕 하세요. '))).toBe('helloworld안녕하세요')
  })
})

describe('inheritStoryIds', () => {
  it('텍스트 동일 씬은 storyId 승계', () => {
    const prev = [scene('u1', '첫 장면'), scene('u2', '둘째 장면')]
    const next = [scene(null, '첫 장면'), scene(null, '둘째 장면')]
    const r = inheritStoryIds(prev, next)
    expect(r.scenes[0].storyId).toBe('u1')
    expect(r.scenes[1].storyId).toBe('u2')
    expect(r.unmatched.prev).toEqual([])
  })
  it('앞에 씬이 삽입돼도 뒤 씬 id가 밀리지 않는다', () => {
    const prev = [scene('u1', '기존 장면')]
    const next = [scene(null, '새 도입부'), scene(null, '기존 장면')]
    const r = inheritStoryIds(prev, next)
    expect(r.scenes[1].storyId).toBe('u1')
    expect(r.scenes[0].storyId).toMatch(/^[0-9a-f-]{36}$/)  // 새 uuid
    expect(r.unmatched.next).toEqual([0])
  })
  it('분할(다중 매칭)이면 자동 승계하지 않는다', () => {
    const prev = [scene('u1', '문장A 문장B')]
    const next = [scene(null, '문장A'), scene(null, '문장B')]  // 둘 다 u1에 포함됨
    const r = inheritStoryIds(prev, next)
    expect(r.scenes[0].storyId).not.toBe('u1')
    expect(r.scenes[1].storyId).not.toBe('u1')
    expect(r.unmatched.prev).toEqual(['u1'])
  })
  it('병합(역방향 다중 매칭)도 자동 승계하지 않는다', () => {
    const prev = [scene('u1', '문장A'), scene('u2', '문장B')]
    const next = [scene(null, '문장A 문장B')]
    const r = inheritStoryIds(prev, next)
    expect(['u1', 'u2']).not.toContain(r.scenes[0].storyId)
    expect(r.unmatched.prev.sort()).toEqual(['u1', 'u2'])
  })
})

describe('inheritSegmentIds', () => {
  // IP4(M2a-2b): ② 재실행 시 splitScenes는 세그먼트 id 없이 반환한다 — 정규화 텍스트 1:1 매칭으로
  // 이전 세그먼트 id를 승계해야 위치기반 재발급 드리프트를 막고, storyId 멤버십(세그먼트 id 집합)이
  // 안정된다. 미매칭 세그먼트는 id 미부여(assignSegmentIds가 위치기반으로 채움).
  const sc = (...segs) => ({ segments: segs })

  it('텍스트 동일 세그먼트는 id 승계', () => {
    const prev = [sc({ id: 's1-1', text: '첫 문장' }, { id: 's1-2', text: '둘째 문장' })]
    const next = [sc({ text: '첫 문장' }, { text: '둘째 문장' })]
    const r = inheritSegmentIds(prev, next)
    expect(r.scenes[0].segments[0].id).toBe('s1-1')
    expect(r.scenes[0].segments[1].id).toBe('s1-2')
  })

  it('세그먼트 삽입 시 뒤 세그먼트 id가 밀리지 않는다', () => {
    const prev = [sc({ id: 's1-1', text: '기존 문장' })]
    const next = [sc({ text: '새 문장' }, { text: '기존 문장' })]
    const r = inheritSegmentIds(prev, next)
    expect(r.scenes[0].segments[1].id).toBe('s1-1')
    expect(r.scenes[0].segments[0].id).toBeUndefined()  // assignSegmentIds가 채움
  })

  it('여러 씬에 걸쳐 재그룹돼도 세그먼트 id를 텍스트로 승계한다', () => {
    const prev = [sc({ id: 's1-1', text: '가' }, { id: 's1-2', text: '나' }), sc({ id: 's2-1', text: '다' })]
    const next = [sc({ text: '가' }), sc({ text: '나' }, { text: '다' })]  // 재그룹으로 씬 경계 이동
    const r = inheritSegmentIds(prev, next)
    expect(r.scenes[0].segments[0].id).toBe('s1-1')
    expect(r.scenes[1].segments[0].id).toBe('s1-2')
    expect(r.scenes[1].segments[1].id).toBe('s2-1')
  })

  it('중복/모호 텍스트는 승계하지 않는다(1:1 아님)', () => {
    const prev = [sc({ id: 's1-1', text: '같은 문장' }, { id: 's1-2', text: '같은 문장' })]
    const next = [sc({ text: '같은 문장' })]
    const r = inheritSegmentIds(prev, next)
    expect(r.scenes[0].segments[0].id).toBeUndefined()
  })
})

describe('assertUniqueStoryIds', () => {
  it('중복 storyId면 throw', () => {
    expect(() => assertUniqueStoryIds([{ storyId: 'x' }, { storyId: 'x' }])).toThrow()
    expect(() => assertUniqueStoryIds([{ storyId: 'x' }, { storyId: 'y' }])).not.toThrow()
  })
})
