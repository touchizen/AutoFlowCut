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
  onUpdate,       // (videoId, patch) => void — 부모 state 업데이트 (history 복원 후 저장)
}) {
  const [histories, setHistories] = useState([])
  const [activeVideo, setActiveVideo] = useState(video.video || null)
  const [activeVideoPath, setActiveVideoPath] = useState(video.videoPath || null)
  const [videoSize, setVideoSize] = useState(null)
  const [dirty, setDirty] = useState(false)

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
    setActiveVideoPath(video.videoPath || null)
    setDirty(false)
  }, [video.video, video.videoPath])

  // History에서 비디오 복원 — 파일 시스템 복원 + state 업데이트 (저장 시 부모 반영)
  const handleRestoreHistory = async (historyItem) => {
    if (!projectName || !video.id) {
      toast.error(t('imageHistory.restoreFailed') || 'Restore failed')
      return
    }
    try {
      // 비디오 ID prefix 제거하여 base 파일명 결정 (vscene_X, fp_X, t2v_X, i2v_X 등)
      const baseId = video.id.replace(/^(vscene_|fp_|t2v_|i2v_)/, '')
      // 기존 videoPath의 확장자를 유지하거나, 없으면 history 파일 확장자 사용
      const histExt = historyItem.filename?.match(/\.(mp4|webm|mov|m4v)$/i)?.[1]?.toLowerCase() || 'mp4'
      // 비디오 ID prefix 보존하여 currentFilename 생성 (vscene_X.mp4, t2v_X.mp4 등)
      const prefix = video.id.match(/^(vscene_|fp_|t2v_|i2v_)/)?.[1] || ''
      const currentFilename = `${prefix}${baseId}.${histExt}`

      const result = await fileSystemAPI.restoreFromHistory(
        projectName,
        'videos',
        currentFilename,
        historyItem.filename
      )

      if (!result.success) {
        toast.error(t('imageHistory.restoreFailed') || result.error || 'Restore failed')
        return
      }

      setActiveVideo(historyItem.data)
      setActiveVideoPath(result.path || null)
      setVideoSize(null)
      setDirty(true)
    } catch (err) {
      console.error('[VideoDetail] Restore history failed:', err)
      toast.error(err.message)
    }
  }

  // 저장 — 부모 state에 반영 후 닫기
  const handleSave = () => {
    if (typeof onUpdate === 'function') {
      onUpdate(video.id, { video: activeVideo, videoPath: activeVideoPath })
    }
    onClose()
  }

  // 히스토리 로드 + 비디오 데이터 없으면 최신 히스토리에서 자동 로드
  useEffect(() => {
    if (!projectName || !video.id) return

    const loadHistory = async () => {
      // videoPath에서 실제 파일명(i2v_N 등) 추출, 없으면 video.id 사용
      const baseName = video.videoPath
        ? video.videoPath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '')
        : video.id
      const result = await fileSystemAPI.getHistory(projectName, 'videos', baseName)
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
        const validHistories = historiesWithData.filter(h => h.data)
        setHistories(validHistories)
        // 메모리에 비디오 데이터 없으면 최신 히스토리에서 자동 로드
        if (!video.video && validHistories.length > 0) {
          setActiveVideo(validHistories[0].data)
        }
      }
    }
    loadHistory()
  }, [projectName, video.id, video.video])

  // 비디오 소스: base64 데이터 또는 파일 경로
  const resolveVideoSrc = (data) => {
    if (!data) return null
    if (data.startsWith('data:')) return data
    if (data.startsWith('/')) return `file://${data}`
    if (/^[A-Z]:\\/i.test(data)) return `file:///${data.replace(/\\/g, '/')}`
    return `data:video/mp4;base64,${data}`
  }
  const videoSrc = activeVideo
    ? resolveVideoSrc(activeVideo)
    : (video.videoPath ? resolveVideoSrc(video.videoPath) : null)

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
          {typeof onUpdate === 'function' && (
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!dirty}
              title={dirty ? '' : (t('detail.noChanges') || 'No changes')}
            >
              💾 {t('actions.save') || 'Save'}
            </button>
          )}
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
                    onClick={() => handleRestoreHistory(hist)}
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
