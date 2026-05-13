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
import { findAutoStyle, previewStyleMatching } from './styleService'
import { filterPendingScenes } from '../utils/sceneFilters'

export function createStyleResolver({ activeTab, scenes = [], references = [], selectedStyleRefId, t, isKo }) {
  const isVideoText = activeTab === 'video-text'

  // image/list: generation 대상 씬에 매칭 가능한 게 있는지
  // 라벨 fallback은 모든 scenes로도 — 모두 완료된 상태에서 빈 라벨 회피
  const targetScenes = filterPendingScenes(scenes)
  const labelScenes = targetScenes.length > 0 ? targetScenes : scenes
  const labelPreview = isVideoText ? null : previewStyleMatching(labelScenes, references)
  const guardPreview = isVideoText ? null : previewStyleMatching(targetScenes, references)

  const autoEffectiveStyleId = isVideoText ? findAutoStyle(references) : null
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
      const ref = references.find(r => String(r.id) === refId && r.type === 'style')
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
      return override
    }
    // undefined: UI 선택값 우선. 없을 때 video-text는 findAutoStyle fallback (라벨이 "자동: X"라
    // 보여주므로 실제 적용도 X로 일치해야). image/list는 null로 둠 — useAutomation이 씬별
    // style_tag로 자동 매칭.
    return selectedStyleRefId ?? (isVideoText ? autoEffectiveStyleId : null)
  }

  const resolveEffectiveStyleIdForRef = (override) => {
    return override ?? selectedStyleRefId ?? findAutoStyle(references)
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
