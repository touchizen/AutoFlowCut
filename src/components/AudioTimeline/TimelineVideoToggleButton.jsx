import { useI18n } from '../../hooks/useI18n'

// 영상 클립 export 포함/제외 토글 — Clip 의 video clip 에만 렌더.
// disabled=true 면 제외 상태(👁 off). TimelineFlagButton 과 동일한 전파 차단 패턴.
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
  return (
    <button
      type="button"
      className={`atl-clip-action-btn atl-clip-eye-btn${disabled ? ' is-off' : ''}${narrow ? ' is-narrow' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={handleClick}
      title={label}
      aria-label={label}
      aria-pressed={disabled ? 'true' : 'false'}
    >
      {disabled ? '🚫' : '👁'}
    </button>
  )
}
