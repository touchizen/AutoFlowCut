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
  // 진행중(스트리밍) 응답의 임시 usage. message_delta 는 응답 내 누적치라 key 별 교체한다.
  // 응답이 끝나면 tap 이 clearPending 후 확정치를 addDelta 로 커밋한다 — 안 지우면 이중계산.
  // codex cumulative 와 별개 통이라 key 문자열이 겹쳐도 안전하다.
  const pending = new Map() // key(query) -> { input, output }

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

    setPending(key, u) {
      // clear-shaped 페이로드({clear:true})는 저장하지 않는다 — 배선이 clear 를 setPending 으로
      // 잘못 흘려도(라우팅 회귀) {0,0} 유령 엔트리를 만들지 않는다(진짜 pending 은 input/output 을 가짐).
      if (!key || !u || u.clear) return
      pending.set(key, { input: u.input || 0, output: u.output || 0 })
    },

    clearPending(key) {
      if (!key) return
      pending.delete(key)
    },

    snapshot() {
      let input = deltaIn
      let output = deltaOut
      for (const v of cumulative.values()) { input += v.input; output += v.output }
      for (const v of pending.values()) { input += v.input; output += v.output }
      return { input, output }
    },
  }
}
