/**
 * src/utils/flowMediaId.js — Flow 미디어 id 모양(UUID) 술어. 렌더러(App handleVideoRetry · useVideoAutomation Phase 0 · videoRecovery #R34-1)와
 * main(flow-rpc-protocol parseVideoSubmitResponse [3][0][0])이 **같은** 술어를 쓴다.
 *
 * M2-R5 J2(A2 = B1 + B5): 돈 규칙(과금된 Flow 제출 = Flow 모양 generationId + videoPath 없음)은 id 모양에 묶여 있다. 사본이 셋(훅·복구·App 은 없었다)이면 하나가 빠지거나
 *   어긋나는 순간 API operation 이름이 download-only 로 폴링되거나(App), 파서가 받아들인 모양을 분류가 fresh 로 잡아 재제출한다(파서·분류 불일치, 돈에 fail-open).
 *   파서가 같은 술어로 [3][0][0] 을 거부하므로 UUID 모양이 아닌 값은 charged generationId 가 될 수 없다.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Flow 가 발급한 미디어/제출 id 모양(UUID)인가. 문자열이 아니거나 비었거나 다른 모양(API operation 이름 `models/…/operations/…` 등)이면 false. */
export function isFlowMediaId(value) {
  return typeof value === 'string' && UUID_SHAPE.test(value.trim())
}

/**
 * M2-R5 J3(B2): 옛 서버측 생성 실패 행 — Flow 의 정책/위험 필터 문구(`PUBLIC_ERROR_*`)가 `error` 에 그대로 남고 kind 는 없다(`errorKind` null), mediaId·videoPath 없음
 * (사용자 실데이터: 야담02 fp_5 · 무한야담ep03 vscene_1/fp_1/fp_2 — 디스크 파일 없음). 미디어가 만들어진 적이 없어 폴 대상이 아니다 — 과금된 in-flight 로 세지 않는다
 * (Start 는 재제출, plain Retry 는 pending 리셋). 넷 다 맞아야 true — kind 가 있거나 mediaId 가 있으면 그 행은 이 라운드의 종결 패치 모양이라 download-only 규칙 그대로.
 */
export function isLegacyFlowGenerationFailure(item) {
  return !!item && item.errorKind == null && typeof item.error === 'string' && /^PUBLIC_ERROR_/.test(item.error) && item.mediaId == null && !item.videoPath
}
