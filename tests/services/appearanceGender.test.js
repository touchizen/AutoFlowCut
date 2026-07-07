import { describe, it, expect } from 'vitest'
import { guessGenderFromAppearance } from '../../src/services/appearanceGender'

// C(성우 추천)의 캐릭터쪽 절반: speaker.appearance(영어 자유텍스트)에서 성별을 추정한다.
// 확신 없으면 null → VoicePicker는 '전체'로 폴백(추천 안 함). "있으면 추천, 없으면 폴백".
describe('guessGenderFromAppearance', () => {
  it('실제 프로젝트 appearance: "28-year-old man, ..." → male', () => {
    expect(guessGenderFromAppearance('28-year-old man, coldest ice-like face, short dark hair')).toBe('male')
  })

  it('"young man, tall, gentle" (리원) → male', () => {
    expect(guessGenderFromAppearance('young man, tall, gentle clear pure face, military aide uniform')).toBe('male')
  })

  it('"elderly East Asian male general" → male ("male"이 "female"로 오인되면 안 됨)', () => {
    expect(guessGenderFromAppearance('elderly East Asian male general, gray hair')).toBe('male')
  })

  it('"young woman, elegant" → female ("woman" 안의 "man"에 오인되면 안 됨)', () => {
    expect(guessGenderFromAppearance('young woman, elegant, long black hair')).toBe('female')
  })

  it('"middle-aged female officer" → female', () => {
    expect(guessGenderFromAppearance('middle-aged female officer, sharp eyes')).toBe('female')
  })

  it('"a girl with braids, she wears a red coat" → female', () => {
    expect(guessGenderFromAppearance('a girl with braids, she wears a red coat')).toBe('female')
  })

  it('성별 단서 없는 appearance(서윤: "young low-rank staff officer, tired face") → null (폴백)', () => {
    expect(guessGenderFromAppearance('young low-rank staff officer, perpetually tired face, messy short hair')).toBe(null)
  })

  it('male/female 단서가 동시에 있으면 모호 → null', () => {
    expect(guessGenderFromAppearance('an old man and his daughter, a young woman')).toBe(null)
  })

  it('"human"의 "man"에 오인되지 않는다 → null', () => {
    expect(guessGenderFromAppearance('a mysterious human figure in a cloak')).toBe(null)
  })

  it('null/빈문자열/비문자열 → null', () => {
    expect(guessGenderFromAppearance(null)).toBe(null)
    expect(guessGenderFromAppearance('')).toBe(null)
    expect(guessGenderFromAppearance(undefined)).toBe(null)
    expect(guessGenderFromAppearance(42)).toBe(null)
  })
})
