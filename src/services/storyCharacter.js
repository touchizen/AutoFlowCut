/**
 * storyCharacter 구조화 스키마 (spec §v2.2 + §v2.8 M2 + §v2.9 MINOR① + §v2.12 A):
 *   { id, name, gender: 'male'|'female'|'unknown', age, role, ethnicity, appearance }
 *
 * - id = name.trim() 파생 (별도 slug 함수 없음 — 기존 코드가 seg.speaker를
 *   String(x).trim()으로 다루는 관례와 정합). 단 기존 speaker가 id를 이미 갖고 있으면
 *   보존한다(하위호환 — id 재파생 시 세그먼트/voice 매칭이 깨짐).
 * - ethnicity(§v2.12): 출신/인종 자유값("한국인"/"Korean"/"East Asian" 등) — 이미지 프롬프트
 *   조합용. 기본값 ''.
 * - 하위호환: 기존 project.json의 speaker/character에는 gender/age/role/ethnicity가 없을 수
 *   있음 → 읽을 때 기본값(gender 'unknown', age/role/ethnicity/appearance '')을 채운다.
 *   마이그레이션 없음.
 */
import { guessGenderFromAppearance } from './appearanceGender'

const GENDERS = ['male', 'female', 'unknown']

const str = (v) => (typeof v === 'string' ? v : '')

export function normalizeStoryCharacter(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const name = str(src.name)
  const id = str(src.id) || name.trim()
  return {
    id,
    name,
    gender: GENDERS.includes(src.gender) ? src.gender : 'unknown',
    age: str(src.age),
    role: str(src.role),
    ethnicity: str(src.ethnicity),
    appearance: str(src.appearance),
  }
}

/**
 * §v2.12 이미지 프롬프트 조합 규칙(공유 helper) — Ref 카드 prompt(upsertStoryCharacterRefs)와
 * 씬 프롬프트 컨텍스트(buildPromptsPrompt)/@멘션 포함 기준(sceneCharacterNames)이 공유한다:
 *   `${ethnicity}, ${appearance}` — 빈 쪽은 콤마 없이 생략.
 * truthy ⇔ ethnicity/appearance 중 하나라도 있음 — ethnicity-only 캐릭터가 Ref 카드엔 있는데
 * 씬 프롬프트/멘션에서 빠지는 불일치를 막는 단일 기준(§v2.12 코드리뷰 FIX MAJOR).
 * renderer(src)와 electron 양쪽에서 import한다(stepMachine의 기존 src import 관례).
 */
export function characterVisualPrompt(c) {
  const ethnicity = str(c?.ethnicity).trim()
  const appearance = str(c?.appearance).trim()
  if (!ethnicity) return appearance
  return appearance ? `${ethnicity}, ${appearance}` : ethnicity
}

/**
 * 오디오 탭 성우 추천의 캐릭터 성별 소스 (spec §v2.8 M5 / §v2.11 / m1):
 * 캐릭터 gender 확정값(male/female)이 상위 소스, 'unknown'/없음이면
 * 기존 guessGenderFromAppearance(appearance) 폴백 → null 가능(null=배지·경고 없음).
 *
 * @param {object|null|undefined} character speaker/storyCharacter
 * @returns {'male'|'female'|null}
 */
export function resolveCharacterGender(character) {
  const gender = character?.gender
  if (gender === 'male' || gender === 'female') return gender
  return guessGenderFromAppearance(character?.appearance)
}

export default { normalizeStoryCharacter, resolveCharacterGender, characterVisualPrompt }
