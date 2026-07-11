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

  // 신규 카드는 구조화 필드(age/gender)를 프롬프트에 담는다 — 이게 빠져서 레퍼런스 이미지가
  // 성별·연령을 잃었다.
  it('신규 카드 prompt에 age와 gender가 들어간다', () => {
    const { references } = upsertStoryCharacterRefs([], [
      { name: '준호', ethnicity: '한국인', age: '40대 초', gender: 'male', appearance: 'weathered face' },
    ])
    expect(references[0].prompt).toBe('한국인, 40대 초, male, weathered face')
  })

  // 이미 프롬프트가 박힌 카드는 갱신되지 않아(사용자 편집 보존), 기존 에피소드는 age/gender가
  // 영영 빠진 채로 남는다. 구 규칙(`ethnicity, appearance`)이 만든 값과 정확히 일치하면
  // "자동생성 후 손대지 않음"이므로 안전하게 갱신할 수 있다.
  it('구 규칙으로 자동생성된 pending 카드의 prompt를 새 규칙으로 복구한다', () => {
    const c = { name: '준호', ethnicity: '한국인', age: '40대 초', gender: 'male', appearance: 'weathered face' }
    const existing = [{ id: 3, name: '준호', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: '한국인, weathered face', status: 'pending', data: null, filePath: '', mediaId: null }]
    const { references } = upsertStoryCharacterRefs(existing, [c])
    expect(references[0].prompt).toBe('한국인, 40대 초, male, weathered face')
  })

  it('사용자가 손댄 prompt는 복구하지 않는다', () => {
    const c = { name: '준호', ethnicity: '한국인', age: '40대 초', gender: 'male', appearance: 'weathered face' }
    const existing = [{ id: 3, name: '준호', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: '내가 직접 쓴 프롬프트', status: 'pending', data: null, filePath: '', mediaId: null }]
    const { references } = upsertStoryCharacterRefs(existing, [c])
    expect(references[0].prompt).toBe('내가 직접 쓴 프롬프트')
  })

  // 갱신본을 이름으로 되꽂으면, 같은 이름의 다른 ref(스타일/씬 카드)까지 캐릭터 카드로 덮인다.
  it('동명의 비-character ref가 있어도 그 카드를 캐릭터 카드로 덮어쓰지 않는다', () => {
    const c = { name: '민수', ethnicity: '한국인', age: '40대', gender: 'male', appearance: 'tall man' }
    const styleRef = { id: 1, name: '민수', type: 'style', prompt: '수채화 스타일', status: 'done', data: 'STYLE' }
    const charRef = { id: 2, name: '민수', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: '한국인, tall man', status: 'pending', data: null, filePath: '', mediaId: null }
    const { references } = upsertStoryCharacterRefs([styleRef, charRef], [c])
    expect(references).toHaveLength(2)
    expect(references[0]).toMatchObject({ id: 1, type: 'style', prompt: '수채화 스타일' })
    expect(references[1]).toMatchObject({ id: 2, type: 'character', prompt: '한국인, 40대, male, tall man' })
  })

  it('이미 이미지가 생성된 카드는 구 규칙 prompt라도 건드리지 않는다', () => {
    const c = { name: '준호', ethnicity: '한국인', age: '40대 초', gender: 'male', appearance: 'weathered face' }
    const existing = [{ id: 3, name: '준호', type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt: '한국인, weathered face', status: 'done', data: 'DATA', filePath: '', mediaId: null }]
    const { references } = upsertStoryCharacterRefs(existing, [c])
    expect(references[0].prompt).toBe('한국인, weathered face')
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
