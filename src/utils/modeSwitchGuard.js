/**
 * modeSwitchGuard — pure helper: 모드 전환 가능 여부 판단.
 * 어떤 배치도 실행 중이지 않아야 전환 가능.
 *
 * @param {{ isRunning: boolean, videoRunning: boolean, refBatchRunning: boolean, hasPendingBatch?: boolean }} state
 * @returns {boolean} true = 전환 가능, false = 배치 진행 중
 */
export function canSwitchMode({ isRunning, videoRunning, refBatchRunning, hasPendingBatch = false }) {
  return !isRunning && !videoRunning && !refBatchRunning && !hasPendingBatch
}

/**
 * shouldApplyModeScopedUpdate — 비동기 작업(예: 다운로드-only 비디오 retry) 완료 결과를
 * 현재 상태에 반영해도 되는지 판단. 작업 시작 시점 모드(startMode)와 완료 시점 모드
 * (currentMode)가 같아야 한다. 다르면 사용자가 도중에 모드를 전환한 것 →
 * stale 교차-모드 데이터로 현재 모드 UI 를 덮어쓰지 않도록 막는다(#R23-7).
 *
 * @param {string} currentMode - 완료 시점의 현재 모드 (modeRef.current)
 * @param {string} startMode   - 작업 시작 시 스냅샷한 모드
 * @returns {boolean} true = 반영해도 안전
 */
export function shouldApplyModeScopedUpdate(currentMode, startMode) {
  return currentMode === startMode
}
