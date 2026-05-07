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
import ErrorSection from './ErrorSection'
import MediaMetaBar from './MediaMetaBar'
import { fetchLatestHistoryMeta, estimateBase64FileSize } from '../utils/mediaMeta'
import { resolveVideoSrc, ensureBase64DataUrl } from '../utils/videoSrc'
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
  // 신규 생성은 video.seed/generatedAt 으로 들어오지만, 구버전은 비어있음 → history 메타에서 backfill
  const [backfilledMeta, setBackfilledMeta] = useState({ seed: null, generatedAt: null, model: null })
  // 사용자가 history 항목을 복원 선택했을 때 그 항목의 메타.
  // null 이면 현재 video prop 의 메타(seed/generatedAt/model) 사용 — 즉 "복원 안 함" 상태.
  const [activeMeta, setActiveMeta] = useState(null)

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
    setActiveMeta(null)  // prop 갱신 = 부모 상태가 권위 — 로컬 복원 메타 리셋
    setDirty(false)
  }, [video.video, video.videoPath])

  // History에서 비디오 복원 — 파일 시스템 복원 + state 업데이트 (저장 시 부모 반영)
  const handleRestoreHistory = async (historyItem) => {
    if (!projectName || !video.id) {
      toast.error(t('imageHistory.restoreFailed') || 'Restore failed')
      return
    }
    try {
      // 기존 videoPath 의 확장자를 유지하거나, 없으면 history 파일 확장자 사용
      const histExt = historyItem.filename?.match(/\.(mp4|webm|mov|m4v)$/i)?.[1]?.toLowerCase() || 'mp4'
      // canonical 파일명 우선순위:
      //   1. video.videoSaveId — 저장 시 사용된 canonical 식별자 (t2v_N / i2v_N)
      //   2. video.videoPath basename — videoSaveId 누락 시 현재 파일 위치
      //   3. video.id 자체 (legacy)
      // ResultsTable 의 vscene_X / fp_X 로 모달이 열려도 실제 디스크 파일은 t2v_X / i2v_X 이므로
      // videoSaveId 우선해야 한다. 빠뜨리면 vscene_X.mp4 로 복원되고 t2v_X.mp4 (canonical)
      // 가 그대로 남아 → 다음 로드 시 remapVideoPath 가 옛 t2v_X 로 되돌림.
      let baseFilename = null
      if (video.videoSaveId) {
        baseFilename = video.videoSaveId
      } else if (video.videoPath) {
        baseFilename = video.videoPath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || null
      }
      const currentFilename = `${baseFilename || video.id}.${histExt}`

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
      // 복원한 history 항목의 metadata(seed/timestamp/model)를 별도 state 로 보존.
      // 사용자가 저장하면 부모로 함께 흘려보내야 project.json 의 stale 메타가 갱신됨.
      const meta = historyItem.metadata || {}
      setActiveMeta({
        seed: meta.seed ?? null,
        generatedAt: typeof meta.timestamp === 'number' ? meta.timestamp : null,
        model: meta.model ?? null,
        mediaId: meta.mediaId ?? null,
      })
      setDirty(true)
    } catch (err) {
      console.error('[VideoDetail] Restore history failed:', err)
      toast.error(err.message)
    }
  }

  // 저장 — 부모 state 에 반영 후 닫기. 복원한 history 가 있으면 메타도 함께 패치.
  const handleSave = () => {
    if (typeof onUpdate === 'function') {
      const patch = { video: activeVideo, videoPath: activeVideoPath }
      if (activeMeta) {
        // 복원 시 받은 메타를 그대로 — null 이면 명시적으로 null 넣어 stale 값 제거.
        patch.seed = activeMeta.seed
        patch.generatedAt = activeMeta.generatedAt
        patch.model = activeMeta.model
        if (activeMeta.mediaId) patch.mediaId = activeMeta.mediaId
      }
      onUpdate(video.id, patch)
    }
    onClose()
  }

  // video state 에 seed/generatedAt 가 없으면 history metadata 에서 backfill (구버전 호환).
  // generatingEndedAt 은 비디오 생성 완료 시각이라 timestamp 폴백으로 활용.
  useEffect(() => {
    let cancelled = false
    const need = (video.seed == null) || (video.generatedAt == null && video.generatingEndedAt == null) || (video.model == null)
    if (!need || !projectName || !video.id) {
      setBackfilledMeta({ seed: null, generatedAt: null, model: null })
      return
    }
    const baseName = video.videoSaveId || (video.videoPath
      ? video.videoPath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '')
      : video.id)
    fetchLatestHistoryMeta(projectName, 'videos', baseName).then(meta => {
      if (cancelled) return
      setBackfilledMeta({
        seed: meta.seed ?? null,
        generatedAt: meta.generatedAt ?? null,
        model: meta.model ?? null
      })
    })
    return () => { cancelled = true }
  }, [projectName, video.id, video.seed, video.generatedAt, video.generatingEndedAt, video.videoSaveId, video.videoPath, video.model])

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

  // 비디오 소스: base64 (메모리) 우선, 없으면 file path — 공용 유틸로 통합.
  const videoSrc = resolveVideoSrc(activeVideo, activeVideoPath || video.videoPath)

  // base64 데이터에서 파일 사이즈 추정 — 공통 유틸 재사용
  const getFileSize = () => estimateBase64FileSize(activeVideo)

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
        <>
          <button className="btn-secondary" onClick={onClose}>
            {t('actions.cancel') || 'Cancel'}
          </button>
          {typeof onUpdate === 'function' && (
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={!dirty}
              title={dirty ? '' : (t('detail.noChanges') || 'No changes')}
            >
              💾 {t('actions.save') || 'Save'}
            </button>
          )}
        </>
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

          {/* 1줄 메타: 해상도 · 재생시간 · 파일크기 · seed · 생성일시 + ▼ 토글로 모델.
              activeMeta 가 set 됐다는 건 사용자가 history 항목을 복원했다는 뜻 —
              그 항목에 메타가 비어있어도(null) 명시적 의도이므로 video/backfill fall-through 금지.
              저장 patch 도 activeMeta 의 null 을 그대로 보내므로 UI/저장값 일치. */}
          <MediaMetaBar
            width={videoSize?.width}
            height={videoSize?.height}
            duration={videoSize?.duration}
            fileSize={videoSize?.fileSize}
            seed={activeMeta ? activeMeta.seed : (video.seed ?? backfilledMeta.seed)}
            generatedAt={
              activeMeta
                ? activeMeta.generatedAt
                : (video.generatedAt
                    ?? backfilledMeta.generatedAt
                    ?? video.generatingEndedAt)
            }
            model={activeMeta ? activeMeta.model : (video.model ?? backfilledMeta.model)}
            t={t}
          />

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

          {/* 에러 정보 (생성 실패 시에만 노출) */}
          <ErrorSection error={video.error} />
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
                      src={ensureBase64DataUrl(hist.data)}
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
