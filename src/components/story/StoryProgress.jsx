/**
 * StoryProgress — StoryView의 진행 표시 프레젠테이션 컴포넌트(StoryRunning, GenClock).
 *
 * StoryView.jsx 분리(§ componentization)로 옮겼다. 동작 변경 없음.
 */
import { useEffect, useRef } from 'react'
import { StopwatchIcon, ElapsedTime } from '../StopwatchIcon'
import { formatProgressLogTime } from './storyViewUtils'

/** 스텝 진행 중 표시 — (선택) 옵션·기준 요약 + 초시계 + 라벨 + 경과 시간(updatedAt 기준, 1초 갱신). */
export function StoryRunning({ label, startedAt, detail, log = [] }) {
  const logRef = useRef(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log.length])
  return (
    <div className="story-running" aria-live="polite">
      {detail && <div className="story-running-detail">{detail}</div>}
      <div className="story-running-main">
        <StopwatchIcon size={18} />
        <span className="story-running-label">{label}</span>
        <span className="story-running-elapsed"><ElapsedTime startedAt={startedAt || null} /></span>
      </div>
      {log.length > 0 && (
        <div className="story-progress-log" ref={logRef} role="log" aria-live="polite">
          {log.map((entry, i) => (
            <div key={entry.id || `${entry.phase || 'log'}-${i}`} className={`story-progress-log-row ${entry.level || 'info'}`}>
              <span className="story-progress-log-time">{formatProgressLogTime(entry.at)}</span>
              <span className="story-progress-log-message">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 생성 중 인라인 시계 — 스트리밍(시놉시스/시나리오)처럼 텍스트만 뜨는 뷰 하단 우측에 붙여
 *  "돌고 있음 + 경과 시간"을 보인다(초시계 애니메이션 + 1초 갱신). reasoning=max 등 첫 출력이
 *  늦을 때 화면이 텅 비어 멈춘 것처럼 보이던 문제를 해소. */
export function GenClock({ startedAt, label }) {
  return (
    <div className="story-gen-clock" aria-live="polite">
      <StopwatchIcon size={14} />
      {label && <span className="story-gen-clock-label">{label}</span>}
      <span className="story-running-elapsed"><ElapsedTime startedAt={startedAt || null} /></span>
    </div>
  )
}
