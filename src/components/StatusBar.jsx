/**
 * StatusBar Component - 진행 상태 표시
 */

import { useElapsedTimer } from '../hooks/useElapsedTimer'
import { formatElapsed, hasImageData } from '../utils/formatters'

export default function StatusBar({ progress, status, message, scenes = [] }) {
  const elapsed = useElapsedTimer(progress.startedAt, progress.endedAt)

  // 씬 통계 (항상 계산)
  const doneCount = scenes.filter(s => hasImageData(s) || s.imagePath).length
  const sceneErrorCount = scenes.filter(s => s.status === 'error').length
  // 비디오(T2V/F2V) 실패는 scene.status='error' 가 아니라 progress.errorCount 로만 온다.
  // 완료 후에도 실패가 성공처럼 보이지 않도록 둘 중 큰 값 표시(이미지는 둘이 같아 중복 없음).
  const errorCount = Math.max(sceneErrorCount, progress?.errorCount || 0)
  const hasScenes = scenes.length > 0

  const baseStatusClass = {
    ready: '',
    uploading: 'uploading',
    running: 'running',
    done: 'success',
    stopped: 'warning',
    error: 'error'
  }[status] || ''
  // 부분 실패(done 인데 실패 있음)는 success(초록)로 보이지 않게 warning 색.
  const statusClass = (status === 'done' && errorCount > 0) ? 'warning' : baseStatusClass

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
