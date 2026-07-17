/**
 * 프로젝트 세션 토큰 누산기 — 프로젝트를 연 시점부터의 누적.
 *
 * **모듈 싱글톤으로 만들지 말 것** — createStepMachine 안에 인스턴스로 두어야 프로젝트 전환 시
 * 함께 죽는다. 싱글톤이면 프로젝트 A 의 토큰이 B 에서 표시된다.
 *
 * 엔진마다 보고 방식이 다르다:
 *   claude — 호출당 delta   → addDelta      (가산)
 *   codex  — thread 누적치  → setCumulative (key 별 교체)
 * 같은 통에 넣고 전부 더하면 codex 가 뻥튀기된다. 이 기능의 유일한 실패 모드는
 * 조용히 틀린 합계이고, 그게 정확히 여기서 만들어진다.
 *
 * **run 경계는 없다.** "실행 시작"은 이 앱에 단일 이벤트가 아니고(자동 진행은 start() 연쇄,
 * generateTitle 같은 side action 은 start() 밖), start() 마다 리셋하면 연쇄 중 앞 합계가 사라진다.
 * 그래서 리셋 지점은 **프로젝트 전환** 하나뿐이다 — machine 이 죽으면 이 tracker 도 죽는다.
 * 표시 라벨도 "이 프로젝트 세션 누적"이어야 한다. "이번 실행"이라 쓰면 그 자체가 조용한 거짓말이다.
 *
 * 늦게 도착하는 이전 프로젝트의 보고는 provider tap 이 **호출 시작 시 sink 를 캡처**해서 막는다
 * (llmClaude.tapQuery / codexAppServer.runCodexTurn). 여기에 세대(epoch) 방어를 두지 않는 이유다.
 */
export function createUsageTracker() {
  let deltaIn = 0
  let deltaOut = 0
  const cumulative = new Map() // key(threadId) -> { input, output }

  return {
    addDelta(u) {
      if (!u) return
      deltaIn += u.input || 0
      deltaOut += u.output || 0
    },

    setCumulative(u) {
      if (!u?.key) return
      cumulative.set(u.key, { input: u.input || 0, output: u.output || 0 })
    },

    snapshot() {
      let input = deltaIn
      let output = deltaOut
      for (const v of cumulative.values()) {
        input += v.input
        output += v.output
      }
      return { input, output }
    },
  }
}
