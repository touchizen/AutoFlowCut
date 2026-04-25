/**
 * useAutoSave — 프로젝트 데이터 자동 저장 (debounce)
 *
 * scenes/references/videoScenes/framePairs 변경 시 자동으로 project.json 저장.
 * 생성 중이거나 복원 중일 때는 스킵.
 */

import { useEffect } from 'react'
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
 * @param {Function} params.saveCurrentProject - 프로젝트 저장 함수
 */
export function useAutoSave({
  scenes, references, videoScenes, framePairs,
  selectedStyleRefId = null,
  settings, generatingRefsCount, isRunning,
  isRestoringRef, saveCurrentProject
}) {
  useEffect(() => {
    if (generatingRefsCount > 0 || isRunning) return
    if (isRestoringRef?.current) return
    if (scenes.length === 0 && references.length === 0 && videoScenes.length === 0) return
    if (settings.saveMode === 'folder' && settings.projectName) {
      const timer = setTimeout(async () => {
        if (isRestoringRef?.current) return
        await saveCurrentProject()
        console.log('[App] Auto-saved project data')
      }, TIMING.AUTO_SAVE_DEBOUNCE)
      return () => clearTimeout(timer)
    }
  }, [scenes, references, videoScenes, framePairs, selectedStyleRefId, settings.projectName, settings.saveMode, generatingRefsCount, isRunning])
}
