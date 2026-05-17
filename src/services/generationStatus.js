/**
 * 생성 완료 판정 helper — MCP/UI 양쪽에서 같은 기준으로 done 카운팅.
 *
 * 회귀 컨텍스트 (P2/P3 review v2):
 *   force 재생성 중 status='pending'으로 리셋되지만 image/path/mediaId는 비교 위해 유지.
 *   기존 done 계산이 image/mediaId만 보면 "이미 다 됐다"고 100% stuck. status를 같이 봐서
 *   in-flight (pending/generating/error) 면 done에서 제외해야 progress가 올바르게 표시됨.
 *
 *   MCP는 ref를 mediaId 기준, UI는 data||filePath 기준 — 다른 정의 자체는 유효한 도메인 차이.
 *   하지만 "status가 in-flight면 done에서 제외" 정책은 공통이어야 한다 → 이 helper로 통일.
 */

/**
 * @param {object} scene
 * @returns {boolean}
 */
export function isSceneGenerationDone(scene) {
  if (!scene) return false
  // status가 in-flight면 image가 있어도 done 아님 (force 재생성 중)
  if (scene.status === 'pending' || scene.status === 'generating' || scene.status === 'error') {
    return false
  }
  return !!(scene.image || scene.imagePath)
}

/**
 * MCP 도메인 — Flow 업로드 완료(mediaId) 기준.
 * @param {object} ref
 * @returns {boolean}
 */
export function isReferenceUploadedDone(ref) {
  if (!ref) return false
  if (ref.status === 'pending' || ref.status === 'generating' || ref.status === 'error') {
    return false
  }
  return !!ref.mediaId
}

/**
 * UI panel 도메인 — 이미지 데이터/경로 있음 기준.
 * @param {object} ref
 * @returns {boolean}
 */
export function isReferenceImageDone(ref) {
  if (!ref) return false
  if (ref.status === 'pending' || ref.status === 'generating' || ref.status === 'error') {
    return false
  }
  return !!(ref.data || ref.filePath)
}
