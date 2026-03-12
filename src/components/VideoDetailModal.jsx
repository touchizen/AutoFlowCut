/**
 * VideoDetailModal - 비디오 상세 모달
 *
 * 비디오 재생, 프롬프트 확인, 히스토리 탐색.
 * SceneDetailModal과 동일한 레이아웃 패턴 사용.
 */

import { useState, useEffect } from 'react'
import { fileSystemAPI } from '../hooks/useFileSystem'
import { toast } from './Toast'
import Modal from './Modal'
import './SceneDetailModal.css'   // 공통 스타일 재사용

export default function VideoDetailModal({
  video,          // 비디오 씬 객체 { id, prompt, video (base64), mediaId, videoPath, status, ... }
  onClose,
  t,
  projectName,
}) {
  const [histories, setHistories] = useState([])
  const [activeVideo, setActiveVideo] = useState(video.video || null)
  const [videoSize, setVideoSize] = useState(null)

  // video prop 변경 시 업데이트 (실제로 바뀔 때만 리셋)
  useEffect(() => {
    setActiveVideo(prev => {
      const next = video.video || null
      if (prev !== next) {
        setVideoSize(null)
        return next
      }
      return prev
    })
  }, [video.video])

  // 히스토리 로드
  useEffect(() => {
    if (!projectName || !video.id) return

    const loadHistory = async () => {
      const result = await fileSystemAPI.getHistory(projectName, 'videos', video.id)
      if (result.success && result.histories?.length > 0) {
        const historiesWithData = await Promise.all(
          result.histories.map(async (hist) => {
            const fileResult = await fileSystemAPI.readHistoryFile(projectName, 'videos', hist.filename)
            return {
              ...hist,
              data: fileResult.success ? fileResult.data : null,
              metadata: fileResult.metadata || null,
            }
          })
        )
        setHistories(historiesWithData.filter(h => h.data))
      }
    }
    loadHistory()
  }, [projectName, video.id])

  const videoSrc = activeVideo
    ? (activeVideo.startsWith('data:') ? activeVideo : `data:video/mp4;base64,${activeVideo}`)
    : null

  // base64 데이터에서 파일 사이즈 추정
  const getFileSize = () => {
    if (!activeVideo) return null
    const b64 = activeVideo.replace(/^data:[^;]+;base64,/, '')
    const bytes = Math.round(b64.length * 0.75)
    if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    if (bytes > 1024) return `${Math.round(bytes / 1024)} KB`
    return `${bytes} B`
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    toast.success(t('toast.copied') || 'Copied!')
  }

  const workFolder = localStorage.getItem('workFolderPath') || ''

  const openInFinder = (relativePath) => {
    if (!relativePath || !workFolder) return
    const absolutePath = `${workFolder}/${relativePath}`
    window.electronAPI?.showInFolder?.(absolutePath)
  }

  const hasHistory = histories.length > 0

  return (
    <Modal
      onClose={onClose}
      title={`${t('results.video') || 'Video'} — ${video.id || ''}`}
      className={`scene-detail-modal ref-detail-modal${hasHistory ? ' has-history' : ''}`}
      footer={
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('actions.close') || 'Close'}
          </button>
        </div>
      }
    >
      <div className="ref-detail-layout">
        {/* Main Column */}
        <div className="ref-detail-main">
          {/* Video Preview */}
          <div className="ref-detail-preview video-preview-container">
            {videoSrc ? (
              <video
                src={videoSrc}
                controls
                muted
                className="video-detail-player"
                onLoadedMetadata={(e) => {
                  const v = e.target
                  if (v.videoWidth && v.videoHeight) {
                    setVideoSize({
                      width: v.videoWidth,
                      height: v.videoHeight,
                      duration: Math.round(v.duration * 10) / 10,
                      fileSize: getFileSize(),
                    })
                  }
                }}
                onLoadedData={(e) => {
                  const v = e.target
                  setVideoSize(prev => {
                    if (prev) return prev
                    if (v.videoWidth && v.videoHeight) {
                      return {
                        width: v.videoWidth,
                        height: v.videoHeight,
                        duration: Math.round(v.duration * 10) / 10,
                        fileSize: getFileSize(),
                      }
                    }
                    return prev
                  })
                }}
              />
            ) : (
              <div className="ref-placeholder">
                <span style={{ fontSize: '2rem' }}>🎬</span>
                <span>{t('status.pending') || 'No video'}</span>
              </div>
            )}
          </div>

          {/* Resolution + Duration + File Size */}
          {videoSize && (
            <div className="video-info-bar">
              <span className="resolution">{videoSize.width} × {videoSize.height}</span>
              <span className="dot-sep">·</span>
              <span>{videoSize.duration}s</span>
              {videoSize.fileSize && (
                <>
                  <span className="dot-sep">·</span>
                  <span>{videoSize.fileSize}</span>
                </>
              )}
            </div>
          )}

          {/* Prompt */}
          <div className="form-group">
            <div className="label-with-copy">
              <label>{t('results.prompt') || 'Prompt'}</label>
              {video.prompt && (
                <button
                  className="btn-copy"
                  onClick={() => copyToClipboard(video.prompt)}
                  title="Copy"
                >&#x29C9;</button>
              )}
            </div>
            <div className="video-detail-prompt">
              {video.prompt || '-'}
            </div>
          </div>

          {/* Meta Info */}
          <div className="form-group">
            <label>{t('videoDetail.info') || 'Info'}</label>
            <div className="video-detail-meta">
              {video.mediaId && (
                <div className="meta-row">
                  <span className="meta-label">Media ID</span>
                  <span className="meta-value" title={video.mediaId}>
                    {video.mediaId.substring(0, 24)}...
                    <button
                      className="btn-copy"
                      onClick={() => copyToClipboard(video.mediaId)}
                    >&#x29C9;</button>
                  </span>
                </div>
              )}
              {video.generationId && (
                <div className="meta-row">
                  <span className="meta-label">Generation ID</span>
                  <span className="meta-value" title={video.generationId}>
                    {video.generationId.substring(0, 24)}...
                  </span>
                </div>
              )}
              {video.videoPath && (
                <div className="meta-row">
                  <span className="meta-label">{t('videoDetail.path') || 'Path'}</span>
                  <span className="meta-value" title={video.videoPath}>
                    ...{video.videoPath.split('/').slice(-2).join('/')}
                    <button
                      className="btn-folder-open"
                      onClick={() => openInFinder(video.videoPath)}
                      title="Reveal in Finder"
                    >📂</button>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* History Column */}
        {hasHistory && (
          <div className="ref-detail-history">
            <div className="history-title">{t('detail.history') || 'History'}</div>
            <div className="history-scroll">
              {histories.map((hist, idx) => {
                const isActive = hist.data === activeVideo
                return (
                  <div
                    key={idx}
                    className={`history-item${isActive ? ' selected' : ''}`}
                    onClick={() => setActiveVideo(hist.data)}
                    title={hist.timestamp || hist.filename}
                  >
                    <video
                      src={hist.data?.startsWith('data:') ? hist.data : `data:video/mp4;base64,${hist.data}`}
                      muted
                      preload="metadata"
                      className="history-thumb-video"
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
