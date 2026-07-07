import { describe, it, expect } from 'vitest'
import { normalizeStoryCharacter, resolveCharacterGender, characterVisualPrompt } from '../../src/services/storyCharacter'

// §v2.2/§v2.12 storyCharacter 구조화 스키마: { id, name, gender, age, role, ethnicity, appearance }
// - id = name.trim() (별도 slug 없음 — seg.speaker의 String(x).trim() 관례와 정합, §v2.9 MINOR①)
// - 기본값: gender 'unknown', age/role/ethnicity/appearance ''
// - 하위호환: 기존 speaker/character(gender/age/role/ethnicity 없음)를 읽을 때 기본값 채움
describe('normalizeStoryCharacter', () => {
  it('완전한 캐릭터는 그대로 통과한다', () => {
    const c = normalizeStoryCharacter({
      id: '강리안', name: '강리안', gender: 'female', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'young woman, elegant',
    })
    expect(c).toEqual({
      id: '강리안', name: '강리안', gender: 'female', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'young woman, elegant',
    })
  })

  it('§v2.12: ethnicity 기본값은 빈 문자열(하위호환 — 기존 speaker에 없으면 "")', () => {
    expect(normalizeStoryCharacter({ name: '리안' }).ethnicity).toBe('')
    expect(normalizeStoryCharacter({ name: '리안', ethnicity: null }).ethnicity).toBe('')
    expect(normalizeStoryCharacter({ name: '리안', ethnicity: 42 }).ethnicity).toBe('')
  })

  it('§v2.12: ethnicity 자유값("한국인"/"Korean" 등)을 보존한다', () => {
    expect(normalizeStoryCharacter({ name: '리안', ethnicity: 'Korean' }).ethnicity).toBe('Korean')
    expect(normalizeStoryCharacter({ name: '리안', ethnicity: 'East Asian' }).ethnicity).toBe('East Asian')
  })

  it('id가 없으면 name.trim()으로 파생한다 (§v2.9 MINOR①)', () => {
    const c = normalizeStoryCharacter({ name: ' 강리안 ' })
    expect(c.id).toBe('강리안')
    expect(c.name).toBe(' 강리안 ')
  })

  it('기존 speaker의 id는 보존한다 (하위호환 — id 재파생 금지)', () => {
    const c = normalizeStoryCharacter({ id: 'rian', name: '강리안', appearance: 'young woman' })
    expect(c.id).toBe('rian')
  })

  it('하위호환: gender/age/role 없는 기존 speaker는 기본값을 채운다', () => {
    const c = normalizeStoryCharacter({ id: 'rian', name: '강리안', appearance: 'young woman', voice: null })
    expect(c.gender).toBe('unknown')
    expect(c.age).toBe('')
    expect(c.role).toBe('')
    expect(c.appearance).toBe('young woman')
  })

  it('gender는 male/female/unknown enum만 허용 — 그 외 값은 unknown으로 정규화', () => {
    expect(normalizeStoryCharacter({ name: 'a', gender: 'male' }).gender).toBe('male')
    expect(normalizeStoryCharacter({ name: 'a', gender: 'female' }).gender).toBe('female')
    expect(normalizeStoryCharacter({ name: 'a', gender: 'unknown' }).gender).toBe('unknown')
    expect(normalizeStoryCharacter({ name: 'a', gender: '여성' }).gender).toBe('unknown')
    expect(normalizeStoryCharacter({ name: 'a', gender: null }).gender).toBe('unknown')
  })

  it('age/role/appearance 비문자열은 빈 문자열로 정규화', () => {
    const c = normalizeStoryCharacter({ name: 'a', age: 20, role: null, appearance: undefined })
    expect(c.age).toBe('')
    expect(c.role).toBe('')
    expect(c.appearance).toBe('')
  })

  it('입력이 null/undefined여도 안전한 기본 스키마를 반환한다', () => {
    const c = normalizeStoryCharacter(null)
    expect(c).toEqual({ id: '', name: '', gender: 'unknown', age: '', role: '', ethnicity: '', appearance: '' })
  })
})

// §v2.12 코드리뷰 FIX: characterVisualPrompt — Ref 카드 prompt와 씬 프롬프트 컨텍스트가 공유하는
// `${ethnicity}, ${appearance}` 조합 규칙(빈 쪽 콤마 생략). truthy ⇔ ethnicity/appearance 중
// 하나라도 있음 — 씬 포함 기준으로도 쓰인다.
describe('characterVisualPrompt', () => {
  it('ethnicity + appearance → "ethnicity, appearance"', () => {
    expect(characterVisualPrompt({ ethnicity: 'Korean', appearance: 'tall man' })).toBe('Korean, tall man')
  })

  it('appearance만 → appearance(앞 콤마 없음)', () => {
    expect(characterVisualPrompt({ ethnicity: '', appearance: 'tall man' })).toBe('tall man')
    expect(characterVisualPrompt({ appearance: 'tall man' })).toBe('tall man')
  })

  it('ethnicity만 → ethnicity(뒤 콤마 없음)', () => {
    expect(characterVisualPrompt({ ethnicity: '한국인', appearance: '' })).toBe('한국인')
  })

  it('둘 다 빈 값/공백이면 빈 문자열(포함 기준 falsy)', () => {
    expect(characterVisualPrompt({ ethnicity: '', appearance: '' })).toBe('')
    expect(characterVisualPrompt({ ethnicity: '  ', appearance: '  ' })).toBe('')
  })

  it('null-safe + 비문자열 무시', () => {
    expect(characterVisualPrompt(null)).toBe('')
    expect(characterVisualPrompt({ ethnicity: 42, appearance: null })).toBe('')
  })
})

// §v2.8 M5 / §v2.11 / m1: 오디오 탭 성우 추천의 성별 소스 우선순위.
// 캐릭터 gender 확정값(male/female)이 상위 소스, unknown/없음이면
// guessGenderFromAppearance(appearance) 폴백(→ null 가능, null=배지 없음).
describe('resolveCharacterGender', () => {
  it('gender 확정값 female이면 appearance가 남성 단서여도 female (확정값 우선)', () => {
    expect(resolveCharacterGender({ gender: 'female', appearance: '28-year-old man, short dark hair' })).toBe('female')
  })

  it('gender 확정값 male이면 appearance가 여성 단서여도 male', () => {
    expect(resolveCharacterGender({ gender: 'male', appearance: 'young woman, elegant' })).toBe('male')
  })

  it("gender 'unknown'이면 appearance 폴백 (여성 단서 → female)", () => {
    expect(resolveCharacterGender({ gender: 'unknown', appearance: 'young woman, elegant' })).toBe('female')
  })

  it('gender 필드가 없으면(기존 speaker) appearance 폴백', () => {
    expect(resolveCharacterGender({ appearance: 'young man, tall' })).toBe('male')
  })

  it('gender unknown + appearance 단서 없음 → null (m1: unknown 아님, 배지 없음)', () => {
    expect(resolveCharacterGender({ gender: 'unknown', appearance: 'young low-rank staff officer, tired face' })).toBe(null)
  })

  it('gender 없음 + appearance 없음 → null', () => {
    expect(resolveCharacterGender({ id: 'narrator', name: '나레이션', appearance: null })).toBe(null)
    expect(resolveCharacterGender(null)).toBe(null)
  })
})
