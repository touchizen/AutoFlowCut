import { useElapsedTimer } from '../hooks/useElapsedTimer'
import { formatElapsed } from '../utils/formatters'

/**
 * 공통 초시계 아이콘 — 초침이 실시간 회전(전역 `.stopwatch-hand` 애니메이션 재사용, App.css).
 * 여러 화면(ResultsTable/ReferenceCard/FrameToVideoPanel/Story 등)에 로컬 복붙돼 있던 것을
 * 하나로 모으기 위한 공통 컴포넌트 — 신규 사용처는 이걸 import 한다(기존 로컬 정의는 점진 마이그레이션).
 */
export function StopwatchIcon({ size = 18 }) {
  const r = size / 2
  const cx = r, cy = r
  const handLen = r * 0.6
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="stopwatch-icon">
      <circle cx={cx} cy={cy} r={r - 1.5} fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1={cx} y1={cy - r + 1.5} x2={cx} y2={cy - r + 3.5} stroke="currentColor" strokeWidth="1.2" />
      <rect x={cx - 1} y={0} width={2} height={2} rx={0.5} fill="currentColor" />
      <line
        className="stopwatch-hand"
        x1={cx} y1={cy}
        x2={cx} y2={cy - handLen}
        stroke="var(--accent, #3b82f6)" strokeWidth="1.5" strokeLinecap="round"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      <circle cx={cx} cy={cy} r={1.2} fill="var(--accent, #3b82f6)" />
    </svg>
  )
}

/** 경과 시간 표시 (1초마다 갱신, endedAt 있으면 멈추고 최종값 유지). */
export function ElapsedTime({ startedAt, endedAt = null }) {
  const elapsed = useElapsedTimer(startedAt || null, endedAt)
  return <span>{formatElapsed(elapsed)}</span>
}
