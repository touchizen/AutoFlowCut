/**
 * useAppSettings — 앱 설정 관리 (초기화 + localStorage 동기화)
 */

import { useState, useEffect, useCallback } from 'react'
import { DEFAULTS, UI } from '../config/defaults'
import { generateProjectName } from '../utils/formatters'

const STORAGE_KEY = 'autoflowcut_settings'

function createDefaults() {
  const randomSeed = () => Math.floor(Math.random() * 1000000)
  return {
    defaultDuration: DEFAULTS.scene.duration,
    projectName: DEFAULTS.project.defaultName,
    aspectRatio: '16:9', // 프로젝트 화면비: '16:9' 롱폼 / '9:16' 숏폼
    saveMode: 'folder',
    concurrency: DEFAULTS.generation.concurrency,
    exportThreshold: UI.EXPORT_THRESHOLD,
    imageBatchCount: 1,
    imageUpscale: 'off',
    videoBatchCount: 1,
    videoResolution: '1080p',
    requireStyle: false,
    seedNo: randomSeed(),
    seedLocked: true,
    mcpHttpEnabled: false,
    mcpHttpPort: 3210
  }
}

function loadSettings() {
  const defaults = createDefaults()
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    const parsed = JSON.parse(saved)
    // 이전 버전 호환: 불필요한 설정 제거
    delete parsed.method
    // seedNo 가 없거나 유효하지 않으면 랜덤으로 초기화
    if (typeof parsed.seedNo !== 'number' || !Number.isFinite(parsed.seedNo)) {
      parsed.seedNo = defaults.seedNo
    }
    return { ...defaults, ...parsed }
  }
  return defaults
}

/**
 * @returns {{ settings, setSettings, updateSetting }}
 */
export function useAppSettings() {
  const [settings, setSettings] = useState(loadSettings)

  // localStorage 동기화
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  // 개별 설정값 변경 헬퍼
  const updateSetting = useCallback((key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }, [])

  /**
   * 프로젝트명을 보장한다.
   * - 이미 유효한 값이 있으면 그대로 반환
   * - 없으면(빈 문자열/falsy) 새 이름을 생성해 settings에 고정하고 반환
   *
   * 호출마다 Date.now()가 새로 찍혀 여러 개의 autoflowcut_<ts> 고아 폴더가
   * 만들어지는 문제를 방지하기 위해, 한 번 생성한 이름은 settings에 영구 저장한다.
   */
  const ensureProjectName = useCallback(() => {
    const current = settings.projectName
    if (current && typeof current === 'string' && current.trim()) {
      return current
    }
    const generated = generateProjectName()
    setSettings(prev => {
      // 동일 렌더에서 다른 호출이 이미 이름을 확정했다면 그 값 유지
      if (prev.projectName && typeof prev.projectName === 'string' && prev.projectName.trim()) {
        return prev
      }
      return { ...prev, projectName: generated }
    })
    return generated
  }, [settings.projectName])

  return { settings, setSettings, updateSetting, ensureProjectName }
}
