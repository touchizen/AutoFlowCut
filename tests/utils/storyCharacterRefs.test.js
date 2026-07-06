/**
 * V2: 스토리 캐릭터(name, appearance) → Ref 탭 character 카드 upsert. type-aware, numeric id.
 */
import { describe, it, expect } from 'vitest'
import { upsertStoryCharacterRefs, assertStoryProjectCurrent } from '../../src/utils/storyCharacterRefs.js'

const charRef = (id, name, over = {}) => ({ id, name, type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: 'old', status: 'done', data: 'DATA', filePath: '/p.png', ...over })

describe('upsertStoryCharacterRefs', () => {
  it('신규 캐릭터를 전체 기본 필드 + numeric id + status:pending으로 추가', () => {
    const { references, collisions } = upsertStoryCharacterRefs([], [{ name: '민수', appearance: 'tall man' }])
    expect(collisions).toEqual([])
    expect(references).toHaveLength(1)
    const r = references[0]
    expect(r).toMatchObject({ name: '민수', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: 'tall man', status: 'pending', data: null, mediaId: null, caption: '', imagePath: '' })
    expect(typeof r.id).toBe('number')
  })

  it('numeric id는 기존 최대 id + 1부터(문자열/NaN 유발 안 함)', () => {
    const existing = [charRef(5, '기존A', { type: 'style' })]
    const { references } = upsertStoryCharacterRefs(existing, [{ name: '민수', appearance: 'x' }, { name: '서준', appearance: 'y' }])
    const added = references.filter((r) => r.type === 'character')
    expect(added.map((r) => r.id).sort((a, b) => a - b)).toEqual([6, 7])
  })

  it('동명 character 카드는 보존(status/data/filePath/prompt 불변 — 사용자 생성분 안 덮음)', () => {
    const existing = [charRef(3, '민수')]
    const { references } = upsertStoryCharacterRefs(existing, [{ name: '민수', appearance: 'new appearance' }])
    expect(references).toHaveLength(1)
    expect(references[0]).toMatchObject({ id: 3, prompt: 'old', status: 'done', data: 'DATA' })
  })

  it('먼저 만든 name-only pending 카드는 나중에 appearance가 오면 prompt를 보강한다', () => {
    const existing = [{ id: 3, name: '민수', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: '', status: 'pending', data: null, filePath: '', mediaId: null }]
    const { references } = upsertStoryCharacterRefs(existing, [{ name: '민수', appearance: 'tall man in black coat' }])
    expect(references).toHaveLength(1)
    expect(references[0]).toMatchObject({ id: 3, prompt: 'tall man in black coat', status: 'pending' })
  })

  it('동명 비-character(scene/style)면 추가 안 하고 collision 반환', () => {
    const existing = [charRef(2, '민수', { type: 'scene' })]
    const { references, collisions } = upsertStoryCharacterRefs(existing, [{ name: '민수', appearance: 'x' }])
    expect(references).toHaveLength(1) // 추가 안 됨
    expect(references[0].type).toBe('scene') // 기존 그대로
    expect(collisions).toEqual(['민수'])
  })

  it('빈 storyCharacters면 원본 그대로', () => {
    const existing = [charRef(1, 'A')]
    const { references, collisions } = upsertStoryCharacterRefs(existing, [])
    expect(references).toBe(existing)
    expect(collisions).toEqual([])
  })

  it('null-safe', () => {
    expect(upsertStoryCharacterRefs(null, null).references).toEqual([])
  })

  it('현재 story project path가 enqueue 시점과 같으면 stale guard를 통과한다', () => {
    expect(() => assertStoryProjectCurrent('/p/a', '/p/a', 'stale')).not.toThrow()
  })

  it('await 이후 프로젝트가 바뀌었으면 stale push로 실패시킨다', () => {
    expect(() => assertStoryProjectCurrent('/p/b', '/p/a', 'stale story push discarded')).toThrow(/stale story push/)
  })
})
