import { formatDuration } from '../../utils/formatters'
import { RULER_H } from './constants'

export default function TimeRuler({ totalMs, pxPerMs, width }) {
  // 줌에 따라 major tick 간격 자동 결정
  const pxPerSec = pxPerMs * 1000
  let majorSec = 60
  if (pxPerSec > 200) majorSec = 1
  else if (pxPerSec > 80) majorSec = 5
  else if (pxPerSec > 30) majorSec = 10
  else if (pxPerSec > 10) majorSec = 30
  else majorSec = 60

  const totalSec = totalMs / 1000
  const ticks = []
  for (let s = 0; s <= totalSec; s += majorSec) {
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
