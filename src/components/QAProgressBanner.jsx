import { useEffect, useState } from 'react'
import { useI18n } from '../hooks/useI18n'
import './QAProgressBanner.css'

export default function QAProgressBanner() {
  const { t } = useI18n()
  const [state, setState] = useState(null)

  useEffect(() => {
    window.__qaProgressUpdate = (data) => {
      // Reject malformed payloads. A banner with "(0/0)" or no kind is noise.
      // Only display when we actually have a kind and (total > 0 or done).
      if (!data || !data.kind) return
      const total = Number(data.total) || 0
      if (total <= 0 && data.state !== 'done') return
      setState(data)
      if (data.state === 'done') {
        setTimeout(() => setState(null), 4000)
      }
    }
    return () => { delete window.__qaProgressUpdate }
  }, [])

  if (!state) return null

  const isKo = t('common.cancel') === '취소'
  const kindLabel = state.kind === 'ref'
    ? (t('qa.ref') || (isKo ? '레퍼런스' : 'Reference'))
    : (t('qa.scene') || (isKo ? '씬' : 'Scene'))
  const isDone = state.state === 'done'
  const icon = isDone ? '✓' : '🔍'
  const total = Number(state.total) || 0
  const current = Number(state.current) || 0
  const round = Number(state.round) || 1
  const issues = Number(state.issues) || 0

  const label = isDone
    ? (isKo
        ? `QA 완료 — ${kindLabel} ${total}/${total}${issues > 0 ? ` · 이슈 ${issues}건 처리` : ''}`
        : `QA done — ${kindLabel} ${total}/${total}${issues > 0 ? ` · ${issues} issues resolved` : ''}`)
    : (isKo
        ? `QA 검수중 — ${kindLabel} (${current}/${total}) · 라운드 ${round}${issues > 0 ? ` · 이슈 ${issues}` : ''}`
        : `QA running — ${kindLabel} (${current}/${total}) · round ${round}${issues > 0 ? ` · ${issues} issues` : ''}`)

  // Progress bar fill: percent of items checked. Hidden when done.
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0

  return (
    <div className={`qa-progress-banner ${isDone ? 'done' : 'running'}`} role="status" aria-live="polite">
      {!isDone && (
        <div className="qa-progress-fill" style={{ width: `${pct}%` }} aria-hidden="true" />
      )}
      <span className="qa-icon">{icon}</span>
      <span className="qa-label">{label}</span>
      <button
        type="button"
        className="qa-close"
        onClick={() => setState(null)}
        title={isKo ? '닫기' : 'Dismiss'}
        aria-label={isKo ? '닫기' : 'Dismiss'}
      >
        ×
      </button>
    </div>
  )
}
