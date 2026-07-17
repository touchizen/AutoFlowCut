/**
 * 이번 실행 누적 토큰 — `in 8.1k / out 4.2k`.
 *
 * in  = 캐시 포함 총 입력, out = thinking/reasoning 포함 총 출력. 두 엔진(claude/codex) 동일 정의.
 * 분리 가능하지만 빼지 않는다 — 빼면 같은 "out" 이 엔진마다 다른 걸 세게 된다.
 *
 * 영속 없음(앱 끄면 사라짐) · 비용 추정 없음 · 스텝별 표시 없음.
 */

/** 1000 미만은 그대로, 이상은 k. 1234 → '1.2k', 999 → '999'. */
export function formatTokens(n) {
  const v = typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
  if (v < 1000) return String(v)
  const k = v / 1000
  return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`
}

export default function StoryTokenUsage({ usage }) {
  // 아직 아무것도 안 돌았으면 자리를 차지하지 않는다.
  if (!usage || (!usage.input && !usage.output)) return null
  return (
    <div className="story-token-usage" title="이번 실행 누적 토큰 (앱을 끄면 사라집니다)">
      <span className="story-token-usage__item">in {formatTokens(usage.input)}</span>
      <span className="story-token-usage__sep">/</span>
      <span className="story-token-usage__item">out {formatTokens(usage.output)}</span>
    </div>
  )
}
