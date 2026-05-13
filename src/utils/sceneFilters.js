/**
 * Scene filtering utilities — generation 대상 결정에 사용.
 *
 * 단일 출처(Single Source of Truth):
 *   - useAutomation.runConcurrentQueue가 sceneIndices 미지정 시 적용하는 동일 필터
 *   - App.jsx의 requireStyle / 자동 카드 검증도 같은 필터를 사용해야 한다 —
 *     안 그러면 "이미 완료된 씬이 매칭이면 통과되지만 실제 생성 대상엔 매칭 0"
 *     같은 거짓 통과가 발생.
 */

/**
 * 이미지 batch generation의 대상 씬을 필터한다.
 *
 * 조건: 이미지가 없거나(없는 게 미생성), 상태가 명시적으로 pending/error.
 *
 * @param {Array} scenes
 * @returns {Array}
 */
export function filterPendingScenes(scenes) {
  if (!Array.isArray(scenes)) return []
  return scenes.filter(s =>
    (!s.image && !s.imagePath) || s.status === 'pending' || s.status === 'error'
  )
}
