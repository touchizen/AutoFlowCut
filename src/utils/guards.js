/**
 * guards.js - 생성 전 공통 사전 체크 (폴더 권한 + 토큰)
 */

import { fileSystemAPI } from '../hooks/useFileSystem'
import { toast } from '../components/Toast'

/**
 * 폴더 모드일 때 폴더 설정 확인.
 * 데스크톱에서는 권한이 항상 있으므로 폴더 존재 여부만 확인.
 * @param {object} settings - 설정
 * @param {function} openSettings - 설정창 열기 함수
 * @param {function} t - 다국어 함수
 * @returns {{ ok: boolean }} ok = 통과 여부
 */
export async function checkFolderPermission(settings, openSettings, t) {
  if (settings.saveMode !== 'folder') return { ok: true }

  const result = await fileSystemAPI.ensurePermission()

  // 폴더 삭제됨
  if (result.error === 'folder_deleted') {
    toast.error(t('toast.folderDeleted'))
    openSettings('storage')
    return { ok: false }
  }

  // 폴더 미설정
  if (result.error === 'not_set') {
    toast.warning(t('toast.folderSelectFirst'))
    openSettings('storage')
    return { ok: false }
  }

  return { ok: true }
}

/**
 * Flow 토큰 확인 (배치 시작 전 필수 호출).
 * 캐시를 무시하고 실제 토큰 유효성을 재확인한다.
 * 만료 시 팝업(모달)으로 재로그인을 안내한다.
 * @param {object} flowAPI - Flow API
 * @param {function} t - 다국어 함수
 * @param {function} [showLoginModal] - 로그인 만료 모달 표시 함수
 * @returns {boolean} true = 통과, false = 차단됨
 */
export async function checkAuthToken(flowAPI, t) {
  // forceRefresh=true: 캐시 무시, 실제 WebContentsView에서 토큰 재추출
  const token = await flowAPI.getAccessToken(true)
  if (!token) {
    flowAPI.clearTokenCache()
    // 커스텀 이벤트로 로그인 만료 모달 표시 요청
    window.dispatchEvent(new CustomEvent('flow-login-expired'))
    return false
  }
  return true
}
