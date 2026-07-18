/**
 * 세션 누적 토큰 표시용 포맷터. 실제 표시는 StoryView 의 UsageInline 이 스텝별 인라인으로 한다
 * (별도 하단 바 StoryTokenUsage 컴포넌트는 제거됨 — 인라인으로 대체).
 *
 * 누적 정의: in = 캐시 포함 총 입력, out = thinking/reasoning 포함 총 출력. 두 엔진(claude/codex)
 * 동일. "이번 실행"이 아니라 "프로젝트 세션 누적"이다 — 리셋 지점은 프로젝트 전환 하나뿐.
 */

/** 1000 미만은 그대로, 1000 이상은 k, 100만 이상은 M. in 은 캐시를 포함해 쉽게 백만을 넘는다. */
export function formatTokens(n) {
  const v = typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
  if (v < 1000) return String(v)
  if (v < 1_000_000) {
    const k = v / 1000
    return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`
  }
  const m = v / 1_000_000
  return `${m < 10 ? m.toFixed(1) : Math.round(m)}M`
}

/** 세션 누적 토큰 인라인(`in 8.1k / out 4.2k`) — 각 스텝 기존 UI 에 얹는다. 0/0 이면 숨긴다
 *  (파이프라인 돌리기 전엔 안 뜨는 게 정상). className 으로 얹히는 자리에 맞춰 여백만 조절. */
export function UsageInline({ usage, className = '' }) {
  if (!usage || (!usage.input && !usage.output)) return null
  return (
    <span className={`story-usage-inline ${className}`.trim()}>
      in {formatTokens(usage.input)} / out {formatTokens(usage.output)}
    </span>
  )
}
