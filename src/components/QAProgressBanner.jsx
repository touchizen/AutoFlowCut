import { useEffect, useState } from 'react'
import { useI18n } from '../hooks/useI18n'
import './QAProgressBanner.css'

export default function QAProgressBanner() {
  const { t } = useI18n()
  const [state, setState] = useState(null)

  useEffect(() => {
    window.__qaProgressUpdate = (data) => {
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
  const label = isDone
    ? (isKo
        ? `QA 완료 — ${kindLabel} ${state.total}/${state.total}${state.issues > 0 ? ` · 이슈 ${state.issues}건 처리` : ''}`
        : `QA done — ${kindLabel} ${state.total}/${state.total}${state.issues > 0 ? ` · ${state.issues} issues resolved` : ''}`)
    : (isKo
        ? `QA 검수중 — ${kindLabel} (${state.current}/${state.total}) · 라운드 ${state.round}${state.issues > 0 ? ` · 이슈 ${state.issues}` : ''}`
        : `QA running — ${kindLabel} (${state.current}/${state.total}) · round ${state.round}${state.issues > 0 ? ` · ${state.issues} issues` : ''}`)

  return (
    <div className={`qa-progress-banner ${isDone ? 'done' : 'running'}`}>
      <span className="qa-icon">{icon}</span>
      <span className="qa-label">{label}</span>
    </div>
  )
}
