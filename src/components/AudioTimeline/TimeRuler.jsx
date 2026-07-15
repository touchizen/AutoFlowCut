import { formatDuration } from '../../utils/formatters'
import { RULER_H } from './constants'

const RULER_VIRTUALIZATION_THRESHOLD = 200
const RULER_VIEWPORT_MARGIN_MS = 10_000

export default function TimeRuler({ totalMs, pxPerMs, width, visibleRangeMs = null }) {
  // 줌에 따라 major tick 간격 자동 결정
  const pxPerSec = pxPerMs * 1000
  let majorSec = 60
  if (pxPerSec > 200) majorSec = 1
  else if (pxPerSec > 80) majorSec = 5
  else if (pxPerSec > 30) majorSec = 10
  else if (pxPerSec > 10) majorSec = 30
  else majorSec = 60

  const totalSec = totalMs / 1000
  const totalTickCount = Math.floor(totalSec / majorSec) + 1
  let firstTickSec = 0
  let lastTickSec = Math.floor(totalSec / majorSec) * majorSec

  if (totalTickCount > RULER_VIRTUALIZATION_THRESHOLD) {
    if (!visibleRangeMs) {
      firstTickSec = 1
      lastTickSec = 0
    } else {
      const minMs = Math.max(0, visibleRangeMs.startMs - RULER_VIEWPORT_MARGIN_MS)
      const maxMs = Math.min(totalMs, visibleRangeMs.endMs + RULER_VIEWPORT_MARGIN_MS)
      firstTickSec = Math.ceil((minMs / 1000) / majorSec) * majorSec
      lastTickSec = Math.floor((maxMs / 1000) / majorSec) * majorSec
    }
  }

  const ticks = []
  for (let s = firstTickSec; s <= lastTickSec; s += majorSec) {
    // Tick 선택만 viewport 기준이다. 위치는 clip과 동일하게 항상 time zero 기준의
    // 절대 좌표를 써서 scroll/zoom 중에도 두 축이 어긋나지 않는다.
    ticks.push({ sec: s, x: s * 1000 * pxPerMs })
  }

  return (
    <div className="atl-ruler" style={{ width, height: RULER_H }}>
      {ticks.map(t => (
        <div key={t.sec} className="atl-ruler-tick" style={{ left: t.x }}>
          <div className="atl-ruler-line" />
          <div className="atl-ruler-label">{formatDuration(t.sec)}</div>
        </div>
      ))}
    </div>
  )
}
