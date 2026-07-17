/**
 * 이 프로젝트 세션의 누적 토큰 — `in 8.1k / out 4.2k`.
 *
 * **"이번 실행"이 아니다.** 리셋 지점은 프로젝트 전환 하나뿐이다 — 이 앱에 "실행 시작"이라는
 * 단일 이벤트가 없기 때문이다(자동 진행은 start() 연쇄, 제목/시놉시스는 start() 밖). 라벨을
 * "이번 실행"이라 쓰면 대본을 3번 재생성한 합이 1번어치처럼 보인다 — 그 자체가 조용한 거짓말이다.
 *
 * in  = 캐시 포함 총 입력, out = thinking/reasoning 포함 총 출력. 두 엔진(claude/codex) 동일 정의.
 * 분리 가능하지만 빼지 않는다 — 빼면 같은 "out" 이 엔진마다 다른 걸 세게 된다.
 *
 * 영속 없음(앱 끄면 사라짐) · 비용 추정 없음 · 스텝별 표시 없음.
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

export default function StoryTokenUsage({ usage }) {
  // 아직 아무것도 안 돌았으면 자리를 차지하지 않는다.
  if (!usage || (!usage.input && !usage.output)) return null
  return (
    <div className="story-token-usage" title="이 프로젝트를 연 뒤 누적된 토큰 (앱을 끄면 사라집니다)">
      <span className="story-token-usage__item">in {formatTokens(usage.input)}</span>
      <span className="story-token-usage__sep">/</span>
      <span className="story-token-usage__item">out {formatTokens(usage.output)}</span>
    </div>
  )
}
