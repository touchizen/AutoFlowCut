/**
 * galleryUpload — F2V 디스크 업로드 프레임을 프로젝트 리소스(frames/)로 저장.
 *
 * saveResource 는 실패 시 throw 가 아니라 { success:false } 를 반환한다(예: work folder/
 * 권한 미준비). 결과를 확인하지 않으면 "조용한 성공" 후 재오픈 시 frames/ 폴백이 없어
 * "No start image" 가 난다.
 *
 * 정책(folder 모드): 디스크에 영속 저장되지 않으면 업로드를 **실패**로 돌린다 → 호출부가
 * gallery::local-* pair 를 만들지 않게 해, 재오픈 시 깨지는 항목 생성을 막는다.
 * (desktop 의 addPendingSave 는 no-op 이라 "나중에 재시도" 는 신뢰 불가 → 즉시 실패시켜
 *  사용자가 work folder 를 먼저 설정하도록 유도.)
 * memory 모드: 디스크가 없으므로 이번 세션 메모리로만 동작 (success:true, persisted:false).
 *
 * fs 주입 가능 → 단위 테스트.
 *
 * @param {object} params
 * @param {string} params.localId
 * @param {string} params.dataUrl
 * @param {string} params.saveMode - 'folder' 일 때만 디스크 저장 + 영속 요구
 * @param {string} params.projectName
 * @param {object} [params.fs] - fileSystemAPI (기본: 싱글톤)
 * @returns {Promise<{success:boolean, persisted:boolean, error?:string}>}
 */
import { RESOURCE } from '../config/defaults'
import { fileSystemAPI } from '../hooks/useFileSystem'

export async function saveGalleryFrame({ localId, dataUrl, saveMode, projectName, fs = fileSystemAPI } = {}) {
  // memory 모드: 디스크 저장 없음 — 이번 세션 메모리 dataUrl 로만 사용 (영속성 보장 안 함).
  if (saveMode !== 'folder') {
    return { success: true, persisted: false }
  }
  if (!projectName || !localId || !dataUrl) {
    return { success: false, persisted: false, error: 'missing project or data' }
  }

  let res
  try {
    res = await fs.saveResource(projectName, RESOURCE.FRAMES, localId, dataUrl)
  } catch (e) {
    res = { success: false, error: e?.message || String(e) }
  }

  if (res?.success) return { success: true, persisted: true }
  // folder 모드인데 디스크 저장 실패 → 업로드 실패 (조용한 성공 금지, pair 생성 막음).
  return { success: false, persisted: false, error: res?.error || 'frame disk save failed' }
}
