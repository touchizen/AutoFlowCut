// handleStart 초입 guard — hasPendingBatch는 M2 failure 모달이 열린 동안 유지되어 MCP
// stop-restart의 scene start 재호출을 막는 latch다.
export function isStartBlocked({ isRunning, videoRunning, hasPendingBatch, retryInFlight, upscaylRunning }) {
  return !!(isRunning || videoRunning || hasPendingBatch || retryInFlight || upscaylRunning)
}

// handleStop 이 ref 작업을 중단할지.
//
// refBatchRunning(preparing/stopping/generating) 만으로는 부족하다 — 빈 레퍼런스 gate 가
// 생성 중일 때 그 flag 들이 전부 false 인 창이 둘 있다: (1) 공유 큐에서 배치가 앞 작업 뒤에
// 대기하는 동안(분 단위), (2) 아이템마다 도는 auth preflight 동안(Flow character 직행 경로는
// preflight 추적을 건너뛴다 — 그런데 빈 character 카드가 바로 이 gate 의 대상이라 이게 기본
// 경로다). 그 창에서 Stop 은 렌더돼 있는데 아무 일도 안 했다.
// gate 가 busy 면 flag 와 무관하게 중단한다. 이르게 불러도 안전하다 — 배치가 enqueue 시점의
// stop 버전과 비교해 큐 대기 중 들어온 중단을 시작할 때 소비한다.
export function shouldStopRefWork({ refBatchRunning, gatePhase }) {
  return !!refBatchRunning || gatePhase === 'busy'
}

/**
 * handleStart의 requireStyle 가드 보조 — auto 매칭 가능 여부 계산.
 *
 * 분리 이유: App.jsx의 handleStart는 길어서 단위 테스트가 부담스러움. 가드 로직만
 * 순수 함수로 빼서 test에서도 same code path 호출 (App.handleStart.test.js).
 *
 * 의미:
 *   - 기본 (force=false): styleResolver.autoAvailable 그대로 — filterPendingScenes 기준.
 *   - force=true: targetScenes (force 대상, 보통 전체 prompt 씬) 기준으로 재계산.
 *     완료 씬만 있는 프로젝트에서 MCP 강제 재생성 시 picker가 뜨고 abort되던 회귀 (P3) 차단.
 *
 * @param {object} args
 * @param {boolean} args.force
 * @param {Array} args.targetScenes
 * @param {Array} args.references
 * @param {boolean} args.autoAvailable - non-force 케이스 fallback
 * @param {Function} [args.previewStyleMatchingFn] - 의존성 주입 (test에서 mock 가능)
 * @returns {boolean}
 */
export function computeGuardAvailable({ force, targetScenes, references, autoAvailable, previewStyleMatchingFn }) {
  if (!force) return !!autoAvailable
  if (!previewStyleMatchingFn) {
    // App.jsx에서 import해 호출할 땐 항상 fn 주입. 누락은 호출자 버그.
    throw new Error('computeGuardAvailable: previewStyleMatchingFn required when force=true')
  }
  const preview = previewStyleMatchingFn(targetScenes, references)
  return (preview?.matches.length ?? 0) > 0
}
