/**
 * ResultsTable Component - 결과 테이블
 */

import { useI18n } from '../hooks/useI18n'
import { getRatioClass } from '../utils/formatters'

export default function ResultsTable({ scenes, onRetry, aspectRatio = '16:9', onShowDetail }) {
  const { t } = useI18n()
  
  if (scenes.length === 0) {
    return (
      <div className="results-empty">
        {t('results.empty')}
      </div>
    )
  }
  
  const doneCount = scenes.filter(s => s.status === 'done').length
  const errorCount = scenes.filter(s => s.status === 'error').length
  
  const ratioClass = getRatioClass(aspectRatio)
  
  return (
    <div className="results-table-container">
      <div className="results-summary">
        <span>✅ {doneCount}</span>
        {errorCount > 0 && <span className="error-count">❌ {errorCount}</span>}
      </div>
      
      <table className="results-table">
        <thead>
          <tr>
            <th className="col-id">#</th>
            <th className="col-img">{t('results.image')}</th>
            <th className="col-prompt">{t('results.prompt')}</th>
            <th className="col-status">{t('results.status')}</th>
          </tr>
        </thead>
        <tbody>
          {scenes.map((scene, index) => (
            <tr key={scene.id} className={`status-${scene.status}`}>
              <td className="col-id">{index + 1}</td>
              
              <td className="col-img">
                <div
                  className={`image-cell ${ratioClass} ${scene.image ? 'clickable' : ''}`}
                  onClick={() => onShowDetail && onShowDetail(scene)}
                  title={t('headerExtra.clickToDetail')}
                >
                  {scene.image ? (
                    <img
                      src={scene.image}
                      alt={`Scene ${index + 1}`}
                      className="result-thumbnail"
                    />
                  ) : scene.status === 'generating' ? (
                    <div className="generating-indicator">
                      <span className="spinner">⚙️</span>
                    </div>
                  ) : (
                    <div className="empty-cell">-</div>
                  )}
                </div>
              </td>

              <td className="col-prompt">
                <div className="prompt-preview" title={scene.prompt}>
                  {scene.prompt.substring(0, 50)}
                  {scene.prompt.length > 50 && '...'}
                </div>
              </td>
              
              <td className="col-status">
                {scene.status === 'pending' && <span className="status pending">⏳ {t('status.pending')}</span>}
                {scene.status === 'generating' && <span className="status generating"><span className="spinner">⚙️</span> {t('status.generating')}</span>}
                {scene.status === 'done' && <span className="status done">✅ {t('status.done')}</span>}
                {scene.status === 'error' && (
                  <button 
                    className="status error retry-btn"
                    onClick={() => onRetry(scene.id)}
                    title={scene.error || t('actions.retryOne')}
                  >
                    🔄 {t('actions.retryOne')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
