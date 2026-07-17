/**
 * 실행 단위 토큰 누산기.
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
 * epoch: "실행 시작"은 이 앱에 단일 이벤트가 아니다 — 자동 진행은 scenes/prompts 를 각각 별도
 * start() 로 부르고, generateTitle 같은 side action 은 start() 밖이다. beginRun() 은 사용자가
 * 새 실행을 승인한 시점에만 부른다(start() 마다가 아니다 — 그러면 연쇄 중 앞 합계가 사라진다).
 * 늦게 끝난 이전 실행의 콜백은 자기 epoch 를 들고 오므로 무시된다.
 */
export function createUsageTracker() {
  let epoch = 1
  let deltaIn = 0
  let deltaOut = 0
  const cumulative = new Map() // key(threadId) -> { input, output }

  // at 생략 = 현재 실행으로 간주(호출부가 epoch 를 안 쓰는 단순 경로)
  const fresh = (at) => at === undefined || at === epoch

  return {
    currentEpoch: () => epoch,

    beginRun() {
      epoch += 1
      deltaIn = 0
      deltaOut = 0
      cumulative.clear()
      return epoch
    },

    addDelta(u, at) {
      if (!u || !fresh(at)) return
      deltaIn += u.input || 0
      deltaOut += u.output || 0
    },

    setCumulative(u, at) {
      if (!u?.key || !fresh(at)) return
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
