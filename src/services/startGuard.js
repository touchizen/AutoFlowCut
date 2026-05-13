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
