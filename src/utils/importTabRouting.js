/**
 * import한 데이터를 보거나 편집할 수 있는 탭으로 자동 전환하기 위한 라우팅.
 *
 * text/csv 만 직접 라우팅한다:
 *   - 이미지 모드 → 'text' (이미지 프롬프트 입력 탭)
 *   - 비디오 모드 → 'video-text' (비디오 프롬프트 입력 탭)
 *
 * srt/reference 는 자체 흐름이 전환을 담당하므로 null:
 *   - srt: 즉시 처리 시 'list' 전환 / conflict 모달 resolve 시 'list' 전환
 *   - reference: Ref 패널을 직접 연다
 *
 * @param {string} type - 'text' | 'csv' | 'srt' | 'reference'
 * @param {boolean} isVideo - 비디오 모드 여부
 * @returns {string|null} 전환할 탭 이름, 또는 직접 라우팅 대상이 아니면 null
 */
export function tabForType(type, isVideo) {
  if (type === 'text' || type === 'csv') {
    return isVideo ? 'video-text' : 'text'
  }
  return null
}

/**
 * 실제로 import가 일어났을 때만 탭 전환.
 *
 * wrong-type 확인창에서 사용자가 Cancel하면 action이 실행되지 않으므로
 * (didImport=false) 탭을 전환하면 안 된다 — 안 그러면 가져온 게 없는데
 * 화면이 바뀌어 import된 것처럼 느껴진다.
 *
 * @param {{ didImport: boolean, type: string, isVideo: boolean }} params
 * @returns {string|null} 전환할 탭 이름, 또는 전환하지 않으면 null
 */
export function tabAfterImport({ didImport, type, isVideo }) {
  if (!didImport) return null
  return tabForType(type, isVideo)
}
