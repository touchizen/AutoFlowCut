/**
 * 경로 세그먼트 안전성 — traversal/구분자/null 을 막는 단 하나의 순수 검사.
 *
 * 🔴 **보안 primitive 는 한 곳에만 둔다.** import 경계(filesystem.js)와 에이전트 이미지 읽기
 *    (sceneImages.js)가 각자 복제하면 한쪽만 강화됐다가 다른 쪽으로 traversal 이 샌다.
 *    Electron 의존 없음 — 순수 노드/렌더러 공용.
 */
export function isSafeImportPathSegment(value) {
  return typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('\0')
}
