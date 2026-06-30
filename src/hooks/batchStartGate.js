/**
 * 씬 배치 시작 게이트 결정. subscriptionBatch == null = 미게이트(test/legacy) → proceed.
 *
 * Actions:
 *   - 'proceed'  : 진행 가능
 *   - 'login'    : 비로그인 → 로그인 모달
 *   - 'loading'  : 인증됐지만 subscription doc 확인 중 (loading/error 상태) → 대기/재시도 (paywall 아님)
 *   - 'paywall'  : 인증+quota 소진 → paywall 모달
 *
 * subscriptionStatus 'loading'|'error': 인증됐지만 Firestore doc 이 아직 확인되지 않은 상태.
 * calculateTrialStatus(null) 은 full free quota 를 반환하지만 서버가 consume 을 거부하므로,
 * 이 상태에서는 진행을 막아 BYOK 생성 → consume 거부 패턴을 예방한다.
 *
 * isReusingBatch (#5): 직전 batchId 를 재사용하는 retry(부분 재시도/저장실패 재다운로드)면 true.
 *   이 경우 서버 consume 은 멱등 no-op(이미 과금됨) 이거나, 미과금이면 서버가 quota 로 거부하므로
 *   클라 paywall 로 미리 막을 필요가 없다. quota 소진(batchRemaining 0) 후에도 이미 과금된 배치의
 *   retry 가 paywall 에 걸려 막히는 회귀를 방지한다. (전체 재생성은 새 batchId → isReusingBatch=false
 *   → paywall 정상 적용.) login/loading 우선순위는 유지(재사용이어도 서버 호출엔 세션/doc 필요).
 */
export function batchStartGate({ subscriptionBatch, isAuthenticated, subscriptionStatus, isReusingBatch = false }) {
  if (subscriptionBatch == null) return { action: 'proceed' }
  if (!isAuthenticated) return { action: 'login' }
  // 인증됐지만 subscription doc 이 loading/error 상태면 진행 불가 (서버가 consume 거부).
  // subscriptionStatus 가 명시적으로 'loading' 또는 'error' 이면 대기가 필요.
  // 하위호환: subscriptionStatus 미전달(undefined) 이면 기존 동작 유지(procede 분기로 흘러감).
  if (subscriptionStatus === 'loading' || subscriptionStatus === 'error') {
    return { action: 'loading' }
  }
  // 기존 batchId 재사용(retry) → 서버 멱등 no-op/거부에 위임, paywall 스킵.
  if (isReusingBatch) return { action: 'proceed' }
  const { batchRemaining, batchUnlimited } = subscriptionBatch
  if (!batchUnlimited && (batchRemaining ?? 0) <= 0) return { action: 'paywall' }
  return { action: 'proceed' }
}
