/**
 * StyleService — 스타일 레퍼런스 매칭 및 프롬프트 합성
 *
 * useAutomation, useReferenceGeneration에서 반복되는 스타일 관련 로직을 공통화.
 */

import { STYLE_PRESETS } from '../config/defaults'
import { splitTags } from '../utils/tagMatch'

/**
 * 등록된 스타일 카드 자동 탐색
 * @param {Array} references - 레퍼런스 배열
 * @returns {string|null} 'ref:{id}' 형태 또는 null
 */
export function findAutoStyle(references) {
  const autoStyle = references.find(r => r.type === 'style' && r.mediaId)
  return autoStyle ? `ref:${autoStyle.id}` : null
}

/**
 * 스타일 ID를 기반으로 프롬프트를 합성하고, 스타일 이미지 레퍼런스를 반환
 *
 * @param {string} prompt - 원본 프롬프트
 * @param {string|null} styleId - 스타일 ID ('ref:xxx', 'preset:xxx', null)
 * @param {Array} references - 레퍼런스 배열
 * @param {Array} existingMatchedRefs - 이미 매칭된 레퍼런스 (중복 방지)
 * @returns {{ styledPrompt: string, styleRefImages: Array<{category,mediaId,caption}> }}
 */
export function applyStyle(prompt, styleId, references, existingMatchedRefs = []) {
  const styleRefImages = []
  let styledPrompt = prompt

  if (!styleId) return { styledPrompt, styleRefImages }

  if (styleId.startsWith('ref:')) {
    const refId = styleId.replace('ref:', '')
    const styleRef = references.find(r => r.id == refId && r.type === 'style')
    if (styleRef) {
      if (styleRef.prompt) {
        styledPrompt = `${prompt}, ${styleRef.prompt}`
      }
      if (styleRef.mediaId && !existingMatchedRefs.some(r => r.mediaId === styleRef.mediaId)) {
        styleRefImages.push({ category: styleRef.category || 'style', mediaId: styleRef.mediaId, caption: styleRef.caption || '' })
      }
    }
  } else if (styleId.startsWith('preset:')) {
    const presetId = styleId.replace('preset:', '')
    const preset = STYLE_PRESETS?.styles?.find(s => s.id === presetId)
    if (preset?.prompt_en) {
      styledPrompt = `${prompt}, ${preset.prompt_en}`
    }
  }

  return { styledPrompt, styleRefImages }
}

/**
 * 태그 매칭된 스타일 + 수동 선택 스타일을 순서대로 적용
 *
 * @param {string} prompt - 원본 프롬프트
 * @param {Array} allMatched - getMatchingReferences()의 결과
 * @param {string|null} selectedStyleRefId - 수동 선택된 스타일 ID
 * @param {Array} references - 레퍼런스 배열
 * @param {Array} matchedRefs - 이미 수집된 매칭 레퍼런스 (mutated)
 * @param {string} [styleTag] - 씬의 style_tag (프리셋 fallback용)
 * @returns {{ styledPrompt: string, appliedStyle: string }}
 */
export function resolveSceneStyle(prompt, allMatched, selectedStyleRefId, references, matchedRefs, styleTag = '') {
  let styledPrompt = prompt
  let appliedStyle = 'none'

  // 1a. 태그 매칭으로 스타일 레퍼런스가 있으면 자동 적용
  const matchedStyleRef = allMatched.find(r => r.type === 'style' && r.prompt)
  if (matchedStyleRef) {
    styledPrompt = `${prompt}, ${matchedStyleRef.prompt}`
    appliedStyle = `auto:${matchedStyleRef.name || matchedStyleRef.id}`
  }

  // 1b. 매칭 레퍼런스 없으면 style_tag로 프리셋에서 찾기
  if (appliedStyle === 'none' && styleTag) {
    const preset = STYLE_PRESETS?.styles?.find(s => s.id === styleTag || s.name_ko === styleTag || s.name_en === styleTag)
    if (preset?.prompt_en) {
      styledPrompt = `${prompt}, ${preset.prompt_en}`
      appliedStyle = `preset:${preset.id}`
    }
  }

  // 2. selectedStyleRefId가 명시적으로 있으면 덮어쓰기
  if (selectedStyleRefId) {
    const { styledPrompt: sp, styleRefImages } = applyStyle(prompt, selectedStyleRefId, references, matchedRefs)
    styledPrompt = sp
    appliedStyle = selectedStyleRefId
    // styleRefImages를 matchedRefs에 추가
    for (const img of styleRefImages) {
      if (!matchedRefs.some(r => r.mediaId === img.mediaId)) {
        matchedRefs.push(img)
      }
    }
  }

  return { styledPrompt, appliedStyle }
}

/**
 * seed 값을 설정에서 추출
 * @param {object} settings - { seedLocked, seedNo }
 * @returns {number|null}
 */
export function resolveSeed(settings) {
  return settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
    ? settings.seedNo
    : null
}

/**
 * 씬별 스타일 매칭을 시뮬레이션한다 (StylePicker 미리보기용).
 * 우선순위: Reference name 매칭 (case-insensitive, multi-tag split) > STYLE_PRESETS id/name_ko/name_en 매칭
 *
 * Production parity (`useScenes.getMatchingReferences` + `resolveSceneStyle`):
 * - ref-match: `splitTags(scene.style_tag)`로 토큰화(소문자) → 첫 매칭 style ref만 사용
 * - preset-fallback: 매칭 ref 없을 때만, raw `scene.style_tag` (대소문자/분리 없음)로 조회
 *
 * @param {Array} scenes - 씬 배열 ({id, style_tag})
 * @param {Array} references - 레퍼런스 배열
 * @param {object} [opts] - { presets } — 테스트 주입용
 * @returns {{
 *   matches: Array<{ sceneId, styleName, source: 'ref'|'preset' }>,
 *   unmatched: Array<string|number>,
 *   styleSummary: Array<{ name, count }>
 * }}
 */
export function previewStyleMatching(scenes, references, opts = {}) {
  const presets = opts.presets ?? (STYLE_PRESETS?.styles || [])
  // Production applies a style ref via either:
  //   - resolveSceneStyle when r.prompt exists (concatenates into the prompt)
  //   - matchedRefs injection when r.mediaId exists (image ref into Flow API)
  // A ref with neither contributes nothing — drop it from preview.
  const styleRefs = references.filter(r => r.type === 'style' && r.name && (r.prompt || r.mediaId))

  const matches = []
  const unmatched = []

  for (const scene of scenes) {
    const tags = splitTags(scene.style_tag)
    if (tags.length === 0) {
      unmatched.push(scene.id)
      continue
    }

    const refMatch = styleRefs.find(r => tags.includes(r.name?.toLowerCase()))
    if (refMatch) {
      matches.push({ sceneId: scene.id, styleName: refMatch.name, source: 'ref' })
      continue
    }

    const rawTag = scene.style_tag
    const preset = presets.find(p => p.id === rawTag || p.name_ko === rawTag || p.name_en === rawTag)
    if (preset) {
      matches.push({ sceneId: scene.id, styleName: preset.name_ko || preset.name_en, source: 'preset' })
      continue
    }

    unmatched.push(scene.id)
  }

  const counts = new Map()
  for (const m of matches) counts.set(m.styleName, (counts.get(m.styleName) || 0) + 1)
  const styleSummary = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return { matches, unmatched, styleSummary }
}
