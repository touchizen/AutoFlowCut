/**
 * useAutoSave — 프로젝트 데이터 자동 저장 (debounce)
 *
 * scenes/references/videoScenes/framePairs 변경 시 자동으로 project.json 저장.
 * 생성 중이거나 복원 중일 때는 스킵.
 */

import { useEffect, useRef } from 'react'
import { TIMING } from '../config/defaults'

/**
 * @param {object} params
 * @param {Array} params.scenes
 * @param {Array} params.references
 * @param {Array} params.videoScenes
 * @param {Array} params.framePairs
 * @param {string|null} [params.selectedStyleRefId] - 현재 선택된 스타일 (변경 시 자동 저장)
 * @param {object} params.settings - { saveMode, projectName }
 * @param {number} params.generatingRefsCount - 생성 중인 레퍼런스 수
 * @param {boolean} params.isRunning - 자동화 실행 중 여부
 * @param {React.MutableRefObject} params.isRestoringRef - 복원 중 여부
 * @param {Function} params.saveCurrentProject - 프로젝트 저장 함수 ({success}|undefined 반환)
 * @param {Function} [params.onSaveError] - 저장 실패 시 호출 (인자: 에러 메시지)
 */
export function useAutoSave({
  scenes, references, videoScenes, framePairs,
  selectedStyleRefId = null,
  settings, generatingRefsCount, isRunning,
  isRestoringRef, saveCurrentProject, onSaveError = null
}) {
  // onSaveError 는 deps 에 넣지 않고 ref 로 최신값을 추적한다 — 콜백이 매 렌더
  // 새 클로저여도 autosave 타이머가 재예약되지 않게.
  const onSaveErrorRef = useRef(onSaveError)
  onSaveErrorRef.current = onSaveError
  // 저장 실패가 연속될 때 토스트 도배 방지 — 실패 streak 의 첫 건에서만 알린다.
  const saveFailedRef = useRef(false)

  useEffect(() => {
    if (generatingRefsCount > 0 || isRunning) return
    if (isRestoringRef?.current) return
    if (scenes.length === 0 && references.length === 0 && videoScenes.length === 0) return
    if (settings.saveMode === 'folder' && settings.projectName) {
      const timer = setTimeout(async () => {
        if (isRestoringRef?.current) return
        const res = await saveCurrentProject()
        if (res && res.success === false) {
          // 생성 직후 등 autosave 실패 — 조용히 묻으면 이미지는 있는데 메타가
          // 유실된다. 사용자에게 보이게 한다.
          console.warn('[App] Auto-save failed:', res.error)
          if (!saveFailedRef.current) {
            saveFailedRef.current = true
            onSaveErrorRef.current?.(res.error)
          }
        } else {
          saveFailedRef.current = false
          console.log('[App] Auto-saved project data')
        }
      }, TIMING.AUTO_SAVE_DEBOUNCE)
      return () => clearTimeout(timer)
    }
  }, [scenes, references, videoScenes, framePairs, selectedStyleRefId, settings.projectName, settings.saveMode, settings.aspectRatio, generatingRefsCount, isRunning])
}
