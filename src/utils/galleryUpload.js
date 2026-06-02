/**
 * galleryUpload — F2V 디스크 업로드 프레임을 프로젝트 리소스(frames/)로 영속 저장.
 *
 * 핵심: fileSystemAPI.saveResource 는 실패 시 throw 가 아니라 { success:false }
 * 를 반환한다. 결과를 확인하지 않으면 "조용한 성공" 후 재오픈 시 frames/ 폴백이
 * 없어 "No start image" 가 난다 (특히 work folder/권한 미준비 상태에서 먼저 업로드).
 *
 * 저장 실패 시 addPendingSave 로 보정 재시도를 등록한다 (useReferenceGeneration 의
 * 저장-실패 패턴과 동일) — 폴더/권한이 준비되면 다음 저장 시점에 디스크로 영속화.
 *
 * fs 주입 가능 → 단위 테스트.
 *
 * @param {object} params
 * @param {string} params.localId
 * @param {string} params.dataUrl
 * @param {string} params.saveMode - 'folder' 일 때만 디스크 저장
 * @param {string} params.projectName
 * @param {object} [params.fs] - fileSystemAPI (기본: 싱글톤)
 * @param {Function} [params.addPendingSave] - 저장 실패 시 보정 재시도 등록
 * @returns {Promise<{persisted:boolean, error?:string}>}
 */
import { RESOURCE } from '../config/defaults'
import { fileSystemAPI } from '../hooks/useFileSystem'

export async function persistGalleryFrame({ localId, dataUrl, saveMode, projectName, fs = fileSystemAPI, addPendingSave } = {}) {
  // memory 모드 또는 projectName/데이터 없음 → 디스크 저장 안 함 (이번 세션 메모리만).
  if (saveMode !== 'folder' || !projectName || !localId || !dataUrl) {
    return { persisted: false }
  }

  const doSave = () => fs.saveResource(projectName, RESOURCE.FRAMES, localId, dataUrl)

  let res
  try {
    res = await doSave()
  } catch (e) {
    res = { success: false, error: e?.message || String(e) }
  }

  if (res?.success) return { persisted: true }

  // 저장 실패(권한/폴더 미준비, IO 오류 등) → 보정 재시도 등록. 조용히 성공 처리하지 않는다.
  if (typeof addPendingSave === 'function') addPendingSave(doSave)
  return { persisted: false, error: res?.error || 'frame disk save failed' }
}
