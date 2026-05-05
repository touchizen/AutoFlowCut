import { useMemo } from 'react'
import { parseTimeToSeconds } from '../../utils/parsers'

// 현재 playhead 위치의 씬 이미지 + 자막
export default function PreviewPanel({ playheadMs, scenes, srtEntries, height = 240 }) {
  // 시간 기준 씬 매칭 (camelCase / snake_case 둘 다 지원)
  const scene = useMemo(() => {
    if (!scenes?.length) return null
    const timeSec = playheadMs / 1000
    return scenes.find(s => {
      const startRaw = s.startTime ?? s.start_time
      const endRaw = s.endTime ?? s.end_time
      const start = typeof startRaw === 'number' ? startRaw : parseTimeToSeconds(startRaw)
      const end = typeof endRaw === 'number' ? endRaw : parseTimeToSeconds(endRaw)
      if (isNaN(start) || isNaN(end)) return false
      return timeSec >= start && timeSec < end
    }) || null
  }, [scenes, playheadMs])

  // SRT 자막 — 정확히 그 시점에 표시되는 것만
  const srt = useMemo(() => {
    if (!srtEntries?.length) return null
    return srtEntries.find(e => playheadMs >= e.startMs && playheadMs <= e.endMs) || null
  }, [srtEntries, playheadMs])

  const imgPath = scene?.imagePath || scene?.image_path || scene?.filePath
  const subtitleText = srt?.text || ''

  return (
    <div className="atl-preview" style={{ height }}>
      <div className="atl-preview-stage">
        {imgPath ? (
          <img className="atl-preview-img" src={`file://${imgPath}`} alt="" />
        ) : (
          <div className="atl-preview-empty">— 씬 없음 —</div>
        )}
        {subtitleText && (
          <div className="atl-preview-subtitle">{subtitleText}</div>
        )}
      </div>
    </div>
  )
}
