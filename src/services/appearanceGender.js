/**
 * speaker.appearance(영어 자유텍스트)에서 성별을 추정하는 순수 함수.
 *
 * 용도: 오디오 탭 C(성우 추천) — 캐릭터 성별이 잡히면 VoicePicker를 그 성별 세그먼트로
 * 열어 추천한다. 확신이 없으면 null을 반환해 '전체'로 폴백(추천하지 않음). 즉 "있으면
 * 추천, 없으면 조용히 폴백". 성우쪽 gender는 이미 voices[].gender로 완비돼 있어 캐릭터쪽만 채운다.
 *
 * 단서가 male·female 양쪽에 다 있으면(두 인물 묘사 등) 모호하므로 null.
 * 단어 경계(\b)로 매칭해 "woman"의 "man", "human"의 "man", "female"의 "male" 오인을 막는다.
 *
 * @param {string|null|undefined} appearance
 * @returns {'male'|'female'|null}
 */
const FEMALE_WORDS = [
  'woman', 'women', 'female', 'girl', 'lady', 'she', 'her',
  'mother', 'daughter', 'wife', 'sister', 'queen', 'princess', 'actress', 'waitress',
]
const MALE_WORDS = [
  'man', 'men', 'male', 'boy', 'guy', 'gentleman', 'he', 'his', 'him',
  'father', 'son', 'husband', 'brother', 'king', 'prince', 'actor', 'waiter',
]

function hasAnyWord(text, words) {
  return words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(text))
}

export function guessGenderFromAppearance(appearance) {
  if (!appearance || typeof appearance !== 'string') return null
  const text = appearance.toLowerCase()
  const isFemale = hasAnyWord(text, FEMALE_WORDS)
  const isMale = hasAnyWord(text, MALE_WORDS)
  if (isFemale && !isMale) return 'female'
  if (isMale && !isFemale) return 'male'
  return null
}
