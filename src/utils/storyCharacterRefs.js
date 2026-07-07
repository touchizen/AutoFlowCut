/**
 * V2: 스토리 캐릭터(name, appearance)를 Ref 탭 character 레퍼런스 카드로 upsert.
 *
 * §v2.12 A: 카드 prompt는 `${ethnicity ? ethnicity + ', ' : ''}${appearance}` 조합 —
 * 캐릭터 이미지가 출신/인종(한국인 등)을 반영한다. ethnicity 없으면 현행(appearance만).
 *
 * type-aware upsert(스펙 §3.1):
 *  - 같은 name + type==='character' 있으면 → 보존(사용자 생성/편집 이미지·status·prompt 불변).
 *  - 같은 name인데 type≠character(scene/style) → 추가 안 하고 collision 반환(태그만 있고 카드 없는
 *    조용한 실패 방지 — App이 토스트).
 *  - 없으면 → 전체 기본 필드 + numeric id로 추가(status:'pending', data:null).
 *
 * id는 numeric(앱이 ref.id를 숫자로 가정 — ReferencePanel Math.max, Number(id)). 문자열 id는 NaN을
 * 전파시키므로 금지. idempotency는 id가 아니라 name 보존으로 확보.
 */
// §v2.12: Ref 카드 이미지 프롬프트 조합(`${ethnicity}, ${appearance}`, 빈 쪽 콤마 생략) —
// 씬 프롬프트(electron buildPromptsPrompt/@멘션)와 동일 규칙을 공유 helper로 일원화.
import { characterVisualPrompt } from '../services/storyCharacter.js'

export function upsertStoryCharacterRefs(existing, storyCharacters) {
  const refs = Array.isArray(existing) ? existing : []
  const chars = Array.isArray(storyCharacters) ? storyCharacters : []
  if (chars.length === 0) return { references: refs, collisions: [] }

  const byName = new Map(refs.map((r) => [r.name, r]))
  let nextId = refs.reduce((max, r) => (typeof r.id === 'number' && r.id > max ? r.id : max), 0)
  const added = []
  const collisions = []
  let patched = false

  for (const c of chars) {
    const existingRef = byName.get(c.name)
    if (existingRef) {
      if (existingRef.type !== 'character') collisions.push(c.name) // 동명 비-character 충돌
      else {
        // §v2.12 FIX(MINOR): c.appearance가 아니라 조합 prompt 존재 여부로 보강 —
        // ethnicity-only 캐릭터도 pending 카드 prompt를 채운다(신규 카드 경로와 동일 규칙).
        const prompt = characterVisualPrompt(c)
        if (!existingRef.prompt && prompt && existingRef.status === 'pending' && !existingRef.data && !existingRef.filePath && !existingRef.mediaId) {
          byName.set(c.name, { ...existingRef, prompt })
          patched = true
        }
      }
      continue // character 동명은 보존(추가 안 함)
    }
    nextId += 1
    const card = {
      id: nextId,
      name: c.name,
      type: 'character',
      category: 'MEDIA_CATEGORY_SUBJECT',
      prompt: characterVisualPrompt(c),
      imagePath: '',
      data: null,
      mediaId: null,
      caption: '',
      status: 'pending',
      errorMessage: null,
    }
    byName.set(c.name, card)
    added.push(card)
  }

  const patchedRefs = patched ? refs.map((r) => byName.get(r.name) || r) : refs
  const references = added.length ? [...patchedRefs, ...added] : patched ? patchedRefs : refs
  return { references, collisions }
}

export function assertStoryProjectCurrent(currentPath, enqueuedPath, message = 'stale story push discarded') {
  if (currentPath !== enqueuedPath) throw new Error(message)
}

export default { upsertStoryCharacterRefs, assertStoryProjectCurrent }
