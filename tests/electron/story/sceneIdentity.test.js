import { describe, it, expect } from 'vitest'
import { normalizeSceneText, inheritStoryIds, assertUniqueStoryIds } from '../../../electron/story/sceneIdentity.js'

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

describe('assertUniqueStoryIds', () => {
  it('중복 storyId면 throw', () => {
    expect(() => assertUniqueStoryIds([{ storyId: 'x' }, { storyId: 'x' }])).toThrow()
    expect(() => assertUniqueStoryIds([{ storyId: 'x' }, { storyId: 'y' }])).not.toThrow()
  })
})
