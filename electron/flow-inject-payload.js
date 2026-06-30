/**
 * Flow 페이지 주입(window.__autoflowcut_inject__) payload 의 단일 contract.
 *
 * setFlowPageInject(arm)와 clearFlowPageInject(reset)가 **같은 필드 집합**을 쓰게 한 곳에 모은다.
 * 필드가 갈라지면(예: 호출부는 top-level duration/videoModel 을 넘기는데 setter 가 구조분해를
 * 빠뜨리면) 주입이 조용히 no-op 된다 — 실제로 T2V OmniFlash 모델강제·길이최적화가 누락됐었다.
 *
 * 페이지측(electron/flow-page-injection.js)이 읽는 필드:
 *   seed, aspectRatio, references, i2v(객체), duration(t2v 길이접미사), videoModel(t2v OmniFlash 강제)
 */

/** 주입 arm payload — 누락/undefined 필드는 null(= 미수정). */
export function buildFlowInjectPayload({ seed, aspectRatio, references, i2v, duration, videoModel } = {}) {
  return {
    seed:        seed        ?? null,
    aspectRatio: aspectRatio ?? null,
    references:  references  ?? null,
    i2v:         i2v         ?? null,
    duration:    duration    ?? null,
    videoModel:  videoModel  ?? null,
  }
}

/** 주입 reset payload — 모든 필드를 null 로(arm 과 동일 키 집합 보장). */
export function flowInjectClearPayload() {
  return buildFlowInjectPayload()
}
