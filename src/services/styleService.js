/**
 * StyleService — 스타일 레퍼런스 매칭 및 프롬프트 합성
 *
 * useAutomation, useReferenceGeneration에서 반복되는 스타일 관련 로직을 공통화.
 */

import { STYLE_PRESETS } from '../config/defaults'

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
 * @returns {{ styledPrompt: string, appliedStyle: string }}
 */
export function resolveSceneStyle(prompt, allMatched, selectedStyleRefId, references, matchedRefs) {
  let styledPrompt = prompt
  let appliedStyle = 'none'

  // 1. 태그 매칭으로 스타일 레퍼런스가 있으면 자동 적용
  const matchedStyleRef = allMatched.find(r => r.type === 'style' && r.prompt)
  if (matchedStyleRef) {
    styledPrompt = `${prompt}, ${matchedStyleRef.prompt}`
    appliedStyle = `auto:${matchedStyleRef.name || matchedStyleRef.id}`
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
