/**
 * Style resolution factory — 흩어진 스타일 의미 결정을 한 곳으로 통합.
 *
 * 입력 (6):
 *   activeTab: 'text' | 'list' | 'video-text' | 그 외
 *   scenes, references: 현재 상태
 *   selectedStyleRefId: UI 선택값 (null이면 자동 모드 의도)
 *   t, isKo: i18n
 *
 * 출력 (7):
 *   autoEffectiveStyleId — 자동 모드일 때 실제 적용될 styleId (image/list는 null=씬별, video-text는 ref:N)
 *   autoAvailable — picker 가드용 (자동 모드로 진행 가능한지)
 *   autoLabel — Start 버튼/자동 카드의 텍스트 라벨 (autoCardMeta.label과 같음)
 *   autoCardMeta — StylePicker 자동 카드 시각 메타 ({label, icon, tooltip, summary})
 *   resolveLabelForId(id) — 임의 styleId의 라벨 (Stop 라벨 snapshot 등)
 *   resolveEffectiveStyleId(override) — image/video 공통 흐름의 override → effective 결정
 *   resolveEffectiveStyleIdForRef(override) — useReferenceGeneration 도메인 (ref 생성)
 */

import { STYLE_PRESETS } from '../config/defaults'
import { findAutoPromptStyle, findAutoStyle, findSceneTagStyle, inheritStyleIdFromCards, isStyleReference, previewStyleMatching } from './styleService'
import { filterPendingScenes } from '../utils/sceneFilters'

export function createStyleResolver({ activeTab, scenes = [], references = [], selectedStyleRefId, t, isKo }) {
  const isVideoText = activeTab === 'video-text'

  const isVideoPromptStyleId = (id) => {
    if (!id || id === 'none') return true
    const styleId = String(id)
    if (styleId.startsWith('preset:')) return true
    if (!styleId.startsWith('ref:')) return true
    const refId = styleId.replace('ref:', '')
    return references.some(r => String(r.id) === refId && isStyleReference(r) && r.prompt)
  }

  const selectedStyleForContext = isVideoText && !isVideoPromptStyleId(selectedStyleRefId)
    ? null
    : selectedStyleRefId

  // image/list: generation 대상 씬에 매칭 가능한 게 있는지
  // 라벨 fallback은 모든 scenes로도 — 모두 완료된 상태에서 빈 라벨 회피
  const targetScenes = filterPendingScenes(scenes)
  const labelScenes = targetScenes.length > 0 ? targetScenes : scenes
  const labelPreview = isVideoText ? null : previewStyleMatching(labelScenes, references, { isKo })
  const guardPreview = isVideoText ? null : previewStyleMatching(targetScenes, references, { isKo })

  const autoEffectiveStyleId = isVideoText ? findAutoPromptStyle(references) : null
  const autoAvailable = isVideoText
    ? !!autoEffectiveStyleId
    : (guardPreview?.matches.length ?? 0) > 0

  const _resolveLabelForId = (id) => {
    if (!id) {
      // null = 자동 모드. 탭별로 라벨 다름.
      if (isVideoText) {
        if (!autoEffectiveStyleId) return t('actions.styleNone')
        return t('actions.autoStyle', { label: _resolveLabelForId(autoEffectiveStyleId) })
      }
      // image/list: previewStyleMatching 결과
      if (!labelPreview || labelPreview.matches.length === 0) return t('actions.styleNone')
      const top = labelPreview.styleSummary[0]
      const more = labelPreview.styleSummary.length - 1
      const inner = more > 0 ? `${top.name} +${more}` : top.name
      return t('actions.autoStyle', { label: inner })
    }
    if (id.startsWith('ref:')) {
      const refId = id.replace('ref:', '')
      const ref = references.find(r => String(r.id) === refId && isStyleReference(r))
      if (isVideoText && !ref?.prompt) return t('actions.styleNone')
      return ref?.name || refId
    }
    if (id.startsWith('preset:')) {
      const presetId = id.replace('preset:', '')
      const preset = STYLE_PRESETS?.styles?.find(s => s.id === presetId)
      return isKo ? (preset?.name_ko || presetId) : (preset?.name_en || presetId)
    }
    return id
  }

  const autoLabel = _resolveLabelForId(null)

  const autoCardMeta = (() => {
    if (isVideoText) {
      return {
        label: autoLabel,
        icon: autoEffectiveStyleId ? '🪄' : '🚫',
        tooltip: '',
        summary: null,
      }
    }
    if (!labelPreview || labelPreview.matches.length === 0) {
      return {
        label: t('reference.autoMatchNone'),
        icon: '🚫',
        tooltip: `${t('reference.autoMatchHint')}\n\n${t('reference.matchPreviewEmpty')}`,
        summary: null,
      }
    }
    const summaryText = labelPreview.styleSummary.slice(0, 2).map(s => s.name).join(', ')
      + (labelPreview.styleSummary.length > 2 ? ` +${labelPreview.styleSummary.length - 2}` : '')
    const lines = [t('reference.autoMatchHint'), '', t('reference.matchPreviewTitle')]
    for (const s of labelPreview.styleSummary) {
      lines.push(t('reference.matchPreviewSummary', { name: s.name, count: s.count }))
    }
    if (labelPreview.unmatched.length > 0) {
      lines.push(t('reference.matchPreviewUnmatched', { count: labelPreview.unmatched.length }))
    }
    return {
      label: t('reference.autoMatch'),
      icon: '🪄',
      tooltip: lines.join('\n'),
      summary: summaryText,
    }
  })()

  const resolveEffectiveStyleId = (override) => {
    if (override !== undefined) {
      if (override === null) return isVideoText ? autoEffectiveStyleId : null
      if (isVideoText && !isVideoPromptStyleId(override)) return null
      return override
    }
    // undefined: UI 선택값 우선. 없을 때 video-text는 findAutoPromptStyle fallback (라벨이 "자동: X"라
    // 보여주므로 실제 적용도 X로 일치해야). image/list는 null로 둠 — useAutomation이 씬별
    // style_tag로 자동 매칭.
    return selectedStyleForContext ?? (isVideoText ? autoEffectiveStyleId : null)
  }

  const deriveStyleIdFromScenes = () => {
    // Ref 스타일은 실제 이미지 생성 입력(prompt가 있는 씬)만 상속 근거로 삼는다.
    // prompt가 있는 tagless 씬은 아래에서 null이 되어 unanimity를 계속 veto한다.
    const sourceScenes = scenes.filter(scene => scene?.prompt)
    if (sourceScenes.length === 0) return null

    const styleIds = sourceScenes.map(scene => {
      const match = findSceneTagStyle(scene?.style_tag, references)
      if (match?.source === 'ref' && match.style.id != null) return `ref:${match.style.id}`
      // resolveSceneStyle도 prompt_en이 있어야 실제로 preset을 적용한다.
      if (match?.source === 'preset' && match.style.prompt_en) return `preset:${match.style.id}`
      return null
    })
    const firstStyleId = styleIds[0]
    if (!firstStyleId || !styleIds.every(id => id === firstStyleId)) return null
    return firstStyleId
  }

  // 우선순위: override(명시적) → selectedStyleRefId(프로젝트 전체 스타일) → 카드들의 기억 →
  //   씬들의 단일 effective style 파생 → findAutoStyle. 기억을 건너뛰고 파생/자동 fallback으로 가면,
  //   기존 카드가 명시적으로 기억한 '무스타일'(null) 계약을 깨뜨린다.
  const resolveEffectiveStyleIdForRef = (override) => {
    if (override != null) return override
    if (selectedStyleRefId != null) return selectedStyleRefId
    // styleId:null 도 정당한 기억("무스타일로 생성됨")이라 ?? 로 건너뛰면 안 된다.
    const inherited = inheritStyleIdFromCards(references)
    if (inherited.found) return inherited.styleId
    const derivedStyleId = deriveStyleIdFromScenes()
    if (derivedStyleId) return derivedStyleId
    return findAutoStyle(references)
  }

  return {
    autoEffectiveStyleId,
    autoAvailable,
    autoLabel,
    autoCardMeta,
    resolveLabelForId: _resolveLabelForId,
    resolveEffectiveStyleId,
    resolveEffectiveStyleIdForRef,
  }
}
