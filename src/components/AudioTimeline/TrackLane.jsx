import Clip from './Clip'
import { TRACK_H, SUB_TRACK_H } from './constants'

const AUDIO_EXT_RE = /\.(mp3|wav|m4a)$/i
const SRT_EXT_RE = /\.srt$/i

export default function TrackLane({
  track, width, height, pxPerMs, renderClips = true,
  onClipClick, onClipDrag, totalDurationMs, playingClipIds, onSceneHover, onFlag, isFlagged,
  // 드래그앤드롭 (Phase 2)
  onTrackDrop, onTrackDragOver, onTrackDragLeave, dragOverTrackId,
}) {
  const h = height ?? (track.isSubTrack ? SUB_TRACK_H : TRACK_H)

  // narration/sfx 라인만 mp3 드롭 accept. 그 외 라인은 패널 레벨로 bubbling.
  const acceptsAudioDrop = track.acceptsDrop === 'audio'
  const isDropTarget = acceptsAudioDrop && dragOverTrackId === track.id

  const handleDragOver = (e) => {
    if (!acceptsAudioDrop) return
    // 파일 드래그만 처리 (텍스트/요소 드래그는 무시)
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    onTrackDragOver?.(track.id)
  }

  const handleDragLeave = (e) => {
    if (!acceptsAudioDrop) return
    // lane 내부 child로 들어갈 때마다 leave 이벤트가 발생함 — relatedTarget이 lane 안에 있으면 무시
    const rt = e.relatedTarget
    if (rt && e.currentTarget.contains(rt)) return
    onTrackDragLeave?.(track.id)
  }

  const handleDrop = (e) => {
    if (!acceptsAudioDrop) return
    const files = Array.from(e.dataTransfer.files || [])
    const mp3s = files.filter(f => AUDIO_EXT_RE.test(f.name))
    const hasSrt = files.some(f => SRT_EXT_RE.test(f.name))
    if (mp3s.length === 0) {
      // SRT만 떨어졌거나 알 수 없는 파일 — 패널 레벨 핸들러가 처리하도록 bubble
      onTrackDragLeave?.(track.id)
      return
    }
    // mp3는 여기서 처리. preventDefault로 브라우저 기본동작(파일 열기)만 막고,
    // SRT가 함께 있으면 stopPropagation 안 해서 패널 레벨 핸들러가 SRT를 처리.
    e.preventDefault()
    if (!hasSrt) e.stopPropagation()
    // 드롭 x좌표(lane 내부) → timecodeMs (lane은 라벨 영역 제외된 좌표계)
    const rect = e.currentTarget.getBoundingClientRect()
    const xInLane = Math.max(0, e.clientX - rect.left)
    const timecodeMs = pxPerMs ? xInLane / pxPerMs : 0
    onTrackDrop?.({ trackRole: track.role, files: mp3s, timecodeMs })
    onTrackDragLeave?.(track.id)
  }

  return (
    <div
      className={`atl-lane${isDropTarget ? ' is-drop-target' : ''}`}
      style={{ height: h, width }}
      data-track-id={track.id}
      data-track-role={track.role}
      data-accepts-drop={acceptsAudioDrop ? 'audio' : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {renderClips && (track.clips || []).map(clip => (
        <Clip
          key={clip.id}
          clip={clip}
          variant={track.variant}
          pxPerMs={pxPerMs}
          height={h}
          onClickClip={onClipClick}
          onDragClip={onClipDrag}
          totalDurationMs={totalDurationMs}
          isPlaying={playingClipIds?.has(clip.id)}
          onSceneHover={onSceneHover}
          onFlag={onFlag}
          isFlagged={isFlagged}
        />
      ))}
    </div>
  )
}
