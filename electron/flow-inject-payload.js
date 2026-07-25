/**
 * Flow 페이지 주입(window.__autoflowcut_inject__) payload 의 단일 contract.
 *
 * setFlowPageInject(arm)와 clearFlowPageInject(reset)가 **같은 필드 집합**을 쓰게 한 곳에 모은다.
 * 필드가 갈라지면(예: 호출부는 top-level duration/videoModel 을 넘기는데 setter 가 구조분해를
 * 빠뜨리면) 주입이 조용히 no-op 된다 — 실제로 T2V OmniFlash 모델강제·길이최적화가 누락됐었다.
 *
 * 페이지측(electron/flow-page-injection.js)이 읽는 필드:
 *   seed, aspectRatio(이미지 imageAspectRatio), videoAspectRatio(비디오 requests[].aspectRatio),
 *   references, i2v(객체), duration(t2v 길이접미사), videoModel(t2v OmniFlash 강제),
 *   genTag(#R35: 이 요청을 특정 async 생성에 correlate 하는 고유 태그 — 응답 보고에 실려 나감)
 */

// '9:16'/'16:9'(또는 이미 VIDEO_ASPECT_RATIO_*) → 비디오 요청 body(requests[].aspectRatio) enum.
// Flow 가 설정 패널을 통합 탭 UI 로 바꿔 DOM 화면비 세터(applyAgentDefaults)가 비디오에 적용되지
// 않게 됐다 — 대신 이 값을 요청에 직접 주입해 DOM 과 무관하게 화면비를 싣는다(이미지의
// imageAspectRatio 주입 미러). 매칭 불가(빈 값 등)면 null → 요청 미수정(Flow 기본값 유지).
export function toVideoAspectEnum(ratio) {
  if (typeof ratio !== 'string' || !ratio.trim()) return null
  if (ratio.startsWith('VIDEO_ASPECT_RATIO_')) return ratio
  if (ratio === '9:16' || /PORTRAIT|9\s*[:x]?\s*16/i.test(ratio)) return 'VIDEO_ASPECT_RATIO_PORTRAIT'
  if (ratio === '16:9' || /LANDSCAPE|16\s*[:x]?\s*9/i.test(ratio)) return 'VIDEO_ASPECT_RATIO_LANDSCAPE'
  return null
}

/** 주입 arm payload — 누락/undefined 필드는 null(= 미수정). */
export function buildFlowInjectPayload({ seed, aspectRatio, videoAspectRatio, references, i2v, duration, videoModel, genTag } = {}) {
  return {
    seed:        seed        ?? null,
    aspectRatio: aspectRatio ?? null,
    // 비디오 요청 requests[].aspectRatio 로 주입할 VIDEO_ASPECT_RATIO_* enum(이미지의 aspectRatio 와 별개).
    videoAspectRatio: videoAspectRatio ?? null,
    references:  references  ?? null,
    i2v:         i2v         ?? null,
    duration:    duration    ?? null,
    videoModel:  videoModel  ?? null,
    // #R35: seed 를 건드리지 않고 요청↔생성 correlation 을 하기 위한 고유 태그. 페이지 monkey-patch 가
    //   요청 처리 시 캡처해 batchGenerateImages 응답 보고(flowReportResponse)에 함께 실어 보낸다.
    genTag:      genTag      ?? null,
  }
}

/** 주입 reset payload — 모든 필드를 null 로(arm 과 동일 키 집합 보장). */
export function flowInjectClearPayload() {
  return buildFlowInjectPayload()
}
