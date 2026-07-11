/**
 * StyleService — 스타일 레퍼런스 매칭 및 프롬프트 합성
 *
 * useAutomation, useReferenceGeneration에서 반복되는 스타일 관련 로직을 공통화.
 */

import { STYLE_PRESETS } from '../config/defaults'
import { splitTags } from '../utils/tagMatch'

/**
 * MCP/외부 호출자가 보내는 styleId를 내부 형식(`ref:*` / `preset:*`)으로 정규화한다.
 *
 * 동작:
 *   - null / undefined / '' → null (선택 없음)
 *   - 'ref:*' / 'preset:*' → 그대로 반환 (이중 wrap 방지)
 *   - plain id (예: 'korean-ani') → 'preset:korean-ani' (legacy backward compat)
 *
 * @param {string|number|null|undefined} styleId
 * @returns {string|null}
 */
export function normalizeStyleId(styleId) {
  if (styleId == null || styleId === '') return null
  const s = String(styleId)
  if (s.startsWith('ref:') || s.startsWith('preset:')) return s
  return `preset:${s}`
}

export function isStyleReference(ref) {
  const type = String(ref?.type || '').toLowerCase()
  const category = String(ref?.category || '').toLowerCase()
  const referenceType = String(ref?.referenceType || '').toLowerCase()
  return referenceType === 'style' || type === 'style' || category === 'style' || category === 'media_category_style'
}

function hasGenAIStyleImage(ref) {
  return !!(ref?.data || ref?.filePath)
}

/**
 * 등록된 스타일 카드 자동 탐색.
 *
 * "사용 가능한 스타일 카드" 기준: prompt 또는 이미지 소스 중 하나라도 있어야 함.
 * 둘 다 없는 placeholder 카드는 production 적용 path가 아무것도 안 하므로 제외.
 *
 * 둘 다 잡는 이유: production applyStyle / _prepareStyleRefs는 prompt만 있어도
 * styledPrompt를 합성하고, GenAI에서 해석 가능한 이미지 소스가 있으면 image ref로 주입한다. mediaId만 보면
 * 사용자가 prompt로만 만든 스타일 카드를 누락 — preview/MCP 자동 모드가 잘못된 결과.
 *
 * @param {Array} references - 레퍼런스 배열
 * @returns {string|null} 'ref:{id}' 형태 또는 null
 */
/**
 * 카드들이 이미 기억하는 프로젝트의 스타일.
 *
 * 새로 추가한 카드는 styleId 기억이 없다. 그때 findAutoStyle(references 의 "첫 번째" 스타일 카드)
 * 로 떨어지면, 스타일 카드를 추가하거나 순서가 바뀌는 것만으로 새 카드가 조용히 다른 스타일로
 * 생성된다. 사용자가 의도적으로 다른 걸 고르지 않는 한 프로젝트가 쓰던 스타일을 물려받아야 한다.
 *
 * 가장 최근에 생성된 카드의 기억을 쓴다(배치는 모두 같은 값을 찍으므로 대개 동일).
 * styleId:undefined 는 기억 없음, null 은 "무스타일로 생성됨"이라는 정당한 기억이다 — 값으로 판정한다
 * (상세 모달의 prop 동기화가 styleId:undefined 로 키를 만들기 때문에 키 존재로 판정하면 안 된다).
 * 스타일 카드 자신은 배치에서 null 을 찍히므로 제외한다 — 물려받으면 전부 무스타일이 된다.
 *
 * @returns {{found: boolean, styleId: string|null}}
 */
export function inheritStyleIdFromCards(references) {
  let best = null
  for (const r of references || []) {
    if (!r || isStyleReference(r)) continue
    // 키 존재가 아니라 값으로 판정한다 — 상세 모달의 prop 동기화가 styleId:undefined 로 키를 만든다.
    //   undefined = 기억 없음, null = '무스타일로 생성됨'이라는 정당한 기억.
    if (r.styleId === undefined) continue
    if (!best || (r.generatedAt || 0) >= (best.generatedAt || 0)) best = r
  }
  return best ? { found: true, styleId: best.styleId } : { found: false, styleId: null }
}

export function findAutoStyle(references) {
  const autoStyle = references.find(r => isStyleReference(r) && (
    r.prompt || hasGenAIStyleImage(r)
  ))
  return autoStyle ? `ref:${autoStyle.id}` : null
}

/**
 * 비디오 T2V 자동 스타일 탐색.
 *
 * Veo 3.1은 style reference image를 지원하지 않으므로, 비디오 자동 스타일은 실제로
 * 프롬프트를 바꿀 수 있는 prompt 보유 스타일 카드만 사용한다.
 */
export function findAutoPromptStyle(references) {
  const autoStyle = references.find(r => isStyleReference(r) && r.prompt)
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

  // 'none' sentinel — caller가 명시적으로 "스타일 미적용" 요구. early return.
  if (styleId === 'none') return { styledPrompt, styleRefImages }
  if (!styleId) return { styledPrompt, styleRefImages }

  if (styleId.startsWith('ref:')) {
    const refId = styleId.replace('ref:', '')
    const styleRef = references.find(r => r.id == refId && isStyleReference(r))
    if (styleRef) {
      if (styleRef.prompt) {
        styledPrompt = `${prompt}, ${styleRef.prompt}`
      }
      // mediaId(Flow), filePath/name(공식 API 디스크 해석), data(메모리 inline) 중 하나라도
      // 있으면 image ref 로 주입.
      if (styleRef.mediaId || styleRef.name || styleRef.data || styleRef.filePath) {
        const dup = existingMatchedRefs.some(r =>
          (styleRef.mediaId && r.mediaId === styleRef.mediaId) ||
          (styleRef.name && r.name === styleRef.name) ||
          (styleRef.filePath && r.filePath === styleRef.filePath))
        if (!dup) {
          styleRefImages.push({
            id: styleRef.id,
            category: styleRef.category || 'style',
            mediaId: styleRef.mediaId || null,
            caption: styleRef.caption || '',
            name: styleRef.name,
            data: styleRef.data || null,
            filePath: styleRef.filePath || null,
          })
        }
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

  // 'none' sentinel — caller가 명시적으로 "스타일 미적용" 요구.
  // 자동 매칭, preset fallback, 수동 override 모두 skip.
  if (selectedStyleRefId === 'none') {
    return { styledPrompt, appliedStyle: 'none' }
  }

  // 1a. 태그 매칭으로 스타일 레퍼런스가 있으면 자동 적용
  const matchedStyleRef = allMatched.find(r => isStyleReference(r) && r.prompt)
  if (matchedStyleRef) {
    styledPrompt = `${prompt}, ${matchedStyleRef.prompt}`
    appliedStyle = `auto:${matchedStyleRef.name || matchedStyleRef.id}`
  }

  // 1b. 매칭 레퍼런스 없으면 splitTags 토큰 기반으로 프리셋에서 찾기
  // (multi-tag `'cinematic, noir'`에서도 각 토큰이 preset과 매칭되면 첫 매칭 적용)
  if (appliedStyle === 'none' && styleTag) {
    const tokens = splitTags(styleTag)
    const preset = (STYLE_PRESETS?.styles || []).find(s =>
      tokens.includes(s.id?.toLowerCase()) ||
      tokens.includes(s.name_ko?.toLowerCase()) ||
      tokens.includes(s.name_en?.toLowerCase())
    )
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
    // styleRefImages를 matchedRefs에 추가 (mediaId 또는 name 기준 dedup)
    for (const img of styleRefImages) {
      const dup = matchedRefs.some(r =>
        (img.mediaId && r.mediaId === img.mediaId) ||
        (img.name && r.name === img.name) ||
        (img.filePath && r.filePath === img.filePath))
      if (!dup) matchedRefs.push(img)
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
 * @param {object} [opts] - { presets, isKo } — 테스트 주입/표시 언어용
 * @returns {{
 *   matches: Array<{ sceneId, styleName, source: 'ref'|'preset' }>,
 *   unmatched: Array<string|number>,
 *   styleSummary: Array<{ name, count }>
 * }}
 */
export function previewStyleMatching(scenes, references, opts = {}) {
  const presets = opts.presets ?? (STYLE_PRESETS?.styles || [])
  const isKo = opts.isKo !== false
  // Production applies a style ref via either:
  //   - resolveSceneStyle when r.prompt exists (concatenates into the prompt)
  //   - matchedRefs injection when a GenAI-readable image source exists
  // A ref with neither contributes nothing — drop it from preview.
  const styleRefs = references.filter(r => isStyleReference(r) && r.name && (r.prompt || r.data || r.filePath))

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

    // Preset 매칭은 splitTags 토큰 기반 — multi-tag (`'cinematic, noir'`)에서도
    // 각 토큰이 preset과 매칭되면 첫 매칭 preset을 적용. 이전엔 raw `scene.style_tag`
    // 전체를 통째로 비교해 multi-tag preset이 누락됐다.
    const preset = presets.find(p =>
      tags.includes(p.id?.toLowerCase()) ||
      tags.includes(p.name_ko?.toLowerCase()) ||
      tags.includes(p.name_en?.toLowerCase())
    )
    if (preset) {
      const styleName = isKo
        ? (preset.name_ko || preset.name_en || preset.id)
        : (preset.name_en || preset.name_ko || preset.id)
      matches.push({ sceneId: scene.id, styleName, source: 'preset' })
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
