import { useI18n } from '../../hooks/useI18n'

// Timeline 클립의 부적합 마크 버튼 — Clip / file-mini-clip 양쪽에서 재사용.
// audioPath, filename: handleFlag 인자
// flagged: 현재 마크 상태 (true면 ✓ 버튼, false면 ⚠️)
// narrow: 얇은 클립용 컴팩트 스타일
// onFlag: (audioPath, filename, event) => void
export default function TimelineFlagButton({ audioPath, filename, flagged, narrow, onFlag }) {
  const { t } = useI18n()
  const labelUnflag = t('audioTab.editFlag') || 'Edit or remove flag'
  const labelFlag = t('audioTab.flagFile') || 'Flag as inappropriate'
  const label = flagged ? labelUnflag : labelFlag

  const handleClick = (e) => {
    e.stopPropagation()
    e.preventDefault()
    onFlag?.(audioPath, filename, e)
  }

  return (
    <button
      type="button"
      className={`atl-clip-action-btn atl-clip-flag-btn${flagged ? ' is-flagged' : ''}${narrow ? ' is-narrow' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={handleClick}
      title={label}
      aria-label={label}
      aria-pressed={flagged ? 'true' : 'false'}
    >
      {flagged ? '✓' : '⚠️'}
    </button>
  )
}
