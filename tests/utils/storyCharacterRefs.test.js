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

  // §v2.12 A: Ref 카드 prompt = `${ethnicity}, ${appearance}` 조합 — 캐릭터 이미지가 인종/출신을 반영.
  it('§v2.12: ethnicity가 있으면 신규 카드 prompt를 "ethnicity, appearance"로 조합한다', () => {
    const { references } = upsertStoryCharacterRefs([], [{ name: '민수', ethnicity: 'Korean', appearance: 'tall man' }])
    expect(references[0].prompt).toBe('Korean, tall man')
  })

  it('§v2.12: ethnicity가 빈 값이면 appearance만(현행 동일, 앞에 콤마 없음)', () => {
    const { references } = upsertStoryCharacterRefs([], [{ name: '민수', ethnicity: '', appearance: 'tall man' }])
    expect(references[0].prompt).toBe('tall man')
  })

  it('§v2.12: appearance 없이 ethnicity만 있으면 뒤 콤마 없이 ethnicity만', () => {
    const { references } = upsertStoryCharacterRefs([], [{ name: '민수', ethnicity: '한국인', appearance: '' }])
    expect(references[0].prompt).toBe('한국인')
  })

  it('§v2.12: name-only pending 카드의 prompt 보강도 ethnicity 조합을 쓴다', () => {
    const existing = [{ id: 3, name: '민수', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: '', status: 'pending', data: null, filePath: '', mediaId: null }]
    const { references } = upsertStoryCharacterRefs(existing, [{ name: '민수', ethnicity: 'Korean', appearance: 'tall man' }])
    expect(references[0]).toMatchObject({ id: 3, prompt: 'Korean, tall man', status: 'pending' })
  })

  // §v2.12 코드리뷰 FIX(MINOR): 보강 조건이 c.appearance truthy에 묶여 있으면
  // ethnicity-only 캐릭터({ethnicity:'Korean', appearance:''})가 pending 카드 prompt를 못 채운다.
  it('§v2.12 FIX: ethnicity-only 캐릭터도 name-only pending 카드 prompt를 보강한다', () => {
    const existing = [{ id: 3, name: '민수', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: '', status: 'pending', data: null, filePath: '', mediaId: null }]
    const { references } = upsertStoryCharacterRefs(existing, [{ name: '민수', ethnicity: 'Korean', appearance: '' }])
    expect(references[0]).toMatchObject({ id: 3, prompt: 'Korean', status: 'pending' })
  })

  it('§v2.12 FIX: ethnicity/appearance 둘 다 빈 값이면 pending 카드 prompt를 건드리지 않는다(회귀 고정)', () => {
    const existing = [{ id: 3, name: '민수', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: '', status: 'pending', data: null, filePath: '', mediaId: null }]
    const { references } = upsertStoryCharacterRefs(existing, [{ name: '민수', ethnicity: '', appearance: '' }])
    expect(references[0].prompt).toBe('')
  })

  it('§v2.12: 동명 character 카드(사용자 prompt 보유)는 ethnicity가 와도 덮지 않는다(idempotency)', () => {
    const existing = [charRef(3, '민수')]
    const { references } = upsertStoryCharacterRefs(existing, [{ name: '민수', ethnicity: 'Korean', appearance: 'new look' }])
    expect(references).toHaveLength(1)
    expect(references[0].prompt).toBe('old')
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
