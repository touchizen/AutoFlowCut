import Clip from './Clip'
import { TRACK_H, SUB_TRACK_H } from './constants'

export default function TrackLane({ track, width, height, pxPerMs, renderClips = true, onClipClick, onClipDrag, totalDurationMs, playingClipIds, onSceneHover, onFlag, isFlagged }) {
  const h = height ?? (track.isSubTrack ? SUB_TRACK_H : TRACK_H)
  return (
    <div className="atl-lane" style={{ height: h, width }}>
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
