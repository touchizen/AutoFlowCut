/**
 * StatusBar Component - 진행 상태 표시
 */

import { useElapsedTimer } from '../hooks/useElapsedTimer'
import { formatElapsed, hasImageData } from '../utils/formatters'

export default function StatusBar({ progress, status, message, scenes = [] }) {
  const elapsed = useElapsedTimer(progress.startedAt, progress.endedAt)

  // 씬 통계 (항상 계산)
  const doneCount = scenes.filter(s => hasImageData(s) || s.imagePath).length
  const errorCount = scenes.filter(s => s.status === 'error').length
  const hasScenes = scenes.length > 0

  const statusClass = {
    ready: '',
    uploading: 'uploading',
    running: 'running',
    done: 'success',
    stopped: 'warning',
    error: 'error'
  }[status] || ''

  const isActive = status === 'running' || status === 'uploading'

  return (
    <div className={`status-bar ${statusClass}`}>
      <div className="status-progress">
        <progress
          value={progress.percent}
          max="100"
        />
        <span className="progress-text">
          {isActive ? (
            <>
              {progress.current} / {progress.total} ({progress.percent}%)
              {progress.errorCount > 0 && <span className="error-count"> ❌ {progress.errorCount}</span>}
            </>
          ) : hasScenes ? (
            <>
              ✅ {doneCount}
              {errorCount > 0 && <span className="error-count"> ❌ {errorCount}</span>}
              <span className="scene-total"> / {scenes.length}</span>
            </>
          ) : (
            <>0 / 0 (0%)</>
          )}
          {progress.startedAt && elapsed > 0 && <span className="elapsed-time"> ⏱ {formatElapsed(elapsed)}</span>}
        </span>
      </div>

      <div className="status-message">
        {message}
      </div>
    </div>
  )
}
