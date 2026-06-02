/**
 * projectPersist — 프로젝트 저장 시 base64 strip 정책.
 *
 * references 는 보통 디스크(references/<name>)에 저장되므로 project.json 에선 base64(data)를
 * 빼서 파일 비대화를 막는다. 하지만 디스크 저장이 실패한(=filePath 가 없는) ref 의 base64 를
 * 무조건 빼면, desktop 의 addPendingSave 가 no-op 이라 재시도도 없어 재오픈 시 이미지가
 * 영구 유실된다(상태는 'done' 이라 사용자가 인지도 못 함).
 *
 * 따라서 filePath 가 있는(디스크에 안전히 저장된) ref 만 data 를 strip 하고, filePath 가
 * 없는 ref 는 base64 를 project.json 에 보존한다. 로드 시(useProjectData) 디스크 파일이
 * 없으면 project.json 의 data 를 그대로 살린다 → 유실 방지.
 *
 * @param {Array} references
 * @returns {Array}
 */
export function stripReferencesForSave(references = []) {
  return (references || []).map((ref) => {
    if (ref && ref.filePath) {
      // 디스크에 저장됨 → base64 제거 (로드 시 filePath 로 복원)
      const { data, ...rest } = ref
      return rest
    }
    // 미저장(저장 실패 등) → base64 보존 (재오픈 유실 방지)
    return ref
  })
}
