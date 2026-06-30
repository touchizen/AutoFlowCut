/**
 * StatusBar Component - 진행 상태 표시
 */

import { useElapsedTimer } from '../hooks/useElapsedTimer'
import { formatElapsed } from '../utils/formatters'
import { isSceneGenerationDone } from '../services/generationStatus'

export default function StatusBar({ progress, status, message, scenes = [], progressIsVideo = false }) {
  const elapsed = useElapsedTimer(progress.startedAt, progress.endedAt)

  // 씬 통계 (항상 계산)
  const doneCount = scenes.filter(isSceneGenerationDone).length
  const sceneErrorCount = scenes.filter(s => s.status === 'error').length
  // 표시 중인 progress 가 비디오면 비디오 실패(progress.errorCount)를 쓴다 — scenes 는
  // 이미지 씬이라, 옛 이미지 에러가 비디오 성공에 새어들어 false warning 나는 걸 방지(도메인 분리).
  // 이미지 뷰는 scenes 가 진실(progress.errorCount 와 동일).
  const errorCount = progressIsVideo ? (progress?.errorCount || 0) : sceneErrorCount
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
