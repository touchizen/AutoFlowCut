/**
 * 태그 매칭 유틸리티
 * SceneList UI 표시 + 생성 전 검증에서 공통 사용
 */

import { STYLE_PRESETS } from '../config/defaults'

/** 태그 문자열을 배열로 분리 (콤마, 세미콜론, 콜론) */
export function splitTags(tagString) {
  if (!tagString) return []
  return tagString.split(/[,;:]/).map(t => t.trim().toLowerCase()).filter(Boolean)
}

/**
 * 단일 태그 필드의 매칭 체크.
 * style 타입은 ref name 매칭에 더해 STYLE_PRESETS의 id/name_ko/name_en도 정상 매칭으로 인정한다 —
 * TagInputAutocomplete의 dropdown이 style 인풋에 preset도 노출하므로 사용자가 preset을
 * 선택해도 unmatched 표시되거나 collectTagErrors가 경고하지 않게 일관성을 맞춘다.
 */
export function checkTagMatch(tagValue, references, type) {
  if (!tagValue || !tagValue.trim()) return null
  const tags = splitTags(tagValue)
  if (tags.length === 0) return null

  const presetTokens = type === 'style'
    ? new Set(
        (STYLE_PRESETS?.styles || []).flatMap(p => [
          p.id?.toLowerCase(),
          p.name_ko?.toLowerCase(),
          p.name_en?.toLowerCase(),
        ]).filter(Boolean)
      )
    : null

  const matchedTags = []
  const unmatchedTags = []
  for (const tag of tags) {
    const refMatch = references.some(ref =>
      ref.type === type && ref.name.toLowerCase() === tag
    )
    const presetMatch = presetTokens?.has(tag) || false
    if (refMatch || presetMatch) matchedTags.push(tag)
    else unmatchedTags.push(tag)
  }
  return { matchedTags, unmatchedTags, allMatched: unmatchedTags.length === 0 }
}

/** 전체 씬 목록의 태그 매칭 에러 수집 */
export function collectTagErrors(scenes, references) {
  const errors = []
  const checks = [
    { field: 'characters', type: 'character' },
    { field: 'scene_tag', type: 'scene' },
    { field: 'style_tag', type: 'style' },
  ]

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]
    const sceneErrors = []

    for (const { field, type } of checks) {
      const result = checkTagMatch(scene[field], references, type)
      if (result && !result.allMatched) {
        sceneErrors.push({ type, unmatchedTags: result.unmatchedTags })
      }
    }

    if (sceneErrors.length > 0) {
      errors.push({ sceneIndex: i, errors: sceneErrors })
    }
  }
  return errors
}
