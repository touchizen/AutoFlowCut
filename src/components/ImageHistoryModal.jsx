/**
 * ImageHistoryModal - 씬별 이미지 히스토리 모달
 * 
 * 해당 씬의 이전 이미지들을 보여주고 선택하여 복원 가능
 */

import { useState, useEffect } from 'react'
import { useI18n } from '../hooks/useI18n'
import { RESOURCE } from '../config/defaults'
import { fileSystemAPI } from '../hooks/useFileSystem'
import Modal from './Modal'
import './ImageHistoryModal.css'

export default function ImageHistoryModal({
  isOpen,
  onClose,
  projectName,
  sceneId,
  currentImage,
  onRestore
}) {
  const { t } = useI18n()
  const [histories, setHistories] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [restoring, setRestoring] = useState(null)
  
  // 히스토리 로드
  useEffect(() => {
    if (isOpen && projectName && sceneId) {
      loadHistories()
    }
  }, [isOpen, projectName, sceneId])
  
  const loadHistories = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const result = await fileSystemAPI.getHistory(projectName, RESOURCE.SCENES, sceneId)
      
      if (result.success) {
        // 히스토리 파일들의 이미지 URL 로드
        const historiesWithUrls = await Promise.all(
          result.histories.map(async (hist) => {
            const fileResult = await fileSystemAPI.readHistoryFile(projectName, RESOURCE.SCENES, hist.filename)
            return {
              ...hist,
              imageUrl: fileResult.success ? fileResult.data : null
            }
          })
        )
        setHistories(historiesWithUrls)
      } else {
        setHistories([])
      }
    } catch (err) {
      console.error('[ImageHistory] Load error:', err)
      setError(err.message)
      setHistories([])
    } finally {
      setLoading(false)
    }
  }
  
  // 히스토리에서 복원
  const handleRestore = async (historyFilename) => {
    setRestoring(historyFilename)
    setError(null)
    
    try {
      // 현재 파일명 추출 (scene_001.png)
      const currentFilename = `${sceneId}.png`
      
      const result = await fileSystemAPI.restoreFromHistory(
        projectName, 
        RESOURCE.SCENES, 
        currentFilename, 
        historyFilename
      )
      
      if (result.success) {
        // 복원된 이미지 데이터 읽기
        const imageResult = await fileSystemAPI.readFile(projectName, RESOURCE.SCENES, currentFilename)
        
        if (imageResult.success && onRestore) {
          onRestore(imageResult.data)
        }
        
        // 히스토리 다시 로드
        await loadHistories()
      } else {
        setError(result.error || t('imageHistory.restoreFailed'))
      }
    } catch (err) {
      console.error('[ImageHistory] Restore error:', err)
      setError(err.message)
    } finally {
      setRestoring(null)
    }
  }
  
  // 기록 삭제
  const handleDelete = async (historyFilename) => {
    if (!confirm(t('imageHistory.deleteConfirm'))) return
    
    try {
      const result = await fileSystemAPI.deleteHistory(projectName, RESOURCE.SCENES, historyFilename)
      if (result.success) {
        await loadHistories()
      }
    } catch (err) {
      console.error('[ImageHistory] Delete error:', err)
    }
  }
  
  // 날짜 포맷
  const formatDate = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  if (!isOpen) return null
  
  const footer = (
    <button className="btn-secondary" onClick={onClose}>{t('imageHistory.close')}</button>
  )
  
  return (
    <Modal 
      onClose={onClose} 
      title={t('imageHistory.title', { sceneId })}
      className="image-history-modal"
      footer={footer}
    >
      <div className="history-modal-content">
        {/* 현재 이미지 */}
        {currentImage && (
          <div className="current-image-section">
            <h4>{t('imageHistory.currentImage')}</h4>
            <div className="current-image-preview">
              <img src={currentImage} alt={t('imageHistory.currentImage')} />
              <span className="current-badge">{t('imageHistory.currentBadge')}</span>
            </div>
          </div>
        )}
        
        {/* 에러 메시지 */}
        {error && (
          <div className="history-error">
            ⚠️ {error}
          </div>
        )}
        
        {/* 로딩 */}
        {loading && (
          <div className="history-loading">
            {t('imageHistory.loading')}
          </div>
        )}
        
        {/* 히스토리 목록 */}
        {!loading && (
          <div className="history-section">
            <h4>{t('imageHistory.previousVersions', { count: histories.length })}</h4>
            
            {histories.length === 0 ? (
              <div className="history-empty">
                {t('imageHistory.noPreviousVersions')}
              </div>
            ) : (
              <div className="history-grid">
                {histories.map((hist) => (
                  <div key={hist.filename} className="history-item">
                    <div className="history-image">
                      {hist.imageUrl ? (
                        <img src={hist.imageUrl} alt={hist.filename} />
                      ) : (
                        <div className="no-preview">{t('imageHistory.noPreview')}</div>
                      )}
                    </div>
                    
                    <div className="history-info">
                      <span className="history-engine">{hist.engine}</span>
                      <span className="history-date">{formatDate(hist.timestamp)}</span>
                    </div>
                    
                    <div className="history-actions">
                      <button
                        className="btn-restore"
                        onClick={() => handleRestore(hist.filename)}
                        disabled={restoring === hist.filename}
                      >
                        {restoring === hist.filename ? t('imageHistory.restoring') : t('imageHistory.useThisImage')}
                      </button>
                      <button
                        className="btn-delete-small"
                        onClick={() => handleDelete(hist.filename)}
                        title={t('imageHistory.delete')}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
