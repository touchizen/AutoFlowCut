import { useI18n } from '../../hooks/useI18n'

// 영상 클립 export 포함/제외 토글 — Clip 의 video clip 에만 렌더.
// disabled=true 면 제외 상태(👁 off). TimelineFlagButton 과 동일한 전파 차단 패턴.
// aria-pressed = "export 포함됨(켜짐)" 상태(=!disabled) — action label 과 모순 없게(disabled 면 "Include" 액션 + not-pressed).
export default function TimelineVideoToggleButton({ disabled, narrow, onToggle }) {
  const { t } = useI18n()
  const label = disabled
    ? (t('timeline.includeClip') || 'Include in export')
    : (t('timeline.excludeClip') || 'Exclude from export')
  const handleClick = (e) => {
    e.stopPropagation()
    e.preventDefault()
    onToggle?.()
  }
  const stopActionDoubleClick = (e) => {
    e.stopPropagation()
    e.preventDefault()
  }
  return (
    <button
      type="button"
      className={`atl-clip-action-btn atl-clip-eye-btn${disabled ? ' is-off' : ''}${narrow ? ' is-narrow' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={handleClick}
      onDoubleClick={stopActionDoubleClick}
      title={label}
      aria-label={label}
      aria-pressed={disabled ? 'false' : 'true'}
    >
      {disabled ? '🚫' : '👁'}
    </button>
  )
}
