/**
 * AudioDetailModal - 오디오 클립 상세 모달
 *
 * 클립 클릭 시 표시되는 모달. 자체 재생 로직은 갖지 않고 부모(AudioPanel)가
 * useAudioPlayback으로 관리하는 상태/콜백을 prop으로 받음.
 */

import Modal from './Modal'
import RealWaveform from './RealWaveform'

function formatTimecode(ms) {
  if (ms == null) return ''
  const totalSec = Math.floor(ms / 1000)
  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
}

export default function AudioDetailModal({
  selectedItem,
  onClose,
  audioReviews,
  getRelativePath,
  isFlagged,
  playingFile,
  playProgress,
  onPlayToggle,
  t,
}) {
  if (!selectedItem) return null

  // 씬 이미지 (camelCase / snake_case / filePath 모두 지원)
  const sceneImg = selectedItem.matchedScene?.imagePath
    || selectedItem.matchedScene?.image_path
    || selectedItem.matchedScene?.filePath

  const flagged = isFlagged?.(selectedItem.path)
  const flagReason = flagged
    ? audioReviews?.[getRelativePath?.(selectedItem.path)]?.reason || ''
    : ''

  const title = `${selectedItem.type === 'voice' ? '🎤' : '🔊'} ${formatTimecode(selectedItem.timecodeMs)} — ${selectedItem.filename}`

  const isPlaying = playingFile === selectedItem.path

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title}
      className="audio-detail-modal"
    >
      {/* 씬 이미지 */}
      {sceneImg && (
        <img className="audio-detail-hero" src={`file://${sceneImg}`} alt="" />
      )}

      {/* 오디오 재생 */}
      <div className="audio-detail-play-row">
        <button
          className={`play-btn${isPlaying ? ' playing' : ''}`}
          onClick={(e) => onPlayToggle?.(selectedItem.path, e)}
          title={isPlaying ? 'Stop' : 'Play'}
        >
          {isPlaying ? '■' : '▶'}
        </button>
        <span className="audio-detail-filename">{selectedItem.filename}</span>
      </div>

      {/* 진짜 파형 + 재생 진행도 */}
      <RealWaveform
        filePath={selectedItem.path}
        color={selectedItem.type === 'voice' ? '#BA68C8' : '#FFB74D'}
        height={80}
        progress={isPlaying ? playProgress : 0}
      />

      {/* 자막 */}
      {selectedItem.srtMatch?.text && (
        <div className="audio-detail-card">
          <div className="audio-detail-card-label">📝 자막</div>
          <div className="audio-detail-card-text">{selectedItem.srtMatch.text}</div>
        </div>
      )}

      {/* 씬 정보 */}
      {selectedItem.matchedScene && (
        <div className="audio-detail-card">
          <div className="audio-detail-card-label">🎬 씬</div>
          {selectedItem.matchedScene.prompt_ko && (
            <div className="audio-detail-card-title">{selectedItem.matchedScene.prompt_ko}</div>
          )}
          {selectedItem.matchedScene.subtitle && (
            <div className="audio-detail-card-text">{selectedItem.matchedScene.subtitle}</div>
          )}
          {selectedItem.matchedScene.characters && (
            <div className="audio-detail-card-meta">👤 {selectedItem.matchedScene.characters}</div>
          )}
        </div>
      )}

      {/* 부적합 마크 */}
      {flagged && (
        <div className="audio-detail-card audio-detail-card-flagged">
          <div className="audio-detail-card-label">⚠️ {t?.('audioTab.flagged') || 'Flagged'}</div>
          <div className="audio-detail-card-text">{flagReason}</div>
        </div>
      )}
    </Modal>
  )
}
