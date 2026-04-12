/**
 * useAppSettings — 앱 설정 관리 (초기화 + localStorage 동기화)
 */

import { useState, useEffect, useCallback } from 'react'
import { DEFAULTS, UI } from '../config/defaults'

const STORAGE_KEY = 'autoflowcut_settings'

function createDefaults() {
  const randomSeed = () => Math.floor(Math.random() * 1000000)
  return {
    defaultDuration: DEFAULTS.scene.duration,
    projectName: DEFAULTS.project.defaultName,
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
    delete parsed.aspectRatio
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

  return { settings, setSettings, updateSetting }
}
